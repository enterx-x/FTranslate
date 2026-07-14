export type ArxivProxyQuery = Record<string, string | string[] | undefined>;

const SORT_BY_VALUES = new Set(['relevance', 'lastUpdatedDate', 'submittedDate']);
const SORT_ORDER_VALUES = new Set(['ascending', 'descending']);

export function buildArxivProxyUpstreamUrl(query: ArxivProxyQuery): string {
  const searchQuery = readSingleValue(query.search_query).trim();
  if (!searchQuery || searchQuery.length > 800) {
    throw new Error('search_query 必须为 1 到 800 个字符。');
  }

  const start = readBoundedInteger(query.start, 0, 2_000, 0, 'start');
  const maxResults = readBoundedInteger(query.max_results, 1, 50, 20, 'max_results');
  const sortBy = readEnum(query.sortBy, SORT_BY_VALUES, 'submittedDate', 'sortBy');
  const sortOrder = readEnum(query.sortOrder, SORT_ORDER_VALUES, 'descending', 'sortOrder');

  const upstream = new URL('https://export.arxiv.org/api/query');
  upstream.searchParams.set('search_query', searchQuery);
  upstream.searchParams.set('start', String(start));
  upstream.searchParams.set('max_results', String(maxResults));
  upstream.searchParams.set('sortBy', sortBy);
  upstream.searchParams.set('sortOrder', sortOrder);
  return upstream.toString();
}

function readSingleValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function readBoundedInteger(
  value: string | string[] | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
  label: string
): number {
  const raw = readSingleValue(value).trim();
  if (!raw) {
    return fallback;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${label} 必须为整数。`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} 必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return parsed;
}

function readEnum(
  value: string | string[] | undefined,
  allowed: Set<string>,
  fallback: string,
  label: string
): string {
  const raw = readSingleValue(value).trim() || fallback;
  if (!allowed.has(raw)) {
    throw new Error(`${label} 参数无效。`);
  }
  return raw;
}
