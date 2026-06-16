import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type LocalTranslationCacheEngine = 'nllb-ct2-int8' | 'argos';
export type LocalTranslationRuntimeEngine = 'nllb-ct2' | 'argos';
export type LocalTranslationPreference = 'nllb-first' | 'argos-first' | 'nllb-only' | 'argos-only';
export type LocalTranslationDevicePreference = 'auto' | 'cuda' | 'cpu';

export interface LocalTranslateBatchResult {
  texts: string[];
  engine: LocalTranslationCacheEngine;
  device?: 'cuda' | 'cpu' | 'unknown';
  model?: string;
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
const DEFAULT_NLLB_TIMEOUT_MS = 120_000;
const DEFAULT_NLLB_MODEL_NAME = 'nllb-200-distilled-600M-ct2-int8';

let nllbRuntime: NllbCTranslate2Runtime | null = null;

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
  return {
    ...process.env,
    FTRANSLATE_NLLB_MODEL_DIR: resolveNllbModelDir(),
    FTRANSLATE_NLLB_TOKENIZER_DIR: resolveNllbTokenizerDir(),
    FTRANSLATE_NLLB_DEVICE: resolveNllbDevice(),
    HF_HOME: process.env.HF_HOME?.trim() || DEFAULT_NLLB_HF_HOME,
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_OFFLINE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  };
}

export function getLocalTranslationStatus(): LocalTranslationStatus {
  const pythonPath = resolveNllbPythonCommand();
  const modelDir = resolveNllbModelDir();
  const tokenizerDir = resolveNllbTokenizerDir();
  const configured = Boolean(modelDir) && fs.existsSync(modelDir) && fs.existsSync(tokenizerDir);
  const runtime = nllbRuntime && !nllbRuntime.isClosed() ? nllbRuntime : null;
  return {
    preferredEngine: resolveLocalTranslationPreference(),
    nllb: {
      configured,
      available: configured,
      pythonPath,
      modelDir,
      tokenizerDir,
      device: resolveNllbDevice(),
      runtimeDevice: runtime?.runtimeDevice ?? 'unknown',
      message: configured
        ? 'NLLB CTranslate2 int8 模型与 tokenizer 已配置。'
        : `未找到 NLLB 模型或 tokenizer：${modelDir} / ${tokenizerDir}`
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
  return getLocalTranslationStatus();
}

export async function warmUpNllbTranslator(timeoutMs = 45_000): Promise<LocalTranslationStatus> {
  if (!fs.existsSync(resolveNllbModelDir()) || !fs.existsSync(resolveNllbTokenizerDir())) {
    return getLocalTranslationStatus();
  }
  try {
    await translateTextsWithNllbCTranslate2(['warm up'], timeoutMs);
  } catch {
    resetNllbRuntime();
  }
  return getLocalTranslationStatus();
}

export async function translateTextsWithNllbCTranslate2(
  texts: string[],
  timeoutMs = DEFAULT_NLLB_TIMEOUT_MS
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
  const runtime = getNllbRuntime();
  const result = await runtime.translate(cleanTexts, Math.max(timeoutMs, cleanTexts.length * 8_000));
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

  translate(texts: string[], timeoutMs: number): Promise<LocalTranslateBatchResult> {
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
      this.child.stdin.write(`${JSON.stringify({ id, texts })}\n`, 'utf8', (error) => {
        if (!error) {
          return;
        }
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
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
    let message: { id?: unknown; texts?: unknown; error?: unknown; device?: unknown };
    try {
      message = JSON.parse(line) as { id?: unknown; texts?: unknown; error?: unknown; device?: unknown };
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
      model: DEFAULT_NLLB_MODEL_NAME
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
    'import ctranslate2',
    'MODEL_NAME = "facebook/nllb-200-distilled-600M"',
    'SRC_LANG = "eng_Latn"',
    'TGT_LANG = "zho_Hans"',
    'model_dir = os.environ.get("FTRANSLATE_NLLB_MODEL_DIR")',
    'tokenizer_dir = os.environ.get("FTRANSLATE_NLLB_TOKENIZER_DIR") or MODEL_NAME',
    'device_pref = os.environ.get("FTRANSLATE_NLLB_DEVICE", "auto").lower()',
    'hf_home = os.environ.get("HF_HOME")',
    'translator = None',
    'tokenizer = None',
    'runtime_device = "unknown"',
    '',
    'def load_runtime():',
    '    global translator, tokenizer, runtime_device',
    '    if translator is not None and tokenizer is not None:',
    '        return',
    '    from transformers import AutoTokenizer',
    '    tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir, src_lang=SRC_LANG, cache_dir=hf_home, local_files_only=True)',
    '    devices = [device_pref] if device_pref in ("cuda", "cpu") else ["cuda", "cpu"]',
    '    last_error = None',
    '    for device in devices:',
    '        try:',
    '            translator = ctranslate2.Translator(model_dir, device=device, compute_type="int8")',
    '            runtime_device = device',
    '            return',
    '        except Exception as exc:',
    '            last_error = exc',
    '    raise last_error or RuntimeError("No CTranslate2 device available")',
    '',
    'def translate_texts(texts):',
    '    global translator, runtime_device',
    '    load_runtime()',
    '    if not texts:',
    '        return []',
    '    source_batches = []',
    '    target_prefixes = []',
    '    tgt_id = tokenizer.convert_tokens_to_ids(TGT_LANG)',
    '    tgt_token = tokenizer.convert_ids_to_tokens(tgt_id) if isinstance(tgt_id, int) and tgt_id >= 0 else TGT_LANG',
    '    for text in texts:',
    '        encoded = tokenizer(text or "", return_attention_mask=False, truncation=True, max_length=768)',
    '        source_batches.append(tokenizer.convert_ids_to_tokens(encoded["input_ids"]))',
    '        target_prefixes.append([tgt_token])',
    '    try:',
    '        results = translator.translate_batch(source_batches, target_prefix=target_prefixes, beam_size=4, max_decoding_length=768)',
    '    except Exception:',
    '        if runtime_device == "cuda" and device_pref == "auto":',
    '            translator = ctranslate2.Translator(model_dir, device="cpu", compute_type="int8")',
    '            runtime_device = "cpu"',
    '            results = translator.translate_batch(source_batches, target_prefix=target_prefixes, beam_size=4, max_decoding_length=768)',
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
    '        out = translate_texts(texts)',
    '        sys.stdout.write(json.dumps({"id": req_id, "texts": out, "device": runtime_device}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()',
    '    except Exception as exc:',
    '        sys.stdout.write(json.dumps({"id": req_id, "error": str(exc), "device": runtime_device}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()'
  ].join('\n');
}
