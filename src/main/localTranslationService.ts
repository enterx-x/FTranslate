import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type LocalTranslationCacheEngine = 'nllb-ct2-int8' | 'argos';
export type LocalTranslationRuntimeEngine = 'nllb-ct2' | 'argos';
export type LocalTranslationPreference = 'nllb-first' | 'argos-first' | 'nllb-only' | 'argos-only';
export type LocalTranslationDevicePreference = 'auto' | 'cuda' | 'cpu';
export type LocalTranslationRuntimeState = 'not_checked' | 'warming' | 'ready' | 'cpu_fallback' | 'failed';
export type LocalTranslationLanguage = 'en' | 'zh';

export interface LocalTranslateBatchResult {
  texts: string[];
  engine: LocalTranslationCacheEngine;
  device?: 'cuda' | 'cpu' | 'unknown';
  model?: string;
  warning?: string;
  fallbackReason?: string;
}

export interface LocalTranslateDirectionOptions {
  sourceLanguage?: LocalTranslationLanguage;
  targetLanguage?: LocalTranslationLanguage;
}

export interface LocalTranslationStatus {
  preferredEngine: LocalTranslationPreference;
  nllb: {
    configured: boolean;
    available: boolean;
    pythonPath: string;
    modelDir: string;
    tokenizerDir: string;
    device: LocalTranslationDevicePreference;
    runtimeDevice: 'cuda' | 'cpu' | 'unknown';
    runtimeState: LocalTranslationRuntimeState;
    cudaDllDirs: string[];
    lastRuntimeError: string;
    lastFallbackReason: string;
    lastCheckedAt: string;
    warmupMs: number;
    message: string;
  };
  fallback: {
    engine: 'argos';
    message: string;
  };
  worker: {
    running: boolean;
    pending: number;
  };
}

const DEFAULT_NLLB_ROOT = 'E:\\FTranslateTools';
const DEFAULT_NLLB_VENV_PYTHON = path.join(DEFAULT_NLLB_ROOT, 'nllb-ctranslate2', 'Scripts', 'python.exe');
const DEFAULT_NLLB_MODEL_DIR = path.join(DEFAULT_NLLB_ROOT, 'models', 'nllb-200-distilled-600M-ct2-int8');
const DEFAULT_NLLB_HF_HOME = path.join(DEFAULT_NLLB_ROOT, 'hf-cache');
const DEFAULT_NLLB_TOKENIZER_DIR = path.join(DEFAULT_NLLB_HF_HOME, 'nllb-200-distilled-600M-snapshot');
const DEFAULT_NLLB_CUDA_DLL_DIR_CANDIDATES = [
  path.join(DEFAULT_NLLB_ROOT, 'cuda-runtime', 'nvidia', 'cublas', 'bin'),
  path.join(DEFAULT_NLLB_ROOT, 'cuda-runtime', 'nvidia', 'cuda_runtime', 'bin'),
  path.join(DEFAULT_NLLB_ROOT, 'cuda-runtime', 'nvidia', 'cudnn', 'bin'),
  'E:\\Anaconda\\envs\\pytorch\\Lib\\site-packages\\torch\\lib',
  'E:\\Anaconda\\envs\\SB3_RL\\Lib\\site-packages\\torch\\lib',
  'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.7\\bin',
  'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.6\\bin',
  'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.5\\bin',
  'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4\\bin'
];
const DEFAULT_NLLB_TIMEOUT_MS = 120_000;
const DEFAULT_NLLB_MODEL_NAME = 'nllb-200-distilled-600M-ct2-int8';
const DEFAULT_NLLB_BEAM_SIZE = 1;
const DEFAULT_NLLB_MAX_DECODING_LENGTH = 512;

let nllbRuntime: NllbCTranslate2Runtime | null = null;
let nllbWarmupPromise: Promise<LocalTranslationStatus> | null = null;
let nllbRuntimeStatus: {
  runtimeState: LocalTranslationRuntimeState;
  runtimeDevice: 'cuda' | 'cpu' | 'unknown';
  lastRuntimeError: string;
  lastFallbackReason: string;
  lastCheckedAt: string;
  warmupMs: number;
} = {
  runtimeState: 'not_checked',
  runtimeDevice: 'unknown',
  lastRuntimeError: '',
  lastFallbackReason: '',
  lastCheckedAt: '',
  warmupMs: 0
};

