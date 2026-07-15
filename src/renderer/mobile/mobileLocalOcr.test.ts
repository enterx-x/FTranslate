import { describe, expect, it } from 'vitest';
import {
  buildCachedLocalOcrBlocks,
  buildLocalOcrBlocks,
  calculateLocalOcrRenderScale,
  extractLocalOcrParagraphs,
  resolveLocalOcrResumeState
} from './mobileLocalOcr';

describe('mobile scanned PDF local OCR', () => {
  it('reflows OCR lines, repairs line-end hyphenation, and classifies headings', () => {
    expect(extractLocalOcrParagraphs(`SAFE REINFORCEMENT LEARNING

The policy remains safe under boun-\nded disturbances.`)).toEqual([
      { type: 'heading', original: 'SAFE REINFORCEMENT LEARNING' },
      { type: 'paragraph', original: 'The policy remains safe under bounded disturbances.' }
    ]);
  });

  it('prefers layout paragraphs and recognizes captions', () => {
    expect(extractLocalOcrParagraphs('ignored fallback', [
      { paragraphs: [{ text: 'Methods' }, { text: 'Figure 2. Safety rate.' }] }
    ])).toEqual([
      { type: 'heading', original: 'Methods' },
      { type: 'caption', original: 'Figure 2. Safety rate.' }
    ]);
  });

  it('builds stable ordered OCR blocks without pretending they are translated', () => {
    const blocks = buildLocalOcrBlocks(2, [
      { type: 'heading', original: 'Methods' },
      { type: 'paragraph', original: 'We train the policy.' }
    ]);
    expect(blocks.map((item) => item.order)).toEqual([1000, 1001]);
    expect(blocks[0].block.page).toBe(2);
    expect(blocks[0].block.translation).toBe('');
    expect(blocks[0].block.sourceHash).not.toBe(blocks[1].block.sourceHash);
  });

  it('restores new local OCR and legacy vision OCR records in reading order', () => {
    const restored = buildCachedLocalOcrBlocks([
      {
        sourceHash: 'second',
        page: 1,
        original: 'Body',
        translation: '正文',
        translatedAt: '2026-07-15T00:00:00.000Z',
        model: 'deepseek-chat',
        origin: 'ocr',
        order: 1,
        blockType: 'paragraph'
      },
      {
        sourceHash: 'first',
        page: 1,
        original: 'Title',
        translation: '标题',
        translatedAt: '2026-07-15T00:00:00.000Z',
        model: 'legacy-vision-model',
        origin: 'vision',
        order: 0,
        blockType: 'heading'
      }
    ]);
    expect(restored.map((block) => block.original)).toEqual(['Title', 'Body']);
    expect(restored[0].type).toBe('heading');
  });

  it('caps local OCR page rendering for iPhone memory use', () => {
    expect(calculateLocalOcrRenderScale(595, 842)).toBeCloseTo(2.1, 1);
    expect(calculateLocalOcrRenderScale(3000, 1500)).toBe(0.6);
    expect(calculateLocalOcrRenderScale(400, 400)).toBe(2.4);
  });

  it('ignores an old completed flag when no OCR paragraphs were actually saved', () => {
    expect(resolveLocalOcrResumeState({
      textBlockCount: 0,
      cachedBlocks: [],
      pageCount: 12,
      legacyLastPage: 12,
      legacyCompleted: true
    })).toEqual({ required: true, startPage: 1 });
  });

  it('continues after the last saved OCR page only when recoverable paragraphs exist', () => {
    const cachedBlocks = buildLocalOcrBlocks(3, [
      { type: 'paragraph', original: 'Recovered page three.' }
    ]).map((item) => item.block);
    expect(resolveLocalOcrResumeState({
      textBlockCount: 0,
      cachedBlocks,
      pageCount: 12,
      legacyLastPage: 3,
      legacyCompleted: false
    })).toEqual({ required: true, startPage: 4 });
  });
});
