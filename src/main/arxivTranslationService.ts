import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { TextDecoder } from 'node:util';
import type {
  ArxivTitleAbstractTranslationRequest,
  ArxivTitleAbstractTranslationResult
} from '../shared/arxiv';

interface ArxivTranslationServiceOptions {
  dbPath: string;
  translateText?: (text: string) => Promise<string>;
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

export class ArxivTranslationService {
  private readonly db: DatabaseSync;
  private readonly translateText: (text: string) => Promise<string>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private translationTail: Promise<unknown> = Promise.resolve();

  constructor(options: ArxivTranslationServiceOptions) {
    this.db = new DatabaseSync(options.dbPath);
    this.translateText = options.translateText ?? ((text) => translateWithArgosCli(text, this.timeoutMs));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TRANSLATION_TIMEOUT_MS;
    this.initDatabase();
  }

  close(): void {
    this.db.close();
  }

  async translatePaper(
    request: ArxivTitleAbstractTranslationRequest
  ): Promise<ArxivTitleAbstractTranslationResult> {
    const stableId = request.stableId.trim();
    const title = request.title.trim();
    const summary = request.summary.trim();

    if (!stableId || !title || !summary) {
      return {
        stableId,
        titleZh: '',
        abstractZh: '',
        engine: 'unavailable',
        status: 'failed',
        cacheHit: false,
        message: '缺少 arXiv 标识、标题或摘要，无法翻译。'
      };
    }

    const cacheKey = buildTranslationCacheKey({ stableId, title, summary });
    const cached = this.readCache(cacheKey);
    if (cached) {
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

    return this.enqueue(async () => {
      const rechecked = this.readCache(cacheKey);
      if (rechecked) {
        return {
          stableId,
          titleZh: rechecked.title_zh,
          abstractZh: rechecked.abstract_zh,
          engine: 'cache',
          status: 'cached',
          cacheHit: true,
          message: '已命中本地 SQLite 翻译缓存。',
          translatedAt: rechecked.translated_at
        };
      }

      try {
        const [titleZh, abstractZh] = await Promise.all([
          this.translateText(title),
          this.translateText(summary)
        ]);
        const translatedAt = new Date(this.now()).toISOString();
        this.writeCache(cacheKey, {
          stableId,
          title,
          summary,
          titleZh: normalizeTranslatedText(titleZh),
          abstractZh: normalizeTranslatedText(abstractZh),
          translatedAt,
          engine: 'argos'
        });
        return {
          stableId,
          titleZh: normalizeTranslatedText(titleZh),
          abstractZh: normalizeTranslatedText(abstractZh),
          engine: 'argos',
          status: 'completed',
          cacheHit: false,
          message: '已使用本地 Argos 翻译并写入 SQLite 缓存。',
          translatedAt
        };
      } catch (error) {
        const isUnavailable = isArgosUnavailableError(error);
        const message = formatTranslationError(error);
        return {
          stableId,
          titleZh: '',
          abstractZh: '',
          engine: 'unavailable',
          status: isUnavailable ? 'unavailable' : 'failed',
          cacheHit: false,
          message
        };
      }
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
    if (hasMojibakeText(row.title_zh) || hasMojibakeText(row.abstract_zh)) {
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
}

function buildTranslationCacheKey(input: { stableId: string; title: string; summary: string }): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
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

export function resolveArgosChildEnv(): NodeJS.ProcessEnv {
  const packagesDir = process.env.FTRANSLATE_ARGOS_PACKAGES_DIR?.trim();
  if (!packagesDir) {
    return process.env;
  }
  return {
    ...process.env,
    ARGOS_PACKAGES_DIR: packagesDir,
    ARGOS_TRANSLATE_PACKAGE_DIR: packagesDir
  };
}

export function decodeArgosCliOutput(buffer: Buffer): string {
  const utf8Text = buffer.toString('utf8');
  if (!hasMojibakeText(utf8Text)) {
    return utf8Text;
  }
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return utf8Text;
  }
}

function hasMojibakeText(value: string): boolean {
  return value.includes('\uFFFD');
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
