import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { collectAcademicGlossaryMatches } from '../shared/academicTranslationGlossary';
import type {
  LocalTranslateBatchResult,
  LocalTranslateDirectionOptions,
  LocalTranslationRuntimeState
} from './localTranslationService';

const DEFAULT_HYMT_ROOT = 'E:\\FTranslateTools\\hy-mt2';
const DEFAULT_HYMT_SERVER = path.join(DEFAULT_HYMT_ROOT, 'runtime', 'llama-server.exe');
const DEFAULT_HYMT_QUALITY_MODEL = path.join(DEFAULT_HYMT_ROOT, 'models', 'Hy-MT2-7B-Q4_K_M.gguf');
const DEFAULT_HYMT_FAST_MODEL = path.join(DEFAULT_HYMT_ROOT, 'models', 'Hy-MT2-1.8B-Q4_K_M.gguf');
const DEFAULT_HYMT_TIMEOUT_MS = 120_000;
const DEFAULT_HYMT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_HYMT_PARALLEL = 2;
const MAX_HYMT_CONTEXT_CHARS = 900;
const HYMT_PROTECTED_MARKER_PATTERN = /\b86753\d{2}901\b/gu;
const HYMT_STRICT_RETRY_SEED_OFFSET = 104_729;

export interface HyMt2RuntimeSnapshot {
  configured: boolean;
  available: boolean;
  serverPath: string;
  modelPath: string;
  runtimeState: LocalTranslationRuntimeState;
  runtimeDevice: 'cuda' | 'cpu' | 'unknown';
  lastRuntimeError: string;
  lastCheckedAt: string;
  warmupMs: number;
  message: string;
  workerRunning: boolean;
  pending: number;
}

export interface HyMt2GenerationConfig {
  temperature: number;
  top_k: number;
  top_p: number;
  repeat_penalty: number;
  seed: number;
}

export function buildHyMt2GenerationConfig(
  options: { seed?: number; strict?: boolean } = {}
): HyMt2GenerationConfig {
  const explicitSeed = options.seed !== undefined;
  const baseSeed = normalizeHyMt2Seed(options.seed, 42);
  const seed = options.strict
    ? explicitSeed
      ? normalizeHyMt2Seed(baseSeed + HYMT_STRICT_RETRY_SEED_OFFSET, 3407)
      : 3407
    : baseSeed;
  return {
    temperature: 0.7,
    top_k: 20,
    top_p: 0.6,
    repeat_penalty: 1.05,
    seed
  };
}

let hyMt2Runtime: HyMt2Runtime | null = null;
let hyMt2WarmupPromise: Promise<HyMt2RuntimeSnapshot> | null = null;
let hyMt2RuntimeStatus: {
  runtimeState: LocalTranslationRuntimeState;
  runtimeDevice: 'cuda' | 'cpu' | 'unknown';
  lastRuntimeError: string;
  lastCheckedAt: string;
  warmupMs: number;
} = {
  runtimeState: 'not_checked',
  runtimeDevice: 'unknown',
  lastRuntimeError: '',
  lastCheckedAt: '',
  warmupMs: 0
};

export function resolveHyMt2ServerCommand(): string {
  return process.env.FTRANSLATE_HYMT_SERVER?.trim() || DEFAULT_HYMT_SERVER;
}

export function resolveHyMt2ModelPath(): string {
  const configured = process.env.FTRANSLATE_HYMT_MODEL?.trim();
  if (configured) {
    return configured;
  }
  if (fs.existsSync(DEFAULT_HYMT_QUALITY_MODEL)) {
    return DEFAULT_HYMT_QUALITY_MODEL;
  }
  if (fs.existsSync(DEFAULT_HYMT_FAST_MODEL)) {
    return DEFAULT_HYMT_FAST_MODEL;
  }
  return DEFAULT_HYMT_QUALITY_MODEL;
}

export function resolveHyMt2ModelCacheIdentity(): string {
  return path.basename(resolveHyMt2ModelPath(), path.extname(resolveHyMt2ModelPath())).toLowerCase();
}

