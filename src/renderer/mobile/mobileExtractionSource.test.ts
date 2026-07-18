import { describe, expect, it } from 'vitest';
import type { MobileTranslationEntry } from './mobileTypes';
import { summarizeMobileExtractionSources } from './mobileExtractionSource';

function entry(page: number, origin: MobileTranslationEntry['origin']): MobileTranslationEntry {
  return {
    sourceHash: `${origin}-${page}`,
    page,
    original: 'text',
    translation: '',
    translatedAt: '',
    model: '',
    origin
  };
}

describe('summarizeMobileExtractionSources', () => {
  it('makes text-layer extraction explicit without calling it OCR', () => {
    const summary = summarizeMobileExtractionSources([
      entry(1, 'text'),
      entry(1, 'text'),
      entry(2, 'text')
    ], 2);

    expect(summary.label).toBe('PDF 文字层 2 页');
    expect(summary.detail).toContain('未启动本地 OCR');
  });

  it('reports mixed text-layer and local-OCR pages separately', () => {
    const summary = summarizeMobileExtractionSources([
      entry(1, 'text'),
      entry(2, 'ocr'),
      entry(2, 'ocr'),
      entry(3, 'vision')
    ], 3);

    expect(summary.label).toBe('文字层 1 页 · OCR 2 页');
    expect(summary.detail).toContain('另有 2 页');
  });
});
