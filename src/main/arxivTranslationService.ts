import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TextDecoder } from 'node:util';
import type {
  ArxivTitleAbstractTranslationRequest,
  ArxivTitleAbstractTranslationResult
} from '../shared/arxiv';
import { isMojibakeTranslationText } from '../shared/arxiv';
import {
  type LocalTranslateBatchResult,
  resetNllbRuntime,
  translateTextsWithNllbCTranslate2
} from './localTranslationService';

interface ArxivTranslationServiceOptions {
  dbPath: string;
  translateText?: (text: string) => Promise<string>;
  translateTexts?: (texts: string[]) => Promise<string[]>;
  translateTextsWithEngine?: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  fallbackTranslateTextsWithEngine?: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  now?: () => number;
  timeoutMs?: number;
}

interface CachedTranslationRow {
  title_zh: string;
  abstract_zh: string;
  translated_at: string;
  engine: string;
}

const DEFAULT_TRANSLATION_TIMEOUT_MS = 90_000;
let argosPythonRuntime: ArgosPythonRuntime | null = null;

export class ArxivTranslationService {
  private readonly db: DatabaseSync;
  private readonly translateTextsWithEngine: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  private readonly fallbackTranslateTextsWithEngine?: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private translationTail: Promise<unknown> = Promise.resolve();

  constructor(options: ArxivTranslationServiceOptions) {
    this.db = new DatabaseSync(options.dbPath);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TRANSLATION_TIMEOUT_MS;
    const usesInjectedTranslator = Boolean(options.translateText || options.translateTexts);
    this.translateTextsWithEngine =
      options.translateTextsWithEngine ??
      (options.translateTexts
        ? (async (texts) => ({ texts: (await options.translateTexts?.(texts)) ?? [], engine: 'argos' }))
        : options.translateText
          ? (async (texts) => ({
              texts: await Promise.all(texts.map((text) => options.translateText?.(text) ?? '')),
              engine: 'argos'
            }))
          : ((texts) => translateTextsWithNllbCTranslate2(texts, this.timeoutMs)));
    this.fallbackTranslateTextsWithEngine =
      options.fallbackTranslateTextsWithEngine ??
      (options.translateTextsWithEngine || (!options.translateText && !options.translateTexts)
        ? ((texts) => translateTextsWithArgosEngine(texts, this.timeoutMs))
        : undefined);
    this.now = options.now ?? Date.now;
    this.initDatabase();
    if (!usesInjectedTranslator) {
      void warmUpArgosTranslator(Math.min(this.timeoutMs, 30_000));
    }
  }

  close(): void {
    this.db.close();
    if (argosPythonRuntime) {
      argosPythonRuntime.close();
      argosPythonRuntime = null;
    }
    resetNllbRuntime();
  }

  async translatePaper(
    request: ArxivTitleAbstractTranslationRequest
  ): Promise<ArxivTitleAbstractTranslationResult> {
    const [result] = await this.translatePapers([request]);
    return result;
  }

