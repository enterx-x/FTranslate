import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const COMET_MBR_MODEL_ID = 'Unbabel/wmt22-comet-da';
export const COMET_MBR_MODEL_REVISION = '2760a223ac957f30acfb18c8aa649b01cf1d75f2';
export const COMET_MBR_ENCODER_ID = 'xlm-roberta-large';
export const COMET_MBR_ENCODER_REVISION = 'c23d21b0620b635a76227c604d44e43a9f0ee389';

const DEFAULT_COMET_MBR_ROOT = 'E:\\FTranslateTools\\comet-mbr';
const DEFAULT_TIMEOUT_MS = 120_000;

export interface CometMbrPair {
  source: string;
  translation: string;
  reference: string;
}

export interface CometMbrRuntimeOptions {
  pythonPath?: string;
  workerPath?: string;
  modelPath?: string;
  timeoutMs?: number;
  modelId?: string;
  modelRevision?: string;
  hfHome?: string;
}

export type CometMbrRuntimeState = 'not_checked' | 'loading' | 'ready' | 'failed';
export type CometMbrRuntimeDevice = 'cpu' | 'cuda' | 'unknown';

export interface CometMbrRuntimeSnapshot {
  configured: boolean;
  available: boolean;
  pythonPath: string;
  workerPath: string;
  modelPath: string;
  modelId: string;
  modelRevision: string;
  device: CometMbrRuntimeDevice;
  state: CometMbrRuntimeState;
  lastError: string;
  pending: number;
}

