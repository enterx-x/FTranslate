export type ArxivSortBy = 'comprehensive' | 'relevance' | 'lastUpdatedDate' | 'submittedDate';
export type ArxivSortOrder = 'ascending' | 'descending';

export interface ArxivSearchRequest {
  searchQuery: string;
  category: string;
  start: number;
  maxResults: number;
  sortBy: ArxivSortBy;
  sortOrder: ArxivSortOrder;
  yearFrom?: string;
  yearTo?: string;
  forceRefresh?: boolean;
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
  cacheStale?: boolean;
  queueSize: number;
  lastRequestGapMs: number;
  cooldownRemainingMs?: number;
  warning?: string;
}

export interface ArxivTitleAbstractTranslationRequest {
  stableId: string;
  title: string;
  summary: string;
  targetLanguage?: 'zh';
}

export type ArxivTitleAbstractTranslationEngine = 'nllb-ct2-int8' | 'argos' | 'cache' | 'unavailable';
export type ArxivTitleAbstractTranslationStatus = 'completed' | 'cached' | 'unavailable' | 'failed';

export interface ArxivTitleAbstractTranslationResult {
  stableId: string;
  titleZh: string;
  abstractZh: string;
  engine: ArxivTitleAbstractTranslationEngine;
  status: ArxivTitleAbstractTranslationStatus;
  cacheHit: boolean;
  message: string;
  translatedAt?: string;
}

export interface ArxivParsedSearchResult {
  papers: ArxivPaper[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
}

const MOJIBAKE_TOKEN_PATTERN =
  /锟斤拷|����|(?:鏈哄櫒)|(?:鐢ㄤ簬)|(?:鐨)|(?:鍦)|(?:浜哄)|(?:涓)|(?:瑙﹁)|(?:瀛︿範)|(?:缈昏瘧)|(?:鎽樿)|(?:瀵艰埅)|(?:璺緞)|(?:æœº)|(?:å™¨)|(?:çš„)|(?:ç”¨)|(?:äºŽ)/u;

export function isMojibakeTranslationText(value?: string): boolean {
  const text = value ?? '';
  if (!text.trim()) {
    return false;
  }
  if (text.includes('\uFFFD') || /[\uE000-\uF8FF]/u.test(text)) {
    return true;
  }
  if (MOJIBAKE_TOKEN_PATTERN.test(text)) {
    return true;
  }
  if (hasLowInformationRepeatedChinese(text)) {
    return true;
  }
  const latinMojibakeHits = text.match(/[ÃÂÐÑæåäçèé]/gu)?.length ?? 0;
  const cjkHits = text.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  return latinMojibakeHits >= 2 && cjkHits >= 1;
}

function hasLowInformationRepeatedChinese(value: string): boolean {
  const compact = value.replace(/\s+/gu, '');
  if (compact.length < 6) {
    return false;
  }
  const cjkChars = compact.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  if (cjkChars / compact.length < 0.7) {
    return false;
  }
  if (/^([\u3400-\u9fff]{1,4})\1{2,}$/u.test(compact)) {
    return true;
  }
  if (/([\u3400-\u9fff]{1,3})\1{3,}/u.test(compact)) {
    return true;
  }
  const pairs = new Map<string, number>();
  for (let index = 0; index < compact.length - 1; index += 2) {
    const pair = compact.slice(index, index + 2);
    if (/^[\u3400-\u9fff]{2}$/u.test(pair)) {
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
  }
  const maxPairCount = Math.max(0, ...pairs.values());
  return maxPairCount >= 4 && maxPairCount * 2 >= compact.length * 0.55;
}

const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query';
const XML_NS_ATOM = 'http://www.w3.org/2005/Atom';
const XML_NS_ARXIV = 'http://arxiv.org/schemas/atom';
const XML_NS_OPENSEARCH = 'http://a9.com/-/spec/opensearch/1.1/';

const CHINESE_QUERY_EXPANSIONS: Array<[RegExp, string]> = [
  [/安全强化学习/gu, 'safe reinforcement learning'],
  [/深度强化学习/gu, 'deep reinforcement learning'],
  [/强化学习/gu, 'reinforcement learning'],
  [/机器人导航|导航机器人/gu, 'robot navigation robotic navigation mobile robot navigation'],
  [/机器人|机械臂/gu, 'robot robotics manipulator'],
  [/触觉感知|触觉传感|触觉|力觉|接触感知|接触丰富/gu, 'haptic tactile haptics tactile sensing tactile perception force feedback contact-rich manipulation visuotactile'],
  [/无人机|飞行器/gu, 'uav drone aerial robot'],
  [/避障|障碍物规避|动态障碍/gu, 'obstacle avoidance collision avoidance dynamic obstacle'],
  [/路径规划|运动规划|轨迹规划/gu, 'path planning motion planning trajectory planning navigation'],
  [/具身智能|具身/gu, 'embodied intelligence embodied AI'],
  [/物理信息|物理约束|物理先验/gu, 'physics-informed physical constraint physics prior'],
  [/神经网络/gu, 'neural network'],
  [/世界模型/gu, 'world model'],
  [/视觉语言动作|视觉语言|多模态/gu, 'vision language action VLA vision language model VLM multimodal'],
  [/控制屏障函数|安全屏障|屏障函数/gu, 'control barrier function CBF safety constraint'],
  [/模型预测控制/gu, 'model predictive control MPC'],
  [/物理信息神经网络|PINN/giu, 'physics-informed neural network PINN'],
  [/移动操作|运动操作|locomanipulation|loco-manipulation/giu, 'loco-manipulation mobile manipulation']
];

const KNOWN_ARXIV_QUERY_PHRASES = [
  'reinforcement learning',
  'safe reinforcement learning',
  'robot navigation',
  'robotic navigation',
  'mobile robot',
  'tactile sensing',
  'tactile perception',
  'visuotactile',
  'force feedback',
  'contact-rich manipulation',
  'path planning',
  'motion planning',
  'trajectory planning',
  'model predictive control',
  'control barrier function',
  'physics-informed',
  'world model',
  'vision language action',
  'foundation model'
];

const ARXIV_QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with'
]);

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
  const query = buildArxivSearchExpression(cleanQuery, request);
  const url = new URL(ARXIV_ENDPOINT);
  url.searchParams.set('search_query', query);
  url.searchParams.set('start', String(request.start));
  url.searchParams.set('max_results', String(request.maxResults));
  url.searchParams.set('sortBy', toArxivApiSortBy(request.sortBy));
  url.searchParams.set('sortOrder', request.sortOrder);
  return url.toString();
}

