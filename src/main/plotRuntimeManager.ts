import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { PlotRendererLanguage, PlotRuntimeCapability, PlotRuntimeInstallJob } from '../shared/scientificPlot';
export type { PlotRuntimeInstallJob } from '../shared/scientificPlot';

export interface PlotRuntimeCommand {
  executable: string;
  prefixArgs: string[];
}

export interface RuntimeCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RuntimeCommandRunner = (
  executable: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal; cwd?: string }
) => Promise<RuntimeCommandResult>;

export interface PlotRuntimeManagerOptions {
  managedRoot: string;
  manifestPath: string;
  installerIntentPath?: string;
  commandRunner?: RuntimeCommandRunner;
  fetchImpl?: typeof fetch;
  now?: () => string;
  env?: NodeJS.ProcessEnv;
}

interface RuntimeManifestEntry {
  version: string;
  fileName: string;
  url: string;
  sha256: string;
  size: number;
  license: string;
}

interface RuntimeManifest {
  schemaVersion: string;
  runtimes: { python: RuntimeManifestEntry; r: RuntimeManifestEntry };
}

const PYTHON_PACKAGES = [
  'numpy==2.2.6', 'pandas==2.3.1', 'matplotlib==3.10.3', 'seaborn==0.13.2',
  'plotly==6.2.0', 'scipy==1.16.0', 'statsmodels==0.14.5', 'openpyxl==3.1.5',
  'pillow==11.3.0', 'tifffile==2025.6.11'
];
const R_PACKAGES = ['jsonlite', 'ggplot2', 'patchwork', 'ComplexHeatmap', 'ggalluvial', 'survival', 'svglite', 'ragg', 'plotly', 'htmlwidgets'];

export class PlotRuntimeManager {
  readonly managedRoot: string;
  private readonly manifestPath: string;
  private readonly installerIntentPath?: string;
  private readonly configuredRootsPath: string;
  private readonly commandRunner: RuntimeCommandRunner;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly installJobs = new Map<string, PlotRuntimeInstallJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly runtimeCommands = new Map<PlotRendererLanguage, PlotRuntimeCommand>();

  constructor(options: PlotRuntimeManagerOptions) {
    this.managedRoot = path.resolve(options.managedRoot);
    this.manifestPath = path.resolve(options.manifestPath);
    this.installerIntentPath = options.installerIntentPath ? path.resolve(options.installerIntentPath) : undefined;
    this.configuredRootsPath = path.join(this.managedRoot, 'runtime-roots.json');
    this.commandRunner = options.commandRunner ?? runCommand;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.env = options.env ?? process.env;
  }

  async detectAll(): Promise<PlotRuntimeCapability[]> {
    const checkedAt = this.now();
    const [python, r, matlab] = await Promise.all([
      this.detectPython(checkedAt),
      this.detectR(checkedAt),
      this.detectMatlab(checkedAt)
    ]);
    const javascript: PlotRuntimeCapability = {
      language: 'javascript',
      status: 'ready',
      version: 'ECharts 6.1.0',
      managed: true,
      packages: { echarts: '6.1.0', 'echarts-gl': '2.1.0' },
      message: '应用内置，可即时生成 SVG/Canvas 预览。',
      checkedAt
    };
    this.runtimeCommands.set('javascript', { executable: 'internal:echarts', prefixArgs: [] });
    return [javascript, python, r, matlab];
  }

  getRuntimeCommand(language: PlotRendererLanguage): PlotRuntimeCommand | undefined {
    const command = this.runtimeCommands.get(language);
    return command ? { executable: command.executable, prefixArgs: [...command.prefixArgs] } : undefined;
  }

  async readInstallerIntent(): Promise<{ python: boolean; r: boolean; matlabDetect: boolean }> {
    if (!this.installerIntentPath || !(await exists(this.installerIntentPath))) {
      return { python: false, r: false, matlabDetect: false };
    }
    const content = await readFile(this.installerIntentPath, 'utf8');
    const read = (key: string) => new RegExp(`^${key}=1$`, 'mi').test(content);
    if (read('Applied')) return { python: false, r: false, matlabDetect: false };
    return { python: read('Python'), r: read('R'), matlabDetect: read('MatlabDetect') };
  }

