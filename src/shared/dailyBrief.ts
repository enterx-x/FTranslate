import type { ArxivPaper, ArxivSearchRequest, ArxivSearchServiceResult } from './arxiv';

export interface DailyBriefPreferences {
  enabled: boolean;
  time: string;
  interests: string;
  excludeTerms: string;
  maxPapers: number;
  useAi: boolean;
}

export interface DailyBriefItem {
  paper: ArxivPaper;
  summary: string;
  reason: string;
  readingHint: string;
  evidenceLevel: 'abstract';
  score: number;
}

export interface DailyBriefFeedback {
  paperId: string;
  kind: 'interested' | 'dismissed' | 'saved';
  title: string;
  topics: string[];
}

export interface DailyBrief {
  id: string;
  date: string;
  createdAt: string;
  items: DailyBriefItem[];
  steps: string[];
  mode: 'ai' | 'rules';
  warning?: string;
}

export interface DailyBriefSnapshot {
  preferences: DailyBriefPreferences;
  briefs: DailyBrief[];
  feedback: DailyBriefFeedback[];
  running: boolean;
  lastError: string | null;
  lastAttemptAt: string | null;
}

export const DAILY_BRIEF_DEFAULT_PREFERENCES: DailyBriefPreferences = {
  enabled: false,
  time: '08:30',
  interests: '',
  excludeTerms: '',
  maxPapers: 5,
  useAi: false
};

export const DAILY_BRIEF_MIN_PAPERS = 1;
export const DAILY_BRIEF_MAX_PAPERS = 20;
export const DAILY_BRIEF_MAX_HISTORY = 30;
export const DAILY_BRIEF_MAX_FEEDBACK = 500;
export const DAILY_BRIEF_MAX_SEARCH_RESULTS = 50;
export const DAILY_BRIEF_MAX_AI_QUERIES = 3;
export const DAILY_BRIEF_MAX_AI_COMPLETIONS = 2;
export const DAILY_BRIEF_MAX_INTERESTS_LENGTH = 2_000;
export const DAILY_BRIEF_MAX_EXCLUDE_TERMS_LENGTH = 2_000;
export const DAILY_BRIEF_MAX_FEEDBACK_TITLE_LENGTH = 4_000;
export const DAILY_BRIEF_MAX_FEEDBACK_TOPIC_LENGTH = 160;

export function isDailyBriefTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/u.test(value)) {
    return false;
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function normalizeDailyBriefPreferences(value: unknown): DailyBriefPreferences {
  const candidate = isRecord(value) ? value : {};
  const rawMaxPapers = typeof candidate.maxPapers === 'number' ? candidate.maxPapers : Number(candidate.maxPapers);
  const maxPapers = Number.isFinite(rawMaxPapers)
    ? Math.min(DAILY_BRIEF_MAX_PAPERS, Math.max(DAILY_BRIEF_MIN_PAPERS, Math.round(rawMaxPapers)))
    : DAILY_BRIEF_DEFAULT_PREFERENCES.maxPapers;

  return {
    enabled: candidate.enabled === true,
    time: isDailyBriefTime(candidate.time) ? candidate.time : DAILY_BRIEF_DEFAULT_PREFERENCES.time,
    interests: normalizeText(candidate.interests).slice(0, DAILY_BRIEF_MAX_INTERESTS_LENGTH),
    excludeTerms: normalizeText(candidate.excludeTerms).slice(0, DAILY_BRIEF_MAX_EXCLUDE_TERMS_LENGTH),
    maxPapers,
    useAi: candidate.useAi === true
  };
}

export function validateDailyBriefPreferences(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['每日简报偏好必须是对象。'];
  }
  const errors: string[] = [];
  if (typeof value.enabled !== 'boolean') errors.push('每日任务开关必须是布尔值。');
  if (!isDailyBriefTime(value.time)) errors.push('时间必须是合法的本机 HH:mm 时间。');
  if (typeof value.interests !== 'string' || !value.interests.trim()) errors.push('研究兴趣至少填写一项。');
  if (typeof value.excludeTerms !== 'string') errors.push('排除词必须是文本。');
  if (typeof value.maxPapers !== 'number' || !Number.isInteger(value.maxPapers) || value.maxPapers < DAILY_BRIEF_MIN_PAPERS || value.maxPapers > DAILY_BRIEF_MAX_PAPERS) {
    errors.push(`每日论文数必须是 ${DAILY_BRIEF_MIN_PAPERS} 到 ${DAILY_BRIEF_MAX_PAPERS} 的整数。`);
  }
  if (typeof value.useAi !== 'boolean') errors.push('AI 开关必须是布尔值。');
  if (typeof value.interests === 'string' && value.interests.length > DAILY_BRIEF_MAX_INTERESTS_LENGTH) errors.push('研究兴趣文本过长。');
  if (typeof value.excludeTerms === 'string' && value.excludeTerms.length > DAILY_BRIEF_MAX_EXCLUDE_TERMS_LENGTH) errors.push('排除词文本过长。');
  return errors;
}

export function canonicalizeArxivStableId(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  let normalized = value.trim().toLowerCase();
  normalized = normalized.replace(/^arxiv\s*:\s*/u, '');
  normalized = normalized.replace(/^https?:\/\/[^/]+\/abs\//u, '');
  normalized = normalized.replace(/^https?:\/\/[^/]+\/pdf\//u, '');
  normalized = normalized.split(/[?#]/u, 1)[0] ?? normalized;
  normalized = normalized.replace(/\.pdf$/iu, '');
  return normalized.replace(/v\d+$/iu, '').trim();
}

export function getDailyBriefDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export type DailyBriefSearch = (request: ArxivSearchRequest) => Promise<ArxivSearchServiceResult>;
export type DailyBriefAiCompletion = (request: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