  async translatePapers(
    requests: ArxivTitleAbstractTranslationRequest[]
  ): Promise<ArxivTitleAbstractTranslationResult[]> {
    const results = new Array<ArxivTitleAbstractTranslationResult>(requests.length);
    const missing: Array<{
      index: number;
      stableId: string;
      title: string;
      summary: string;
      cacheKey: string;
    }> = [];

    requests.forEach((request, index) => {
      const stableId = coerceTranslationInput(request.stableId);
      const title = coerceTranslationInput(request.title);
      const summary = coerceTranslationInput(request.summary);

      if (!stableId || !title || !summary) {
        results[index] = buildFailedTranslationResult(
          stableId,
          '缺少 arXiv 标识、标题或摘要，无法翻译。'
        );
        return;
      }

      const cacheKey = buildTranslationCacheKey({ stableId, title, summary });
      const cached = this.readCache(cacheKey);
      if (cached) {
        results[index] = buildCachedTranslationResult(stableId, cached);
        return;
      }

      missing.push({ index, stableId, title, summary, cacheKey });
    });

    if (missing.length === 0) {
      return results;
    }

    return this.enqueue(async () => {
      const remaining: typeof missing = [];
      missing.forEach((item) => {
        const rechecked = this.readCache(item.cacheKey);
        if (rechecked) {
          results[item.index] = buildCachedTranslationResult(item.stableId, rechecked);
          return;
        }
        remaining.push(item);
      });

      if (remaining.length === 0) {
        return results;
      }

      try {
        const texts = remaining.flatMap((item) => [item.title, item.summary]);
        const translationResult = await this.translateTextsWithFallback(texts);
        const translatedTexts = translationResult.texts;
        const translatedAt = new Date(this.now()).toISOString();

        remaining.forEach((item, itemIndex) => {
          const titleZh = normalizeTranslatedText(translatedTexts[itemIndex * 2] ?? '');
          const abstractZh = normalizeTranslatedText(translatedTexts[itemIndex * 2 + 1] ?? '');
          if (!isUsableTranslatedText(titleZh) || !isUsableTranslatedText(abstractZh)) {
            results[item.index] = buildFailedTranslationResult(
              item.stableId,
              '本地翻译返回了乱码或空结果，已丢弃该缓存并保留英文。'
            );
            return;
          }

          this.writeCache(item.cacheKey, {
            stableId: item.stableId,
            title: item.title,
            summary: item.summary,
            titleZh,
            abstractZh,
            translatedAt,
            engine: translationResult.engine
          });
          results[item.index] = {
            stableId: item.stableId,
            titleZh,
            abstractZh,
            engine: translationResult.engine,
            status: 'completed',
            cacheHit: false,
            message: buildCompletedTranslationMessage(translationResult.engine),
            translatedAt
          };
        });
      } catch (error) {
        const isUnavailable = isArgosUnavailableError(error);
        const message = formatTranslationError(error);
        remaining.forEach((item) => {
          results[item.index] = {
            stableId: item.stableId,
            titleZh: '',
            abstractZh: '',
            engine: 'unavailable',
            status: isUnavailable ? 'unavailable' : 'failed',
            cacheHit: false,
            message
          };
        });
      }
      return results;
    });
  }

  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS arxiv_translation_cache (
        cache_key TEXT PRIMARY KEY,
        stable_id TEXT NOT NULL,
        source_title TEXT NOT NULL,
        source_summary TEXT NOT NULL,
        title_zh TEXT NOT NULL,
        abstract_zh TEXT NOT NULL,
        translated_at TEXT NOT NULL,
        engine TEXT NOT NULL
      );
    `);
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.translationTail.then(task);
    this.translationTail = run.catch(() => undefined);
    return run;
  }

  private readCache(cacheKey: string): CachedTranslationRow | null {
    const row = this.db
      .prepare(
        `SELECT title_zh, abstract_zh, translated_at, engine
         FROM arxiv_translation_cache
         WHERE cache_key = ?`
      )
      .get(cacheKey) as CachedTranslationRow | undefined;
    if (!row?.title_zh || !row.abstract_zh) {
      return null;
    }
    if (isMojibakeTranslationText(row.title_zh) || isMojibakeTranslationText(row.abstract_zh)) {
      this.db.prepare(`DELETE FROM arxiv_translation_cache WHERE cache_key = ?`).run(cacheKey);
      return null;
    }
    return row;
  }

  private writeCache(
    cacheKey: string,
    value: {
      stableId: string;
      title: string;
      summary: string;
      titleZh: string;
      abstractZh: string;
      translatedAt: string;
      engine: string;
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO arxiv_translation_cache(
          cache_key,
          stable_id,
          source_title,
          source_summary,
          title_zh,
          abstract_zh,
          translated_at,
          engine
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          title_zh = excluded.title_zh,
          abstract_zh = excluded.abstract_zh,
          translated_at = excluded.translated_at,
          engine = excluded.engine`
      )
      .run(
        cacheKey,
        value.stableId,
        value.title,
        value.summary,
        value.titleZh,
        value.abstractZh,
        value.translatedAt,
        value.engine
      );
  }

  private async translateTextsWithFallback(texts: string[]): Promise<LocalTranslateBatchResult> {
    try {
      return await this.translateTextsWithEngine(texts);
    } catch (error) {
      if (!this.fallbackTranslateTextsWithEngine) {
        throw error;
      }
      return this.fallbackTranslateTextsWithEngine(texts);
    }
  }
}