  async acknowledgeInstallerIntent(): Promise<boolean> {
    if (!this.installerIntentPath || !(await exists(this.installerIntentPath))) return false;
    const content = await readFile(this.installerIntentPath, 'utf8');
    const next = /^Applied=/mi.test(content)
      ? content.replace(/^Applied=.*$/mi, 'Applied=1')
      : `${content.trimEnd()}\nApplied=1\n`;
    await writeFile(this.installerIntentPath, next, 'utf8');
    return true;
  }

  startInstall(language: 'python' | 'r', targetRoot = this.managedRoot): PlotRuntimeInstallJob {
    const safeRoot = validateManagedRoot(targetRoot);
    const targetPath = path.join(safeRoot, language);
    const job: PlotRuntimeInstallJob = {
      id: `runtime-${randomUUID()}`,
      language,
      status: 'queued',
      progress: 0,
      message: '等待下载官方运行环境。',
      targetPath,
      createdAt: this.now()
    };
    this.installJobs.set(job.id, job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    void this.runInstall(job, controller.signal);
    return { ...job };
  }

  getInstallJob(jobId: string): PlotRuntimeInstallJob | undefined {
    const job = this.installJobs.get(jobId);
    return job ? { ...job } : undefined;
  }

  cancelInstall(jobId: string): boolean {
    const controller = this.controllers.get(jobId);
    const job = this.installJobs.get(jobId);
    if (!controller || !job || ['succeeded', 'failed', 'cancelled'].includes(job.status)) return false;
    controller.abort();
    job.status = 'cancelled';
    job.message = '安装已取消。';
    job.finishedAt = this.now();
    return true;
  }

  async removeManagedRuntime(language: 'python' | 'r', targetRoot = this.managedRoot): Promise<boolean> {
    const root = validateManagedRoot(targetRoot);
    const target = path.join(root, language);
    const marker = path.join(target, '.ftranslate-managed-runtime.json');
    if (!(await exists(marker))) throw new Error('拒绝删除：目标不是 FTranslate 创建的私有运行环境。');
    const resolved = path.resolve(target);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('拒绝删除私有运行环境之外的路径。');
    await rm(target, { recursive: true, force: true });
    const configuredRoots = await this.readConfiguredRoots();
    if (configuredRoots[language] && path.resolve(configuredRoots[language]) === root) {
      delete configuredRoots[language];
      await this.writeConfiguredRoots(configuredRoots);
    }
    this.runtimeCommands.delete(language);
    return true;
  }

  private async detectPython(checkedAt: string): Promise<PlotRuntimeCapability> {
    const candidates: PlotRuntimeCommand[] = [];
    const configuredRoot = (await this.readConfiguredRoots()).python;
    if (this.env.FTRANSLATE_PLOT_PYTHON) candidates.push({ executable: this.env.FTRANSLATE_PLOT_PYTHON, prefixArgs: [] });
    if (configuredRoot) candidates.push({ executable: path.join(configuredRoot, 'python', 'python.exe'), prefixArgs: [] });
    candidates.push({ executable: path.join(this.managedRoot, 'python', 'python.exe'), prefixArgs: [] });
    const pythonPath = await this.where('python.exe');
    if (pythonPath) candidates.push({ executable: pythonPath, prefixArgs: [] });
    const pyLauncher = await this.where('py.exe');
    if (pyLauncher) candidates.push({ executable: pyLauncher, prefixArgs: ['-3.12'] });
    for (const candidate of uniqueCommands(candidates)) {
      const version = await this.tryCommand(candidate, ['--version'], 8_000);
      if (!version) continue;
      const packages = await this.readPythonPackages(candidate);
      this.runtimeCommands.set('python', candidate);
      const missing = ['matplotlib', 'seaborn', 'plotly', 'scipy', 'statsmodels', 'pandas'].filter((name) => !packages[name]);
      return {
        language: 'python',
        status: missing.length ? 'degraded' : 'ready',
        version: firstVersion(version),
        executable: candidate.executable,
        managed: isInside(this.managedRoot, candidate.executable) || Boolean(configuredRoot && isInside(configuredRoot, candidate.executable)),
        packages,
        message: missing.length ? `Python 可用，但缺少：${missing.join('、')}` : 'Python 科研绘图环境可用。',
        checkedAt
      };
    }
    return missingCapability('python', '未检测到 Python。可检测系统环境或安装 FTranslate 私有环境。', checkedAt);
  }

  private async detectR(checkedAt: string): Promise<PlotRuntimeCapability> {
    const configuredRoot = (await this.readConfiguredRoots()).r;
    const candidates = [
      this.env.FTRANSLATE_PLOT_RSCRIPT,
      configuredRoot ? path.join(configuredRoot, 'r', 'bin', 'Rscript.exe') : undefined,
      path.join(this.managedRoot, 'r', 'bin', 'Rscript.exe'),
      await this.where('Rscript.exe')
    ].filter((item): item is string => Boolean(item)).map((executable) => ({ executable, prefixArgs: [] }));
    for (const candidate of uniqueCommands(candidates)) {
      const version = await this.tryCommand(candidate, ['--version'], 8_000);
      if (!version) continue;
      const packages = await this.readRPackages(candidate);
      this.runtimeCommands.set('r', candidate);
      const missing = ['ggplot2', 'patchwork', 'jsonlite'].filter((name) => !packages[name]);
      return {
        language: 'r',
        status: missing.length ? 'degraded' : 'ready',
        version: firstVersion(version),
        executable: candidate.executable,
        managed: isInside(this.managedRoot, candidate.executable) || Boolean(configuredRoot && isInside(configuredRoot, candidate.executable)),
        packages,
        message: missing.length ? `R 可用，但缺少：${missing.join('、')}` : 'R 科研绘图环境可用。',
        checkedAt
      };
    }
    return missingCapability('r', '未检测到 Rscript。PowerShell 的 r 别名不会被误判为 R。', checkedAt);
  }

  private async detectMatlab(checkedAt: string): Promise<PlotRuntimeCapability> {
    const candidates = [
      this.env.FTRANSLATE_MATLAB,
      this.env.MATLAB_ROOT ? path.join(this.env.MATLAB_ROOT, 'bin', 'matlab.exe') : undefined,
      await this.where('matlab.exe'),
      await this.findMatlabFromRegistry()
    ].filter((item): item is string => Boolean(item));
    for (const executable of [...new Set(candidates)]) {
      if (!(await exists(executable)) && path.isAbsolute(executable)) continue;
      const result = await this.tryCommand(
        { executable, prefixArgs: [] },
        ['-batch', "fprintf('FTRANSLATE_VERSION=%s\\n',version); v=ver; fprintf('FTRANSLATE_TOOLBOX=%s\\n',v.Name);"],
        45_000
      );
      if (!result) continue;
      const toolboxes = [...result.matchAll(/FTRANSLATE_TOOLBOX=([^\r\n]+)/g)].map((match) => match[1].trim());
      const version = result.match(/FTRANSLATE_VERSION=([^\r\n]+)/)?.[1]?.trim() ?? firstVersion(result);
      this.runtimeCommands.set('matlab', { executable, prefixArgs: [] });
      return {
        language: 'matlab',
        status: 'ready',
        version,
        executable,
        managed: false,
        packages: {},
        toolboxes,
        message: '检测到用户已有 MATLAB；FTranslate 不安装 MATLAB。',
        checkedAt
      };
    }
    return missingCapability('matlab', '未检测到 MATLAB。该商用软件仅支持检测，不提供安装。', checkedAt);
  }

  private async runInstall(job: PlotRuntimeInstallJob, signal: AbortSignal): Promise<void> {
    let temporaryPath = '';
    try {
      const manifest = await this.readManifest();
      const entry = manifest.runtimes[job.language];
      const downloads = path.join(this.managedRoot, '.downloads');
      await mkdir(downloads, { recursive: true });
      temporaryPath = path.join(downloads, `${job.id}-${entry.fileName}`);
      job.status = 'downloading';
      job.message = `正在从官方源下载 ${job.language === 'python' ? 'Python' : 'R'} ${entry.version}…`;
      await this.downloadVerified(entry, temporaryPath, signal, (progress) => {
        job.progress = Math.min(65, Math.round(progress * 65));
      });
      if (signal.aborted) throw abortError();
      await mkdir(job.targetPath, { recursive: true });
      job.status = 'installing';
      job.progress = 70;
      job.message = '正在安装到私有目录…';
      const args = job.language === 'python'
        ? ['/quiet', 'InstallAllUsers=0', `TargetDir=${job.targetPath}`, 'Include_pip=1', 'Include_test=0', 'Include_launcher=0', 'PrependPath=0', 'Shortcuts=0']
        : ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${job.targetPath}`];
      const installResult = await this.commandRunner(temporaryPath, args, { timeoutMs: 10 * 60_000, signal });
      if (installResult.exitCode !== 0) throw new Error(`运行环境安装器退出码 ${installResult.exitCode}：${trimLog(installResult.stderr)}`);
      job.status = 'configuring';
      job.progress = 82;
      job.message = '正在安装固定版本科研绘图包…';
      if (job.language === 'python') await this.configurePython(job.targetPath, signal);
      else await this.configureR(job.targetPath, signal);
      await writeFile(path.join(job.targetPath, '.ftranslate-managed-runtime.json'), JSON.stringify({ language: job.language, version: entry.version, createdAt: this.now() }, null, 2));
      const configuredRoots = await this.readConfiguredRoots();
      configuredRoots[job.language] = path.dirname(job.targetPath);
      await this.writeConfiguredRoots(configuredRoots);
      job.status = 'succeeded';
      job.progress = 100;
      job.message = '私有科研绘图环境已配置。';
      job.finishedAt = this.now();
    } catch (error) {
      if (signal.aborted) {
        job.status = 'cancelled';
        job.message = '安装已取消。';
      } else {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.message = `安装失败：${job.error}`;
      }
      job.finishedAt = this.now();
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true });
      this.controllers.delete(job.id);
    }
  }

  private async configurePython(targetPath: string, signal: AbortSignal): Promise<void> {
    const executable = path.join(targetPath, 'python.exe');
    const result = await this.commandRunner(executable, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', ...PYTHON_PACKAGES], { timeoutMs: 20 * 60_000, signal });
    if (result.exitCode !== 0) throw new Error(`Python 包安装失败：${trimLog(result.stderr)}`);
  }

  private async configureR(targetPath: string, signal: AbortSignal): Promise<void> {
    const executable = path.join(targetPath, 'bin', 'Rscript.exe');
    const expression = `options(repos=c(CRAN='https://cloud.r-project.org')); install.packages(${JSON.stringify(R_PACKAGES)}, dependencies=TRUE)`;
    const result = await this.commandRunner(executable, ['--vanilla', '-e', expression], { timeoutMs: 30 * 60_000, signal });
    if (result.exitCode !== 0) throw new Error(`R 包安装失败：${trimLog(result.stderr)}`);
  }

  private async readConfiguredRoots(): Promise<Partial<Record<'python' | 'r', string>>> {
    if (!(await exists(this.configuredRootsPath))) return {};
    try {
      const value = JSON.parse(await readFile(this.configuredRootsPath, 'utf8')) as Record<string, unknown>;
      return Object.fromEntries(
        (['python', 'r'] as const)
          .filter((language) => typeof value[language] === 'string')
          .map((language) => [language, validateManagedRoot(String(value[language]))])
      );
    } catch {
      return {};
    }
  }

  private async writeConfiguredRoots(roots: Partial<Record<'python' | 'r', string>>): Promise<void> {
    await mkdir(this.managedRoot, { recursive: true });
    await writeFile(this.configuredRootsPath, JSON.stringify(roots, null, 2), 'utf8');
  }

  private async downloadVerified(
    entry: RuntimeManifestEntry,
    target: string,
    signal: AbortSignal,
    onProgress: (progress: number) => void
  ): Promise<void> {
    const response = await this.fetchImpl(entry.url, { signal, redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`官方下载失败：HTTP ${response.status}`);
    const file = await open(target, 'w');
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) throw abortError();
        await file.write(value);
        hash.update(value);
        received += value.byteLength;
        onProgress(Math.min(1, received / Math.max(1, entry.size)));
      }
    } finally {
      await file.close();
    }
    if (received !== entry.size) throw new Error(`下载大小不一致：期望 ${entry.size}，实际 ${received}。`);
    const digest = hash.digest('hex').toUpperCase();
    if (digest !== entry.sha256.toUpperCase()) throw new Error('官方下载文件 SHA256 校验失败，已拒绝安装。');
  }

  private async readManifest(): Promise<RuntimeManifest> {
    const value = JSON.parse(await readFile(this.manifestPath, 'utf8')) as RuntimeManifest;
    if (value.schemaVersion !== '1.0' || !value.runtimes?.python || !value.runtimes?.r) throw new Error('绘图运行环境清单无效。');
    return value;
  }

  private async readPythonPackages(command: PlotRuntimeCommand): Promise<Record<string, string>> {
    const code = "import importlib.metadata as m,json; names=['matplotlib','seaborn','plotly','scipy','statsmodels','pandas']; print(json.dumps({n:(m.version(n) if n else '') for n in names}))";
    const result = await this.commandRunner(command.executable, [...command.prefixArgs, '-c', code], { timeoutMs: 15_000 });
    return result.exitCode === 0 ? parseLastJsonObject(result.stdout) : {};
  }

  private async readRPackages(command: PlotRuntimeCommand): Promise<Record<string, string>> {
    const expression = "p<-c('ggplot2','patchwork','jsonlite','ComplexHeatmap','ggalluvial','survival','svglite','ragg'); cat(jsonlite::toJSON(setNames(as.list(sapply(p,function(x) if(requireNamespace(x,quietly=TRUE)) as.character(packageVersion(x)) else '')),p),auto_unbox=TRUE))";
    const result = await this.commandRunner(command.executable, [...command.prefixArgs, '--vanilla', '-e', expression], { timeoutMs: 20_000 });
    return result.exitCode === 0 ? parseLastJsonObject(result.stdout) : {};
  }

  private async tryCommand(command: PlotRuntimeCommand, args: string[], timeoutMs: number): Promise<string | null> {
    try {
      const result = await this.commandRunner(command.executable, [...command.prefixArgs, ...args], { timeoutMs });
      return result.exitCode === 0 ? `${result.stdout}\n${result.stderr}`.trim() : null;
    } catch {
      return null;
    }
  }

  private async where(executable: string): Promise<string | undefined> {
    try {
      const result = await this.commandRunner('where.exe', [executable], { timeoutMs: 5_000 });
      if (result.exitCode !== 0) return undefined;
      return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    } catch {
      return undefined;
    }
  }

  private async findMatlabFromRegistry(): Promise<string | undefined> {
    try {
      const result = await this.commandRunner('reg.exe', ['query', 'HKLM\\SOFTWARE\\MathWorks\\MATLAB', '/s', '/v', 'MATLABROOT'], { timeoutMs: 8_000 });
      const roots = [...result.stdout.matchAll(/MATLABROOT\s+REG_SZ\s+([^\r\n]+)/g)].map((match) => match[1].trim());
      return roots.length ? path.join(roots[roots.length - 1], 'bin', 'matlab.exe') : undefined;
    } catch {
      return undefined;
    }
  }
}

export async function runCommand(
  executable: string,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal; cwd?: string } = {}
): Promise<RuntimeCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${options.timeoutMs ?? 60_000} ms.`));
    }, options.timeoutMs ?? 60_000);
    const abort = () => {
      child.kill();
      reject(abortError());
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout = appendLimited(stdout, String(chunk)); });
    child.stderr.on('data', (chunk) => { stderr = appendLimited(stderr, String(chunk)); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function missingCapability(language: PlotRendererLanguage, message: string, checkedAt: string): PlotRuntimeCapability {
  return { language, status: 'missing', managed: false, packages: {}, message, checkedAt };
}

function validateManagedRoot(value: string): string {
  const root = path.resolve(value);
  const parsed = path.parse(root);
  if (root === parsed.root || root.length < parsed.root.length + 3) throw new Error('私有运行环境目录不能是磁盘根目录。');
  return root;
}

function uniqueCommands(commands: PlotRuntimeCommand[]): PlotRuntimeCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = `${command.executable}\u0000${command.prefixArgs.join('\u0000')}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

function firstVersion(value: string): string {
  return value.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? value.split(/\r?\n/)[0].trim();
}

function parseLastJsonObject(value: string): Record<string, string> {
  const matches = [...value.matchAll(/\{[^{}]*\}/g)];
  if (!matches.length) return {};
  try {
    const parsed = JSON.parse(matches[matches.length - 1][0]) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])));
  } catch {
    return {};
  }
}

function appendLimited(current: string, addition: string): string {
  return `${current}${addition}`.slice(-200_000);
}

function trimLog(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 2_000);
}

function abortError(): Error {
  const error = new Error('Operation cancelled.');
  error.name = 'AbortError';
  return error;
}