export function resolveNllbPythonCommand(): string {
  const configured = process.env.FTRANSLATE_NLLB_PYTHON?.trim();
  if (configured) {
    return configured;
  }
  return fs.existsSync(DEFAULT_NLLB_VENV_PYTHON) ? DEFAULT_NLLB_VENV_PYTHON : 'python';
}

export function resolveNllbModelDir(): string {
  return process.env.FTRANSLATE_NLLB_MODEL_DIR?.trim() || DEFAULT_NLLB_MODEL_DIR;
}

export function resolveNllbTokenizerDir(): string {
  return process.env.FTRANSLATE_NLLB_TOKENIZER_DIR?.trim() || DEFAULT_NLLB_TOKENIZER_DIR;
}

export function resolveNllbDevice(): LocalTranslationDevicePreference {
  const configured = process.env.FTRANSLATE_NLLB_DEVICE?.trim().toLowerCase();
  return configured === 'cuda' || configured === 'cpu' ? configured : 'auto';
}

export function resolveNllbBeamSize(): number {
  return clampIntegerEnv('FTRANSLATE_NLLB_BEAM_SIZE', DEFAULT_NLLB_BEAM_SIZE, 1, 8);
}

export function resolveNllbMaxDecodingLength(): number {
  return clampIntegerEnv(
    'FTRANSLATE_NLLB_MAX_DECODING_LENGTH',
    DEFAULT_NLLB_MAX_DECODING_LENGTH,
    128,
    1024
  );
}

export function resolveNllbCudaDllDirs(): string[] {
  const configured = process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS?.trim();
  const configuredDirs = configured
    ? configured.split(';').map((item) => item.trim()).filter(Boolean)
    : [];
  const dirs = [...configuredDirs, ...DEFAULT_NLLB_CUDA_DLL_DIR_CANDIDATES];
  const cudaRuntimeDlls = ['cublas64_12.dll', 'cudart64_12.dll', 'cudnn64_9.dll', 'cudnn64_8.dll'];
  return Array.from(new Set(dirs)).filter((dir) =>
    cudaRuntimeDlls.some((dll) => fs.existsSync(path.join(dir, dll)))
  );
}

export function resolveLocalTranslationPreference(): LocalTranslationPreference {
  const configured = process.env.FTRANSLATE_LOCAL_TRANSLATION_ENGINE?.trim().toLowerCase();
  if (
    configured === 'nllb-first' ||
    configured === 'argos-first' ||
    configured === 'nllb-only' ||
    configured === 'argos-only'
  ) {
    return configured;
  }
  return 'nllb-first';
}

export function resolveNllbChildEnv(): NodeJS.ProcessEnv {
  const cudaDllDirs = resolveNllbCudaDllDirs();
  const inheritedPath = process.env.Path ?? process.env.PATH ?? '';
  const pathValue = [...cudaDllDirs, inheritedPath].filter(Boolean).join(path.delimiter);
  return {
    ...process.env,
    FTRANSLATE_NLLB_MODEL_DIR: resolveNllbModelDir(),
    FTRANSLATE_NLLB_TOKENIZER_DIR: resolveNllbTokenizerDir(),
    FTRANSLATE_NLLB_CUDA_DLL_DIRS: cudaDllDirs.join(path.delimiter),
    FTRANSLATE_NLLB_DEVICE: resolveNllbDevice(),
    FTRANSLATE_NLLB_BEAM_SIZE: String(resolveNllbBeamSize()),
    FTRANSLATE_NLLB_MAX_DECODING_LENGTH: String(resolveNllbMaxDecodingLength()),
    HF_HOME: process.env.HF_HOME?.trim() || DEFAULT_NLLB_HF_HOME,
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_OFFLINE: '1',
    PATH: pathValue,
    Path: pathValue,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  };
}