function buildTranslationCacheKey(input: { stableId: string; title: string; summary: string }): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        version: 2,
        target: 'zh',
        stableId: input.stableId,
        title: input.title,
        summary: input.summary
      })
    )
    .digest('hex');
}

function normalizeTranslatedText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isUsableTranslatedText(value: string): boolean {
  return Boolean(value.trim()) && !isMojibakeTranslationText(value);
}

function buildCompletedTranslationMessage(engine: LocalTranslateBatchResult['engine']): string {
  return engine === 'nllb-ct2-int8'
    ? '已使用本地 NLLB CTranslate2 int8 批量翻译并写入 SQLite 缓存。'
    : '已使用本地 Argos 批量翻译并写入 SQLite 缓存。';
}

function buildCachedTranslationResult(
  stableId: string,
  cached: CachedTranslationRow
): ArxivTitleAbstractTranslationResult {
  return {
    stableId,
    titleZh: cached.title_zh,
    abstractZh: cached.abstract_zh,
    engine: 'cache',
    status: 'cached',
    cacheHit: true,
    message: '已命中本地 SQLite 翻译缓存。',
    translatedAt: cached.translated_at
  };
}

function buildFailedTranslationResult(stableId: string, message: string): ArxivTitleAbstractTranslationResult {
  return {
    stableId,
    titleZh: '',
    abstractZh: '',
    engine: 'unavailable',
    status: 'failed',
    cacheHit: false,
    message
  };
}

function coerceTranslationInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function translateTextsWithArgosEngine(
  texts: string[],
  timeoutMs: number
): Promise<LocalTranslateBatchResult> {
  return {
    texts: await translateTextsWithArgos(texts, timeoutMs),
    engine: 'argos'
  };
}

async function translateTextsWithArgos(texts: string[], timeoutMs: number): Promise<string[]> {
  if (texts.length === 0) {
    return [];
  }
  try {
    return await translateTextsWithArgosPython(texts, Math.max(timeoutMs, texts.length * 3_000));
  } catch (error) {
    const results: string[] = [];
    for (const text of texts) {
      results.push(await translateWithArgosCli(text, timeoutMs));
    }
    return results;
  }
}

function translateTextsWithArgosPython(texts: string[], timeoutMs: number): Promise<string[]> {
  const runtime = getArgosPythonRuntime();
  return runtime.translate(texts, timeoutMs).catch(async (error) => {
    resetArgosPythonRuntime();
    try {
      return await translateTextsWithArgosPythonOnce(texts, timeoutMs);
    } catch {
      throw error;
    }
  });
}

