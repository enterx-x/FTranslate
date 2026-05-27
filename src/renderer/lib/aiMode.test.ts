import { describe, expect, it } from 'vitest';
import {
  buildAiCacheDocument,
  countPendingAiTranslations,
  getDefaultAiCacheFileName,
  getAiQueueStats,
  getTranslatableExtractedBlocks,
  getCurrentAiCacheItem,
  cloneJsonDocumentForAi,
  updateAiCacheItem
} from './aiMode';
import type { ExtractedPdfBlock } from './pdfTextStructure';
import type { TranslationDocument } from './translation';

const extractedBlock: ExtractedPdfBlock = {
  id: 'pdf-1-a',
  section: 'Abstract',
  original: 'Foundation models emerge from large datasets.',
  translation: '',
  type: 'paragraph',
  page: 1,
  sourceHash: 'hash-a'
};

describe('AI mode helpers', () => {
  it('creates a JSON cache document from extracted PDF blocks', () => {
    const document = buildAiCacheDocument([extractedBlock], 'paper.pdf');

    expect(document.kind).toBe('json');
    expect(document.sourceName).toBe('paper-ai-cache.json');
    expect(document.items[0]).toMatchObject({
      section: 'Abstract',
      original: extractedBlock.original,
      type: 'paragraph',
      page: 1,
      sourceHash: 'hash-a'
    });
  });

  it('keeps only translatable natural paragraphs in the AI cache document', () => {
    const noisyBlocks: ExtractedPdfBlock[] = [
      extractedBlock,
      { ...extractedBlock, id: 'heading', type: 'heading', sourceHash: 'heading' },
      { ...extractedBlock, id: 'formula', type: 'formula', sourceHash: 'formula', original: 'x_t = f(x, u)' },
      { ...extractedBlock, id: 'caption', type: 'caption', sourceHash: 'caption', original: 'Fig. 2: Overview.' },
      { ...extractedBlock, id: 'noise', sourceHash: 'noise', original: 'p4□□□ R□□t □□□□' }
    ];

    expect(getTranslatableExtractedBlocks(noisyBlocks)).toEqual([extractedBlock]);
    expect(buildAiCacheDocument(noisyBlocks, 'paper.pdf').items).toEqual([extractedBlock]);
  });

  it('preserves cached translations by source hash when rebuilding from PDF extraction', () => {
    const existing: TranslationDocument = {
      kind: 'json',
      sourceName: 'paper-ai-cache.json',
      sourcePath: 'D:/paper-ai-cache.json',
      items: [
        {
          section: 'Abstract',
          original: extractedBlock.original,
          translation: '基础模型来自大规模数据集。',
          sourceHash: 'hash-a',
          provider: 'deepseek',
          model: 'deepseek-chat'
        }
      ]
    };

    const document = buildAiCacheDocument([extractedBlock], 'paper.pdf', existing);

    expect(document.sourcePath).toBe('D:/paper-ai-cache.json');
    expect(document.items[0].translation).toBe('基础模型来自大规模数据集。');
    expect(document.items[0].provider).toBe('deepseek');
  });

  it('counts only untranslated paragraph and heading items as pending', () => {
    expect(
      countPendingAiTranslations([
        extractedBlock,
        { ...extractedBlock, id: 'caption', type: 'caption', sourceHash: 'caption', translation: '' },
        { ...extractedBlock, id: 'done', sourceHash: 'done', translation: '已翻译' }
      ])
    ).toBe(1);
  });

  it('summarizes AI queue totals, cached items, and pending items', () => {
    expect(
      getAiQueueStats([
        extractedBlock,
        { ...extractedBlock, id: 'done', sourceHash: 'done', translation: 'cached translation' },
        { ...extractedBlock, id: 'skip', type: 'caption', sourceHash: 'skip', translation: '' }
      ])
    ).toEqual({
      total: 3,
      cached: 1,
      pending: 1,
      skipped: 1
    });
  });

  it('builds a stable default cache file name', () => {
    expect(getDefaultAiCacheFileName('2604.15483v2.pdf')).toBe('2604.15483v2-ai-cache.json');
    expect(getDefaultAiCacheFileName()).toBe('ai-translation-cache.json');
  });

  it('keeps AI cache updates isolated from the manual translation document', () => {
    const manualDocument: TranslationDocument = {
      kind: 'json',
      sourceName: 'manual.json',
      sourcePath: 'D:/manual.json',
      items: [
        {
          section: 'Abstract',
          original: extractedBlock.original,
          translation: 'manual translation',
          sourceHash: 'hash-a'
        }
      ]
    };

    const aiCache = cloneJsonDocumentForAi(manualDocument);
    const updatedAiCache = updateAiCacheItem(aiCache, 0, {
      translation: 'AI translation',
      translatedAt: '2026-05-27T00:00:00.000Z',
      provider: 'kimi',
      model: 'kimi-k2.5'
    });

    expect(updatedAiCache?.items[0].translation).toBe('AI translation');
    expect(manualDocument.items[0].translation).toBe('manual translation');
    expect(updatedAiCache?.items[0]).not.toBe(manualDocument.items[0]);
  });

  it('returns the current AI cache item with its translated text for detail display', () => {
    const document: TranslationDocument = {
      kind: 'json',
      sourceName: 'paper-ai-cache.json',
      items: [
        {
          section: 'Abstract',
          original: extractedBlock.original,
          translation: '基础模型来自大规模数据集。',
          sourceHash: 'hash-a',
          provider: 'kimi',
          model: 'kimi-k2.6'
        }
      ]
    };

    expect(getCurrentAiCacheItem(document, 0)?.translation).toBe('基础模型来自大规模数据集。');
    expect(getCurrentAiCacheItem(document, 1)).toBeNull();
    expect(getCurrentAiCacheItem(null, 0)).toBeNull();
  });
});
