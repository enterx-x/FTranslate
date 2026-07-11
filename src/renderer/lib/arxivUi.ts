import {
  normalizeArxivSearchQuery,
  type ArxivPaper,
  type ArxivQueryMode,
  type ArxivSearchServiceResult,
  type ArxivSortBy,
  type ArxivTitleAbstractTranslationEngine,
  type ArxivTitleAbstractTranslationStatus,
  type ArxivTranslationQualityStatus
} from './arxivClient';

export type ArxivReadingPriority = 'high' | 'medium' | 'low';

export interface ArxivTopicMatch {
  rl: number;
  pinn: number;
  path_planning: number;
  robotics: number;
  embodied_ai: number;
  world_model: number;
}

export interface ArxivPaperInsight {
  totalScore: number;
  relevance: number;
  novelty: number;
  methodClarity: number;
  experimentQuality: number;
  codeAvailability: number;
  topicMatch: ArxivTopicMatch;
  readingPriority: ArxivReadingPriority;
  reasonZh: string;
  tags: string[];
}

export interface ArxivTopicCard {
  key: keyof ArxivTopicMatch;
  label: string;
  value: number;
}

export interface ArxivPaperMeta {
  favorite?: boolean;
  read?: boolean;
  queuedAt?: string;
  titleZh?: string;
  abstractZh?: string;
  insight?: ArxivPaperInsight;
  translatedAt?: string;
  scoredAt?: string;
  translationStatus?: ArxivTitleAbstractTranslationStatus;
  translationMessage?: string;
  translationEngine?: ArxivTitleAbstractTranslationEngine;
  qualityStatus?: ArxivTranslationQualityStatus;
  translationElapsedMs?: number;
  insightQuery?: string;
  insightQueryMode?: ArxivQueryMode;
}

export function getArxivRankingScopeLabel(sortBy: ArxivSortBy): string {
  switch (sortBy) {
    case 'comprehensive':
      return '本页相关排序';
    case 'relevance':
      return 'arXiv 全局相关性';
    case 'submittedDate':
      return 'arXiv 提交时间';
    case 'lastUpdatedDate':
      return 'arXiv 更新时间';
  }
}

export function getArxivWaitStateLabel(
  state: Pick<ArxivSearchServiceResult, 'queueSize' | 'lastRequestGapMs' | 'cooldownRemainingMs'> | null,
  isSearching = false
): string {
  if (!state) {
    return isSearching ? 'arXiv 请求中' : 'arXiv 待命';
  }
  if ((state.cooldownRemainingMs ?? 0) > 0) {
    return `arXiv 冷却 ${Math.max(1, Math.ceil((state.cooldownRemainingMs ?? 0) / 60_000))} 分钟`;
  }
  if (state.queueSize > 0) {
    return `arXiv 排队 ${state.queueSize}`;
  }
  if (isSearching) {
    return 'arXiv 请求中';
  }
  return 'arXiv 就绪';
}

export function getArxivTranslationQualityLabel(meta: ArxivPaperMeta): string {
  let label: string;
  switch (meta.qualityStatus) {
    case 'passed':
      label = '质量门禁：通过';
      break;
    case 'failed':
      label = '质量门禁：未通过';
      break;
    case 'not-checked':
      label = '质量门禁：未检查';
      break;
    default:
      label = getLegacyArxivTranslationQualityLabel(meta.translationStatus);
      break;
  }
  if (typeof meta.translationElapsedMs !== 'number' || !Number.isFinite(meta.translationElapsedMs)) {
    return label;
  }
  const elapsedMs = Math.max(0, meta.translationElapsedMs);
  const elapsedLabel = elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;
  return `${label} · ${elapsedLabel}`;
}

function getLegacyArxivTranslationQualityLabel(
  translationStatus?: ArxivTitleAbstractTranslationStatus
): string {
  switch (translationStatus) {
    case 'completed':
    case 'cached':
      return '质量门禁：通过';
    case 'failed':
      return '质量门禁：未通过';
    case 'unavailable':
      return '质量门禁：不可用';
    default:
      return '质量门禁：待检查';
  }
}