export function getLocalTranslationStatus(): LocalTranslationStatus {
  const pythonPath = resolveNllbPythonCommand();
  const modelDir = resolveNllbModelDir();
  const tokenizerDir = resolveNllbTokenizerDir();
  const configured = hasConfiguredNllb();
  const runtime = nllbRuntime && !nllbRuntime.isClosed() ? nllbRuntime : null;
  const runtimeDevice = runtime?.runtimeDevice ?? nllbRuntimeStatus.runtimeDevice;
  const runtimeState = configured ? nllbRuntimeStatus.runtimeState : 'failed';
  const available = configured && Boolean(runtime) && (runtimeState === 'ready' || runtimeState === 'cpu_fallback');
  const cudaDllDirs = resolveNllbCudaDllDirs();
  return {
    preferredEngine: resolveLocalTranslationPreference(),
    nllb: {
      configured,
      available,
      pythonPath,
      modelDir,
      tokenizerDir,
      device: resolveNllbDevice(),
      runtimeDevice,
      runtimeState,
      cudaDllDirs,
      lastRuntimeError: nllbRuntimeStatus.lastRuntimeError,
      lastFallbackReason: nllbRuntimeStatus.lastFallbackReason,
      lastCheckedAt: nllbRuntimeStatus.lastCheckedAt,
      warmupMs: nllbRuntimeStatus.warmupMs,
      message: buildNllbStatusMessage({
        configured,
        runtimeState,
        runtimeDevice,
        modelDir,
        tokenizerDir,
        lastRuntimeError: nllbRuntimeStatus.lastRuntimeError,
        lastFallbackReason: nllbRuntimeStatus.lastFallbackReason,
        warmupMs: nllbRuntimeStatus.warmupMs
      })
    },
    fallback: {
      engine: 'argos',
      message: 'Argos 仍作为轻量 fallback 保留。'
    },
    worker: {
      running: Boolean(runtime),
      pending: runtime?.pendingCount() ?? 0
    }
  };
}

export async function checkLocalTranslationInstall(): Promise<LocalTranslationStatus> {
  return warmUpNllbTranslator();
}

export async function warmUpNllbTranslator(timeoutMs = 45_000): Promise<LocalTranslationStatus> {
  if (resolveLocalTranslationPreference() === 'argos-only') {
    updateNllbRuntimeStatus({
      runtimeState: 'not_checked',
      runtimeDevice: 'unknown',
      lastRuntimeError: '',
      lastFallbackReason: '',
      warmupMs: 0
    });
    return getLocalTranslationStatus();
  }
  if (!hasConfiguredNllb()) {
    updateNllbRuntimeStatus({
      runtimeState: 'failed',
      runtimeDevice: 'unknown',
      lastRuntimeError: `未找到 NLLB 模型或 tokenizer：${resolveNllbModelDir()} / ${resolveNllbTokenizerDir()}`,
      lastFallbackReason: '',
      warmupMs: 0
    });
    return getLocalTranslationStatus();
  }
  if (nllbWarmupPromise) {
    return nllbWarmupPromise;
  }
  updateNllbRuntimeStatus({
    runtimeState: 'warming',
    runtimeDevice: nllbRuntimeStatus.runtimeDevice,
    lastRuntimeError: '',
    lastFallbackReason: '',
    warmupMs: 0
  });
  const startedAt = Date.now();
  nllbWarmupPromise = (async () => {
    try {
      const result = await translateTextsWithNllbCTranslate2(['warm up'], timeoutMs);
      const warmupMs = Date.now() - startedAt;
      updateNllbRuntimeStatus({
        runtimeState: result.device === 'cpu' && result.fallbackReason ? 'cpu_fallback' : 'ready',
        runtimeDevice: result.device ?? 'unknown',
        lastRuntimeError: '',
        lastFallbackReason: result.fallbackReason ?? '',
        warmupMs
      });
      return getLocalTranslationStatus();
    } catch (error) {
      const warmupMs = Date.now() - startedAt;
      resetNllbRuntime();
      updateNllbRuntimeStatus({
        runtimeState: 'failed',
        runtimeDevice: 'unknown',
        lastRuntimeError: formatErrorMessage(error),
        lastFallbackReason: '',
        warmupMs
      });
      return getLocalTranslationStatus();
    } finally {
      nllbWarmupPromise = null;
    }
  })();
  return nllbWarmupPromise;
}

