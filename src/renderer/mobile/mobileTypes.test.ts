import { describe, expect, it } from 'vitest';
import {
  createArxivMobilePaper,
  createImportedMobilePaper,
  mergeTranslationEntry,
  parseMobileLibrary,
  sanitizeFileName,
  upsertMobilePaper,
  type MobileStoredPdf,
  type MobileTranslationEntry
} from './mobileTypes';

const storedPdf: MobileStoredPdf = {
  path: 'papers/local/source/paper.pdf',
  fileName: 'paper.pdf',
  kind: 'source',
  byteLength: 120
};

describe('mobile paper model', () => {
  it('creates a local paper without leaking desktop path assumptions', () => {
    const paper = createImportedMobilePaper({ id: 'local-1', fileName: 'robot-navigation.pdf', storedPdf, now: '2026-07-13T00:00:00.000Z' });
    expect(paper.title).toBe('robot-navigation');
    expect(paper.source).toBe('import');
    expect(paper.lastPage).toBe(1);
  });

  it('maps arXiv metadata into the mobile library record', () => {
    const paper = createArxivMobilePaper({
      now: '2026-07-13T00:00:00.000Z',
      storedPdf,
      paper: {
        id: 'https://arxiv.org/abs/2607.00001v1',
        stableId: '2607.00001',
        title: 'Safe RL',
        authors: ['Ada'],
        summary: 'Abstract',
        published: '2026-07-01T00:00:00Z',
        publishedAt: '2026-07-01T00:00:00Z',
        updated: '2026-07-01T00:00:00Z',
        categories: ['cs.RO'],
        primaryCategory: 'cs.RO',
        abstractUrl: 'https://arxiv.org/abs/2607.00001',
        pdfUrl: 'https://arxiv.org/pdf/2607.00001.pdf'
      }
    });
    expect(paper.id).toBe('arxiv-2607.00001');
    expect(paper.year).toBe('2026');
    expect(paper.authors).toEqual(['Ada']);
  });

  it('preserves translated PDF when refreshing an existing record', () => {
    const original = createImportedMobilePaper({ id: 'local-1', fileName: 'paper.pdf', storedPdf });
    const translatedPdf = { ...storedPdf, kind: 'translated' as const, path: 'papers/local/translated/paper.pdf' };
    const withTranslation = { ...original, translatedPdf };
    const refreshed = { ...original, title: 'Updated title' };
    expect(upsertMobilePaper([withTranslation], refreshed)[0].translatedPdf).toEqual(translatedPdf);
  });

  it('rejects malformed library JSON and sanitizes file names', () => {
    expect(parseMobileLibrary('{bad')).toEqual([]);
    expect(sanitizeFileName('a/b:c?.pdf')).toBe('a-b-c-.pdf');
  });
});

describe('mobile translation cache', () => {
  it('replaces one source hash without duplicating entries', () => {
    const first: MobileTranslationEntry = { sourceHash: 'a', page: 1, original: 'A', translation: '甲', translatedAt: '1', model: 'm' };
    const second: MobileTranslationEntry = { ...first, translation: '乙', translatedAt: '2' };
    expect(mergeTranslationEntry([first], second)).toEqual([second]);
  });
});
