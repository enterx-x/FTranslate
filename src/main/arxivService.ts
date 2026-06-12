import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { DatabaseSync } from 'node:sqlite';
import {
  type ArxivParsedSearchResult,
  type ArxivSearchRequest,
  type ArxivSearchServiceResult,
  buildArxivApiUrl,
  buildArxivCacheKey,
  parseArxivSearchResult
} from '../shared/arxiv';

interface ArxivServiceOptions {
  dbPath: string;
  fetchImpl?: typeof fetch;
  minRequestGapMs?: number;
  cacheTtlMs?: number;
  firstCooldownMs?: number;
  repeatedCooldownMs?: number;
  requestTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface ArxivLogEntry {
  source: string;
  query: string;
  cacheHit: boolean;
  queueSize: number;
  lastRequestGapMs: number;
  status: string;
}

const DEFAULT_MIN_REQUEST_GAP_MS = 3200;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FIRST_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_REPEATED_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;

export class ArxivService {
  private readonly db: DatabaseSync;
  private readonly fetchImpl: typeof fetch;
  private readonly minRequestGapMs: number;
  private readonly cacheTtlMs: number;
  private readonly firstCooldownMs: number;
  private readonly repeatedCooldownMs: number;
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private requestTail: Promise<unknown> = Promise.resolve();
  private queuedRequests = 0;

  constructor(options: ArxivServiceOptions) {
    this.db = new DatabaseSync(options.dbPath);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.minRequestGapMs = options.minRequestGapMs ?? DEFAULT_MIN_REQUEST_GAP_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.firstCooldownMs = options.firstCooldownMs ?? DEFAULT_FIRST_COOLDOWN_MS;
    this.repeatedCooldownMs = options.repeatedCooldownMs ?? DEFAULT_REPEATED_COOLDOWN_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.initDatabase();
  }

  close(): void {
    this.db.close();
  }

  async search(request: ArxivSearchRequest, source = 'renderer:arxiv-search'): Promise<ArxivSearchServiceResult> {
    const cacheKey = buildArxivCacheKey(request);
    const cached = this.readCache(cacheKey);
    if (cached) {
      this.writeLog({
        source,
        query: cacheKey,
        cacheHit: true,
        queueSize: 0,
        lastRequestGapMs: this.getLastRequestGapMs(),
        status: 'cache-hit'
      });
      return {
        ...cached,
        cacheHit: true,
        queueSize: 0,
        lastRequestGapMs: this.getLastRequestGapMs()
      };
    }

    const queueSize = this.queuedRequests;
    return this.enqueue(async () => {
      const url = buildArxivApiUrl(request);
      const { text, lastRequestGapMs } = await this.fetchText(url, source, cacheKey, queueSize);
      const result = parseArxivSearchResult(text, XmldomParser as any);
      this.writeCache(cacheKey, result);
      return {
        ...result,
        cacheHit: false,
        queueSize,
        lastRequestGapMs
      };
    });
  }

  async downloadPdf(pdfUrl: string, source = 'renderer:arxiv-download'): Promise<Buffer> {
    const url = normalizeArxivPdfDownloadUrl(pdfUrl);
    const query = url.toString();
    const queueSize = this.queuedRequests;
    return this.enqueue(async () => {
      const { buffer } = await this.fetchBinary(url.toString(), source, query, queueSize);
      if (buffer.byteLength < 1024 || buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
        this.writeLog({
          source,
          query,
          cacheHit: false,
          queueSize,
          lastRequestGapMs: this.getLastRequestGapMs(),
          status: 'invalid-pdf'
        });
        throw new Error('arXiv 返回的内容不是有效 PDF。');
      }
      return buffer;
    });
  }

