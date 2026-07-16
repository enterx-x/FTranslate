import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { DatabaseSync } from 'node:sqlite';
import {
  type ArxivPaper,
  type ArxivParsedSearchResult,
  type ArxivQueryMode,
  type ArxivSearchRequest,
  type ArxivSearchServiceResult,
  buildArxivApiUrl,
  buildArxivCacheKey,
  getUnmappedChineseArxivQuery,
  hasDeterministicChineseArxivQuery,
  isMojibakeTranslationText,
  normalizeArxivWhitespace,
  normalizeArxivSearchQuery,
  parseArxivSearchResult,
  resolveArxivQueryMode
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
  translateSearchQueryToEnglish?: (query: string) => Promise<string>;
}

interface ArxivLogEntry {
  source: string;
  query: string;
  cacheHit: boolean;
  queueSize: number;
  lastRequestGapMs: number;
  status: string;
}

interface ResolvedSearchRequest {
  request: ArxivSearchRequest;
  metadata: ArxivSearchMetadata;
}

interface ArxivSearchMetadata {
  originalSearchQuery?: string;
  effectiveSearchQuery?: string;
  translatedQuery?: string;
  expandedQueryTerms?: string[];
  queryNotice?: string;
  queryMode?: ArxivQueryMode;
  normalizedSearchQuery?: string;
}

