import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  assertPlotDataTable,
  normalizeScientificPlotSpec,
  type PlotDataTable,
  type PlotRenderArtifact,
  type PlotRenderJob,
  type PlotRendererLanguage,
  type ScientificPlotSpec
} from '../shared/scientificPlot';
import { compilePlotScript, type GeneratedPlotScript } from './plotScriptCompilers';
import type { PlotRuntimeCommand, RuntimeCommandResult, RuntimeCommandRunner } from './plotRuntimeManager';
import { runCommand } from './plotRuntimeManager';
import type { ScientificPlotStore } from './scientificPlotStore';

export interface PlotRuntimeResolver {
  detectAll: () => Promise<unknown>;
  getRuntimeCommand: (language: PlotRendererLanguage) => PlotRuntimeCommand | undefined;
}

export interface SubmitPlotRenderRequest {
  projectId: string;
  spec: ScientificPlotSpec;
  data: PlotDataTable;
  force?: boolean;
}

export interface PlotRendererOptions {
  store: ScientificPlotStore;
  runtimeManager: PlotRuntimeResolver;
  commandRunner?: RuntimeCommandRunner;
  scriptCompiler?: typeof compilePlotScript;
  now?: () => string;
  timeoutMs?: Partial<Record<Exclude<PlotRendererLanguage, 'javascript'>, number>>;
}

export class PlotRendererService {
  private readonly store: ScientificPlotStore;
  private readonly runtimeManager: PlotRuntimeResolver;
  private readonly commandRunner: RuntimeCommandRunner;
  private readonly scriptCompiler: typeof compilePlotScript;
  private readonly now: () => string;
  private readonly timeoutMs: Record<Exclude<PlotRendererLanguage, 'javascript'>, number>;
  private readonly jobs = new Map<string, PlotRenderJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly cache = new Map<string, PlotRenderArtifact[]>();
  private readonly lastSuccess = new Map<string, PlotRenderArtifact[]>();

  constructor(options: PlotRendererOptions) {
    this.store = options.store;
    this.runtimeManager = options.runtimeManager;
    this.commandRunner = options.commandRunner ?? runCommand;
    this.scriptCompiler = options.scriptCompiler ?? compilePlotScript;
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeoutMs = {
      python: options.timeoutMs?.python ?? 180_000,
      r: options.timeoutMs?.r ?? 240_000,
      matlab: options.timeoutMs?.matlab ?? 600_000
    };
  }

  submit(request: SubmitPlotRenderRequest): PlotRenderJob {
    const spec = normalizeScientificPlotSpec(request.spec);
    if (!assertPlotDataTable(request.data)) throw new Error('Plot render data is invalid.');
    if (spec.id !== request.projectId) throw new Error('Plot spec id must match the project id.');
    const language = spec.renderer.language;
    const specHash = hashRenderInput(spec, request.data);
    const job: PlotRenderJob = {
      id: `render-${randomUUID()}`,
      projectId: request.projectId,
      specHash,
      language,
      status: 'queued',
      progress: 0,
      message: '等待渲染。',
      createdAt: this.now(),
      artifacts: [],
      cacheHit: false
    };
    this.cancelSupersededQueuedJob(job);
    this.jobs.set(job.id, job);

    if (language === 'javascript') {
      job.status = 'succeeded';
      job.progress = 100;
      job.message = 'ECharts 由 renderer 直接真实渲染。';
      job.startedAt = job.createdAt;
      job.finishedAt = this.now();
      return cloneJob(job);
    }

    const cached = !request.force ? this.cache.get(specHash) : undefined;
    if (cached) {
      job.status = 'succeeded';
      job.progress = 100;
      job.message = '已复用相同数据、配置和运行环境的渲染结果。';
      job.startedAt = job.createdAt;
      job.finishedAt = this.now();
      job.artifacts = cached.map((artifact) => ({ ...artifact }));
      job.cacheHit = true;
      return cloneJob(job);
    }

    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    void this.execute(job, spec, request.data, controller.signal);
    return cloneJob(job);
  }