const TOPIC_KEYWORDS: Record<keyof ArxivTopicMatch, { label: string; keywords: string[] }> = {
  rl: {
    label: 'RL',
    keywords: ['reinforcement learning', 'rl', 'policy', 'actor', 'critic', 'reward', 'imitation learning']
  },
  pinn: {
    label: 'PINN',
    keywords: [
      'pinn',
      'physics-informed',
      'physics informed',
      'physics-informed neural network',
      'physical constraint',
      'physics residual',
      'pde residual',
      'ode residual',
      'neural ode'
    ]
  },
  path_planning: {
    label: '路径规划',
    keywords: ['path planning', 'motion planning', 'navigation', 'trajectory', 'planning', 'planner']
  },
  robotics: {
    label: '机器人',
    keywords: ['robot', 'robots', 'robotic', 'humanoid', 'manipulation', 'locomotion', 'uav', 'drone', 'mobile robot']
  },
  embodied_ai: {
    label: '具身智能',
    keywords: ['embodied', 'vision-language-action', 'vla', 'vlm', 'foundation model', 'language instruction']
  },
  world_model: {
    label: 'World Model',
    keywords: ['world model', 'model-based', 'dynamics model', 'predictive model', 'latent dynamics']
  }
};

const NOVELTY_KEYWORDS = ['novel', 'new', 'propose', 'present', 'foundation', 'zero-shot', 'generalization'];
const METHOD_KEYWORDS = ['framework', 'architecture', 'module', 'controller', 'planner', 'algorithm', 'model'];
const EXPERIMENT_KEYWORDS = ['experiment', 'benchmark', 'baseline', 'result', 'real-world', 'simulation', 'dataset'];
const CODE_KEYWORDS = ['code', 'github', 'open-source', 'repository', 'implementation'];
const MATCH_REASON_PHRASES = [
  'tactile sensing',
  'tactile perception',
  'haptic feedback',
  'force feedback',
  'touch sensing',
  'contact sensing',
  'robot navigation',
  'robotic navigation',
  'mobile robot navigation',
  'path planning',
  'motion planning',
  'trajectory planning',
  'obstacle avoidance',
  'collision avoidance',
  'embodied ai',
  'embodied intelligence',
  'vision language action',
  'vision-language-action',
  'mobile manipulation',
  'loco-manipulation',
  'reinforcement learning',
  'safe reinforcement learning',
  'physics-informed',
  'control barrier function',
  'model predictive control',
  'world model'
];
const MATCH_REASON_STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'using',
  'based',
  'sensing',
  'perception',
  'feedback',
  'information',
  'model',
  'learning'
]);

export function buildArxivPaperInsight(
  paper: ArxivPaper,
  query: string,
  queryMode: ArxivQueryMode = 'balanced'
): ArxivPaperInsight {
  const haystack = normalizeText([paper.title, paper.summary, paper.categories.join(' '), paper.primaryCategory].join(' '));
  const normalizedQuery = normalizeText(normalizeArxivSearchQuery(query, queryMode));
  const queryTerms = queryMode === 'strict' && normalizedQuery.includes(' ')
    ? [normalizedQuery]
    : normalizedQuery.split(/\s+/u).filter((term) => term.length >= 3);
  const queryHits = queryTerms.filter((term) =>
    queryMode === 'strict' ? keywordMatches(haystack, term) : haystack.includes(term)
  ).length;
  const queryScore = queryTerms.length === 0 ? 4 : clampScore(Math.round((queryHits / queryTerms.length) * 10));

  const topicMatch = Object.fromEntries(
    Object.entries(TOPIC_KEYWORDS).map(([key, config]) => [
      key,
      scoreByKeywords(haystack, config.keywords)
    ])
  ) as unknown as ArxivTopicMatch;

  const strongestTopic = Math.max(...Object.values(topicMatch));
  const relevance = clampScore(Math.round(queryScore * 0.55 + strongestTopic * 0.45));
  const novelty = scoreByKeywords(haystack, NOVELTY_KEYWORDS);
  const methodClarity = scoreByKeywords(haystack, METHOD_KEYWORDS);
  const experimentQuality = scoreByKeywords(haystack, EXPERIMENT_KEYWORDS);
  const codeAvailability = scoreByKeywords(haystack, CODE_KEYWORDS);
  const topicBreadth = clampScore(Object.values(topicMatch).filter((score) => score >= 5).length * 2);
  const totalScore = Math.round(
    clampScore(
      relevance * 0.34 +
        strongestTopic * 0.2 +
        topicBreadth * 0.18 +
        novelty * 0.08 +
        methodClarity * 0.1 +
        experimentQuality * 0.08 +
        codeAvailability * 0.02
    ) * 10
  );
  const readingPriority: ArxivReadingPriority =
    totalScore >= 70 ? 'high' : totalScore >= 45 ? 'medium' : 'low';
  const tags = buildTags(topicMatch, haystack);

  return {
    totalScore,
    relevance: relevance * 10,
    novelty: novelty * 10,
    methodClarity: methodClarity * 10,
    experimentQuality: experimentQuality * 10,
    codeAvailability: codeAvailability * 10,
    topicMatch,
    readingPriority,
    reasonZh: buildReasonZh(tags, readingPriority, relevance, experimentQuality),
    tags
  };
}

