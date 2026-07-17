import { describe, expect, it } from 'vitest';
import {
  createArxivMobilePaper,
  createImportedMobilePaper,
  isMobilePaperSourceEquivalent,
  isTranslationEntryCurrent,
  mergeTranslationEntry,
  MOBILE_LOCAL_OCR_VERSION,
  parseMobileLibrary,
  replaceMobileFigurePageEntries,
  replaceMobileOcrPageEntries,
  normalizeMobilePaperTags,
  sanitizeFileName,
  updateMobilePaper,
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
    expect(paper.localOcrVersion).toBe(MOBILE_LOCAL_OCR_VERSION);
    expect(paper.localOcrStatus).toBe('pending');
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
    const withTranslation = {
      ...original,
      translatedPdf,
      lastPage: 12,
      pageCount: 20,
      visionOcrLastPage: 8,
      visionOcrCompleted: true,
      visionOcrProcessedPages: [1, 2, 8]
    };
    const refreshed = { ...original, title: 'Updated title' };
    const merged = upsertMobilePaper([withTranslation], refreshed)[0];
    expect(merged.translatedPdf).toEqual(translatedPdf);
    expect(merged.lastPage).toBe(12);
    expect(merged.pageCount).toBe(20);
    expect(merged.visionOcrLastPage).toBe(8);
    expect(merged.visionOcrCompleted).toBe(true);
    expect(merged.visionOcrProcessedPages).toEqual([1, 2, 8]);
    expect(isMobilePaperSourceEquivalent(withTranslation, refreshed)).toBe(true);
  });

  it('invalidates progress and translated PDF when the source bytes change under the same paper id', () => {
    const original = createImportedMobilePaper({ id: 'local-1', fileName: 'paper.pdf', storedPdf });
    const translatedPdf = { ...storedPdf, kind: 'translated' as const, path: 'papers/local/translated/paper.pdf' };
    const withTranslation = {
      ...original,
      translatedPdf,
      lastPage: 12,
      pageCount: 20,
      visionOcrLastPage: 8,
      visionOcrCompleted: true,
      visionOcrProcessedPages: [1, 2, 8]
    };
    const refreshed = {
      ...original,
      sourcePdf: { ...storedPdf, contentHash: 'sha256-source-v2' }
    };
    const merged = upsertMobilePaper([withTranslation], refreshed)[0];
    expect(isMobilePaperSourceEquivalent(withTranslation, refreshed)).toBe(false);
    expect(merged.translatedPdf).toBeUndefined();
    expect(merged.lastPage).toBe(1);
    expect(merged.pageCount).toBeUndefined();
    expect(merged.visionOcrLastPage).toBeUndefined();
    expect(merged.visionOcrCompleted).toBe(false);
    expect(merged.visionOcrProcessedPages).toEqual([]);
    expect(merged.localOcrVersion).toBe(MOBILE_LOCAL_OCR_VERSION);
    expect(merged.localOcrStatus).toBe('pending');
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
    expect(parsed[0].tags).toEqual([]);
    expect(parsed[0].lastOpenedAt).toBe(parsed[0].addedAt);
    expect(parsed[0].sourcePdf.kind).toBe('source');
  });

  it('normalizes persisted OCR page coverage', () => {
    const parsed = parseMobileLibrary(JSON.stringify([{
      id: 'ocr-pages',
      title: 'OCR pages',
      lastPage: 1,
      visionOcrProcessedPages: [3, 1, 3, 2.8, 0, -1, '4'],
      sourcePdf: { path: 'papers/ocr/source/paper.pdf', fileName: 'paper.pdf', byteLength: 120 }
    }]));
    expect(parsed[0].visionOcrProcessedPages).toEqual([1, 2, 3, 4]);
  });

  it('stores a custom display title and normalized tags without changing the source title', () => {
    const paper = createImportedMobilePaper({ id: 'local-1', fileName: 'paper.pdf', storedPdf });
    const [updated] = updateMobilePaper([paper], paper.id, {
      customTitle: '  我的安全强化学习论文  ',
      tags: [' 强化学习 ', 'CBF', '强化学习', '', 'A very long tag name that should be truncated']
    });
    expect(updated.title).toBe('paper');
    expect(updated.customTitle).toBe('我的安全强化学习论文');
    expect(updated.tags).toEqual(['强化学习', 'CBF', 'A very long tag name tha']);
    expect(normalizeMobilePaperTags(['RL', 'rl', ' CBF '])).toEqual(['RL', 'CBF']);
  });

  it('preserves custom title and tags when the same arXiv source is saved again', () => {
    const original = {
      ...createImportedMobilePaper({ id: 'local-1', fileName: 'paper.pdf', storedPdf }),
      customTitle: '我的论文',
      tags: ['RL']
    };
    const refreshed = createImportedMobilePaper({ id: 'local-1', fileName: 'paper-updated.pdf', storedPdf });
    const [merged] = upsertMobilePaper([original], refreshed);
    expect(merged.customTitle).toBe('我的论文');
    expect(merged.tags).toEqual(['RL']);
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

  it('does not treat locally OCR-extracted source text as an existing translation', () => {
    const entry: MobileTranslationEntry = {
      sourceHash: 'ocr-a',
      page: 1,
      original: 'Scanned source text',
      translation: '',
      translatedAt: '1',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      origin: 'ocr'
    };
    expect(isTranslationEntryCurrent(entry, { model: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1' })).toBe(false);
  });

  it('replaces every extracted fragment for one page without touching other pages', () => {
    const stalePageOne: MobileTranslationEntry = {
      sourceHash: 'stale-ee',
      page: 1,
      original: 'EE',
      translation: 'EE',
      translatedAt: '1',
      model: 'm',
      origin: 'ocr'
    };
    const pageTwo = { ...stalePageOne, sourceHash: 'page-two', page: 2, original: 'Page two.' };
    const textLayer = { ...stalePageOne, sourceHash: 'text-layer', origin: 'text' as const };
    const figure = { ...stalePageOne, sourceHash: 'figure-one', origin: 'figure' as const };
    const replacement = { ...stalePageOne, sourceHash: 'clean-page-one', original: 'A complete paragraph.', translation: '' };
    expect(replaceMobileOcrPageEntries([stalePageOne, pageTwo, textLayer, figure], 1, [replacement])).toEqual([
      pageTwo,
      figure,
      replacement
    ]);
  });

  it('replaces page figures without deleting text or figures from other pages', () => {
    const text: MobileTranslationEntry = {
      sourceHash: 'text-one',
      page: 1,
      original: 'Paragraph',
      translation: '',
      translatedAt: '1',
      model: '',
      origin: 'text'
    };
    const oldFigure: MobileTranslationEntry = { ...text, sourceHash: 'old-figure', origin: 'figure' };
    const pageTwoFigure: MobileTranslationEntry = { ...oldFigure, sourceHash: 'page-two-figure', page: 2 };
    const replacement: MobileTranslationEntry = { ...oldFigure, sourceHash: 'new-figure' };
    expect(replaceMobileFigurePageEntries([text, oldFigure, pageTwoFigure], 1, [replacement])).toEqual([
      text,
      pageTwoFigure,
      replacement
    ]);
  });
});