  getJob(jobId: string): PlotRenderJob | undefined {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : undefined;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || ['succeeded', 'failed', 'cancelled', 'timed-out'].includes(job.status)) return false;
    this.controllers.get(jobId)?.abort();
    job.status = 'cancelled';
    job.message = '渲染已取消。';
    job.finishedAt = this.now();
    return true;
  }

  dispose(): void {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
  }

  private async execute(
    job: PlotRenderJob,
    spec: ScientificPlotSpec,
    data: PlotDataTable,
    signal: AbortSignal
  ): Promise<void> {
    const language = spec.renderer.language as Exclude<PlotRendererLanguage, 'javascript'>;
    try {
      job.status = 'running';
      job.startedAt = this.now();
      job.progress = 8;
      job.message = `正在检查 ${languageLabel(language)} 运行环境…`;
      let command = this.runtimeManager.getRuntimeCommand(language);
      if (!command) {
        await this.runtimeManager.detectAll();
        command = this.runtimeManager.getRuntimeCommand(language);
      }
      if (!command) throw new RenderFailure('runtime-missing', `未检测到可用的 ${languageLabel(language)} 运行环境。`);
      const script = this.scriptCompiler(language);
      const relativeRoot = `renders/jobs/${job.id}`;
      const workingDirectory = this.store.resolveProjectFile(job.projectId, relativeRoot);
      await mkdir(path.join(workingDirectory, 'output'), { recursive: true });
      const specPath = (await this.store.writeArtifact(job.projectId, `${relativeRoot}/plot-spec.json`, JSON.stringify(spec, null, 2))).filePath;
      const dataPath = (await this.store.writeArtifact(job.projectId, `${relativeRoot}/data.csv`, serializeCsv(data))).filePath;
      const scriptPath = (await this.store.writeArtifact(job.projectId, `${relativeRoot}/${script.fileName}`, script.content)).filePath;
      void specPath; void dataPath;
      job.progress = 25;
      job.message = `${languageLabel(language)} 正在真实生成预览…`;
      const result = await this.commandRunner(
        command.executable,
        buildCommandArgs(language, command, scriptPath),
        { timeoutMs: this.timeoutMs[language], signal, cwd: workingDirectory }
      );
      if (signal.aborted) throw new RenderFailure('cancelled', '渲染已取消。');
      await this.store.writeArtifact(job.projectId, `${relativeRoot}/render.log`, redactLog(`${result.stdout}\n${result.stderr}`, workingDirectory));
      if (result.exitCode !== 0) throw new RenderFailure('renderer-exit', `${languageLabel(language)} 退出码 ${result.exitCode}：${lastLogLine(result)}`);
      job.progress = 84;
      job.message = '正在验证渲染产物…';
      const artifacts = await this.validateArtifacts(job.projectId, relativeRoot, workingDirectory, script);
      const scriptBytes = await readFile(scriptPath);
      artifacts.push({
        kind: 'script',
        format: path.extname(script.fileName).slice(1).toLowerCase(),
        filePath: scriptPath,
        sha256: createHash('sha256').update(scriptBytes).digest('hex')
      });
      job.artifacts = artifacts;
      job.status = 'succeeded';
      job.progress = 100;
      job.message = `${languageLabel(language)} 预览已生成。`;
      job.finishedAt = this.now();
      this.cache.set(job.specHash, artifacts.map((artifact) => ({ ...artifact })));
      this.lastSuccess.set(job.projectId, artifacts.map((artifact) => ({ ...artifact })));
    } catch (error) {
      if (job.status === 'cancelled' || signal.aborted || (error instanceof RenderFailure && error.code === 'cancelled')) {
        job.status = 'cancelled';
        job.errorCode = 'cancelled';
        job.message = '渲染已取消。';
      } else if (/timed out/i.test(error instanceof Error ? error.message : String(error))) {
        job.status = 'timed-out';
        job.errorCode = 'timeout';
        job.message = `渲染超时：${error instanceof Error ? error.message : String(error)}`;
      } else {
        job.status = 'failed';
        job.errorCode = error instanceof RenderFailure ? error.code : 'render-failed';
        job.message = error instanceof Error ? error.message : String(error);
      }
      job.finishedAt = this.now();
      job.artifacts = (this.lastSuccess.get(job.projectId) ?? []).map((artifact) => ({ ...artifact, stale: true }));
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async validateArtifacts(
    projectId: string,
    relativeRoot: string,
    workingDirectory: string,
    script: GeneratedPlotScript
  ): Promise<PlotRenderArtifact[]> {
    const outputDirectory = path.join(workingDirectory, 'output');
    const names = await readdir(outputDirectory);
    if (!names.includes('render-manifest.json')) throw new RenderFailure('manifest-missing', '渲染器未生成 render-manifest.json。');
    const manifest = JSON.parse(await readFile(path.join(outputDirectory, 'render-manifest.json'), 'utf8')) as Record<string, unknown>;
    if (manifest.language !== script.language) throw new RenderFailure('manifest-language', '渲染产物语言与所选语言不一致。');
    const previewName = typeof manifest.preview === 'string' ? manifest.preview : '';
    if (!/^[A-Za-z0-9._-]+$/.test(previewName) || !names.includes(previewName)) throw new RenderFailure('preview-missing', '渲染器未生成声明的预览文件。');
    const artifactNames = names.filter((name) => /^(preview\.(svg|png|html)|export-[A-Za-z0-9_-]+\.(png|svg|pdf|tiff)|analysis-results\.json|render-manifest\.json)$/.test(name));
    const artifacts: PlotRenderArtifact[] = [];
    for (const name of artifactNames) {
      const filePath = this.store.resolveProjectFile(projectId, `${relativeRoot}/output/${name}`);
      const bytes = await readFile(filePath);
      if (bytes.byteLength === 0) throw new RenderFailure('artifact-empty', `渲染产物为空：${name}`);
      artifacts.push({
        kind: name.startsWith('preview.') ? 'preview' : name.startsWith('export-') ? 'export' : name.startsWith('analysis') ? 'analysis' : 'manifest',
        format: path.extname(name).slice(1),
        filePath,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    }
    if (!artifacts.some((artifact) => artifact.kind === 'preview')) throw new RenderFailure('preview-missing', '未找到可显示的预览产物。');
    return artifacts;
  }

  private cancelSupersededQueuedJob(next: PlotRenderJob): void {
    this.jobs.forEach((job) => {
      if (job.projectId === next.projectId && job.language === next.language && job.status === 'queued') {
        job.status = 'cancelled';
        job.message = '已被更新的绘图配置替代。';
        job.finishedAt = this.now();
      }
    });
  }
}

class RenderFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RenderFailure';
  }
}

function buildCommandArgs(
  language: Exclude<PlotRendererLanguage, 'javascript'>,
  command: PlotRuntimeCommand,
  scriptPath: string
): string[] {
  if (language === 'matlab') {
    const escaped = scriptPath.replace(/'/g, "''").replace(/\\/g, '/');
    return [...command.prefixArgs, '-batch', `run('${escaped}')`];
  }
  return [...command.prefixArgs, scriptPath];
}

function serializeCsv(table: PlotDataTable): string {
  return [
    table.columns.map((column) => csvCell(column.id)).join(','),
    ...table.rows.map((row) => row.map(csvCell).join(','))
  ].join('\r\n');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function hashRenderInput(spec: ScientificPlotSpec, data: PlotDataTable): string {
  return createHash('sha256').update(JSON.stringify({ spec, columns: data.columns, rows: data.rows })).digest('hex');
}

function redactLog(value: string, workingDirectory: string): string {
  return value.replaceAll(workingDirectory, '<plot-job>').replace(/[\r\n]{3,}/g, '\n\n').slice(-200_000);
}

function lastLogLine(result: RuntimeCommandResult): string {
  return `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)?.slice(0, 1_000) ?? '无错误输出';
}

function languageLabel(language: Exclude<PlotRendererLanguage, 'javascript'>): string {
  return language === 'python' ? 'Python' : language === 'r' ? 'R' : 'MATLAB';
}

function cloneJob(job: PlotRenderJob): PlotRenderJob {
  return { ...job, artifacts: job.artifacts.map((artifact) => ({ ...artifact })) };
}