export function buildArxivCacheKey(request: ArxivSearchRequest): string {
  return JSON.stringify({
    query_version: 'title-abstract-v3',
    search_query: `${request.category || 'all'}:${normalizeArxivSearchQuery(request.searchQuery).toLowerCase()}`,
    yearFrom: normalizeArxivYear(request.yearFrom),
    yearTo: normalizeArxivYear(request.yearTo),
    start: request.start,
    max_results: request.maxResults,
    sortBy: request.sortBy,
    sortOrder: request.sortOrder
  });
}

export function toArxivApiSortBy(sortBy: ArxivSortBy): Exclude<ArxivSortBy, 'comprehensive'> {
  return sortBy === 'comprehensive' ? 'submittedDate' : sortBy;
}

export function buildArxivSearchExpression(
  cleanQuery: string,
  request: Pick<ArxivSearchRequest, 'category' | 'yearFrom' | 'yearTo'>
): string {
  const queryParts = [buildTitleAbstractExpression(cleanQuery)];
  const dateRange = buildSubmittedDateRange(request.yearFrom, request.yearTo);
  if (dateRange) {
    queryParts.push(dateRange);
  }
  const scopedQuery = queryParts.join(' AND ');
  return request.category ? `cat:${request.category} AND ${scopedQuery}` : scopedQuery;
}

function buildTitleAbstractExpression(cleanQuery: string): string {
  const normalized = normalizeArxivWhitespace(cleanQuery.toLowerCase());
  const groups = buildSemanticTitleAbstractGroups(normalized);
  if (groups.length === 0) {
    return `all:${escapeArxivTerm(cleanQuery, cleanQuery.includes(' '))}`;
  }
  return `(${groups.map((group) => `(${group})`).join(' OR ')})`;
}

function buildFieldPairClause(value: string, phrase: boolean): string {
  const term = escapeArxivTerm(value, phrase);
  return `(ti:${term} OR abs:${term})`;
}

