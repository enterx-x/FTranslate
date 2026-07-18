import { describe, expect, it } from 'vitest';
import type { MobileTranslationEntry } from './mobileTypes';
import { summarizeMobileExtractionSources } from './mobileExtractionSource';

function entry(
  page: number,
  origin: MobileTranslationEntry['origin'],
  extractionMode?: MobileTranslationEntry['extractionMode'],
  extractionWarning?: string
): MobileTranslationEntry {
  return {
    sourceHash: `${origin}-${page}`,
    page,
    original: 'text',
    translation: '',
    translatedAt: '',
    model: '',
    origin,
    extractionMode,
    extractionWarning
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

  it('distinguishes Safari compatibility reflow from local OCR and keeps the fallback reason', () => {
    const textSummary = summarizeMobileExtractionSources([
      entry(1, 'text', 'compatibility', 'PDF 文字层结构重排异常，已使用兼容重排。'),
      entry(2, 'text', 'structured')
    ], 2);
    const ocrSummary = summarizeMobileExtractionSources([
      entry(1, 'ocr', 'ocr', 'PDF 文字层读取失败：TypeError')
    ], 1);

    expect(textSummary.label).toBe('PDF 文字层 2 页 · 兼容重排 1 页');
    expect(textSummary.detail).toContain('未启动本地 OCR');
    expect(ocrSummary.detail).toContain('TypeError');
  });
});
