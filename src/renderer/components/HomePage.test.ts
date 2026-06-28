import { describe, expect, it } from 'vitest';
import { buildHomePageMetrics } from './HomePage';
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