const DEFAULT_MIN_REQUEST_GAP_MS = 3200;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FIRST_COOLDOWN_MS = 2 * 60 * 1000;
const DEFAULT_REPEATED_COOLDOWN_MS = 10 * 60 * 1000;
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
  private readonly translateSearchQueryToEnglish?: (query: string) => Promise<string>;
  private readonly translatedQueryCache = new Map<string, ArxivSearchMetadata & { searchQuery: string }>();
  private readonly inFlightSearches = new Map<string, Promise<ArxivSearchServiceResult>>();
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
    this.translateSearchQueryToEnglish = options.translateSearchQueryToEnglish;
    this.initDatabase();
  }

  close(): void {
    this.db.close();
  }

  async search(request: ArxivSearchRequest, source = 'renderer:arxiv-search'): Promise<ArxivSearchServiceResult> {
    const resolved = await this.resolveSearchRequest(request);
    const effectiveRequest = resolved.request;
    const metadata = resolved.metadata;
    const cacheKey = buildArxivCacheKey(effectiveRequest);
    const cached = effectiveRequest.forceRefresh ? null : this.readCacheEntry(cacheKey, false);
    if (cached) {
      const result = applyLocalArxivSort(cached.result, effectiveRequest);
      this.writeLog({
        source,
        query: cacheKey,
        cacheHit: true,
        queueSize: 0,
        lastRequestGapMs: this.getLastRequestGapMs(),
        status: 'cache-hit'
      });
      return {
        ...result,
        cacheHit: true,
        cacheStale: false,
        queueSize: 0,
        lastRequestGapMs: this.getLastRequestGapMs(),
        ...metadata
      };
    }

    const inFlightKey = `search:${cacheKey}`;
    const inFlight = this.inFlightSearches.get(inFlightKey);
    if (inFlight) {
      return inFlight.then((result) => ({ ...result, ...metadata }));
    }

    const cooldown = this.getCooldownStatus();
    if (cooldown.remainingMs > 0) {
      const staleCache = this.readCacheEntry(cacheKey, true);
      if (staleCache) {
        const result = applyLocalArxivSort(staleCache.result, effectiveRequest);
        const warning = `arXiv 正在保护冷却，已显示本地缓存结果；约 ${formatRemainingCooldown(
          cooldown.remainingMs
        )} 后可再次实时刷新。`;
        this.writeLog({
          source,
          query: cacheKey,
          cacheHit: true,
          queueSize: 0,
          lastRequestGapMs: this.getLastRequestGapMs(),
          status: staleCache.stale ? 'stale-cache-cooldown' : 'cache-hit-cooldown'
        });
        return {
          ...result,
          cacheHit: true,
          cacheStale: staleCache.stale,
          queueSize: 0,
          lastRequestGapMs: this.getLastRequestGapMs(),
          cooldownRemainingMs: cooldown.remainingMs,
          warning,
          ...metadata
        };
      }
      const warning = `arXiv 正在保护冷却，约 ${formatRemainingCooldown(
        cooldown.remainingMs
      )} 后可重试；当前查询没有可用缓存，所以先显示空结果，不再继续访问 arXiv。`;
      this.writeLog({
        source,
        query: cacheKey,
        cacheHit: false,
        queueSize: 0,
        lastRequestGapMs: this.getLastRequestGapMs(),
        status: 'cooldown-empty'
      });
      return this.buildEmptySearchResult(effectiveRequest, warning, 0, this.getLastRequestGapMs(), cooldown.remainingMs, metadata);
    }

    const queueSize = this.queuedRequests;
    const searchPromise = this.enqueue(async () => {
      try {
        const url = buildArxivApiUrl(effectiveRequest);
        const { text, lastRequestGapMs } = await this.fetchText(url, source, cacheKey, queueSize);
        const result = applyLocalArxivSort(parseArxivSearchResult(text, XmldomParser as any), effectiveRequest);
        this.writeCache(cacheKey, result);
        return {
          ...result,
          cacheHit: false,
          queueSize,
          lastRequestGapMs,
          ...metadata
        };
      } catch (error) {
        const staleCache = this.readCacheEntry(cacheKey, true);
        const cooldownAfterFailure = this.getCooldownStatus();
        if (staleCache) {
          const result = applyLocalArxivSort(staleCache.result, effectiveRequest);
          const warning = `arXiv 暂时不可用，已回退到本地缓存结果。原因：${formatSearchError(error)}`;
          this.writeLog({
            source,
            query: cacheKey,
            cacheHit: true,
            queueSize,
            lastRequestGapMs: this.getLastRequestGapMs(),
            status: staleCache.stale ? 'stale-cache-failure' : 'cache-hit-failure'
          });
          return {
            ...result,
            cacheHit: true,
            cacheStale: staleCache.stale,
            queueSize,
            lastRequestGapMs: this.getLastRequestGapMs(),
            cooldownRemainingMs:
              cooldownAfterFailure.remainingMs > 0 ? cooldownAfterFailure.remainingMs : undefined,
            warning,
            ...metadata
          };
        }

        const warning = `arXiv 暂时不可用，已返回空结果；稍后可重新搜索。原因：${formatSearchError(error)}`;
        this.writeLog({
          source,
          query: cacheKey,
          cacheHit: false,
          queueSize,
          lastRequestGapMs: this.getLastRequestGapMs(),
          status: 'failure-empty'
        });
        return this.buildEmptySearchResult(
          effectiveRequest,
          warning,
          queueSize,
          this.getLastRequestGapMs(),
          cooldownAfterFailure.remainingMs > 0 ? cooldownAfterFailure.remainingMs : undefined,
          metadata
        );
      }
    });
    this.inFlightSearches.set(inFlightKey, searchPromise);
    try {
      return await searchPromise;
    } finally {
      this.inFlightSearches.delete(inFlightKey);
    }
  }

  private async resolveSearchRequest(request: ArxivSearchRequest): Promise<ResolvedSearchRequest> {
    const searchQuery = request.searchQuery.trim();
    const queryMode = resolveArxivQueryMode(request.queryMode);
    const normalizedSearchQuery = normalizeArxivSearchQuery(searchQuery, queryMode);
    if (!hasCjkText(searchQuery)) {
      return {
        request: { ...request, queryMode },
        metadata: {
          originalSearchQuery: searchQuery,
          effectiveSearchQuery: normalizedSearchQuery,
          normalizedSearchQuery,
          queryMode
        }
      };
    }

    const cacheKey = `${queryMode}:${searchQuery}`;
    const cached = this.translatedQueryCache.get(cacheKey);
    if (cached !== undefined) {
      const { searchQuery: cachedSearchQuery, ...metadata } = cached;
      return { request: { ...request, queryMode, searchQuery: cachedSearchQuery }, metadata };
    }

    const deterministicQuery = normalizedSearchQuery;
    const hasDeterministicQuery = hasDeterministicChineseArxivQuery(searchQuery);
    const unmappedChineseQuery = getUnmappedChineseArxivQuery(searchQuery);
    let translatedQuery = '';
    if (queryMode !== 'strict' && unmappedChineseQuery && this.translateSearchQueryToEnglish) {
      try {
        translatedQuery = sanitizeTranslatedSearchQuery(
          await this.translateSearchQueryToEnglish(unmappedChineseQuery)
        );
      } catch {
        translatedQuery = '';
      }
    }

    const expandedQuery = mergeSearchQuerySegments(
      queryMode === 'strict' || !translatedQuery
        ? [deterministicQuery]
        : [deterministicQuery, translatedQuery]
    );
    const expandedQueryTerms = buildExpandedQueryTerms(deterministicQuery, translatedQuery);
    const metadata: ArxivSearchMetadata & { searchQuery: string } = {
      searchQuery: hasDeterministicQuery ? searchQuery : expandedQuery,
      originalSearchQuery: searchQuery,
      effectiveSearchQuery: expandedQuery,
      translatedQuery: translatedQuery || undefined,
      expandedQueryTerms,
      queryNotice: buildChineseSearchQueryNotice(searchQuery, expandedQueryTerms),
      queryMode,
      normalizedSearchQuery
    };
    this.translatedQueryCache.set(cacheKey, metadata);
    return { request: { ...request, queryMode, searchQuery: expandedQuery }, metadata };
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

  private buildEmptySearchResult(
    request: ArxivSearchRequest,
    warning: string,
    queueSize: number,
    lastRequestGapMs: number,
    cooldownRemainingMs?: number,
    metadata: ArxivSearchMetadata = {}
  ): ArxivSearchServiceResult {
    return {
      papers: [],
      totalResults: 0,
      startIndex: request.start ?? 0,
      itemsPerPage: 0,
      cacheHit: false,
      cacheStale: false,
      queueSize,
      lastRequestGapMs,
      cooldownRemainingMs,
      warning,
      ...metadata
    };
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

  private readCacheEntry(
    cacheKey: string,
    allowStale: boolean
  ): { result: ArxivParsedSearchResult; stale: boolean } | null {
    const row = this.db
      .prepare('SELECT created_at, response_json FROM arxiv_cache WHERE cache_key = ?')
      .get(cacheKey) as { created_at: number; response_json: string } | undefined;
    if (!row) {
      return null;
    }
    const stale = this.now() - row.created_at > this.cacheTtlMs;
    if (stale && !allowStale) {
      return null;
    }
    try {
      const parsed = JSON.parse(row.response_json) as unknown;
      if (Array.isArray(parsed)) {
        return {
          result: {
            papers: parsed,
            totalResults: parsed.length,
            startIndex: 0,
            itemsPerPage: parsed.length
          } as ArxivParsedSearchResult,
          stale
        };
      }
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as ArxivParsedSearchResult).papers)) {
        const result = parsed as ArxivParsedSearchResult;
        return {
          result: {
            papers: result.papers,
            totalResults: result.totalResults || result.papers.length,
            startIndex: result.startIndex || 0,
            itemsPerPage: result.itemsPerPage || result.papers.length
          },
          stale
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
    const cooldown = this.getCooldownStatus();
    if (cooldown.remainingMs <= 0) {
      return null;
    }
    return new Error(`arXiv 请求正在保护冷却中，约 ${formatRemainingCooldown(cooldown.remainingMs)} 后再试。冷却期间不会访问 arXiv。`);
  }

  private getCooldownStatus(): { remainingMs: number } {
    const cooldownUntil = this.getStateNumber('cooldown_until', 0);
    return { remainingMs: Math.max(0, cooldownUntil - this.now()) };
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

function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function sanitizeTranslatedSearchQuery(value: string): string {
  if (isMojibakeTranslationText(value) || hasCjkText(value)) {
    return '';
  }
  const sanitized = normalizeArxivWhitespace(
    value
      .replace(/[“”"']/gu, ' ')
      .replace(/[^a-z0-9.+\-\s]/giu, ' ')
      .replace(/\s+/gu, ' ')
  );
  if (!/[a-z]/iu.test(sanitized)) {
    return '';
  }
  return sanitized.split(/\s+/u).slice(0, 24).join(' ');
}

function mergeSearchQuerySegments(values: string[]): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of values) {
    const normalized = normalizeArxivWhitespace(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalized);
  }
  return normalizeArxivWhitespace(merged.join(' '));
}

function buildExpandedQueryTerms(deterministicQuery: string, translatedQuery: string): string[] {
  const terms: string[] = [];
  const add = (value: string): void => {
    const normalized = normalizeArxivWhitespace(value);
    const key = normalized.toLowerCase();
    if (!normalized || terms.some((term) => term.toLowerCase() === key)) {
      return;
    }
    terms.push(normalized);
  };

  add(translatedQuery);
  const deterministicWords = deterministicQuery
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
  deterministicWords.forEach(add);
  return terms.slice(0, 12);
}

function buildChineseSearchQueryNotice(originalQuery: string, expandedQueryTerms: string[]): string | undefined {
  if (expandedQueryTerms.length === 0) {
    return undefined;
  }
  return `中文查询“${originalQuery}”已按 ${expandedQueryTerms.slice(0, 6).join(' / ')} 检索`;
}

function applyLocalArxivSort(result: ArxivParsedSearchResult, request: ArxivSearchRequest): ArxivParsedSearchResult {
  if (request.sortBy !== 'comprehensive' || result.papers.length <= 1) {
    return result;
  }
  const queryTerms = tokenizeLocalRankingQuery(
    normalizeArxivSearchQuery(request.searchQuery, request.queryMode)
  );
  const requiredTermGroups = buildRequiredLocalTermGroups(request.searchQuery, request.queryMode);
  const scored = result.papers
    .map((paper) => ({ paper, score: scoreComprehensivePaper(paper, queryTerms, request.category) }))
    .filter((entry) => entry.score.textHits > 0 && matchesRequiredTermGroups(entry.paper, requiredTermGroups));
  const sorted =
    scored.length > 0 || requiredTermGroups.length > 0
      ? scored
      : result.papers.map((paper) => ({ paper, score: scoreComprehensivePaper(paper, queryTerms, request.category) }));
  sorted.sort((left, right) => {
    return request.sortOrder === 'ascending' ? left.score.value - right.score.value : right.score.value - left.score.value;
  });
  return {
    ...result,
    papers: sorted.map((entry) => entry.paper),
    totalResults: result.totalResults,
    itemsPerPage: sorted.length
  };
}

function buildRequiredLocalTermGroups(searchQuery: string, queryMode?: ArxivQueryMode): string[][] {
  const normalized = normalizeArxivSearchQuery(searchQuery, queryMode).toLowerCase();
  const normalizedTokens = tokenizeLocalRankingQuery(normalized);
  const groups: string[][] = [];
  const tactileFocusedTokens = new Set([
    'tactile',
    'haptic',
    'haptics',
    'visuotactile',
    'touch',
    'sensing',
    'contact',
    'perception',
    'force',
    'feedback'
  ]);
  const isEnglishTactileOnly =
    normalizedTokens.length > 0 && normalizedTokens.every((token) => tactileFocusedTokens.has(token));
  if (
    /触觉感知|触觉传感|触觉|力觉|接触感知|接触丰富/u.test(searchQuery) ||
    isEnglishTactileOnly
  ) {
    groups.push([
      'tactile',
      'haptic',
      'haptics',
      'visuotactile',
      'touch sensing',
      'contact sensing',
      'tactile sensing',
      'tactile perception'
    ]);
  }
  if (/人形|仿人/u.test(searchQuery) || normalizedTokens.includes('humanoid')) {
    groups.push(['humanoid', 'humanoid robot', 'humanoid robotics']);
  }
  return groups;
}

function matchesRequiredTermGroups(paper: ArxivPaper, groups: string[][]): boolean {
  if (groups.length === 0) {
    return true;
  }
  const text = `${paper.title} ${paper.summary}`.toLowerCase();
  return groups.every((group) => group.some((term) => text.includes(term)));
}

function tokenizeLocalRankingQuery(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9.+-]+/iu)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  );
}

