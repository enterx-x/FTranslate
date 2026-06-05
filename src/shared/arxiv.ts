export type ArxivSortBy = 'relevance' | 'lastUpdatedDate' | 'submittedDate';
export type ArxivSortOrder = 'ascending' | 'descending';

export interface ArxivSearchRequest {
  searchQuery: string;
  category: string;
  start: number;
  maxResults: number;
  sortBy: ArxivSortBy;
  sortOrder: ArxivSortOrder;
}

export interface ArxivPaper {
  id: string;
  stableId: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  publishedAt: string;
  updated: string;
  categories: string[];
  primaryCategory: string;
  abstractUrl: string;
  pdfUrl: string;
}

export interface ArxivSearchServiceResult {
  papers: ArxivPaper[];
  cacheHit: boolean;
  queueSize: number;
  lastRequestGapMs: number;
}

const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query';
const XML_NS_ATOM = 'http://www.w3.org/2005/Atom';
const XML_NS_ARXIV = 'http://arxiv.org/schemas/atom';

export function normalizeArxivWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildArxivApiUrl(request: ArxivSearchRequest): string {
  const cleanQuery = normalizeArxivWhitespace(request.searchQuery);
  const query = request.category
    ? `cat:${request.category} AND all:${cleanQuery}`
    : `all:${cleanQuery}`;
  const url = new URL(ARXIV_ENDPOINT);
  url.searchParams.set('search_query', query);
  url.searchParams.set('start', String(request.start));
  url.searchParams.set('max_results', String(request.maxResults));
  url.searchParams.set('sortBy', request.sortBy);
  url.searchParams.set('sortOrder', request.sortOrder);
  return url.toString();
}

export function buildArxivCacheKey(request: ArxivSearchRequest): string {
  return JSON.stringify({
    search_query: `${request.category || 'all'}:${normalizeArxivWhitespace(request.searchQuery).toLowerCase()}`,
    start: request.start,
    max_results: request.maxResults,
    sortBy: request.sortBy,
    sortOrder: request.sortOrder
  });
}

function getTextContent(parent: Element, tagName: string, namespace = XML_NS_ATOM): string {
  return normalizeArxivWhitespace(parent.getElementsByTagNameNS(namespace, tagName)[0]?.textContent ?? '');
}

type ArxivDomParserConstructor = new () => {
  parseFromString(source: string, mimeType: string): Document;
};

export function parseArxivFeed(xmlText: string, DomParserCtor?: ArxivDomParserConstructor): ArxivPaper[] {
  const ParserCtor =
    DomParserCtor ?? (typeof DOMParser === 'undefined' ? undefined : (DOMParser as ArxivDomParserConstructor));
  if (!ParserCtor) {
    throw new Error('当前运行环境缺少 XML 解析器，无法解析 arXiv API 返回结果。');
  }

  const parser = new ParserCtor();
  const document = parser.parseFromString(xmlText, 'application/xml');
  const parseError = document.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error(`arXiv XML 解析失败：${normalizeArxivWhitespace(parseError.textContent ?? '')}`);
  }

  const entries = Array.from(document.getElementsByTagNameNS(XML_NS_ATOM, 'entry'));
  return entries.map((entry): ArxivPaper => {
    const id = getTextContent(entry, 'id');
    const title = getTextContent(entry, 'title');
    const summary = getTextContent(entry, 'summary');
    const published = getTextContent(entry, 'published');
    const updated = getTextContent(entry, 'updated');
    const authors = Array.from(entry.getElementsByTagNameNS(XML_NS_ATOM, 'author'))
      .map((author) => getTextContent(author, 'name'))
      .filter(Boolean);
    const categories = Array.from(entry.getElementsByTagNameNS(XML_NS_ATOM, 'category'))
      .map((category) => category.getAttribute('term') ?? '')
      .filter(Boolean);
    const primaryCategory =
      entry.getElementsByTagNameNS(XML_NS_ARXIV, 'primary_category')[0]?.getAttribute('term') ??
      categories[0] ??
      '';
    const links = Array.from(entry.getElementsByTagNameNS(XML_NS_ATOM, 'link'));
    const rawPdfUrl =
      links.find((link) => link.getAttribute('title') === 'pdf')?.getAttribute('href') ??
      id.replace('/abs/', '/pdf/');
    const pdfUrl = normalizeParsedArxivPdfUrl(rawPdfUrl);

    const stableId = id.split('/').pop()?.replace(/v\d+$/iu, '') ?? id;

    return {
      id,
      stableId,
      title,
      authors,
      summary,
      published,
      publishedAt: published,
      updated,
      categories,
      primaryCategory,
      abstractUrl: id,
      pdfUrl
    };
  });
}

export function createArxivDomParser(): typeof DOMParser | null {
  return typeof DOMParser === 'undefined' ? null : DOMParser;
}

function normalizeParsedArxivPdfUrl(value: string): string {
  try {
    const url = new URL(value.trim().replace(/^http:\/\//iu, 'https://'));
    if (url.hostname === 'arxiv.org' || url.hostname === 'www.arxiv.org') {
      if (!url.pathname.toLowerCase().endsWith('.pdf')) {
        url.pathname = `${url.pathname}.pdf`;
      }
      return url.toString();
    }
  } catch {
    return value;
  }
  return value;
}