export function hasConfiguredHyMt2(): boolean {
  const externalBaseUrl = process.env.FTRANSLATE_HYMT_BASE_URL?.trim();
  if (externalBaseUrl) {
    return true;
  }
  return fs.existsSync(resolveHyMt2ServerCommand()) && fs.existsSync(resolveHyMt2ModelPath());
}

export function getHyMt2RuntimeStatus(): HyMt2RuntimeSnapshot {
  const runtime = hyMt2Runtime && !hyMt2Runtime.isClosed() ? hyMt2Runtime : null;
  const configured = hasConfiguredHyMt2();
  const runtimeState = configured ? hyMt2RuntimeStatus.runtimeState : 'failed';
  const runtimeDevice = runtime?.runtimeDevice ?? hyMt2RuntimeStatus.runtimeDevice;
  const available = configured && Boolean(runtime) && runtimeState === 'ready';
  return {
    configured,
    available,
    serverPath: resolveHyMt2ServerCommand(),
    modelPath: resolveHyMt2ModelPath(),
    runtimeState,
    runtimeDevice,
    lastRuntimeError: hyMt2RuntimeStatus.lastRuntimeError,
    lastCheckedAt: hyMt2RuntimeStatus.lastCheckedAt,
    warmupMs: hyMt2RuntimeStatus.warmupMs,
    message: buildHyMt2StatusMessage({
      configured,
      runtimeState,
      runtimeDevice,
      lastRuntimeError: hyMt2RuntimeStatus.lastRuntimeError,
      warmupMs: hyMt2RuntimeStatus.warmupMs
    }),
    workerRunning: Boolean(runtime),
    pending: runtime?.pendingCount() ?? 0
  };
}

export async function warmUpHyMt2Translator(
  timeoutMs = DEFAULT_HYMT_STARTUP_TIMEOUT_MS
): Promise<HyMt2RuntimeSnapshot> {
  if (!hasConfiguredHyMt2()) {
    updateHyMt2RuntimeStatus({
      runtimeState: 'failed',
      runtimeDevice: 'unknown',
      lastRuntimeError: `未找到 HY-MT2 模型或 llama.cpp：${resolveHyMt2ModelPath()} / ${resolveHyMt2ServerCommand()}`,
      warmupMs: 0
    });
    return getHyMt2RuntimeStatus();
  }
  if (hyMt2WarmupPromise) {
    return hyMt2WarmupPromise;
  }
  updateHyMt2RuntimeStatus({
    runtimeState: 'warming',
    runtimeDevice: hyMt2RuntimeStatus.runtimeDevice,
    lastRuntimeError: '',
    warmupMs: 0
  });
  const startedAt = Date.now();
  hyMt2WarmupPromise = (async () => {
    try {
      await translateTextsWithHyMt2(['warm up'], timeoutMs);
      updateHyMt2RuntimeStatus({
        runtimeState: 'ready',
        runtimeDevice: hyMt2Runtime?.runtimeDevice ?? 'unknown',
        lastRuntimeError: '',
        warmupMs: Date.now() - startedAt
      });
    } catch (error) {
      resetHyMt2Runtime();
      updateHyMt2RuntimeStatus({
        runtimeState: 'failed',
        runtimeDevice: 'unknown',
        lastRuntimeError: formatErrorMessage(error),
        warmupMs: Date.now() - startedAt
      });
    } finally {
      hyMt2WarmupPromise = null;
    }
    return getHyMt2RuntimeStatus();
  })();
  return hyMt2WarmupPromise;
}

