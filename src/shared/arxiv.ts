export type ArxivSortBy = 'comprehensive' | 'relevance' | 'lastUpdatedDate' | 'submittedDate';
export type ArxivSortOrder = 'ascending' | 'descending';
export type ArxivQueryMode = 'strict' | 'balanced' | 'explore';

export interface ArxivSearchRequest {
  searchQuery: string;
  queryMode?: ArxivQueryMode;
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
  originalSearchQuery?: string;
  effectiveSearchQuery?: string;
  translatedQuery?: string;
  expandedQueryTerms?: string[];
  queryNotice?: string;
  queryMode?: ArxivQueryMode;
  normalizedSearchQuery?: string;
}

export interface ArxivTitleAbstractTranslationRequest {
  stableId: string;
  title: string;
  summary: string;
  pretranslatedTitleZh?: string;
  targetLanguage?: 'zh';
}

export type ArxivTranslationPriority = 'foreground' | 'preview' | 'background';

export interface ArxivTranslationBatchRequest {
  papers: ArxivTitleAbstractTranslationRequest[];
  priority?: ArxivTranslationPriority;
  sessionId?: number;
}

export type ArxivTitleAbstractTranslationEngine = 'nllb-ct2-int8' | 'argos' | 'cache' | 'unavailable';
export type ArxivTitleAbstractTranslationStatus = 'completed' | 'cached' | 'unavailable' | 'failed';
export type ArxivTranslationQualityStatus = 'passed' | 'failed' | 'not-checked';

export interface ArxivTitleAbstractTranslationResult {
  stableId: string;
  titleZh: string;
  abstractZh: string;
  engine: ArxivTitleAbstractTranslationEngine;
  status: ArxivTitleAbstractTranslationStatus;
  cacheHit: boolean;
  qualityStatus: ArxivTranslationQualityStatus;
  elapsedMs: number;
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
  if (maxPairCount >= 4 && maxPairCount * 2 >= compact.length * 0.55) {
    return true;
  }
  const suspiciousRepeatedTerms = ['互出', '分析'];
  return suspiciousRepeatedTerms.some((term) => {
    const count = compact.split(term).length - 1;
    return count >= 2 && count * term.length >= compact.length * 0.35;
  });
}

const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query';
const XML_NS_ATOM = 'http://www.w3.org/2005/Atom';
const XML_NS_ARXIV = 'http://arxiv.org/schemas/atom';
const XML_NS_OPENSEARCH = 'http://a9.com/-/spec/opensearch/1.1/';