export function buildArxivTopicCards(
  insight: ArxivPaperInsight,
  query = '',
  queryMode: ArxivQueryMode = 'balanced'
): ArxivTopicCard[] {
  const queryTopics = new Set(detectQueryTopicKeys(query, queryMode));
  return (Object.entries(TOPIC_KEYWORDS) as Array<[keyof ArxivTopicMatch, { label: string; keywords: string[] }]>)
    .map(([key, config]) => ({
      key,
      label: config.label,
      value: insight.topicMatch[key]
    }))
    .filter((card) => card.value > 0 || queryTopics.has(card.key))
    .sort((left, right) => {
      const leftQuery = queryTopics.has(left.key) ? 1 : 0;
      const rightQuery = queryTopics.has(right.key) ? 1 : 0;
      return rightQuery - leftQuery || right.value - left.value;
    })
    .slice(0, 6);
}

export function buildArxivMatchReasons(
  paper: ArxivPaper,
  query: string,
  queryMode: ArxivQueryMode = 'balanced',
  limit = 5
): string[] {
  const normalizedQuery = normalizeText(normalizeArxivSearchQuery(query, queryMode));
  const haystack = normalizeText([paper.title, paper.summary, paper.categories.join(' '), paper.primaryCategory].join(' '));
  if (!normalizedQuery || !haystack) {
    return [];
  }
  const phraseCandidates = MATCH_REASON_PHRASES.filter((phrase) => normalizedQuery.includes(normalizeText(phrase)));
  const tokenCandidates = normalizedQuery
    .split(/[^a-z0-9.+-]+/iu)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !MATCH_REASON_STOP_WORDS.has(term));
  return Array.from(new Set([...phraseCandidates, ...tokenCandidates]))
    .filter((term) => keywordMatches(haystack, term))
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, Math.max(1, Math.floor(limit)));
}

export function buildArxivExportMarkdown(paper: ArxivPaper, meta: ArxivPaperMeta = {}): string {
  const insight = meta.insight ?? buildArxivPaperInsight(paper, '');
  const authors = paper.authors.length > 0 ? paper.authors.join(', ') : 'arXiv 未返回作者';
  const title = meta.titleZh || paper.title;
  return [
    `# ${title}`,
    '',
    ...(meta.titleZh ? [`- English title: ${paper.title}`] : []),
    `- arXiv ID: ${paper.stableId}`,
    `- Authors: ${authors}`,
    `- Submitted (arXiv API UTC): ${formatArxivApiDate(paper.publishedAt || paper.published)}`,
    `- Categories: ${paper.categories.join(', ') || paper.primaryCategory || 'N/A'}`,
    `- Reading priority: ${insight.readingPriority}`,
    `- Score: ${insight.totalScore}/100`,
    `- arXiv: ${paper.abstractUrl}`,
    `- PDF: ${paper.pdfUrl}`,
    '',
    '## Abstract',
    paper.summary,
    '',
    ...(meta.abstractZh ? ['## 中文摘要', meta.abstractZh, ''] : []),
    '## 推荐理由',
    insight.reasonZh,
    '',
    '## Tags',
    insight.tags.map((tag) => `- ${tag}`).join('\n')
  ].join('\n');
}

export function buildArxivBibTeX(paper: ArxivPaper): string {
  const firstAuthor = paper.authors[0]?.split(/\s+/u).pop()?.toLowerCase().replace(/[^a-z0-9]/giu, '') || 'arxiv';
  const year = getYear(paper.publishedAt || paper.published) || 'noyear';
  const titleStem = paper.title
    .split(/[:：]/u)[0]
    .replace(/[^a-z0-9]+/giu, '')
    .slice(0, 24)
    .toLowerCase();
  const key = `${firstAuthor}${year}${titleStem || paper.stableId.replace(/\W+/gu, '')}`;
  const authors = paper.authors.join(' and ') || 'Unknown';
  return [
    `@misc{${key},`,
    `  title={${escapeBibTeX(paper.title)}},`,
    `  author={${escapeBibTeX(authors)}},`,
    `  year={${year}},`,
    `  eprint={${paper.stableId}},`,
    '  archivePrefix={arXiv},',
    `  primaryClass={${paper.primaryCategory || paper.categories[0] || 'cs.RO'}},`,
    `  url={${paper.abstractUrl}}`,
    '}'
  ].join('\n');
}