export async function translateTextsWithNllbCTranslate2(
  texts: string[],
  timeoutMs = DEFAULT_NLLB_TIMEOUT_MS,
  options: LocalTranslateDirectionOptions = {}
): Promise<LocalTranslateBatchResult> {
  const cleanTexts = texts.map((text) => (typeof text === 'string' ? text : ''));
  if (cleanTexts.length === 0) {
    return { texts: [], engine: 'nllb-ct2-int8', device: 'unknown', model: DEFAULT_NLLB_MODEL_NAME };
  }
  if (!fs.existsSync(resolveNllbModelDir())) {
    throw new Error(`NLLB CTranslate2 模型未配置：${resolveNllbModelDir()}`);
  }
  if (!fs.existsSync(resolveNllbTokenizerDir())) {
    throw new Error(`NLLB tokenizer 未配置：${resolveNllbTokenizerDir()}`);
  }
  const startedAt = Date.now();
  const hadReadyRuntime = nllbRuntimeStatus.runtimeState === 'ready' || nllbRuntimeStatus.runtimeState === 'cpu_fallback';
  const runtime = getNllbRuntime();
  const result = await runtime.translate(cleanTexts, Math.max(timeoutMs, cleanTexts.length * 8_000), options);
  updateNllbRuntimeStatus({
    runtimeState: result.device === 'cpu' && result.fallbackReason ? 'cpu_fallback' : 'ready',
    runtimeDevice: result.device ?? 'unknown',
    lastRuntimeError: '',
    lastFallbackReason: result.fallbackReason ?? '',
    warmupMs: hadReadyRuntime ? nllbRuntimeStatus.warmupMs : Date.now() - startedAt
  });
  return {
    ...result,
    engine: 'nllb-ct2-int8',
    model: DEFAULT_NLLB_MODEL_NAME
  };
}

export function resetNllbRuntime(): void {
  if (nllbRuntime) {
    nllbRuntime.close();
    nllbRuntime = null;
  }
  updateNllbRuntimeStatus({
    runtimeState: 'not_checked',
    runtimeDevice: 'unknown',
    lastRuntimeError: '',
    lastFallbackReason: '',
    warmupMs: 0
  });
}

function hasConfiguredNllb(): boolean {
  const modelDir = resolveNllbModelDir();
  const tokenizerDir = resolveNllbTokenizerDir();
  return Boolean(modelDir) && fs.existsSync(modelDir) && fs.existsSync(tokenizerDir);
}

function updateNllbRuntimeStatus(
  patch: Partial<typeof nllbRuntimeStatus> & Pick<typeof nllbRuntimeStatus, 'runtimeState'>
): void {
  nllbRuntimeStatus = {
    ...nllbRuntimeStatus,
    ...patch,
    lastCheckedAt: new Date().toISOString()
  };
}