function scoreComprehensivePaper(
  paper: ArxivPaper,
  queryTerms: string[],
  category: string
): { value: number; textHits: number } {
  const title = paper.title.toLowerCase();
  const summary = paper.summary.toLowerCase();
  const categoryBonus = category && paper.categories.includes(category) ? 8 : 0;
  const titleHits = queryTerms.filter((term) => title.includes(term)).length;
  const abstractHits = queryTerms.filter((term) => summary.includes(term)).length;
  const textHits = titleHits + abstractHits;
  if (textHits === 0) {
    return { value: 0, textHits };
  }
  const relevance = titleHits * 12 + abstractHits * 5;
  const recency = scoreRecency(paper.updated || paper.publishedAt || paper.published);
  const experimentalCue = /\b(experiment|benchmark|baseline|result|real-world|dataset|simulation)\b/iu.test(summary) ? 6 : 0;
  const methodCue = /\b(method|model|framework|policy|controller|planner|architecture|algorithm)\b/iu.test(summary)
    ? 5
    : 0;
  return { value: relevance + recency + categoryBonus + experimentalCue + methodCue, textHits };
}

function scoreRecency(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return 0;
  }
  const days = Math.max(0, (Date.now() - time) / 86_400_000);
  return Math.max(0, 18 - Math.min(18, days / 30));
}

function formatRemainingCooldown(remainingMs: number): string {
  if (remainingMs <= 0) {
    return '0 秒';
  }
  if (remainingMs < 60_000) {
    return `${Math.ceil(remainingMs / 1000)} 秒`;
  }
  return `${Math.ceil(remainingMs / 60_000)} 分钟`;
}

function formatSearchError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
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