interface WorkerResponse {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export function resolveCometMbrWorkerPath(options: {
  resourcesPath?: string;
  moduleDir?: string;
} = {}): string {
  const resourcesPath = options.resourcesPath
    ?? (typeof process.resourcesPath === 'string' ? process.resourcesPath : '');
  const packagedWorker = resourcesPath
    ? path.join(resourcesPath, 'runtime', 'comet-mbr', 'comet_mbr_worker.py')
    : '';
  if (packagedWorker && fs.existsSync(packagedWorker)) {
    return packagedWorker;
  }
  return path.resolve(options.moduleDir ?? __dirname, '../../assets/runtime/comet-mbr/comet_mbr_worker.py');
}

function resolveDefaultModelPath(root: string): string {
  return path.join(root, 'models', 'wmt22-comet-da', 'checkpoints', 'model.ckpt');
}

function resolveDefaultPythonPath(root: string): string {
  return path.join(root, '.venv', 'Scripts', 'python.exe');
}

function toDevice(value: unknown): CometMbrRuntimeDevice {
  return value === 'cpu' || value === 'cuda' ? value : 'unknown';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CometMbrRuntime {
  private readonly pythonPath: string;
  private readonly workerPath: string;
  private readonly modelPath: string;
  private readonly timeoutMs: number;
  private readonly modelId: string;
  private readonly modelRevision: string;
  private readonly hfHome: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private nextId = 1;
  private intentionalStop = false;
  private state: CometMbrRuntimeState = 'not_checked';
  private available = false;
  private device: CometMbrRuntimeDevice = 'unknown';
  private lastError = '';

  constructor(options: CometMbrRuntimeOptions = {}) {
    const root = process.env.FTRANSLATE_COMET_MBR_ROOT?.trim() || DEFAULT_COMET_MBR_ROOT;
    this.pythonPath = options.pythonPath
      || process.env.FTRANSLATE_COMET_MBR_PYTHON?.trim()
      || resolveDefaultPythonPath(root);
    this.workerPath = options.workerPath
      || process.env.FTRANSLATE_COMET_MBR_WORKER?.trim()
      || resolveCometMbrWorkerPath();
    this.modelPath = options.modelPath
      || process.env.FTRANSLATE_COMET_MBR_MODEL?.trim()
      || resolveDefaultModelPath(root);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.modelId = options.modelId ?? COMET_MBR_MODEL_ID;
    this.modelRevision = options.modelRevision ?? COMET_MBR_MODEL_REVISION;
    this.hfHome = options.hfHome
      || process.env.FTRANSLATE_COMET_MBR_HF_HOME?.trim()
      || path.join(root, 'hf-cache');
  }

  snapshot(): CometMbrRuntimeSnapshot {
    return {
      configured: this.isConfigured(),
      available: this.available,
      pythonPath: this.pythonPath,
      workerPath: this.workerPath,
      modelPath: this.modelPath,
      modelId: this.modelId,
      modelRevision: this.modelRevision,
      device: this.device,
      state: this.state,
      lastError: this.lastError,
      pending: this.pending.size
    };
  }

  async probe(): Promise<CometMbrRuntimeSnapshot> {
    const result = await this.request('probe', {}) as Record<string, unknown>;
    this.validateModelIdentity(result);
    this.device = toDevice(result.device);
    this.state = 'ready';
    this.available = true;
    this.lastError = '';
    return this.snapshot();
  }

  async score(pairs: CometMbrPair[]): Promise<number[]> {
    if (pairs.length === 0) {
      return [];
    }
    const result = await this.request('score', { pairs }) as Record<string, unknown>;
    const scores = result.scores;
    if (!Array.isArray(scores)
      || scores.length !== pairs.length
      || !scores.every((score) => typeof score === 'number' && Number.isFinite(score))) {
      const error = new Error(
        `COMET worker 评分数量不匹配：期望 ${pairs.length}，实际 ${Array.isArray(scores) ? scores.length : 'invalid'}`
      );
      this.failRuntime(error, true);
      throw error;
    }
    this.device = toDevice(result.device);
    this.state = 'ready';
    this.available = true;
    this.lastError = '';
    return scores;
  }

  async unload(): Promise<void> {
    if (!this.child) {
      this.resetIdleState();
      return;
    }
    try {
      await this.request('unload', {});
    } finally {
      this.stopWorker();
      this.resetIdleState();
    }
  }

  close(): void {
    this.rejectPending(new Error('COMET worker closed'));
    this.stopWorker();
    this.resetIdleState();
  }

  private isConfigured(): boolean {
    return fs.existsSync(this.pythonPath)
      && fs.existsSync(this.workerPath)
      && fs.existsSync(this.modelPath);
  }

  private ensureConfigured(): void {
    if (this.isConfigured()) {
      return;
    }
    const missing = [
      ['Python', this.pythonPath],
      ['worker', this.workerPath],
      ['model', this.modelPath]
    ].filter(([, filePath]) => !fs.existsSync(filePath));
    const error = new Error(`COMET-MBR runtime is not configured: ${missing.map(([name]) => name).join(', ')} missing`);
    this.state = 'failed';
    this.available = false;
    this.lastError = error.message;
    throw error;
  }

  private startWorker(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child;
    }
    this.ensureConfigured();
    this.state = 'loading';
    this.available = false;
    this.lastError = '';
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.intentionalStop = false;

    const child = spawn(this.pythonPath, [this.workerPath], {
      env: {
        ...process.env,
        FTRANSLATE_COMET_MBR_MODEL: this.modelPath,
        FTRANSLATE_COMET_MBR_MODEL_ID: this.modelId,
        FTRANSLATE_COMET_MBR_MODEL_REVISION: this.modelRevision,
        HF_HOME: this.hfHome,
        HF_HUB_CACHE: this.hfHome,
        HUGGINGFACE_HUB_CACHE: this.hfHome,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.drainStdout();
    });
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-65_536);
    });
    child.on('error', (error) => {
      if (this.child === child) {
        this.failRuntime(error, false);
      }
    });
    child.on('close', (code, signal) => {
      if (this.child === child) {
        this.child = null;
      }
      if (this.intentionalStop) {
        this.intentionalStop = false;
        return;
      }
      const details = this.stderrBuffer.trim();
      const error = new Error(
        `COMET worker 意外退出（${signal || `code ${code ?? 'unknown'}`}）${details ? `：${details.slice(-1_000)}` : ''}`
      );
      this.failRuntime(error, false);
    });
    return child;
  }

  private request(action: string, payload: Record<string, unknown>): Promise<unknown> {
    const child = this.startWorker();
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`COMET worker 请求超时：${this.timeoutMs} ms`);
        this.failRuntime(error, true);
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, action, ...payload })}\n`, 'utf8', (error) => {
        if (!error) {
          return;
        }
        this.failRuntime(error, true);
      });
    });
  }

  private drainStdout(): void {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      let message: WorkerResponse;
      try {
        message = JSON.parse(line) as WorkerResponse;
      } catch {
        this.failRuntime(new Error('COMET worker JSON protocol error'), true);
        return;
      }
      const id = typeof message.id === 'string' ? message.id : '';
      const entry = this.pending.get(id);
      if (!entry) {
        continue;
      }
      clearTimeout(entry.timer);
      this.pending.delete(id);
      if (message.ok !== true) {
        const detail = typeof message.error === 'string' && message.error
          ? message.error
          : 'COMET worker returned an unsuccessful response';
        entry.reject(new Error(detail));
        continue;
      }
      entry.resolve(message.result);
    }
  }

  private validateModelIdentity(result: Record<string, unknown>): void {
    if (result.modelId !== this.modelId || result.modelRevision !== this.modelRevision) {
      const error = new Error('COMET worker model identity does not match the pinned evaluator');
      this.failRuntime(error, true);
      throw error;
    }
  }

  private failRuntime(error: unknown, terminate: boolean): void {
    const normalized = error instanceof Error ? error : new Error(formatError(error));
    this.state = 'failed';
    this.available = false;
    this.device = 'unknown';
    this.lastError = normalized.message;
    this.rejectPending(normalized);
    if (terminate) {
      this.stopWorker();
    }
  }

  private rejectPending(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  private stopWorker(): void {
    const child = this.child;
    if (!child) {
      return;
    }
    this.intentionalStop = true;
    this.child = null;
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    if (!child.killed && child.exitCode === null) {
      if (process.platform === 'win32' && child.pid) {
        try {
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            timeout: 2_000,
            windowsHide: true
          });
          return;
        } catch {
          // Fall back to the direct child if the process already exited mid-cleanup.
        }
      }
      child.kill();
    }
  }

  private resetIdleState(): void {
    this.state = 'not_checked';
    this.available = false;
    this.device = 'unknown';
    this.lastError = '';
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }
}
