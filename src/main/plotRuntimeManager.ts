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
const PYTHON_REPAIR_PACKAGES = [
  'numpy', 'pandas', 'matplotlib', 'seaborn', 'plotly', 'scipy', 'statsmodels',
  'openpyxl', 'pillow', 'tifffile'
];
const R_CRAN_PACKAGES = ['jsonlite', 'ggplot2', 'patchwork', 'ggalluvial', 'survival', 'svglite', 'ragg', 'plotly', 'htmlwidgets', 'BiocManager'];
const R_BIOCONDUCTOR_PACKAGES = ['ComplexHeatmap'];

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
    const active = this.findActiveInstallJob(language);
    if (active) return { ...active };
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

  startRepair(language: 'python' | 'r'): PlotRuntimeInstallJob {
    const active = this.findActiveInstallJob(language);
    if (active) return { ...active };
    const command = this.runtimeCommands.get(language);
    if (!command) throw new Error(`未检测到可修复的 ${language === 'python' ? 'Python' : 'R'} 环境。`);
    const job: PlotRuntimeInstallJob = {
      id: `runtime-${randomUUID()}`,
      language,
      status: 'queued',
      progress: 0,
      message: `等待修复现有 ${language === 'python' ? 'Python' : 'R'} 环境。`,
      targetPath: command.executable,
      createdAt: this.now()
    };
    this.installJobs.set(job.id, job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    void this.runRepair(job, command, controller.signal);
    return { ...job };
  }

  getInstallJob(jobId: string): PlotRuntimeInstallJob | undefined {
    const job = this.installJobs.get(jobId);
    return job ? { ...job } : undefined;
  }

  private findActiveInstallJob(language: 'python' | 'r'): PlotRuntimeInstallJob | undefined {
    return [...this.installJobs.values()].find((job) =>
      job.language === language && !['succeeded', 'failed', 'cancelled'].includes(job.status)
    );
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
    const configuredRoot = (await this.readConfiguredRoots()).python;
    const candidates: PlotRuntimeCommand[] = [];
    if (this.env.FTRANSLATE_PLOT_PYTHON) candidates.push({ executable: this.env.FTRANSLATE_PLOT_PYTHON, prefixArgs: [] });
    candidates.push(...(await this.whereAll('python.exe')).map((executable) => ({ executable, prefixArgs: [] })));
    candidates.push(...(await this.findPythonFromRegistry()).map((executable) => ({ executable, prefixArgs: [] })));
    candidates.push(...(await this.findPythonCommonPaths()).map((executable) => ({ executable, prefixArgs: [] })));
    const pyLauncher = await this.where('py.exe');
    if (pyLauncher) candidates.push({ executable: pyLauncher, prefixArgs: ['-3'] });
    if (configuredRoot) candidates.push({ executable: path.join(configuredRoot, 'python', 'python.exe'), prefixArgs: [] });
    candidates.push({ executable: path.join(this.managedRoot, 'python', 'python.exe'), prefixArgs: [] });
    let degraded: { capability: PlotRuntimeCapability; command: PlotRuntimeCommand } | undefined;
    for (const candidate of uniqueCommands(candidates)) {
      const version = await this.tryCommand(candidate, ['--version'], 8_000);
      if (!version) continue;
      const packages = await this.readPythonPackages(candidate);
      const missing = ['matplotlib', 'seaborn', 'plotly', 'scipy', 'statsmodels', 'pandas'].filter((name) => !packages[name]);
      const managed = isInside(this.managedRoot, candidate.executable) || Boolean(configuredRoot && isInside(configuredRoot, candidate.executable));
      const capability: PlotRuntimeCapability = {
        language: 'python',
        status: missing.length ? 'degraded' : 'ready',
        version: firstVersion(version),
        executable: candidate.executable,
        managed,
        packages,
        message: missing.length
          ? `检测到${managed ? ' FTranslate 私有' : '系统'} Python，但缺少：${missing.join('、')}`
          : `已自动使用${managed ? ' FTranslate 私有' : '系统'} Python 科研绘图环境。`,
        checkedAt
      };
      if (!missing.length) {
        this.runtimeCommands.set('python', candidate);
        return capability;
      }
      degraded ??= { capability, command: candidate };
    }
    if (degraded) {
      this.runtimeCommands.set('python', degraded.command);
      return degraded.capability;
    }
    this.runtimeCommands.delete('python');
    return missingCapability('python', '未检测到 Python。可检测系统环境或安装 FTranslate 私有环境。', checkedAt);
  }

  private async detectR(checkedAt: string): Promise<PlotRuntimeCapability> {
    const configuredRoot = (await this.readConfiguredRoots()).r;
    const candidates: PlotRuntimeCommand[] = [];
    if (this.env.FTRANSLATE_PLOT_RSCRIPT) candidates.push({ executable: this.env.FTRANSLATE_PLOT_RSCRIPT, prefixArgs: [] });
    candidates.push(...(await this.whereAll('Rscript.exe')).map((executable) => ({ executable, prefixArgs: [] })));
    candidates.push(...(await this.findRFromRegistry()).map((executable) => ({ executable, prefixArgs: [] })));
    candidates.push(...(await this.findRCommonPaths()).map((executable) => ({ executable, prefixArgs: [] })));
    if (configuredRoot) candidates.push({ executable: path.join(configuredRoot, 'r', 'bin', 'Rscript.exe'), prefixArgs: [] });
    candidates.push({ executable: path.join(this.managedRoot, 'r', 'bin', 'Rscript.exe'), prefixArgs: [] });
    let degraded: { capability: PlotRuntimeCapability; command: PlotRuntimeCommand } | undefined;
    for (const candidate of uniqueCommands(candidates)) {
      const version = await this.tryCommand(candidate, ['--version'], 8_000);
      if (!version) continue;
      const packages = await this.readRPackages(candidate);
      const missing = ['ggplot2', 'patchwork', 'jsonlite'].filter((name) => !packages[name]);
      const managed = isInside(this.managedRoot, candidate.executable) || Boolean(configuredRoot && isInside(configuredRoot, candidate.executable));
      const capability: PlotRuntimeCapability = {
        language: 'r',
        status: missing.length ? 'degraded' : 'ready',
        version: firstVersion(version),
        executable: candidate.executable,
        managed,
        packages,
        message: missing.length
          ? `检测到${managed ? ' FTranslate 私有' : '系统'} R，但缺少：${missing.join('、')}`
          : `已自动使用${managed ? ' FTranslate 私有' : '系统'} R 科研绘图环境。`,
        checkedAt
      };
      if (!missing.length) {
        this.runtimeCommands.set('r', candidate);
        return capability;
      }
      degraded ??= { capability, command: candidate };
    }
    if (degraded) {
      this.runtimeCommands.set('r', degraded.command);
      return degraded.capability;
    }
    this.runtimeCommands.delete('r');
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
      if (job.language === 'r' && await exists(path.join(job.targetPath, 'bin', 'Rscript.exe'))) {
        job.status = 'configuring';
        job.progress = 82;
        job.message = '检测到已安装的私有 R，正在修复科研绘图库…';
        await this.configureR(job.targetPath, signal, (packageName, index, total) => {
          job.progress = 82 + Math.round((index / Math.max(1, total)) * 14);
          job.message = `正在配置 R 绘图库 ${index + 1}/${total}：${packageName}`;
        });
        await this.finishManagedRuntimeInstall(job, 'existing');
        return;
      }
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
      else await this.configureR(job.targetPath, signal, (packageName, index, total) => {
        job.progress = 82 + Math.round((index / Math.max(1, total)) * 14);
        job.message = `正在配置 R 绘图库 ${index + 1}/${total}：${packageName}`;
      });
      await this.finishManagedRuntimeInstall(job, entry.version);
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

  private async runRepair(job: PlotRuntimeInstallJob, command: PlotRuntimeCommand, signal: AbortSignal): Promise<void> {
    try {
      job.status = 'configuring';
      job.progress = 20;
      job.message = `正在为现有 ${job.language === 'python' ? 'Python' : 'R'} 补齐科研绘图库…`;
      if (job.language === 'python') {
        job.message = '正在为现有 Python 安装缺失绘图库；下载期间仍可取消…';
        await this.configurePythonCommand(command, PYTHON_REPAIR_PACKAGES, signal);
      } else {
        await this.configureRCommand(command, signal, (packageName, index, total) => {
          job.progress = 12 + Math.round((index / Math.max(1, total)) * 80);
          job.message = `正在安装 R 绘图库 ${index + 1}/${total}：${packageName}`;
        });
      }
      job.status = 'succeeded';
      job.progress = 100;
      job.message = `现有 ${job.language === 'python' ? 'Python' : 'R'} 科研绘图环境已修复。`;
      job.finishedAt = this.now();
    } catch (error) {
      if (signal.aborted) {
        job.status = 'cancelled';
        job.message = '修复已取消。';
      } else {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.message = `修复失败：${job.error}`;
      }
      job.finishedAt = this.now();
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async configurePython(targetPath: string, signal: AbortSignal): Promise<void> {
    await this.configurePythonCommand({ executable: path.join(targetPath, 'python.exe'), prefixArgs: [] }, PYTHON_PACKAGES, signal);
  }

  private async configurePythonCommand(command: PlotRuntimeCommand, packages: string[], signal: AbortSignal): Promise<void> {
    const result = await this.commandRunner(command.executable, [...command.prefixArgs, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', ...packages], { timeoutMs: 20 * 60_000, signal });
    if (result.exitCode !== 0) throw new Error(`Python 包安装失败：${trimLog(result.stderr)}`);
  }

  private async configureR(
    targetPath: string,
    signal: AbortSignal,
    onProgress?: (packageName: string, index: number, total: number) => void
  ): Promise<void> {
    await this.configureRCommand({ executable: path.join(targetPath, 'bin', 'Rscript.exe'), prefixArgs: [] }, signal, onProgress);
  }

  private async configureRCommand(
    command: PlotRuntimeCommand,
    signal: AbortSignal,
    onProgress?: (packageName: string, index: number, total: number) => void
  ): Promise<void> {
    const packages = [
      ...R_CRAN_PACKAGES.map((name) => ({ name, source: 'cran' as const })),
      ...R_BIOCONDUCTOR_PACKAGES.map((name) => ({ name, source: 'bioconductor' as const }))
    ];
    for (let index = 0; index < packages.length; index += 1) {
      const item = packages[index];
      onProgress?.(item.name, index, packages.length);
      const expression = buildRPackageInstallExpression(item.name, item.source);
      const result = await this.commandRunner(command.executable, [...command.prefixArgs, '--vanilla', '-e', expression], { timeoutMs: 12 * 60_000, signal });
      if (result.exitCode !== 0) throw new Error(`R 包 ${item.name} 安装失败：${trimLog(result.stderr || result.stdout)}`);
    }
  }

  private async finishManagedRuntimeInstall(job: PlotRuntimeInstallJob, version: string): Promise<void> {
    await writeFile(path.join(job.targetPath, '.ftranslate-managed-runtime.json'), JSON.stringify({ language: job.language, version, createdAt: this.now() }, null, 2));
    const configuredRoots = await this.readConfiguredRoots();
    configuredRoots[job.language] = path.dirname(job.targetPath);
    await this.writeConfiguredRoots(configuredRoots);
    job.status = 'succeeded';
    job.progress = 100;
    job.message = '私有科研绘图环境已配置。';
    job.finishedAt = this.now();
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
    const expression = "p<-c('ggplot2','patchwork','jsonlite','ComplexHeatmap','ggalluvial','survival','svglite','ragg'); for(x in p) cat(sprintf('FTRANSLATE_PACKAGE=%s\\t%s\\n',x,if(requireNamespace(x,quietly=TRUE)) as.character(packageVersion(x)) else ''))";
    const result = await this.commandRunner(command.executable, [...command.prefixArgs, '--vanilla', '-e', expression], { timeoutMs: 20_000 });
    if (result.exitCode !== 0) return {};
    return Object.fromEntries(
      [...result.stdout.matchAll(/^FTRANSLATE_PACKAGE=([^\t\r\n]+)\t([^\r\n]*)$/gm)]
        .map((match) => [match[1].trim(), match[2].trim()] as const)
        .filter((entry) => Boolean(entry[1]))
    );
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
    return (await this.whereAll(executable))[0];
  }

  private async whereAll(executable: string): Promise<string[]> {
    try {
      const result = await this.commandRunner('where.exe', [executable], { timeoutMs: 5_000 });
      if (result.exitCode !== 0) return [];
      return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  private async findPythonFromRegistry(): Promise<string[]> {
    return this.findRegistryValues(
      ['HKCU\\SOFTWARE\\Python\\PythonCore', 'HKLM\\SOFTWARE\\Python\\PythonCore'],
      'ExecutablePath',
      (value) => value
    );
  }

  private async findRFromRegistry(): Promise<string[]> {
    return this.findRegistryValues(
      ['HKCU\\SOFTWARE\\R-core\\R', 'HKLM\\SOFTWARE\\R-core\\R'],
      'InstallPath',
      (value) => path.join(value, 'bin', 'Rscript.exe')
    );
  }

  private async findRegistryValues(keys: string[], valueName: string, mapValue: (value: string) => string): Promise<string[]> {
    const values: string[] = [];
    for (const key of keys) {
      try {
        const result = await this.commandRunner('reg.exe', ['query', key, '/s', '/v', valueName], { timeoutMs: 8_000 });
        if (result.exitCode !== 0) continue;
        const pattern = new RegExp(`${valueName}\\s+REG_(?:SZ|EXPAND_SZ)\\s+([^\\r\\n]+)`, 'gi');
        values.push(...[...result.stdout.matchAll(pattern)].map((match) => mapValue(match[1].trim())));
      } catch {
        // Registry lookup is best-effort; PATH and common directories remain available.
      }
    }
    return values;
  }

  private async findPythonCommonPaths(): Promise<string[]> {
    const roots = [
      this.env.LOCALAPPDATA ? path.join(this.env.LOCALAPPDATA, 'Programs', 'Python') : undefined,
      this.env.ProgramFiles ? path.join(this.env.ProgramFiles, 'Python') : undefined
    ].filter((item): item is string => Boolean(item));
    return findExecutablesInVersionDirectories(roots, 'Python', ['python.exe']);
  }

  private async findRCommonPaths(): Promise<string[]> {
    const roots = [
      this.env.ProgramFiles ? path.join(this.env.ProgramFiles, 'R') : undefined,
      this.env.LOCALAPPDATA ? path.join(this.env.LOCALAPPDATA, 'Programs', 'R') : undefined
    ].filter((item): item is string => Boolean(item));
    return findExecutablesInVersionDirectories(roots, 'R-', [path.join('bin', 'Rscript.exe'), path.join('bin', 'x64', 'Rscript.exe')]);
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

export function buildRPackageInstallExpression(
  packageName?: string,
  source: 'cran' | 'bioconductor' = 'cran'
): string {
  if (!packageName) {
    const packages = `c(${R_CRAN_PACKAGES.map((name) => JSON.stringify(name)).join(',')})`;
    return [
      "options(repos=c(CRAN='https://cloud.r-project.org'))",
      "userLib <- Sys.getenv('R_LIBS_USER')",
      "if (nzchar(userLib)) { dir.create(userLib, recursive=TRUE, showWarnings=FALSE); .libPaths(c(userLib, .libPaths())) }",
      `required <- ${packages}`,
      "missing <- setdiff(required, rownames(installed.packages()))",
      "if (length(missing)) install.packages(missing, lib=if(nzchar(userLib)) userLib else NULL, dependencies=NA)",
      "if (!requireNamespace('ComplexHeatmap', quietly=TRUE)) BiocManager::install('ComplexHeatmap', lib=if(nzchar(userLib)) userLib else NULL, ask=FALSE, update=FALSE)"
    ].join('; ');
  }
  const quoted = JSON.stringify(packageName);
  return [
    "options(repos=c(CRAN='https://cloud.r-project.org'))",
    "userLib <- Sys.getenv('R_LIBS_USER')",
    "if (nzchar(userLib)) { dir.create(userLib, recursive=TRUE, showWarnings=FALSE); .libPaths(c(userLib, .libPaths())) }",
    source === 'cran'
      ? `if (!requireNamespace(${quoted}, quietly=TRUE)) install.packages(${quoted}, lib=if(nzchar(userLib)) userLib else NULL, dependencies=NA)`
      : "if (!requireNamespace('BiocManager', quietly=TRUE)) install.packages('BiocManager', lib=if(nzchar(userLib)) userLib else NULL, dependencies=NA)",
    source === 'bioconductor'
      ? `if (!requireNamespace(${quoted}, quietly=TRUE)) BiocManager::install(${quoted}, lib=if(nzchar(userLib)) userLib else NULL, ask=FALSE, update=FALSE)`
      : 'invisible(NULL)',
    `if (!requireNamespace(${quoted}, quietly=TRUE)) stop('Package installation did not make ${packageName} available')`
  ].join('; ');
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

async function findExecutablesInVersionDirectories(roots: string[], prefix: string, relativePaths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
      for (const directory of directories) {
        for (const relativePath of relativePaths) {
          const executable = path.join(root, directory.name, relativePath);
          if (await exists(executable)) found.push(executable);
        }
      }
    } catch {
      // Common-directory probing is best-effort.
    }
  }
  return found;
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