export async function translateTextsWithHyMt2(
  texts: string[],
  timeoutMs = DEFAULT_HYMT_TIMEOUT_MS,
  options: LocalTranslateDirectionOptions = {}
): Promise<LocalTranslateBatchResult> {
  const cleanTexts = texts.map((text) => (typeof text === 'string' ? text : ''));
  if (cleanTexts.length === 0) {
    return {
      texts: [],
      engine: 'hy-mt2-q4',
      device: 'unknown',
      model: resolveHyMt2ModelCacheIdentity()
    };
  }
  if (!hasConfiguredHyMt2()) {
    throw new Error(`HY-MT2 本地翻译未配置：${resolveHyMt2ModelPath()} / ${resolveHyMt2ServerCommand()}`);
  }
  const startedAt = Date.now();
  const runtime = getHyMt2Runtime();
  try {
    const translatedTexts = await runtime.translate(
      cleanTexts,
      Math.max(timeoutMs, cleanTexts.length * 8_000),
      options
    );
    updateHyMt2RuntimeStatus({
      runtimeState: 'ready',
      runtimeDevice: runtime.runtimeDevice,
      lastRuntimeError: '',
      warmupMs: hyMt2RuntimeStatus.warmupMs || Date.now() - startedAt
    });
    return {
      texts: translatedTexts,
      engine: 'hy-mt2-q4',
      device: runtime.runtimeDevice,
      model: resolveHyMt2ModelCacheIdentity()
    };
  } catch (error) {
    updateHyMt2RuntimeStatus({
      runtimeState: 'failed',
      runtimeDevice: runtime.runtimeDevice,
      lastRuntimeError: formatErrorMessage(error),
      warmupMs: hyMt2RuntimeStatus.warmupMs || Date.now() - startedAt
    });
    throw error;
  }
}

export function resetHyMt2Runtime(): void {
  if (hyMt2Runtime) {
    hyMt2Runtime.close();
    hyMt2Runtime = null;
  }
  updateHyMt2RuntimeStatus({
    runtimeState: 'not_checked',
    runtimeDevice: 'unknown',
    lastRuntimeError: '',
    warmupMs: 0
  });
}

export function buildHyMt2Prompt(
  source: string,
  options: LocalTranslateDirectionOptions = {},
  strict = false
): string {
  const sourceLanguage = options.sourceLanguage ?? 'en';
  const targetLanguage = options.targetLanguage ?? 'zh';
  const targetLabel = targetLanguage === 'en' ? '英文' : '中文';
  const context = normalizeHyMt2Context(options.itemContext?.context ?? '');
  const academicStyle = options.itemContext?.style === 'academic-paper'
    ? '翻译风格必须符合学术论文书面语，忠实、准确、自然、简洁，不得增加原文没有的信息。\n'
    : '';
  const protectedMarkers = Array.from(new Set(source.match(HYMT_PROTECTED_MARKER_PATTERN) ?? []));
  const markerConstraint = protectedMarkers.length > 0
    ? (
        `原文中的数字占位符 ${protectedMarkers.join('、')} 必须在译文中原样保留且各出现恰好一次，` +
        '不得遗漏、修改或翻译，并保持在对应语义位置。\n'
      )
    : '';
  const strictConstraint = strict
    ? '严格要求：背景信息只用于消歧，禁止复述或翻译背景；只翻译当前文本，并逐字保持所有数字占位符；译文必须语法通顺，避免重复助词和重叠谓语。\n'
    : '';
  const glossaryLines = sourceLanguage === 'en' && targetLanguage === 'zh'
    ? collectAcademicGlossaryMatches(source)
        .slice(0, 20)
        .map((match) => `${match.source} 翻译成 ${match.target}`)
    : [];
  const glossaryPrefix = glossaryLines.length > 0
    ? `参考下面的翻译：\n${glossaryLines.join('\n')}\n\n`
    : '';
  const contextPrefix = context ? `〖背景信息〗\n${context}\n\n` : '';
  const translationInstruction = context
    ? `参考上面的信息，把下面的文本翻译成${targetLabel}。不要翻译上文，只输出当前文本的译文，不要额外解释：`
    : `将以下文本翻译为${targetLabel}，注意只需要输出翻译后的结果，不要额外解释：`;
  return (
    `${glossaryPrefix}${contextPrefix}${academicStyle}${markerConstraint}${strictConstraint}` +
    `${translationInstruction}\n\n${source}`
  );
}

