import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  buildArxivApiUrl,
  buildArxivCacheKey,
  parseArxivSearchResult,
  type ArxivSearchRequest,
  type ArxivSearchServiceResult
} from '../../shared/arxiv';
import { buildMobileWebArxivSearchUrl } from './mobileWeb';

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
    const apiUrl = buildArxivApiUrl(request);
    const { status, xmlText, source } = Capacitor.isNativePlatform()
      ? await requestNativeArxiv(apiUrl)
      : await requestWebArxiv(apiUrl, request);
    if (status < 200 || status >= 300) {
      throw new Error(formatMobileArxivHttpError(status, xmlText));
    }
    const parsed = parseArxivSearchResult(xmlText);
    const result: ArxivSearchServiceResult = {
      ...parsed,
      cacheHit: false,
      queueSize: 0,
      lastRequestGapMs: waitMs,
      ...(source === 'html-fallback' ? { warning: 'arXiv API 暂时繁忙，当前结果来自 arXiv 官网备用检索。' } : {})
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

async function requestNativeArxiv(url: string): Promise<{ status: number; xmlText: string; source: string }> {
  const response = await CapacitorHttp.get({
    url,
    responseType: 'text',
    connectTimeout: 15_000,
    readTimeout: 30_000,
    headers: { Accept: 'application/atom+xml' }
  });
  return {
    status: response.status,
    xmlText: typeof response.data === 'string' ? response.data : String(response.data ?? ''),
    source: 'api'
  };
}

async function requestWebArxiv(
  url: string,
  request: ArxivSearchRequest
): Promise<{ status: number; xmlText: string; source: string }> {
  const response = await fetch(buildMobileWebArxivSearchUrl(url, window.location.href, {
    query: request.searchQuery,
    category: request.category
  }), {
    headers: { Accept: 'application/atom+xml' }
  });
  return {
    status: response.status,
    xmlText: await response.text(),
    source: response.headers.get('x-ftranslate-arxiv-source') ?? 'api'
  };
}

export function formatMobileArxivHttpError(status: number, responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Non-JSON upstream responses fall through to a concise status message.
  }
  if ([429, 502, 503, 504].includes(status)) {
    return `arXiv 暂时繁忙（HTTP ${status}），请稍后点击刷新。`;
  }
  return `arXiv 检索失败：HTTP ${status}`;
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
