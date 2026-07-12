import { describe, expect, it } from 'vitest';
import {
  buildPdfSelectionPopoverPosition,
  normalizePdfSelectionText,
  resolvePdfSelectionTranslationDirection
} from './pdfSelectionTranslation';

describe('pdfSelectionTranslation', () => {
  it('normalizes PDF text-layer whitespace and joins wrapped English words', () => {
    expect(normalizePdfSelectionText('physics-infor-\nmed   reinforcement\u00ad learning')).toBe(
      'physics-informed reinforcement learning'
    );
  });

  it('chooses a useful bilingual direction from the selected text', () => {
    expect(resolvePdfSelectionTranslationDirection('safe reinforcement learning')).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'zh'
    });
    expect(resolvePdfSelectionTranslationDirection('安全强化学习')).toMatchObject({
      sourceLanguage: 'zh',
      targetLanguage: 'en'
    });
  });

  it('keeps the translation popover inside the PDF viewport', () => {
    const shell = { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 };
    expect(
      buildPdfSelectionPopoverPosition(
        { left: 860, top: 610, right: 890, bottom: 630, width: 30, height: 20 },
        shell,
        { width: 320, height: 220 }
      )
    ).toEqual({ left: 468, top: 330 });
  });
});