function normalizeHyMt2Context(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').replace(/[ \t]+/gu, ' ').trim();
  if (normalized.length <= MAX_HYMT_CONTEXT_CHARS) {
    return normalized;
  }
  const truncated = normalized.slice(normalized.length - MAX_HYMT_CONTEXT_CHARS);
  const firstBoundary = truncated.search(/(?<=[.!?。！？])\s+/u);
  return (firstBoundary >= 0 ? truncated.slice(firstBoundary + 1) : truncated).trim();
}

export function normalizeHyMt2Output(value: string): string {
  let normalized = value.replace(/\r\n?/gu, '\n').trim();
  const fenced = normalized.match(/^```(?:[A-Za-z0-9_-]+)?\s*\n?([\s\S]*?)\n?```$/u);
  if (fenced) {
    normalized = fenced[1]?.trim() ?? '';
  }
  const tagged = normalized.match(/^<target>\s*([\s\S]*?)\s*<\/target>$/iu);
  if (tagged) {
    normalized = tagged[1]?.trim() ?? '';
  }
  return normalized.replace(/^(?:翻译结果|译文)\s*[：:]\s*/u, '').trim();
}

export function inferHyMt2RuntimeDevice(log: string): 'cuda' | 'cpu' | 'unknown' {
  if (/\bCUDA\d*\b|offload(?:ed|ing).+GPU|using device CUDA/iu.test(log)) {
    return 'cuda';
  }
  if (/CPU backend only|using CPU(?:\s+backend)? only/iu.test(log)) {
    return 'cpu';
  }
  return 'unknown';
}

export function validateHyMt2ProtectedMarkers(source: string, translated: string): boolean {
  const expected = [...(source.match(HYMT_PROTECTED_MARKER_PATTERN) ?? [])].sort();
  const actual = [...(translated.match(HYMT_PROTECTED_MARKER_PATTERN) ?? [])].sort();
  return expected.length === actual.length && expected.every((marker, index) => marker === actual[index]);
}

export function hasHyMt2ContextLeakage(source: string, translated: string, context: string): boolean {
  const normalizedContext = normalizeComparableLatinText(context);
  if (!normalizedContext) {
    return false;
  }

  const normalizedSource = normalizeComparableLatinText(source);
  const normalizedTranslation = normalizeComparableLatinText(translated);
  const contextTokens = normalizedContext.split(' ').filter(Boolean);
  for (let index = 0; index + 6 <= contextTokens.length; index += 1) {
    const phrase = contextTokens.slice(index, index + 6).join(' ');
    if (!normalizedSource.includes(phrase) && normalizedTranslation.includes(phrase)) {
      return true;
    }
  }

  const sourceLength = countMeaningfulHyMt2Characters(source);
  const translatedLength = countMeaningfulHyMt2Characters(translated);
  return sourceLength >= 16 && translatedLength > Math.max(48, Math.ceil(sourceLength * 1.8));
}

export function hasHyMt2FluencyArtifact(value: string): boolean {
  const compact = value.replace(/\s+/gu, '');
  if (/了(?:进行|开展|实施|完成|实现|采用|提出|评估|验证|测试)了/u.test(compact)) {
    return true;
  }
  return /([\u3400-\u9fff]{2,4})了\1了/u.test(compact);
}

function normalizeComparableLatinText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function countMeaningfulHyMt2Characters(value: string): number {
  return value.match(/[A-Za-z0-9\u3400-\u9fff]/gu)?.length ?? 0;
}

function getHyMt2Runtime(): HyMt2Runtime {
  if (!hyMt2Runtime || hyMt2Runtime.isClosed()) {
    hyMt2Runtime = new HyMt2Runtime();
  }
  return hyMt2Runtime;
}

