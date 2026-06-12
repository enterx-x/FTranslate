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
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  cacheHit: boolean;
  queueSize: number;
  lastRequestGapMs: number;
}

export interface ArxivParsedSearchResult {
  papers: ArxivPaper[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
}

const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query';
const XML_NS_ATOM = 'http://www.w3.org/2005/Atom';
const XML_NS_ARXIV = 'http://arxiv.org/schemas/atom';
const XML_NS_OPENSEARCH = 'http://a9.com/-/spec/opensearch/1.1/';

const CHINESE_QUERY_EXPANSIONS: Array<[RegExp, string]> = [
  [/安全强化学习/gu, 'safe reinforcement learning'],
  [/强化学习/gu, 'reinforcement learning'],
  [/路径规划|运动规划/gu, 'path planning motion planning navigation'],
  [/机器人/gu, 'robot robotics'],
  [/具身智能/gu, 'embodied intelligence embodied AI'],
  [/物理信息|物理约束/gu, 'physics-informed physical constraint'],
  [/神经网络/gu, 'neural network'],
  [/世界模型/gu, 'world model'],
  [/控制屏障函数/gu, 'control barrier function CBF'],
  [/模型预测控制/gu, 'model predictive control MPC']
];

export function normalizeArxivWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeArxivSearchQuery(value: string): string {
  const cleanValue = normalizeArxivWhitespace(value);
  const expansions = CHINESE_QUERY_EXPANSIONS.flatMap(([pattern, expansion]) => {
    pattern.lastIndex = 0;
    return pattern.test(cleanValue) ? [expansion] : [];
  });
  const latinRemainder = normalizeArxivWhitespace(
    cleanValue
      .replace(/[\u3400-\u9fff]+/gu, ' ')
      .replace(/[，。；、：？！]/gu, ' ')
  );
  return normalizeArxivWhitespace([latinRemainder, ...expansions].join(' ')) || cleanValue;
}

export function buildArxivApiUrl(request: ArxivSearchRequest): string {
  const cleanQuery = normalizeArxivSearchQuery(request.searchQuery);
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
    search_query: `${request.category || 'all'}:${normalizeArxivSearchQuery(request.searchQuery).toLowerCase()}`,
    start: request.start,
    max_results: request.maxResults,
    sortBy: request.sortBy,
    sortOrder: request.sortOrder
  });
}

function getTextContent(parent: Element, tagName: string, namespace = XML_NS_ATOM): string {
  return normalizeArxivWhitespace(parent.getElementsByTagNameNS(namespace, tagName)[0]?.textContent ?? '');
}

function getNumberContent(parent: Element, tagName: string, namespace = XML_NS_OPENSEARCH): number {
  const parsed = Number(getTextContent(parent, tagName, namespace));
  return Number.isFinite(parsed) ? parsed : 0;
}

type ArxivDomParserConstructor = new () => {
  parseFromString(source: string, mimeType: string): Document;
};

export function parseArxivFeed(xmlText: string, DomParserCtor?: ArxivDomParserConstructor): ArxivPaper[] {
  return parseArxivSearchResult(xmlText, DomParserCtor).papers;
}

export function parseArxivSearchResult(
  xmlText: string,
  DomParserCtor?: ArxivDomParserConstructor
): ArxivParsedSearchResult {
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
  const papers = entries.map((entry): ArxivPaper => {
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
  const feed = document.documentElement;
  const totalResults = getNumberContent(feed, 'totalResults') || papers.length;
  const startIndex = getNumberContent(feed, 'startIndex');
  const itemsPerPage = getNumberContent(feed, 'itemsPerPage') || papers.length;

  return {
    papers,
    totalResults,
    startIndex,
    itemsPerPage
  };
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