const CHINESE_QUERY_EXPANSIONS: Array<[RegExp, string]> = [
  [/安全强化学习/gu, 'safe reinforcement learning'],
  [/深度强化学习/gu, 'deep reinforcement learning'],
  [/强化学习/gu, 'reinforcement learning'],
  [/深度学习/gu, 'deep learning'],
  [/机器学习/gu, 'machine learning'],
  [/人工智能/gu, 'artificial intelligence AI'],
  [/自监督学习/gu, 'self-supervised learning'],
  [/无监督学习/gu, 'unsupervised learning'],
  [/监督学习/gu, 'supervised learning'],
  [/迁移学习/gu, 'transfer learning'],
  [/元学习/gu, 'meta learning'],
  [/图神经网络|图网络/gu, 'graph neural network GNN'],
  [/扩散模型|扩散生成/gu, 'diffusion model generative model'],
  [/生成模型/gu, 'generative model'],
  [/视觉语言动作(?:模型)?/gu, 'vision language action VLA'],
  [/视觉语言(?:模型)?/gu, 'vision language model VLM'],
  [/大语言模型|语言模型/gu, 'large language model LLM'],
  [/基础模型|基座模型/gu, 'foundation model'],
  [/机器人操作|操作任务/gu, 'robot manipulation manipulation'],
  [/机器人导航|导航机器人/gu, 'robot navigation robotic navigation mobile robot navigation'],
  [/软体机器人/gu, 'soft robot soft robotics'],
  [/人形机器人|仿人机器人/gu, 'humanoid robot humanoid robotics'],
  [/人形(?!机器人)/gu, 'humanoid robot humanoid robotics'],
  [/移动机器人/gu, 'mobile robot mobile robotics'],
  [/足式机器人|腿式机器人/gu, 'legged robot legged locomotion'],
  [/轮式机器人/gu, 'wheeled robot mobile robot'],
  [/机器人|机械臂/gu, 'robot robotics manipulator'],
  [/机器(?!人|学习)|机械(?!臂)/gu, 'machine robot robotics mechanical'],
  [/柔顺操作|柔顺操控/gu, 'compliant manipulation compliant control'],
  [/操纵|操控/gu, 'robot manipulation manipulation'],
  [/多指抓取|灵巧抓取|抓取/gu, 'dexterous grasping robotic grasping'],
  [/灵巧手/gu, 'dexterous hand robotic hand'],
  [/可变形物体|柔性物体/gu, 'deformable object manipulation'],
  [/触觉感知|触觉传感|触觉|力觉|接触感知|接触丰富/gu, 'haptic tactile haptics tactile sensing tactile perception force feedback touch sensing contact sensing visuotactile'],
  [/多模态/gu, 'multimodal'],
  [/视觉感知|计算机视觉|视觉/gu, 'computer vision visual perception vision'],
  [/点云|三维点云/gu, 'point cloud 3D point cloud'],
  [/姿态估计|位姿估计/gu, 'pose estimation state estimation'],
  [/状态估计/gu, 'state estimation'],
  [/无人机|飞行器/gu, 'uav drone aerial robot'],
  [/避障|障碍物规避|动态障碍/gu, 'obstacle avoidance collision avoidance dynamic obstacle'],
  [/路径规划|运动规划|轨迹规划/gu, 'path planning motion planning trajectory planning navigation'],
  [/轨迹优化/gu, 'trajectory optimization'],
  [/最优控制/gu, 'optimal control'],
  [/控制屏障函数|安全屏障|屏障函数/gu, 'control barrier function CBF safety constraint'],
  [/模型预测控制/gu, 'model predictive control MPC'],
  [/控制系统|控制器|控制/gu, 'control system controller control'],
  [/具身智能|具身/gu, 'embodied intelligence embodied AI'],
  [/物理信息神经网络|\bPINNs?\b/giu, 'physics-informed neural network PINN'],
  [/物理信息|物理约束|物理先验/gu, 'physics-informed physical constraint physics prior'],
  [/神经网络/gu, 'neural network'],
  [/世界模型/gu, 'world model'],
  [/移动操作|运动操作|locomanipulation|loco-manipulation/giu, 'loco-manipulation mobile manipulation'],
  [/优化算法|优化/gu, 'optimization algorithm optimization'],
  [/材料科学|材料/gu, 'materials science materials'],
  [/量子计算|量子/gu, 'quantum computing quantum'],
  [/生物信息|生物医学/gu, 'bioinformatics biomedical'],
  [/医学影像|医疗影像/gu, 'medical imaging biomedical imaging'],
  [/自然语言处理/gu, 'natural language processing NLP'],
  [/信息检索|检索系统/gu, 'information retrieval search engine'],
  [/数据挖掘/gu, 'data mining'],
  [/数据库/gu, 'database data management'],
  [/网络安全|信息安全/gu, 'cybersecurity information security'],
  [/密码学|加密/gu, 'cryptography encryption'],
  [/形式化验证|程序验证/gu, 'formal verification program verification'],
  [/编译器|程序语言/gu, 'compiler programming language'],
  [/操作系统|分布式系统|系统/gu, 'computer systems distributed systems operating systems'],
  [/计算机图形学|图形学/gu, 'computer graphics rendering'],
  [/图像处理/gu, 'image processing'],
  [/信号处理/gu, 'signal processing'],
  [/统计学习|统计/gu, 'statistical learning statistics'],
  [/概率模型|概率/gu, 'probabilistic model probability'],
  [/运筹优化|运筹学/gu, 'operations research optimization'],
  [/博弈论/gu, 'game theory'],
  [/金融|经济学/gu, 'finance economics'],
  [/天体物理|天文/gu, 'astrophysics astronomy'],
  [/计算物理/gu, 'computational physics'],
  [/推荐系统/gu, 'recommender system recommendation'],
  [/联邦学习/gu, 'federated learning'],
  [/因果推断|因果学习/gu, 'causal inference causal learning']
];

