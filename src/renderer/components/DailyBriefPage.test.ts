import { describe, expect, it } from 'vitest';
import type { ArxivPaper } from '../../shared/arxiv';
import type { DailyBrief, DailyBriefItem, DailyBriefSnapshot } from '../../shared/dailyBrief';
import {
  DEFAULT_DAILY_BRIEF_PREFERENCES,
  buildDailyBriefFeedback,
  getDailyBriefFeedbackPaperId,
  getDailyBriefPaperId,
  getDailyBriefStatus,
  isDailyBriefForToday,
  normalizeDailyBriefPreferences,
  sortDailyBriefsByNewest,
  formatDailyBriefScore
} from './DailyBriefPage';

const paper: ArxivPaper = {
  id: 'https://arxiv.org/abs/2609.00001v1',
  stableId: '2609.00001',
  title: 'A Long English Title for a Reproducible Research Brief',
  authors: ['Ada Lovelace'],
  summary: 'An abstract used only as a bounded evidence source.',
  published: '2026-09-07T00:00:00Z',
  publishedAt: '2026-09-07T00:00:00Z',
  updated: '2026-09-07T00:00:00Z',
  categories: ['cs.RO', 'cs.LG'],
  primaryCategory: 'cs.RO',
  abstractUrl: 'https://arxiv.org/abs/2609.00001v1',
  pdfUrl: 'https://arxiv.org/pdf/2609.00001v1.pdf'
};

const item: DailyBriefItem = {
  paper,
  summary: 'A short recommendation summary.',
  reason: 'It matches the saved research interests.',
  readingHint: 'Check the evaluation protocol first.',
  evidenceLevel: 'abstract',
  score: 84
};

function buildBrief(id: string, date: string, createdAt = `${date}T08:30:00+08:00`): DailyBrief {
  return {
    id,
    date,
    createdAt,
    items: [item],
    steps: ['search'],
    mode: 'rules'
  };
}

function buildSnapshot(overrides: Partial<DailyBriefSnapshot> = {}): DailyBriefSnapshot {
  return {
    preferences: { ...DEFAULT_DAILY_BRIEF_PREFERENCES },
    briefs: [],
    feedback: [],
    running: false,
    lastError: null,
    lastAttemptAt: null,
    ...overrides
  };
}

describe('DailyBriefPage helpers', () => {
  it('keeps automatic generation disabled in the initial preferences', () => {
    expect(DEFAULT_DAILY_BRIEF_PREFERENCES).toMatchObject({
      enabled: false,
      useAi: false,
      maxPapers: 5
    });
  });

  it('normalizes malformed local form values without enabling scheduling', () => {
    expect(
      normalizeDailyBriefPreferences({
        enabled: true,
        time: 'not-a-time',
        interests: ' robots ',
        excludeTerms: '',
        maxPapers: 0,
        useAi: true
      })
    ).toEqual({
      enabled: true,
      time: '08:30',
      interests: 'robots',
      excludeTerms: '',
      maxPapers: 1,
      useAi: true
    });
  });

  it('sorts brief history without mutating the snapshot array', () => {
    const oldest = buildBrief('old', '2026-09-05');
    const newest = buildBrief('new', '2026-09-07');
    const input = [oldest, newest];

    expect(sortDailyBriefsByNewest(input).map((brief) => brief.id)).toEqual(['new', 'old']);
    expect(input.map((brief) => brief.id)).toEqual(['old', 'new']);
  });

  it('distinguishes a stale brief from today in the status copy', () => {
    const stale = buildBrief('old', '2026-09-06');
    const snapshot = buildSnapshot({
      preferences: { ...DEFAULT_DAILY_BRIEF_PREFERENCES, enabled: true },
      briefs: [stale]
    });

    expect(isDailyBriefForToday(stale, new Date(2026, 8, 7, 9, 0))).toBe(false);
    expect(getDailyBriefStatus(snapshot)).toMatchObject({
      tone: 'empty',
      label: '今日尚未生成'
    });
  });

  it('builds reversible feedback using the stable arXiv id and topics', () => {
    expect(buildDailyBriefFeedback(paper, 'saved')).toEqual({
      paperId: '2609.00001',
      kind: 'saved',
      title: paper.title,
      topics: ['cs.RO', 'cs.LG']
    });
  });

  it('matches versioned paper records to canonical feedback ids', () => {
    const versionOne = { ...paper, stableId: '2609.00001v1' };
    const versionTwo = { ...paper, stableId: '2609.00001v2' };

    expect(getDailyBriefPaperId(versionOne)).toBe('2609.00001');
    expect(getDailyBriefPaperId(versionTwo)).toBe('2609.00001');
    expect(getDailyBriefFeedbackPaperId('2609.00001v1')).toBe(getDailyBriefPaperId(versionTwo));
  });

  it('renders the shared 0-100 matching score without treating it as a probability', () => {
    expect(formatDailyBriefScore(72.4)).toBe('匹配分 72/100');
    expect(formatDailyBriefScore(1)).toBe('匹配分 1/100');
    expect(formatDailyBriefScore(Number.NaN)).toBe('匹配分 —/100');
  });
});