function buildSemanticTitleAbstractGroups(normalized: string): string[] {
  const groups: string[] = [];
  const consumedTokens = new Set<string>();

  const addGroup = (clause: string, consumedTerms: string[]): void => {
    if (groups.includes(clause)) {
      return;
    }
    groups.push(clause);
    consumedTerms.forEach((term) => {
      tokenizeArxivQuery(term).forEach((token) => consumedTokens.add(token));
    });
  };

  if (containsAny(normalized, ['tactile', 'haptic', 'haptics', 'visuotactile', 'force feedback', 'contact-rich'])) {
    addGroup(
      orClauses([
        buildFieldPairClause('tactile', false),
        buildFieldPairClause('haptic', false),
        buildFieldPairClause('haptics', false),
        buildFieldPairClause('visuotactile', false),
        buildFieldPairClause('tactile sensing', true),
        buildFieldPairClause('tactile perception', true),
        buildFieldPairClause('force feedback', true),
        buildFieldPairClause('contact-rich manipulation', true)
      ]),
      ['tactile', 'haptic', 'haptics', 'visuotactile', 'force feedback', 'contact-rich manipulation']
    );
  }

  if (containsAny(normalized, ['reinforcement learning', 'reinforcement-learning', 'rl'])) {
    addGroup(
      orClauses([
        buildFieldPairClause('reinforcement learning', true),
        andClauses([buildFieldPairClause('reinforcement', false), buildFieldPairClause('learning', false)]),
        buildFieldPairClause('rl', false)
      ]),
      ['reinforcement learning', 'reinforcement-learning', 'rl']
    );
  }

  if (containsAny(normalized, ['robot navigation', 'robotic navigation', 'mobile robot navigation'])) {
    addGroup(
      orClauses([
        buildFieldPairClause('robot navigation', true),
        buildFieldPairClause('robotic navigation', true),
        buildFieldPairClause('mobile robot navigation', true),
        andClauses([
          orClauses([
            buildFieldPairClause('robot', false),
            buildFieldPairClause('robotic', false),
            buildFieldPairClause('robots', false),
            buildFieldPairClause('mobile robot', true)
          ]),
          buildFieldPairClause('navigation', false)
        ])
      ]),
      ['robot navigation', 'robotic navigation', 'mobile robot navigation', 'robot', 'robotic', 'robots', 'navigation']
    );
  }

  if (containsAny(normalized, ['path planning', 'motion planning', 'trajectory planning'])) {
    addGroup(
      orClauses([
        buildFieldPairClause('path planning', true),
        buildFieldPairClause('motion planning', true),
        buildFieldPairClause('trajectory planning', true),
        andClauses([
          orClauses([
            buildFieldPairClause('path', false),
            buildFieldPairClause('motion', false),
            buildFieldPairClause('trajectory', false)
          ]),
          buildFieldPairClause('planning', false)
        ])
      ]),
      ['path planning', 'motion planning', 'trajectory planning', 'path', 'motion', 'trajectory', 'planning']
    );
  }

  if (
    !containsAny(normalized, ['robot navigation', 'robotic navigation', 'mobile robot navigation']) &&
    containsAny(normalized, ['robot', 'robotic', 'robots', 'robotics', 'manipulator', 'humanoid'])
  ) {
    addGroup(
      orClauses([
        buildFieldPairClause('robot', false),
        buildFieldPairClause('robotic', false),
        buildFieldPairClause('robots', false),
        buildFieldPairClause('robotics', false),
        buildFieldPairClause('manipulator', false),
        buildFieldPairClause('manipulation', false),
        buildFieldPairClause('humanoid', false)
      ]),
      ['robot', 'robotic', 'robots', 'robotics', 'manipulator', 'manipulation', 'humanoid']
    );
  }

  KNOWN_ARXIV_QUERY_PHRASES.forEach((phrase) => {
    if (normalized.includes(phrase) && !phrase.split(/\s+/u).every((token) => consumedTokens.has(token))) {
      addGroup(
        orClauses([
          buildFieldPairClause(phrase, true),
          andClauses(phrase.split(/\s+/u).map((token) => buildFieldPairClause(token, false)))
        ]),
        [phrase]
      );
    }
  });

  tokenizeArxivQuery(normalized)
    .filter((token) => !consumedTokens.has(token))
    .forEach((token) => {
      addGroup(buildFieldPairClause(token, false), [token]);
    });

  return groups;
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function orClauses(clauses: string[]): string {
  return Array.from(new Set(clauses)).join(' OR ');
}

function andClauses(clauses: string[]): string {
  return `(${Array.from(new Set(clauses)).join(' AND ')})`;
}

function tokenizeArxivQuery(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[^a-z0-9.+-]+/iu)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2 && !ARXIV_QUERY_STOP_WORDS.has(term))
    )
  ).slice(0, 12);
}

function escapeArxivTerm(value: string, phrase: boolean): string {
  const safeValue = value.replace(/["\\]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return phrase || safeValue.includes(' ') ? `"${safeValue}"` : safeValue;
}

function buildSubmittedDateRange(yearFrom?: string, yearTo?: string): string {
  const from = normalizeArxivYear(yearFrom);
  const to = normalizeArxivYear(yearTo);
  if (!from && !to) {
    return '';
  }
  const startYear = from || '1991';
  const endYear = to || String(new Date().getFullYear());
  return `submittedDate:[${startYear}01010000 TO ${endYear}12312359]`;
}

function normalizeArxivYear(value?: string): string {
  const match = value?.match(/\b(19|20)\d{2}\b/u);
  return match?.[0] ?? '';
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