class HyMt2Runtime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private baseUrl = process.env.FTRANSLATE_HYMT_BASE_URL?.trim().replace(/\/$/u, '') ?? '';
  private readonly apiKey = process.env.FTRANSLATE_HYMT_API_KEY?.trim() || crypto.randomBytes(24).toString('hex');
  private stderrBuffer = '';
  private closed = false;
  private pending = 0;
  runtimeDevice: 'cuda' | 'cpu' | 'unknown' = 'unknown';

  isClosed(): boolean {
    return this.closed || Boolean(this.child?.killed);
  }

  pendingCount(): number {
    return this.pending;
  }

  async translate(
    texts: string[],
    timeoutMs: number,
    options: LocalTranslateDirectionOptions
  ): Promise<string[]> {
    await this.ensureReady(Math.min(timeoutMs, DEFAULT_HYMT_STARTUP_TIMEOUT_MS));
    this.pending += texts.length;
    try {
      return await mapWithConcurrency(texts, DEFAULT_HYMT_PARALLEL, (text, index) =>
        this.translateOne(text, timeoutMs, {
          ...options,
          itemContext: options.itemContexts?.[index] ?? options.itemContext
        })
      );
    } finally {
      this.pending = Math.max(0, this.pending - texts.length);
    }
  }

  close(): void {
    this.closed = true;
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }

  private async ensureReady(timeoutMs: number): Promise<void> {
    if (this.closed) {
      throw new Error('HY-MT2 worker 已关闭。');
    }
    if (this.baseUrl && await isHealthyHyMt2Server(this.baseUrl, this.apiKey, 1_500)) {
      return;
    }
    if (!this.readyPromise) {
      this.readyPromise = this.startServer(timeoutMs).catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }
    await this.readyPromise;
  }

  private async startServer(timeoutMs: number): Promise<void> {
    const externalBaseUrl = process.env.FTRANSLATE_HYMT_BASE_URL?.trim();
    if (externalBaseUrl) {
      this.baseUrl = externalBaseUrl.replace(/\/$/u, '');
      await waitForHyMt2Server(this.baseUrl, this.apiKey, timeoutMs, () => this.closed);
      return;
    }

    const port = await findFreeTcpPort();
    this.baseUrl = `http://127.0.0.1:${port}`;
    const serverCommand = resolveHyMt2ServerCommand();
    const modelPath = resolveHyMt2ModelPath();
    const gpuLayers = process.env.FTRANSLATE_HYMT_GPU_LAYERS?.trim() || 'auto';
    this.child = spawn(
      serverCommand,
      [
        '-m', modelPath,
        '--host', '127.0.0.1',
        '--port', String(port),
        '-ngl', gpuLayers,
        '-c', '4096',
        '-np', String(DEFAULT_HYMT_PARALLEL),
        '-lv', '4',
        '--flash-attn', 'auto',
        '--api-key', this.apiKey,
        '--no-webui',
        '--no-warmup'
      ],
      {
        cwd: path.dirname(serverCommand),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    this.child.stdout.on('data', () => undefined);
    this.child.stderr.on('data', (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-65_536);
      const inferredDevice = inferHyMt2RuntimeDevice(text);
      if (inferredDevice !== 'unknown') {
        this.runtimeDevice = inferredDevice;
      }
    });
    this.child.on('error', (error) => {
      this.stderrBuffer = `${this.stderrBuffer}\n${formatErrorMessage(error)}`.slice(-65_536);
    });
    this.child.on('close', () => {
      if (!this.closed) {
        this.readyPromise = null;
      }
    });
    await waitForHyMt2Server(
      this.baseUrl,
      this.apiKey,
      timeoutMs,
      () => this.closed || Boolean(this.child?.exitCode !== null)
    ).catch((error) => {
      const details = this.stderrBuffer.trim();
      this.close();
      throw new Error(details ? `${formatErrorMessage(error)}：${details.slice(-2_000)}` : formatErrorMessage(error));
    });
    if (this.runtimeDevice === 'unknown') {
      this.runtimeDevice = inferHyMt2RuntimeDevice(this.stderrBuffer);
    }
  }

  private async translateOne(
    source: string,
    timeoutMs: number,
    options: LocalTranslateDirectionOptions
  ): Promise<string> {
    if (!source.trim()) {
      return '';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let lastValidationError = 'HY-MT2 未返回翻译文本。';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const strictAttempt = attempt === 1;
        const generation = buildHyMt2GenerationConfig({
          seed: options.generation?.seed,
          strict: strictAttempt
        });
        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            messages: [{
              role: 'user',
              content: buildHyMt2Prompt(source, options, Boolean(options.generation?.strict) || strictAttempt)
            }],
            max_tokens: estimateHyMt2MaxTokens(source),
            ...generation,
            stream: false
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HY-MT2 请求失败：HTTP ${response.status} ${await response.text()}`);
        }
        const payload = await response.json() as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        const normalized = normalizeHyMt2Output(typeof content === 'string' ? content : '');
        if (!normalized) {
          lastValidationError = 'HY-MT2 未返回翻译文本。';
          continue;
        }
        if (!validateHyMt2ProtectedMarkers(source, normalized)) {
          lastValidationError = 'HY-MT2 损坏了受保护的公式、代码或引用占位符。';
          continue;
        }
        if (hasHyMt2ContextLeakage(source, normalized, options.itemContext?.context ?? '')) {
          lastValidationError = 'HY-MT2 错误输出了只应作为背景的论文上下文。';
          continue;
        }
        if (hasHyMt2FluencyArtifact(normalized)) {
          lastValidationError = 'HY-MT2 译文包含重复助词或重叠谓语。';
          continue;
        }
        return normalized;
      }
      throw new Error(`${lastValidationError} 严格重试后仍未通过质量检查。`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeHyMt2Seed(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.abs(Math.trunc(value as number)) % 2_147_483_647;
  return normalized || fallback;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index] as T, index);
    }
  });
  await Promise.all(workers);
  return output;
}

function estimateHyMt2MaxTokens(source: string): number {
  return Math.min(768, Math.max(96, Math.ceil(source.length * 1.4) + 32));
}

async function findFreeTcpPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error || !port) {
          reject(error ?? new Error('无法分配 HY-MT2 本地端口。'));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHyMt2Server(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  shouldStop: () => boolean
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop()) {
      throw new Error('HY-MT2 本地服务在就绪前退出。');
    }
    if (await isHealthyHyMt2Server(baseUrl, apiKey, 1_500)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`HY-MT2 首次加载超时：${Math.round(timeoutMs / 1000)} 秒`);
}

async function isHealthyHyMt2Server(baseUrl: string, apiKey: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function updateHyMt2RuntimeStatus(
  patch: Partial<typeof hyMt2RuntimeStatus> & Pick<typeof hyMt2RuntimeStatus, 'runtimeState'>
): void {
  hyMt2RuntimeStatus = {
    ...hyMt2RuntimeStatus,
    ...patch,
    lastCheckedAt: new Date().toISOString()
  };
}

function buildHyMt2StatusMessage(input: {
  configured: boolean;
  runtimeState: LocalTranslationRuntimeState;
  runtimeDevice: 'cuda' | 'cpu' | 'unknown';
  lastRuntimeError: string;
  warmupMs: number;
}): string {
  if (!input.configured) {
    return `未找到 HY-MT2 模型或 llama.cpp：${resolveHyMt2ModelPath()} / ${resolveHyMt2ServerCommand()}`;
  }
  if (input.runtimeState === 'not_checked') {
    return 'HY-MT2 专用翻译模型已配置，等待首次预热。';
  }
  if (input.runtimeState === 'warming') {
    return '正在加载 HY-MT2 专用翻译模型。';
  }
  if (input.runtimeState === 'ready') {
    return `HY-MT2 已就绪，运行设备：${input.runtimeDevice.toUpperCase()}，预热 ${input.warmupMs} ms。`;
  }
  return `HY-MT2 运行检查失败：${input.lastRuntimeError || '未知错误'}`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