const EXPLORE_QUERY_SYNONYMS: Array<[string[], string]> = [
  [['robot navigation', 'robotic navigation', 'mobile robot navigation'], 'autonomous navigation mobile robotics'],
  [['reinforcement learning'], 'policy learning sequential decision making'],
  [['path planning', 'motion planning', 'trajectory planning'], 'route planning trajectory generation'],
  [['tactile', 'haptic', 'visuotactile'], 'touch somatosensory'],
  [['control barrier function', 'cbf'], 'safety filter safe control'],
  [['model predictive control', 'mpc'], 'receding horizon control']
];

const ARXIV_QUERY_ACRONYM_TOKENS = new Set([
  'ai',
  'cbf',
  'gnn',
  'llm',
  'mpc',
  'nlp',
  'pinn',
  'rl',
  'uav',
  'vla',
  'vlm'
]);

const KNOWN_ARXIV_QUERY_PHRASES = [
  'reinforcement learning',
  'safe reinforcement learning',
  'deep learning',
  'machine learning',
  'artificial intelligence',
  'self-supervised learning',
  'unsupervised learning',
  'supervised learning',
  'transfer learning',
  'meta learning',
  'graph neural network',
  'diffusion model',
  'generative model',
  'large language model',
  'robot navigation',
  'robotic navigation',
  'autonomous navigation',
  'mobile robotics',
  'mobile robot',
  'soft robot',
  'soft robotics',
  'humanoid robot',
  'legged robot',
  'wheeled robot',
  'compliant manipulation',
  'compliant control',
  'dexterous grasping',
  'robotic grasping',
  'dexterous hand',
  'robotic hand',
  'deformable object manipulation',
  'tactile sensing',
  'tactile perception',
  'visuotactile',
  'force feedback',
  'touch sensing',
  'contact sensing',
  'computer vision',
  'visual perception',
  'point cloud',
  '3d point cloud',
  'pose estimation',
  'state estimation',
  'path planning',
  'motion planning',
  'trajectory planning',
  'trajectory optimization',
  'obstacle avoidance',
  'collision avoidance',
  'optimal control',
  'control system',
  'model predictive control',
  'control barrier function',
  'physics-informed',
  'world model',
  'embodied ai',
  'embodied intelligence',
  'embodied agent',
  'vision language action',
  'mobile manipulation',
  'loco-manipulation',
  'foundation model',
  'materials science',
  'quantum computing',
  'medical imaging',
  'natural language processing',
  'information retrieval',
  'search engine',
  'data mining',
  'database',
  'data management',
  'cybersecurity',
  'information security',
  'cryptography',
  'formal verification',
  'program verification',
  'compiler',
  'programming language',
  'computer systems',
  'distributed systems',
  'operating systems',
  'computer graphics',
  'image processing',
  'signal processing',
  'statistical learning',
  'statistics',
  'probabilistic model',
  'operations research',
  'game theory',
  'finance',
  'economics',
  'astrophysics',
  'astronomy',
  'computational physics',
  'recommender system',
  'federated learning',
  'causal inference',
  'causal learning'
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

export function resolveArxivQueryMode(value?: ArxivQueryMode): ArxivQueryMode {
  return value === 'strict' || value === 'explore' ? value : 'balanced';
}

export function normalizeArxivSearchQuery(
  value: string,
  mode: ArxivQueryMode = 'balanced'
): string {
  const cleanValue = normalizeArxivWhitespace(value);
  const queryMode = resolveArxivQueryMode(mode);
  const matched = collectChineseQueryExpansions(cleanValue, queryMode);
  const expansions = matched.expansions;
  const modeExpansions = queryMode === 'strict' ? removeContainedQueryExpansions(expansions) : expansions;
  const latinRemainder = normalizeArxivWhitespace(
    matched.remaining
      .replace(/[\u3400-\u9fff]+/gu, ' ')
      .replace(/[，。；、：？！]/gu, ' ')
  );
  const balanced = normalizeArxivWhitespace([latinRemainder, ...modeExpansions].join(' ')) || cleanValue;
  if (queryMode !== 'explore') {
    return balanced;
  }
  const normalized = balanced.toLowerCase();
  const exploreExpansions = EXPLORE_QUERY_SYNONYMS.flatMap(([needles, expansion]) =>
    containsAny(normalized, needles) ? [expansion] : []
  );
  return normalizeArxivWhitespace([balanced, ...exploreExpansions].join(' '));
}

export function hasDeterministicChineseArxivQuery(value: string): boolean {
  return collectChineseQueryExpansions(normalizeArxivWhitespace(value), 'balanced').expansions.length > 0;
}

export function hasUnmappedChineseArxivQuery(value: string): boolean {
  return Boolean(getUnmappedChineseArxivQuery(value));
}

export function getUnmappedChineseArxivQuery(value: string): string {
  const { remaining } = collectChineseQueryExpansions(normalizeArxivWhitespace(value), 'balanced');
  return normalizeArxivWhitespace(remaining.match(/[\u3400-\u9fff]+/gu)?.join(' ') ?? '');
}

function collectChineseQueryExpansions(
  value: string,
  mode: ArxivQueryMode
): { expansions: string[]; remaining: string } {
  let remaining = value;
  const expansions: string[] = [];
  CHINESE_QUERY_EXPANSIONS.forEach(([pattern, expansion]) => {
    pattern.lastIndex = 0;
    if (!pattern.test(remaining)) {
      return;
    }
    expansions.push(mode === 'strict' ? toStrictQueryExpansion(expansion) : expansion);
    pattern.lastIndex = 0;
    remaining = remaining.replace(pattern, ' ');
  });
  return { expansions, remaining: normalizeArxivWhitespace(remaining) };
}

export function buildArxivApiUrl(request: ArxivSearchRequest): string {
  const queryMode = resolveArxivQueryMode(request.queryMode);
  const cleanQuery = normalizeArxivSearchQuery(request.searchQuery, queryMode);
  const query = buildArxivSearchExpression(cleanQuery, request, request.searchQuery);
  const url = new URL(ARXIV_ENDPOINT);
  url.searchParams.set('search_query', query);
  url.searchParams.set('start', String(request.start));
  url.searchParams.set('max_results', String(request.maxResults));
  url.searchParams.set('sortBy', toArxivApiSortBy(request.sortBy));
  url.searchParams.set('sortOrder', request.sortOrder);
  return url.toString();
}

export function buildArxivCacheKey(request: ArxivSearchRequest): string {
  const queryMode = resolveArxivQueryMode(request.queryMode);
  const yearRange = normalizeArxivYearRange(request.yearFrom, request.yearTo);
  return JSON.stringify({
    query_version: 'title-abstract-v7',
    query_mode: queryMode,
    search_query: `${request.category || 'all'}:${normalizeArxivSearchQuery(request.searchQuery, queryMode).toLowerCase()}`,
    yearFrom: yearRange.from,
    yearTo: yearRange.to,
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
  request: Pick<ArxivSearchRequest, 'category' | 'yearFrom' | 'yearTo' | 'queryMode'>,
  originalQuery = cleanQuery
): string {
  const queryParts = [
    buildTitleAbstractExpression(cleanQuery, resolveArxivQueryMode(request.queryMode), originalQuery)
  ];
  const dateRange = buildSubmittedDateRange(request.yearFrom, request.yearTo);
  if (dateRange) {
    queryParts.push(dateRange);
  }
  const scopedQuery = queryParts.join(' AND ');
  return request.category ? `cat:${request.category} AND ${scopedQuery}` : scopedQuery;
}

function buildTitleAbstractExpression(
  cleanQuery: string,
  queryMode: ArxivQueryMode,
  originalQuery: string
): string {
  if (queryMode === 'strict') {
    return buildFieldPairClause(cleanQuery, cleanQuery.includes(' '));
  }
  const chineseConcepts = collectChineseQueryExpansions(originalQuery, 'balanced').expansions;
  if (chineseConcepts.length > 0) {
    const conceptClauses = chineseConcepts.map((concept) => {
      const expandedConcept = normalizeArxivSearchQuery(concept, queryMode).toLowerCase();
      const conceptGroups = buildSemanticTitleAbstractGroups(expandedConcept, queryMode === 'balanced');
      if (conceptGroups.length === 0) {
        return buildFieldPairClause(expandedConcept, expandedConcept.includes(' '));
      }
      return wrapBooleanGroup(conceptGroups);
    });
    const latinRemainder = normalizeArxivWhitespace(
      originalQuery.replace(/[\u3400-\u9fff]+/gu, ' ').replace(/[，。；、：？！]/gu, ' ')
    );
    if (latinRemainder) {
      buildSemanticTitleAbstractGroups(latinRemainder.toLowerCase(), queryMode === 'balanced').forEach((group) => {
        conceptClauses.push(wrapBooleanGroup([group]));
      });
    }
    const operator = queryMode === 'explore' ? ' OR ' : ' AND ';
    return combineBooleanConcepts(conceptClauses, operator);
  }
  const normalized = normalizeArxivWhitespace(cleanQuery.toLowerCase());
  const groups = buildSemanticTitleAbstractGroups(normalized, queryMode === 'balanced');
  if (groups.length === 0) {
    return `all:${escapeArxivTerm(cleanQuery, cleanQuery.includes(' '))}`;
  }
  const operator = queryMode === 'explore' ? ' OR ' : ' AND ';
  return combineBooleanConcepts(groups.map((group) => wrapBooleanGroup([group])), operator);
}

function wrapBooleanGroup(groups: string[]): string {
  return `(${groups.map(stripWrappingParentheses).join(' OR ')})`;
}

function combineBooleanConcepts(clauses: string[], operator: ' OR ' | ' AND '): string {
  if (clauses.length <= 1) {
    return clauses[0] ?? '';
  }
  const combined = clauses.join(operator);
  return operator === ' OR ' ? `(${combined})` : combined;
}

function stripWrappingParentheses(value: string): string {
  const text = value.trim();
  if (!text.startsWith('(') || !text.endsWith(')')) {
    return text;
  }
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '(') {
      depth += 1;
    } else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0 && index < text.length - 1) {
        return text;
      }
    }
  }
  return depth === 0 ? text.slice(1, -1).trim() : text;
}

