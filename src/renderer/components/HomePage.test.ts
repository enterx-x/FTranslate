import { describe, expect, it } from 'vitest';
import {
  buildHomePageMetrics,
  getHomePageVisibleActions
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
    lastPage: 1
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
});

describe('getHomePageVisibleActions', () => {
  it('keeps library actions focused on importing, reading, editing, and removing papers', () => {
    expect(getHomePageVisibleActions()).toEqual([
      'import',
      'open',
      'edit',
      'remove'
    ]);
  });

  it('does not include research workbench shortcuts in the library surface', () => {
    expect(getHomePageVisibleActions()).not.toContain('research-sheet');
    expect(getHomePageVisibleActions()).not.toContain('experiment-matrix');
    expect(getHomePageVisibleActions()).not.toContain('knowledge-graph');
    expect(getHomePageVisibleActions()).not.toContain('presentation');
  });
});
