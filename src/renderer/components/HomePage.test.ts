import { describe, expect, it } from 'vitest';
import {
  buildHomePageMetrics,
  buildResearchWorkspaceOverview
} from './HomePage';
import type { PaperRecord } from '../lib/papers';

function makePaper(id: string, overrides: Partial<PaperRecord> = {}): PaperRecord {
  const base: PaperRecord = {
    id,
    pdfName: `${id}.pdf`,
    pdfPath: `C:/papers/${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: '',
    englishTitle: id,
    authors: '',
    journal: '',
    year: '',
    notes: '',
    lastOpenedAt: '',
    lastPage: 1,
    tags: [],
    isPinned: false,
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  return { ...base, ...overrides };
}

describe('buildHomePageMetrics', () => {
  it('derives latest paper and paper counts from the library', () => {
    const oldest = makePaper('oldest', {
      notes: '有笔记',
      lastOpenedAt: '2026-01-01T00:00:00.000Z'
    });
    const latest = makePaper('latest', {
      translatedPdfPath: 'C:/papers/latest-zh.pdf',
      lastOpenedAt: '2026-02-01T00:00:00.000Z'
    });
    const ignoredNotes = makePaper('blank-notes', {
      notes: '   ',
      translatedPdfPath: 'C:/papers/blank-zh.pdf'
    });

    expect(buildHomePageMetrics([oldest, latest, ignoredNotes])).toEqual({
      latestPaper: latest,
      notedPaperCount: 1,
      dualPdfCount: 2
    });
  });

  it('keeps the latest reading independent from library activity sorting', () => {
    const opened = makePaper('opened', {
      lastOpenedAt: '2026-04-01T00:00:00.000Z'
    });
    const edited = makePaper('edited', {
      lastOpenedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z'
    });

    expect(buildHomePageMetrics([edited, opened]).latestPaper?.id).toBe('opened');
  });
});

describe('buildResearchWorkspaceOverview', () => {
  it('derives workbench objects and workflow readiness from local papers', () => {
    const papers = [
      makePaper('method-paper', {
        notes: 'method card notes',
        translatedPdfPath: 'C:/papers/method-paper-bilingual.pdf',
        lastOpenedAt: '2026-02-01T00:00:00.000Z'
      }),
      makePaper('baseline-paper')
    ];

    const overview = buildResearchWorkspaceOverview(papers, {
      paperCount: 2,
      nodeCount: 8,
      edgeCount: 11
    });

    expect(overview.objectCards).toEqual([
      expect.objectContaining({ key: 'papers', value: '2', status: 'Ready' }),
      expect.objectContaining({ key: 'evidenceGraph', value: '8', status: 'Ready' }),
      expect.objectContaining({ key: 'notes', value: '1', status: 'Ready' }),
      expect.objectContaining({ key: 'bilingualAssets', value: '1', status: 'Cached' })
    ]);
    expect(overview.pipeline.map((stage) => [stage.key, stage.status])).toEqual([
      ['method', 'Ready'],
      ['code', 'Planned'],
      ['experiment', 'Draftable'],
      ['runtime', 'Planned']
    ]);
    expect(overview.nextActions[0]).toMatchObject({
      key: 'continue-reading',
      actionLabel: '继续阅读'
    });
    expect(overview.risks.map((risk) => risk.key)).toEqual([
      'project-space',
      'code-mapping',
      'runtime-center'
    ]);
  });

  it('marks setup gaps before the first paper is imported', () => {
    const overview = buildResearchWorkspaceOverview([], {
      paperCount: 0,
      nodeCount: 0,
      edgeCount: 0
    });

    expect(overview.objectCards.map((card) => card.status)).toEqual([
      'Setup needed',
      'Evidence missing',
      'Setup needed',
      'Setup needed'
    ]);
    expect(overview.pipeline.map((stage) => stage.status)).toEqual([
      'Needs paper',
      'Planned',
      'Needs evidence',
      'Planned'
    ]);
    expect(overview.nextActions[0]).toMatchObject({
      key: 'import-paper',
      actionLabel: '导入论文'
    });
  });
});
