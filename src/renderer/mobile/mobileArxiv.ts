import { CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  buildArxivApiUrl,
  buildArxivCacheKey,
  parseArxivSearchResult,
  type ArxivSearchRequest,
  type ArxivSearchServiceResult
} from '../../shared/arxiv';

const ARXIV_CACHE_PREFIX = 'pdfTranslationReader:mobileArxivCache:v1:';
const MIN_REQUEST_GAP_MS = 3200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let lastRequestAt = 0;

interface CachedArxivResult {
  cachedAt: number;
  result: ArxivSearchServiceResult;
}

export async function searchMobileArxiv(request: ArxivSearchRequest): Promise<ArxivSearchServiceResult> {
  const cacheKey = `${ARXIV_CACHE_PREFIX}${hashString(buildArxivCacheKey(request))}`;
  const cached = await readCache(cacheKey);
  if (!request.forceRefresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { ...cached.result, cacheHit: true, cacheStale: false };
  }

  const waitMs = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
  if (waitMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, waitMs));
  }

  try {
    lastRequestAt = Date.now();
    const response = await CapacitorHttp.get({
      url: buildArxivApiUrl(request),
      responseType: 'text',
      connectTimeout: 15_000,
      readTimeout: 30_000,
      headers: { Accept: 'application/atom+xml' }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`);
    }
    const xmlText = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    const parsed = parseArxivSearchResult(xmlText);
    const result: ArxivSearchServiceResult = {
      ...parsed,
      cacheHit: false,
      queueSize: 0,
      lastRequestGapMs: waitMs
    };
    await Preferences.set({ key: cacheKey, value: JSON.stringify({ cachedAt: Date.now(), result }) });
    return result;
  } catch (error) {
    if (cached) {
      return {
        ...cached.result,
        cacheHit: true,
        cacheStale: true,
        warning: `实时检索失败，已显示本机缓存：${formatError(error)}`
      };
    }
    throw new Error(`arXiv 检索失败：${formatError(error)}`);
  }
}

async function readCache(key: string): Promise<CachedArxivResult | null> {
  const { value } = await Preferences.get({ key });
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as CachedArxivResult;
    return typeof parsed.cachedAt === 'number' && parsed.result ? parsed : null;
  } catch {
    return null;
  }
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