  getRecentLogs(limit = 50): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        `SELECT created_at, source, query, cache_hit, queue_size, last_request_gap_ms, status
         FROM arxiv_request_log
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
  }

  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS arxiv_cache (
        cache_key TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        response_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arxiv_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arxiv_request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        query TEXT NOT NULL,
        cache_hit INTEGER NOT NULL,
        queue_size INTEGER NOT NULL,
        last_request_gap_ms INTEGER NOT NULL,
        status TEXT NOT NULL
      );
    `);
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.queuedRequests += 1;
    const run = this.requestTail.then(async () => {
      this.queuedRequests -= 1;
      return task();
    });
    this.requestTail = run.catch(() => undefined);
    return run;
  }

  private readCache(cacheKey: string): ArxivParsedSearchResult | null {
    const row = this.db
      .prepare('SELECT created_at, response_json FROM arxiv_cache WHERE cache_key = ?')
      .get(cacheKey) as { created_at: number; response_json: string } | undefined;
    if (!row || this.now() - row.created_at > this.cacheTtlMs) {
      return null;
    }
    try {
      const parsed = JSON.parse(row.response_json) as unknown;
      if (Array.isArray(parsed)) {
        return {
          papers: parsed,
          totalResults: parsed.length,
          startIndex: 0,
          itemsPerPage: parsed.length
        } as ArxivParsedSearchResult;
      }
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as ArxivParsedSearchResult).papers)) {
        const result = parsed as ArxivParsedSearchResult;
        return {
          papers: result.papers,
          totalResults: result.totalResults || result.papers.length,
          startIndex: result.startIndex || 0,
          itemsPerPage: result.itemsPerPage || result.papers.length
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private writeCache(cacheKey: string, result: ArxivParsedSearchResult): void {
    this.db
      .prepare(
        `INSERT INTO arxiv_cache(cache_key, created_at, response_json)
         VALUES (?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET created_at = excluded.created_at, response_json = excluded.response_json`
      )
      .run(cacheKey, this.now(), JSON.stringify(result));
  }

  private async fetchText(
    url: string,
    source: string,
    query: string,
    queueSize: number
  ): Promise<{ text: string; lastRequestGapMs: number }> {
    const { response, lastRequestGapMs } = await this.fetchWithPolicy(url, source, query, queueSize);
    const text = await response.text();
    this.writeLog({
      source,
      query,
      cacheHit: false,
      queueSize,
      lastRequestGapMs,
      status: `http-${response.status}`
    });
    return { text, lastRequestGapMs };
  }

  private async fetchBinary(
    url: string,
    source: string,
    query: string,
    queueSize: number
  ): Promise<{ buffer: Buffer; lastRequestGapMs: number }> {
    const { response, lastRequestGapMs } = await this.fetchWithPolicy(url, source, query, queueSize);
    const buffer = Buffer.from(await response.arrayBuffer());
    this.writeLog({
      source,
      query,
      cacheHit: false,
      queueSize,
      lastRequestGapMs,
      status: `http-${response.status}`
    });
    return { buffer, lastRequestGapMs };
  }

  private async fetchWithPolicy(
    url: string,
    source: string,
    query: string,
    queueSize: number
  ): Promise<{ response: Response; lastRequestGapMs: number }> {
    const cooldownError = this.getCooldownError();
    if (cooldownError) {
      this.writeLog({
        source,
        query,
        cacheHit: false,
        queueSize,
        lastRequestGapMs: this.getLastRequestGapMs(),
        status: 'circuit-open-local'
      });
      throw cooldownError;
    }

    const lastRequestAt = this.getStateNumber('last_request_at', 0);
    const beforeWait = this.now();
    const lastRequestGapMs = lastRequestAt > 0 ? Math.max(0, beforeWait - lastRequestAt) : -1;
    if (lastRequestAt > 0 && lastRequestGapMs < this.minRequestGapMs) {
      await this.sleep(this.minRequestGapMs - lastRequestGapMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    this.setStateNumber('last_request_at', this.now());
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'FTranslate/0.1 local desktop arxiv client'
        }
      });
      clearTimeout(timer);
      if (response.status === 429 || response.status === 503) {
        await this.openCircuit(`HTTP ${response.status}`);
        this.writeLog({
          source,
          query,
          cacheHit: false,
          queueSize,
          lastRequestGapMs,
          status: `circuit-open-http-${response.status}`
        });
        throw new Error(`arXiv 请求失败：HTTP ${response.status}。已进入冷却，避免继续触发限流。`);
      }
      if (!response.ok) {
        this.writeLog({
          source,
          query,
          cacheHit: false,
          queueSize,
          lastRequestGapMs,
          status: `http-${response.status}`
        });
        throw new Error(`arXiv 请求失败：HTTP ${response.status}`);
      }
      this.closeCircuit();
      return { response, lastRequestGapMs };
    } catch (error) {
      clearTimeout(timer);
      if (isAbortError(error)) {
        await this.openCircuit('timeout');
        this.writeLog({
          source,
          query,
          cacheHit: false,
          queueSize,
          lastRequestGapMs,
          status: 'circuit-open-timeout'
        });
        throw new Error('arXiv 请求超时。已进入冷却，避免继续触发限流。');
      }
      throw error;
    }
  }

  private getCooldownError(): Error | null {
    const cooldownUntil = this.getStateNumber('cooldown_until', 0);
    const remainingMs = cooldownUntil - this.now();
    if (remainingMs <= 0) {
      return null;
    }
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return new Error(`arXiv 请求正在冷却中，约 ${remainingMinutes} 分钟后再试。冷却期间不会访问 arXiv。`);
  }

  private async openCircuit(reason: string): Promise<void> {
    const failureCount = this.getStateNumber('failure_count', 0) + 1;
    const cooldownMs = failureCount >= 2 ? this.repeatedCooldownMs : this.firstCooldownMs;
    this.setStateNumber('failure_count', failureCount);
    this.setStateNumber('cooldown_until', this.now() + cooldownMs);
    this.setStateString('last_failure_reason', reason);
  }

  private closeCircuit(): void {
    this.setStateNumber('failure_count', 0);
    this.setStateNumber('cooldown_until', 0);
    this.setStateString('last_failure_reason', '');
  }

  private getLastRequestGapMs(): number {
    const lastRequestAt = this.getStateNumber('last_request_at', 0);
    return lastRequestAt > 0 ? Math.max(0, this.now() - lastRequestAt) : -1;
  }

  private getStateNumber(key: string, fallback: number): number {
    const value = this.getStateString(key, '');
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private setStateNumber(key: string, value: number): void {
    this.setStateString(key, String(value));
  }

  private getStateString(key: string, fallback: string): string {
    const row = this.db.prepare('SELECT value FROM arxiv_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? fallback;
  }

  private setStateString(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO arxiv_state(key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  private writeLog(entry: ArxivLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO arxiv_request_log(created_at, source, query, cache_hit, queue_size, last_request_gap_ms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.now(),
        entry.source,
        entry.query,
        entry.cacheHit ? 1 : 0,
        entry.queueSize,
        entry.lastRequestGapMs,
        entry.status
      );
  }
}

export function normalizeArxivPdfDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (!['arxiv.org', 'www.arxiv.org'].includes(url.hostname)) {
    throw new Error('只允许下载 arXiv PDF。');
  }
  url.protocol = 'https:';
  if (url.pathname.startsWith('/abs/')) {
    url.pathname = url.pathname.replace('/abs/', '/pdf/');
  }
  if (!url.pathname.startsWith('/pdf/')) {
    throw new Error('当前链接不是 arXiv PDF 链接。');
  }
  if (!url.pathname.toLowerCase().endsWith('.pdf')) {
    url.pathname = `${url.pathname}.pdf`;
  }
  return url;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