function buildNllbStatusMessage(input: {
  configured: boolean;
  runtimeState: LocalTranslationRuntimeState;
  runtimeDevice: 'cuda' | 'cpu' | 'unknown';
  modelDir: string;
  tokenizerDir: string;
  lastRuntimeError: string;
  lastFallbackReason: string;
  warmupMs: number;
}): string {
  if (!input.configured) {
    return `未找到 NLLB 模型或 tokenizer：${input.modelDir} / ${input.tokenizerDir}`;
  }
  if (input.runtimeState === 'not_checked') {
    return 'NLLB CTranslate2 int8 模型与 tokenizer 已配置，但尚未完成运行检查。';
  }
  if (input.runtimeState === 'warming') {
    return '正在预热 NLLB worker。';
  }
  if (input.runtimeState === 'cpu_fallback') {
    return `NLLB 已回退 CPU 运行：${input.lastFallbackReason || 'CUDA 不可用'}。`;
  }
  if (input.runtimeState === 'ready') {
    return `NLLB worker 已就绪，运行设备：${input.runtimeDevice.toUpperCase()}，预热 ${input.warmupMs} ms。`;
  }
  return `NLLB 运行检查失败：${input.lastRuntimeError || '未知错误'}`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function getNllbRuntime(): NllbCTranslate2Runtime {
  if (!nllbRuntime || nllbRuntime.isClosed()) {
    nllbRuntime = new NllbCTranslate2Runtime();
  }
  return nllbRuntime;
}

class NllbCTranslate2Runtime {
  private readonly child = spawn(resolveNllbPythonCommand(), ['-u', '-c', buildNllbWorkerScript()], {
    env: resolveNllbChildEnv(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  private readonly pending = new Map<
    string,
    {
      resolve: (value: LocalTranslateBatchResult) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private nextId = 1;
  private closed = false;
  runtimeDevice: 'cuda' | 'cpu' | 'unknown' = 'unknown';

  constructor() {
    this.child.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      this.drainStdout();
    });
    this.child.stderr.on('data', (chunk: Buffer | string) => {
      this.stderrBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    });
    this.child.on('error', (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.child.on('close', (code) => {
      this.closed = true;
      this.failAll(new Error(`NLLB worker 已退出：${this.stderrBuffer.trim() || `exit ${code}`}`));
    });
  }

  isClosed(): boolean {
    return this.closed || this.child.killed;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  translate(
    texts: string[],
    timeoutMs: number,
    options: LocalTranslateDirectionOptions = {}
  ): Promise<LocalTranslateBatchResult> {
    if (this.isClosed()) {
      return Promise.reject(new Error('NLLB worker 不可用。'));
    }
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`NLLB 批量翻译超时：${Math.round(timeoutMs / 1000)} 秒`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        `${JSON.stringify({
          id,
          texts,
          sourceLanguage: options.sourceLanguage ?? 'en',
          targetLanguage: options.targetLanguage ?? 'zh'
        })}\n`,
        'utf8',
        (error) => {
          if (!error) {
            return;
          }
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      );
    });
  }

  close(): void {
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private drainStdout(): void {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    let message: {
      id?: unknown;
      texts?: unknown;
      error?: unknown;
      device?: unknown;
      warning?: unknown;
      fallbackReason?: unknown;
    };
    try {
      message = JSON.parse(line) as {
        id?: unknown;
        texts?: unknown;
        error?: unknown;
        device?: unknown;
        warning?: unknown;
        fallbackReason?: unknown;
      };
    } catch {
      return;
    }
    const id = typeof message.id === 'string' ? message.id : '';
    const entry = this.pending.get(id);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (typeof message.device === 'string' && (message.device === 'cuda' || message.device === 'cpu')) {
      this.runtimeDevice = message.device;
    }
    if (typeof message.error === 'string' && message.error) {
      entry.reject(new Error(message.error));
      return;
    }
    if (!Array.isArray(message.texts) || !message.texts.every((item) => typeof item === 'string')) {
      entry.reject(new Error('NLLB worker 返回格式无效。'));
      return;
    }
    entry.resolve({
      texts: message.texts.map((item) => item.replace(/\s+/gu, ' ').trim()),
      engine: 'nllb-ct2-int8',
      device: this.runtimeDevice,
      model: DEFAULT_NLLB_MODEL_NAME,
      warning: typeof message.warning === 'string' ? message.warning : undefined,
      fallbackReason: typeof message.fallbackReason === 'string' ? message.fallbackReason : undefined
    });
  }

  private failAll(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

function buildNllbWorkerScript(): string {
  return [
    'import json, os, sys, traceback',
    'MODEL_NAME = "facebook/nllb-200-distilled-600M"',
    'LANGUAGE_CODES = {"en": "eng_Latn", "zh": "zho_Hans"}',
    'model_dir = os.environ.get("FTRANSLATE_NLLB_MODEL_DIR")',
    'tokenizer_dir = os.environ.get("FTRANSLATE_NLLB_TOKENIZER_DIR") or MODEL_NAME',
    'cuda_dll_dirs = [p for p in os.environ.get("FTRANSLATE_NLLB_CUDA_DLL_DIRS", "").split(os.pathsep) if p]',
    'if hasattr(os, "add_dll_directory"):',
    '    for dll_dir in cuda_dll_dirs:',
    '        if os.path.isdir(dll_dir):',
    '            os.add_dll_directory(dll_dir)',
    'import ctranslate2',
    'device_pref = os.environ.get("FTRANSLATE_NLLB_DEVICE", "auto").lower()',
    'beam_size = max(1, min(8, int(os.environ.get("FTRANSLATE_NLLB_BEAM_SIZE", "1"))))',
    'max_decoding_length = max(128, min(1024, int(os.environ.get("FTRANSLATE_NLLB_MAX_DECODING_LENGTH", "512"))))',
    'hf_home = os.environ.get("HF_HOME")',
    'translator = None',
    'tokenizer = None',
    'runtime_device = "unknown"',
    'fallback_reason = ""',
    '',
    'def load_runtime():',
    '    global translator, tokenizer, runtime_device, fallback_reason',
    '    if translator is not None and tokenizer is not None:',
    '        return',
    '    from transformers import AutoTokenizer',
    '    tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir, src_lang=LANGUAGE_CODES["en"], cache_dir=hf_home, local_files_only=True)',
    '    devices = [device_pref] if device_pref in ("cuda", "cpu") else ["cuda", "cpu"]',
    '    last_error = None',
    '    for device in devices:',
    '        try:',
    '            translator = ctranslate2.Translator(model_dir, device=device, compute_type="int8")',
    '            runtime_device = device',
    '            return',
    '        except Exception as exc:',
    '            last_error = exc',
    '            if device == "cuda":',
    '                fallback_reason = str(exc)',
    '    raise last_error or RuntimeError("No CTranslate2 device available")',
    '',
    'def translate_texts(texts, source_language="en", target_language="zh"):',
    '    global translator, runtime_device, fallback_reason',
    '    load_runtime()',
    '    if not texts:',
    '        return []',
    '    source_lang = LANGUAGE_CODES.get(source_language, LANGUAGE_CODES["en"])',
    '    target_lang = LANGUAGE_CODES.get(target_language, LANGUAGE_CODES["zh"])',
    '    tokenizer.src_lang = source_lang',
    '    source_batches = []',
    '    target_prefixes = []',
    '    tgt_id = tokenizer.convert_tokens_to_ids(target_lang)',
    '    tgt_token = tokenizer.convert_ids_to_tokens(tgt_id) if isinstance(tgt_id, int) and tgt_id >= 0 else target_lang',
    '    for text in texts:',
    '        encoded = tokenizer(text or "", return_attention_mask=False, truncation=True, max_length=max_decoding_length)',
    '        source_batches.append(tokenizer.convert_ids_to_tokens(encoded["input_ids"]))',
    '        target_prefixes.append([tgt_token])',
    '    try:',
    '        results = translator.translate_batch(source_batches, target_prefix=target_prefixes, beam_size=beam_size, max_decoding_length=max_decoding_length)',
    '    except Exception:',
    '        if runtime_device == "cuda" and device_pref == "auto":',
    '            fallback_reason = traceback.format_exc().strip()',
    '            translator = ctranslate2.Translator(model_dir, device="cpu", compute_type="int8")',
    '            runtime_device = "cpu"',
    '            results = translator.translate_batch(source_batches, target_prefix=target_prefixes, beam_size=beam_size, max_decoding_length=max_decoding_length)',
    '        else:',
    '            raise',
    '    outputs = []',
    '    for result in results:',
    '        tokens = result.hypotheses[0]',
    '        if tokens and tokens[0] == tgt_token:',
    '            tokens = tokens[1:]',
    '        outputs.append(tokenizer.decode(tokenizer.convert_tokens_to_ids(tokens), skip_special_tokens=True).strip())',
    '    return outputs',
    '',
    'for line in sys.stdin:',
    '    if not line.strip():',
    '        continue',
    '    req_id = None',
    '    try:',
    '        payload = json.loads(line)',
    '        req_id = payload.get("id")',
    '        texts = payload.get("texts", [])',
    '        source_language = payload.get("sourceLanguage", "en")',
    '        target_language = payload.get("targetLanguage", "zh")',
    '        out = translate_texts(texts, source_language, target_language)',
    '        warning = ("CUDA unavailable; using CPU fallback" if runtime_device == "cpu" and fallback_reason else "")',
    '        sys.stdout.write(json.dumps({"id": req_id, "texts": out, "device": runtime_device, "warning": warning, "fallbackReason": fallback_reason}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()',
    '    except Exception as exc:',
    '        sys.stdout.write(json.dumps({"id": req_id, "error": str(exc), "device": runtime_device, "fallbackReason": fallback_reason}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()'
  ].join('\n');
}
