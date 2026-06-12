import type { ArxivPaper } from './arxivClient';

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

export interface ArxivPaperMeta {
  favorite?: boolean;
  read?: boolean;
  queuedAt?: string;
  titleZh?: string;
  abstractZh?: string;
  insight?: ArxivPaperInsight;
  translatedAt?: string;
  scoredAt?: string;
}

const TOPIC_KEYWORDS: Record<keyof ArxivTopicMatch, { label: string; keywords: string[] }> = {
  rl: {
    label: 'RL',
    keywords: ['reinforcement learning', 'rl', 'policy', 'actor', 'critic', 'reward', 'imitation learning']
  },
  pinn: {
    label: 'PINN',
    keywords: ['pinn', 'physics-informed', 'physics informed', 'physical constraint', 'dynamics', 'pde', 'ode']
  },
  path_planning: {
    label: '路径规划',
    keywords: ['path planning', 'motion planning', 'navigation', 'trajectory', 'planning', 'planner']
  },
  robotics: {
    label: '机器人',
    keywords: ['robot', 'robotic', 'humanoid', 'manipulation', 'locomotion', 'uav', 'drone', 'mobile robot']
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

export function buildArxivPaperInsight(paper: ArxivPaper, query: string): ArxivPaperInsight {
  const haystack = normalizeText([paper.title, paper.summary, paper.categories.join(' '), paper.primaryCategory].join(' '));
  const queryTerms = normalizeText(query)
    .split(/\s+/u)
    .filter((term) => term.length >= 3);
  const queryHits = queryTerms.filter((term) => haystack.includes(term)).length;
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
    `- Published: ${formatDate(paper.publishedAt || paper.published)}`,
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
  const hits = keywords.filter((keyword) => haystack.includes(normalizeText(keyword))).length;
  if (hits === 0) {
    return 0;
  }
  return clampScore(5 + hits * 2);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, value));
}

function formatDate(value: string): string {
  return value ? value.slice(0, 10) : 'N/A';
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