export function parseArxivTitleAbstractTranslation(
  value: string,
  paper: ArxivPaper
): { titleZh: string; abstractZh: string } {
  const cleaned = cleanAiText(value);
  const jsonText = extractJsonObject(cleaned);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as {
        titleZh?: unknown;
        abstractZh?: unknown;
        title?: unknown;
        abstract?: unknown;
      };
      const titleZh = typeof parsed.titleZh === 'string' ? parsed.titleZh.trim() : '';
      const abstractZh =
        typeof parsed.abstractZh === 'string'
          ? parsed.abstractZh.trim()
          : typeof parsed.abstract === 'string'
            ? parsed.abstract.trim()
            : '';
      if (titleZh || abstractZh) {
        return {
          titleZh,
          abstractZh: abstractZh || cleaned
        };
      }
    } catch {
      // AI 可能返回带说明的非严格 JSON，兜底保留原文，避免按钮失败。
    }
  }
  return {
    titleZh: '',
    abstractZh: cleaned || paper.summary
  };
}

export function formatArxivResultRange(start: number, count: number, total: number): string {
  if (count <= 0) {
    return total > 0 ? `0 / ${total} 篇` : '0 篇';
  }
  const from = start + 1;
  const to = start + count;
  return total > 0 ? `${from}-${to} / ${total} 篇` : `${count} 篇`;
}

export function formatArxivApiDate(value: string): string {
  return value ? value.slice(0, 10) : 'N/A';
}

export function getArxivApiDateTooltip(kind: 'submitted' | 'updated', value: string): string {
  const timestamp = value || 'N/A';
  if (kind === 'submitted') {
    return `arXiv API submitted/published timestamp: ${timestamp} (UTC). The arXiv website new/recent announcement date may be one day later than this API date.`;
  }
  return `arXiv API latest version updated timestamp: ${timestamp} (UTC). This is the latest version time, not the first announcement date.`;
}

function buildTags(topicMatch: ArxivTopicMatch, haystack: string): string[] {
  const tags = Object.entries(TOPIC_KEYWORDS)
    .filter(([key]) => topicMatch[key as keyof ArxivTopicMatch] >= 5)
    .map(([, config]) => config.label);
  if (scoreByKeywords(haystack, EXPERIMENT_KEYWORDS) >= 5) {
    tags.push('实验');
  }
  if (scoreByKeywords(haystack, METHOD_KEYWORDS) >= 5) {
    tags.push('方法');
  }
  return Array.from(new Set(tags)).slice(0, 6);
}

function buildReasonZh(tags: string[], priority: ArxivReadingPriority, relevance: number, experimentQuality: number): string {
  const topicText = tags.length > 0 ? tags.slice(0, 4).join('、') : '当前检索主题';
  const priorityText = priority === 'high' ? '优先阅读' : priority === 'medium' ? '可加入候选阅读' : '暂时低优先级';
  const evidence = experimentQuality >= 6 ? '摘要中出现实验、基准或真实验证线索' : '摘要中的实验信息仍需进入正文确认';
  return `与${topicText}相关，相关性评分约 ${relevance * 10}/100，${evidence}，建议${priorityText}。`;
}

function scoreByKeywords(haystack: string, keywords: string[]): number {
  const hits = keywords.filter((keyword) => keywordMatches(haystack, keyword)).length;
  if (hits === 0) {
    return 0;
  }
  return clampScore(5 + hits * 2);
}

function detectQueryTopicKeys(
  query: string,
  queryMode: ArxivQueryMode
): Array<keyof ArxivTopicMatch> {
  const normalizedQuery = normalizeText(normalizeArxivSearchQuery(query, queryMode));
  return (Object.entries(TOPIC_KEYWORDS) as Array<[keyof ArxivTopicMatch, { label: string; keywords: string[] }]>)
    .filter(([, config]) => config.keywords.some((keyword) => keywordMatches(normalizedQuery, keyword)))
    .map(([key]) => key);
}

function keywordMatches(haystack: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) {
    return false;
  }
  if (/^[a-z0-9.+-]+$/iu.test(normalizedKeyword)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedKeyword)}($|[^a-z0-9])`, 'iu').test(haystack);
  }
  return haystack.includes(normalizedKeyword);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, value));
}

function getYear(value: string): string {
  return value.match(/\b(19|20)\d{2}\b/u)?.[0] ?? '';
}

function escapeBibTeX(value: string): string {
  return value.replace(/[{}]/gu, '');
}

function cleanAiText(value: string): string {
  return value.replace(/^```[a-z]*\s*/iu, '').replace(/```$/u, '').trim();
}

function extractJsonObject(value: string): string {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : '';
}
