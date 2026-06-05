export const ARXIV_API_ENDPOINT = 'https://export.arxiv.org/api/query';

export type ArxivSortBy = 'relevance' | 'lastUpdatedDate' | 'submittedDate';
export type ArxivSortOrder = 'ascending' | 'descending';

export interface ArxivSearchRequest {
  query: string;
  category?: string;
  start?: number;
  maxResults?: number;
  sortBy?: ArxivSortBy;
  sortOrder?: ArxivSortOrder;
}

export interface ArxivPaper {
  id: string;
  stableId: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  publishedAt?: string;
  updatedAt?: string;
  abstractUrl: string;
  pdfUrl: string;
}

const MAX_ARXIV_RESULTS = 50;
export const ARXIV_RATE_LIMIT_COOLDOWN_MS = 90_000;

export function buildArxivApiUrl(request: ArxivSearchRequest): string {
  const params = new URLSearchParams({
    search_query: buildArxivSearchQuery(request),
    start: String(Math.max(0, request.start ?? 0)),
    max_results: String(clampInteger(request.maxResults ?? 10, 1, MAX_ARXIV_RESULTS)),
    sortBy: request.sortBy ?? 'relevance',
    sortOrder: request.sortOrder ?? 'descending'
  });

  return `${ARXIV_API_ENDPOINT}?${params.toString()}`;
}

export function buildArxivCacheKey(request: ArxivSearchRequest): string {
  return [
    normalizeCacheText(request.query),
    normalizeCacheText(request.category ?? ''),
    Math.max(0, request.start ?? 0),
    clampInteger(request.maxResults ?? 10, 1, MAX_ARXIV_RESULTS),
    request.sortBy ?? 'relevance',
    request.sortOrder ?? 'descending'
  ].join('|');
}

export function isArxivRateLimitStatus(status: number): boolean {
  return status === 429;
}

export function buildArxivRateLimitMessage(retryAt: number, now = Date.now()): string {
  const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
  return `arXiv 官方 API 正在限流，请约 ${seconds} 秒后再试。已有结果会继续保留，避免重复请求触发更长限流。`;
}

export function buildArxivHttpErrorMessage(status: number, statusText = ''): string {
  if (isArxivRateLimitStatus(status)) {
    return 'arXiv 官方 API 正在限流，请稍后再试。';
  }
  const suffix = statusText.trim() ? ` ${statusText.trim()}` : '';
  return `arXiv API 请求失败：HTTP ${status}${suffix}`;
}

export function parseArxivAtomFeed(xml: string): ArxivPaper[] {
  return matchAll(xml, /<entry\b[\s\S]*?<\/entry>/giu)
    .map((entry) => parseArxivEntry(entry))
    .filter((paper): paper is ArxivPaper => Boolean(paper));
}

function buildArxivSearchQuery(request: ArxivSearchRequest): string {
  const parts = [`all:"${normalizeSearchText(request.query)}"`];
  const category = normalizeSearchText(request.category ?? '');
  if (category) {
    parts.push(`cat:${category}`);
  }
  return parts.join(' AND ');
}

function parseArxivEntry(entryXml: string): ArxivPaper | null {
  const abstractUrl = normalizeHttpUrl(readXmlText(entryXml, 'id'));
  const id = readArxivId(abstractUrl);
  if (!id) {
    return null;
  }

  const title = normalizeXmlText(readXmlText(entryXml, 'title'));
  const summary = normalizeXmlText(readXmlText(entryXml, 'summary'));
  const pdfUrl = normalizeArxivPdfUrl(readPdfLink(entryXml), id);

  return {
    id,
    stableId: id.replace(/v\d+$/iu, ''),
    title,
    summary,
    authors: matchAll(entryXml, /<author\b[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/giu).map(normalizeXmlText),
    categories: matchAll(entryXml, /<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?>/giu).map(normalizeXmlText),
    publishedAt: normalizeOptional(readXmlText(entryXml, 'published')),
    updatedAt: normalizeOptional(readXmlText(entryXml, 'updated')),
    abstractUrl: abstractUrl || `https://arxiv.org/abs/${id}`,
    pdfUrl
  };
}

function readXmlText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'iu'));
  return decodeXmlEntities(match?.[1] ?? '');
}

function readPdfLink(entryXml: string): string {
  const links = matchAll(entryXml, /<link\b[^>]*>/giu);
  const pdfLink = links.find((link) => /\btitle=["']pdf["']/iu.test(link) || /\btype=["']application\/pdf["']/iu.test(link));
  return readAttribute(pdfLink ?? '', 'href');
}

function readAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'iu'));
  return decodeXmlEntities(match?.[1] ?? '');
}

function readArxivId(value: string): string {
  const match = value.match(/(?:abs|pdf)\/([^/?#]+)(?:\.pdf)?/iu);
  return (match?.[1] ?? '').trim();
}

function normalizeArxivPdfUrl(rawUrl: string, id: string): string {
  const url = normalizeHttpUrl(rawUrl || `https://arxiv.org/pdf/${id}`);
  const withoutPdfSuffix = url.replace(/\.pdf$/iu, '');
  return `${withoutPdfSuffix}.pdf`;
}

function normalizeHttpUrl(value: string): string {
  return value.trim().replace(/^http:\/\//iu, 'https://');
}

function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function normalizeCacheText(value: string): string {
  return normalizeSearchText(value).toLowerCase();
}

function normalizeXmlText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function normalizeOptional(value: string): string | undefined {
  const normalized = normalizeXmlText(value);
  return normalized || undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

function matchAll(value: string, pattern: RegExp): string[] {
  return Array.from(value.matchAll(pattern), (match) => match[1] ?? match[0]);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