function toStrictQueryExpansion(expansion: string): string {
  const normalized = normalizeArxivWhitespace(expansion.toLowerCase());
  const phrase = KNOWN_ARXIV_QUERY_PHRASES
    .filter((candidate) => normalized === candidate || normalized.startsWith(`${candidate} `))
    .sort((left, right) => right.length - left.length)[0];
  return phrase ?? normalized.split(' ')[0] ?? normalized;
}

function removeContainedQueryExpansions(expansions: string[]): string[] {
  const unique = Array.from(new Set(expansions));
  return unique.filter(
    (candidate) =>
      !unique.some(
        (other) =>
          other !== candidate &&
          (` ${other} `).includes(` ${candidate} `)
      )
  );
}

function buildFieldPairClause(value: string, phrase: boolean): string {
  const term = escapeArxivTerm(value, phrase);
  return `(ti:${term} OR abs:${term})`;
}

function buildSemanticTitleAbstractGroups(normalized: string, compact = false): string[] {
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

  const addAliasGroup = (needles: string[], aliases: string[]): void => {
    if (!containsAny(normalized, needles)) {
      return;
    }
    addGroup(
      orClauses(aliases.map((alias) => buildFieldPairClause(alias, alias.includes(' ')))),
      needles
    );
  };

  addAliasGroup(
    ['physics-informed neural network', 'physics informed neural network', 'pinn'],
    ['physics-informed neural network', 'physics informed neural network', 'pinn']
  );
  addAliasGroup(['graph neural network', 'gnn'], ['graph neural network', 'gnn']);
  addAliasGroup(['large language model', 'llm'], ['large language model', 'llm']);
  addAliasGroup(['natural language processing', 'nlp'], ['natural language processing', 'nlp']);
  addAliasGroup(
    ['unmanned aerial vehicle', 'uav', 'drone', 'aerial robot'],
    ['unmanned aerial vehicle', 'uav', 'drone', 'aerial robot']
  );
  addAliasGroup(
    ['vision language action', 'vision-language-action', 'vla'],
    ['vision language action', 'vision-language-action', 'vla']
  );
  addAliasGroup(
    ['vision language model', 'vision-language model', 'vlm'],
    ['vision language model', 'vision-language model', 'vlm']
  );

  if (
    containsAny(normalized, [
      'tactile',
      'haptic',
      'haptics',
      'visuotactile',
      'force feedback',
      'touch sensing',
      'contact sensing'
    ])
  ) {
    addGroup(
      orClauses(
        (compact
          ? [
              buildFieldPairClause('tactile', false),
              buildFieldPairClause('haptic', false),
              buildFieldPairClause('visuotactile', false)
            ]
          : [
              buildFieldPairClause('tactile', false),
              buildFieldPairClause('haptic', false),
              buildFieldPairClause('haptics', false),
              buildFieldPairClause('visuotactile', false),
              buildFieldPairClause('tactile sensing', true),
              buildFieldPairClause('tactile perception', true),
              buildFieldPairClause('force feedback', true),
              buildFieldPairClause('touch sensing', true),
              buildFieldPairClause('contact sensing', true)
            ])
      ),
      [
        'tactile',
        'haptic',
        'haptics',
        'visuotactile',
        'tactile sensing',
        'tactile perception',
        'force feedback',
        'touch sensing',
        'contact sensing'
      ]
    );
  }

  if (containsAny(normalized, ['reinforcement learning', 'reinforcement-learning', 'rl'])) {
    addGroup(
      orClauses(
        compact
          ? [buildFieldPairClause('reinforcement learning', true), buildFieldPairClause('rl', false)]
          : [
              buildFieldPairClause('reinforcement learning', true),
              andClauses([buildFieldPairClause('reinforcement', false), buildFieldPairClause('learning', false)]),
              buildFieldPairClause('rl', false)
            ]
      ),
      ['reinforcement learning', 'reinforcement-learning', 'rl']
    );
  }

  if (containsAny(normalized, ['robot navigation', 'robotic navigation', 'mobile robot navigation'])) {
    addGroup(
      orClauses(
        compact
          ? [
              buildFieldPairClause('robot navigation', true),
              buildFieldPairClause('robotic navigation', true),
              buildFieldPairClause('mobile robot navigation', true)
            ]
          : [
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
            ]
      ),
      ['robot navigation', 'robotic navigation', 'mobile robot navigation', 'robot', 'robotic', 'robots', 'navigation']
    );
  }

  if (containsAny(normalized, ['path planning', 'motion planning', 'trajectory planning'])) {
    addGroup(
      orClauses(
        compact
          ? [
              buildFieldPairClause('path planning', true),
              buildFieldPairClause('motion planning', true),
              buildFieldPairClause('trajectory planning', true)
            ]
          : [
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
            ]
      ),
      ['path planning', 'motion planning', 'trajectory planning', 'path', 'motion', 'trajectory', 'planning']
    );
  }

  if (containsAny(normalized, ['mpc', 'model predictive control'])) {
    addGroup(
      orClauses([
        buildFieldPairClause('model predictive control', true),
        buildFieldPairClause('mpc', false)
      ]),
      ['model predictive control', 'mpc']
    );
  }

  if (containsAny(normalized, ['cbf', 'control barrier function', 'control barrier functions'])) {
    addGroup(
      orClauses([
        buildFieldPairClause('control barrier function', true),
        buildFieldPairClause('control barrier functions', true),
        buildFieldPairClause('cbf', false)
      ]),
      ['control barrier function', 'control barrier functions', 'cbf']
    );
  }

  if (containsAny(normalized, ['embodied ai', 'embodied intelligence', 'embodied agent', 'embodied'])) {
    addGroup(
      orClauses([
        buildFieldPairClause('embodied ai', true),
        buildFieldPairClause('embodied intelligence', true),
        buildFieldPairClause('embodied agent', true),
        andClauses([
          buildFieldPairClause('embodied', false),
          orClauses([
            buildFieldPairClause('ai', false),
            buildFieldPairClause('intelligence', false),
            buildFieldPairClause('agent', false),
            buildFieldPairClause('robot', false)
          ])
        ])
      ]),
      ['embodied ai', 'embodied intelligence', 'embodied agent', 'embodied', 'ai', 'intelligence', 'agent']
    );
  }

  if (
    !containsAny(normalized, ['robot navigation', 'robotic navigation', 'mobile robot navigation']) &&
    containsAny(normalized, ['humanoid'])
  ) {
    addGroup(
      orClauses(
        compact
          ? [buildFieldPairClause('humanoid', false)]
          : [
              buildFieldPairClause('humanoid', false),
              buildFieldPairClause('humanoid robot', true),
              buildFieldPairClause('humanoid robotics', true)
            ]
      ),
      ['humanoid', 'humanoid robot', 'humanoid robotics']
    );
  }

  if (
    !containsAny(normalized, ['robot navigation', 'robotic navigation', 'mobile robot navigation']) &&
    !containsAny(normalized, ['humanoid']) &&
    !consumedTokens.has('robot') &&
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
        orClauses(
          compact
            ? [buildFieldPairClause(phrase, true)]
            : [
                buildFieldPairClause(phrase, true),
                andClauses(phrase.split(/\s+/u).map((token) => buildFieldPairClause(token, false)))
              ]
        ),
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
  const normalizedValue = value.toLowerCase();
  const tokens = new Set(
    normalizedValue
      .split(/[^a-z0-9.+-]+/iu)
      .map((token) => token.trim())
      .filter(Boolean)
  );
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase();
    return ARXIV_QUERY_ACRONYM_TOKENS.has(normalizedNeedle) || /^[a-z0-9.+-]{2,3}$/iu.test(normalizedNeedle)
      ? tokens.has(normalizedNeedle)
      : normalizedValue.includes(normalizedNeedle);
  });
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
  const { from, to } = normalizeArxivYearRange(yearFrom, yearTo);
  if (!from && !to) {
    return '';
  }
  const startYear = from || '1991';
  const endYear = to || String(new Date().getFullYear());
  return `submittedDate:[${startYear}01010000 TO ${endYear}12312359]`;
}

function normalizeArxivYearRange(yearFrom?: string, yearTo?: string): { from: string; to: string } {
  const from = normalizeArxivYear(yearFrom);
  const to = normalizeArxivYear(yearTo);
  return from && to && from > to ? { from: to, to: from } : { from, to };
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