function translateTextsWithArgosPythonOnce(texts: string[], timeoutMs: number): Promise<string[]> {
  const script = [
    'import json, sys',
    'from argostranslate import translate',
    'payload = json.load(sys.stdin)',
    'texts = payload.get("texts", [])',
    'out = [translate.translate(item, "en", "zh") if item else "" for item in texts]',
    'sys.stdout.write(json.dumps({"texts": out}, ensure_ascii=False))'
  ].join('\n');

  return new Promise((resolve, reject) => {
    const child = spawn(resolveArgosPythonCommand(), ['-c', script], {
      env: resolveArgosChildEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Argos 批量翻译超时：${Math.round(timeoutMs / 1000)} 秒`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = decodeArgosCliOutput(Buffer.concat(stdoutChunks));
      if (code === 0 && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout) as { texts?: unknown };
          if (Array.isArray(parsed.texts) && parsed.texts.every((item) => typeof item === 'string')) {
            const restored = parsed.texts.map((item) => normalizeTranslatedText(item));
            if (restored.length === texts.length && restored.every(Boolean)) {
              resolve(restored);
              return;
            }
          }
        } catch {
          // Fall through to a readable error below.
        }
      }
      const stderr = decodeArgosCliOutput(Buffer.concat(stderrChunks));
      reject(new Error(`Argos 批量翻译失败：${stderr.trim() || stdout.trim() || `exit ${code}`}`));
    });
    child.stdin.end(JSON.stringify({ texts }));
  });
}

function getArgosPythonRuntime(): ArgosPythonRuntime {
  if (!argosPythonRuntime || argosPythonRuntime.isClosed()) {
    argosPythonRuntime = new ArgosPythonRuntime();
  }
  return argosPythonRuntime;
}

function resetArgosPythonRuntime(): void {
  if (argosPythonRuntime) {
    argosPythonRuntime.close();
    argosPythonRuntime = null;
  }
}

async function warmUpArgosTranslator(timeoutMs: number): Promise<void> {
  try {
    await translateTextsWithArgosPython(['warm up'], timeoutMs);
  } catch {
    resetArgosPythonRuntime();
  }
}

class ArgosPythonRuntime {
  private readonly child = spawn(resolveArgosPythonCommand(), ['-u', '-c', buildArgosWorkerScript()], {
    env: resolveArgosChildEnv(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  private readonly pending = new Map<
    string,
    {
      resolve: (value: string[]) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private nextId = 1;
  private closed = false;

  constructor() {
    this.child.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuffer += decodeArgosCliOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.drainStdout();
    });
    this.child.stderr.on('data', (chunk: Buffer | string) => {
      this.stderrBuffer += decodeArgosCliOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    this.child.on('error', (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.child.on('close', (code) => {
      this.closed = true;
      this.failAll(new Error(`Argos worker 已退出：${this.stderrBuffer.trim() || `exit ${code}`}`));
    });
  }

  isClosed(): boolean {
    return this.closed || this.child.killed;
  }

  translate(texts: string[], timeoutMs: number): Promise<string[]> {
    if (this.isClosed()) {
      return Promise.reject(new Error('Argos worker 不可用。'));
    }
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Argos 批量翻译超时：${Math.round(timeoutMs / 1000)} 秒`));
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
    let message: { id?: unknown; texts?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as { id?: unknown; texts?: unknown; error?: unknown };
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
    if (typeof message.error === 'string' && message.error) {
      entry.reject(new Error(message.error));
      return;
    }
    if (!Array.isArray(message.texts) || !message.texts.every((item) => typeof item === 'string')) {
      entry.reject(new Error('Argos worker 返回格式无效。'));
      return;
    }
    entry.resolve(message.texts.map((item) => normalizeTranslatedText(item)));
  }

  private failAll(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

function buildArgosWorkerScript(): string {
  return [
    'import json, sys, traceback',
    'from argostranslate import translate',
    'for line in sys.stdin:',
    '    if not line.strip():',
    '        continue',
    '    req_id = None',
    '    try:',
    '        payload = json.loads(line)',
    '        req_id = payload.get("id")',
    '        texts = payload.get("texts", [])',
    '        out = [translate.translate(item, "en", "zh") if item else "" for item in texts]',
    '        sys.stdout.write(json.dumps({"id": req_id, "texts": out}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()',
    '    except Exception as exc:',
    '        sys.stdout.write(json.dumps({"id": req_id, "error": str(exc)}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()'
  ].join('\n');
}

export function buildArgosCombinedPayload(texts: string[]): { text: string; markers: string[] } {
  const markers = texts.slice(1).map((_, index) => {
    const digest = crypto.createHash('sha1').update(`ftranslate-segment-${index}`).digest('hex').slice(0, 16);
    return String((BigInt(`0x${digest}`) % 9_000_000_000n) + 1_000_000_000n);
  });
  let text = texts[0] ?? '';
  markers.forEach((marker, index) => {
    text += `\n\n${marker}\n\n${texts[index + 1] ?? ''}`;
  });
  return { text, markers };
}

export function splitArgosCombinedOutput(
  output: string,
  markers: string[],
  expectedCount: number
): string[] | null {
  if (expectedCount === 0) {
    return [];
  }
  const segments: string[] = [];
  let cursor = 0;
  for (const marker of markers) {
    const markerIndex = output.indexOf(marker, cursor);
    if (markerIndex < 0) {
      return null;
    }
    segments.push(output.slice(cursor, markerIndex).trim());
    cursor = markerIndex + marker.length;
    const boundarySuffix = output
      .slice(cursor)
      .match(/^\s*(?:[（(][^\r\n]{0,64}[)）]\s*[。.．]?)?\s*/u)?.[0];
    cursor += boundarySuffix?.length ?? 0;
  }
  segments.push(output.slice(cursor).trim());
  return segments.length === expectedCount && segments.every(Boolean) ? segments : null;
}

function translateWithArgosCli(text: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveArgosCliCommand(), ['--from-lang', 'en', '--to-lang', 'zh'], {
      env: resolveArgosChildEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Argos 本地翻译超时：${Math.round(timeoutMs / 1000)} 秒`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = decodeArgosCliOutput(Buffer.concat(stdoutChunks));
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      const stderr = decodeArgosCliOutput(Buffer.concat(stderrChunks));
      reject(new Error(`Argos 本地翻译失败：${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.end(text);
  });
}

export function resolveArgosCliCommand(): string {
  return process.env.FTRANSLATE_ARGOS_CLI?.trim() || 'argos-translate';
}

export function resolveArgosPythonCommand(): string {
  const configured = process.env.FTRANSLATE_ARGOS_PYTHON?.trim();
  if (configured) {
    return configured;
  }
  const cliCommand = process.env.FTRANSLATE_ARGOS_CLI?.trim();
  if (cliCommand && /[\\/]Scripts[\\/]argos-translate(?:\.exe)?$/iu.test(cliCommand)) {
    return path.join(path.dirname(cliCommand), '..', 'python.exe');
  }
  return 'python';
}

export function resolveArgosChildEnv(): NodeJS.ProcessEnv {
  const packagesDir = process.env.FTRANSLATE_ARGOS_PACKAGES_DIR?.trim();
  return {
    ...process.env,
    ...(packagesDir
      ? {
          ARGOS_PACKAGES_DIR: packagesDir,
          ARGOS_TRANSLATE_PACKAGE_DIR: packagesDir
        }
      : {}),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  };
}

export function decodeArgosCliOutput(buffer: Buffer): string {
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const gb18030Text = new TextDecoder('gb18030').decode(buffer);
    return scoreDecodedArgosText(gb18030Text) < scoreDecodedArgosText(utf8Text)
      ? gb18030Text
      : utf8Text;
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

function scoreDecodedArgosText(text: string): number {
  const replacementCount = text.match(/\uFFFD/gu)?.length ?? 0;
  const privateUseCount = text.match(/[\uE000-\uF8FF]/gu)?.length ?? 0;
  const cyrillicCount = text.match(/[\u0400-\u04FF]/gu)?.length ?? 0;
  const mojibakePenalty = isMojibakeTranslationText(text) ? 20 : 0;
  return replacementCount * 10 + privateUseCount * 8 + cyrillicCount * 3 + mojibakePenalty;
}

function formatTranslationError(error: unknown): string {
  if (isArgosUnavailableError(error)) {
    return [
      '离线翻译未配置：当前没有可用的 Argos Translate CLI 或 en→zh 模型，已保留英文标题和摘要。',
      '查看 README 的“arXiv 离线翻译配置”安装说明后，回到本页点击“稍后重试”。',
      'arXiv 检索页不会自动调用 AI 翻译。'
    ].join(' ');
  }
  const message = error instanceof Error ? error.message : String(error);
  return `本地 arXiv 标题/摘要翻译失败：${message}`;
}

function isArgosUnavailableError(error: unknown): boolean {
  if (isMissingArgosError(error)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /translation package|no package|not installed|from[-_ ]?lang|to[-_ ]?lang|language pair/iu.test(message);
}

function isMissingArgosError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
