import { describe, expect, it } from 'vitest';
import {
  createArxivMobilePaper,
  createImportedMobilePaper,
  isMobilePaperSourceEquivalent,
  isTranslationEntryCurrent,
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
  byteLength: 120,
  contentHash: 'sha256-source-v1'
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
      titleZh: '安全强化学习',
      abstractZh: '中文摘要',
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
    expect(paper.titleZh).toBe('安全强化学习');
    expect(paper.abstractZh).toBe('中文摘要');
  });

  it('preserves translated PDF when refreshing an existing record', () => {
    const original = createImportedMobilePaper({ id: 'local-1', fileName: 'paper.pdf', storedPdf });
    const translatedPdf = { ...storedPdf, kind: 'translated' as const, path: 'papers/local/translated/paper.pdf' };
    const withTranslation = { ...original, translatedPdf, lastPage: 12, pageCount: 20 };
    const refreshed = { ...original, title: 'Updated title' };
    const merged = upsertMobilePaper([withTranslation], refreshed)[0];
    expect(merged.translatedPdf).toEqual(translatedPdf);
    expect(merged.lastPage).toBe(12);
    expect(merged.pageCount).toBe(20);
    expect(isMobilePaperSourceEquivalent(withTranslation, refreshed)).toBe(true);
  });

  it('invalidates progress and translated PDF when the source bytes change under the same paper id', () => {
    const original = createImportedMobilePaper({ id: 'local-1', fileName: 'paper.pdf', storedPdf });
    const translatedPdf = { ...storedPdf, kind: 'translated' as const, path: 'papers/local/translated/paper.pdf' };
    const withTranslation = { ...original, translatedPdf, lastPage: 12, pageCount: 20 };
    const refreshed = {
      ...original,
      sourcePdf: { ...storedPdf, contentHash: 'sha256-source-v2' }
    };
    const merged = upsertMobilePaper([withTranslation], refreshed)[0];
    expect(isMobilePaperSourceEquivalent(withTranslation, refreshed)).toBe(false);
    expect(merged.translatedPdf).toBeUndefined();
    expect(merged.lastPage).toBe(1);
    expect(merged.pageCount).toBeUndefined();
  });

  it('rejects malformed library JSON and sanitizes file names', () => {
    expect(parseMobileLibrary('{bad')).toEqual([]);
    expect(sanitizeFileName('a/b:c?.pdf')).toBe('a-b-c-.pdf');
  });

  it('normalizes recoverable legacy records instead of allowing missing fields to crash the library', () => {
    const parsed = parseMobileLibrary(JSON.stringify([{
      id: 'legacy-1',
      title: 'Legacy paper',
      lastPage: 3,
      sourcePdf: { path: 'papers/legacy/source/paper.pdf', fileName: 'paper.pdf', byteLength: 120 }
    }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].authors).toEqual([]);
    expect(parsed[0].categories).toEqual([]);
    expect(parsed[0].lastOpenedAt).toBe(parsed[0].addedAt);
    expect(parsed[0].sourcePdf.kind).toBe('source');
  });
});

describe('mobile translation cache', () => {
  it('replaces one source hash without duplicating entries', () => {
    const first: MobileTranslationEntry = { sourceHash: 'a', page: 1, original: 'A', translation: '甲', translatedAt: '1', model: 'm' };
    const second: MobileTranslationEntry = { ...first, translation: '乙', translatedAt: '2' };
    expect(mergeTranslationEntry([first], second)).toEqual([second]);
  });

  it('does not silently evict old translations after 600 entries', () => {
    const entry = (index: number): MobileTranslationEntry => ({
      sourceHash: `h-${index}`,
      page: 1,
      original: `source-${index}`,
      translation: `translation-${index}`,
      translatedAt: String(index),
      model: 'model-a',
      baseURL: 'https://api.example.test/v1'
    });
    const result = mergeTranslationEntry(Array.from({ length: 600 }, (_, index) => entry(index)), entry(600));
    expect(result).toHaveLength(601);
    expect(result[0].sourceHash).toBe('h-0');
  });

  it('marks cached translations stale when the model or endpoint changes', () => {
    const entry: MobileTranslationEntry = {
      sourceHash: 'a',
      page: 1,
      original: 'A',
      translation: '甲',
      translatedAt: '1',
      model: 'model-a',
      baseURL: 'https://api.example.test/v1'
    };
    expect(isTranslationEntryCurrent(entry, { model: 'model-a', baseURL: 'https://api.example.test/v1/' })).toBe(true);
    expect(isTranslationEntryCurrent(entry, { model: 'model-b', baseURL: 'https://api.example.test/v1' })).toBe(false);
    expect(isTranslationEntryCurrent(entry, { model: 'model-a', baseURL: 'https://other.example.test/v1' })).toBe(false);
  });
});
