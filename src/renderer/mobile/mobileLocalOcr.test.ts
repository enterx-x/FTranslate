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

  it('rejects one-word layout fragmentation and keeps fallback paragraphs intact', () => {
    expect(extractLocalOcrParagraphs(`The policy remains safe under bounded disturbances.

The controller preserves the original paragraph while translating it.`, [
      {
        paragraphs: [
          { text: 'The' },
          { text: 'policy' },
          { text: 'remains' },
          { text: 'safe' },
          { text: 'under' },
          { text: 'bounded' },
          { text: 'disturbances.' },
          { text: 'The' },
          { text: 'controller' },
          { text: 'preserves' },
          { text: 'the' },
          { text: 'original' },
          { text: 'paragraph' },
          { text: 'while' },
          { text: 'translating' },
          { text: 'it.' }
        ]
      }
    ])).toEqual([
      { type: 'paragraph', original: 'The policy remains safe under bounded disturbances.' },
      { type: 'paragraph', original: 'The controller preserves the original paragraph while translating it.' }
    ]);
  });

  it('repairs a word split across adjacent OCR layout fragments', () => {
    expect(extractLocalOcrParagraphs('', [
      {
        paragraphs: [
          { text: 'The inter-' },
          { text: 'action remains stable under bounded disturbances.' }
        ]
      }
    ])).toEqual([
      { type: 'paragraph', original: 'The interaction remains stable under bounded disturbances.' }
    ]);
  });

  it('drops isolated OCR labels, page numbers, and cropped lowercase fragments', () => {
    expect(extractLocalOcrParagraphs(`EE

System enables versatile, contact-rich, and dexterous humanoid manipulation.

4

age manipulation of`, [
      {
        paragraphs: [
          { text: 'EE' },
          { text: 'System enables versatile, contact-rich, and dexterous humanoid manipulation.' },
          { text: '4' },
          { text: 'age manipulation of' }
        ]
      }
    ])).toEqual([
      {
        type: 'paragraph',
        original: 'System enables versatile, contact-rich, and dexterous humanoid manipulation.'
      }
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
    expect(calculateLocalOcrRenderScale(595, 842)).toBeCloseTo(3.1, 1);
    expect(calculateLocalOcrRenderScale(3000, 1500)).toBeCloseTo(0.87, 2);
    expect(calculateLocalOcrRenderScale(400, 400)).toBe(3.4);
  });

  it('uses OCR coordinates to keep two-column reading order and ignore image blocks', () => {
    expect(extractLocalOcrParagraphs('fallback should not win', [
      {
        blocktype: 'FLOWING_TEXT',
        bbox: { x0: 330, y0: 500, x1: 570, y1: 550 },
        paragraphs: [{
          text: 'Right column paragraph remains second.',
          confidence: 92,
          bbox: { x0: 330, y0: 500, x1: 570, y1: 550 },
          lines: [{
            text: 'Right column paragraph remains second.',
            confidence: 92,
            bbox: { x0: 330, y0: 500, x1: 570, y1: 520 }
          }]
        }]
      },
      {
        blocktype: 'FLOWING_IMAGE',
        bbox: { x0: 40, y0: 120, x1: 570, y1: 450 },
        paragraphs: [{ text: 'A D robot label noise', confidence: 80 }]
      },
      {
        blocktype: 'FLOWING_TEXT',
        bbox: { x0: 50, y0: 500, x1: 290, y1: 550 },
        paragraphs: [{
          text: 'Left column paragraph remains first.',
          confidence: 94,
          bbox: { x0: 50, y0: 500, x1: 290, y1: 550 },
          lines: [{
            text: 'Left column paragraph remains first.',
            confidence: 94,
            bbox: { x0: 50, y0: 500, x1: 290, y1: 520 }
          }]
        }]
      }
    ], { page: 2, pageWidth: 612, pageHeight: 792 })).toEqual([
      { type: 'paragraph', original: 'Left column paragraph remains first.' },
      { type: 'paragraph', original: 'Right column paragraph remains second.' }
    ]);
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

  it('continues after a contiguous run of saved OCR pages', () => {
    const cachedBlocks = [1, 2, 3].flatMap((page) => buildLocalOcrBlocks(page, [
      { type: 'paragraph', original: `Recovered page ${page}.` }
    ]).map((item) => item.block));
    expect(resolveLocalOcrResumeState({
      textBlockCount: 0,
      cachedBlocks,
      pageCount: 12,
      legacyLastPage: 3,
      legacyCompleted: false
    })).toEqual({ required: true, startPage: 4 });
  });

  it('recovers from the first missing page instead of trusting a legacy last-page marker', () => {
    const cachedBlocks = buildLocalOcrBlocks(3, [
      { type: 'paragraph', original: 'Only page three survived.' }
    ]).map((item) => item.block);
    expect(resolveLocalOcrResumeState({
      textBlockCount: 0,
      cachedBlocks,
      pageCount: 12,
      legacyLastPage: 3,
      legacyCompleted: false
    })).toEqual({ required: true, startPage: 1 });
  });

  it('uses explicit processed pages so blank OCR pages are not repeated', () => {
    const cachedBlocks = buildLocalOcrBlocks(3, [
      { type: 'paragraph', original: 'Recovered page three.' }
    ]).map((item) => item.block);
    expect(resolveLocalOcrResumeState({
      textBlockCount: 0,
      cachedBlocks,
      processedPages: [1, 2, 3],
      pageCount: 12
    })).toEqual({ required: true, startPage: 4 });
    expect(resolveLocalOcrResumeState({
      textBlockCount: 0,
      cachedBlocks: [],
      processedPages: [1, 2, 3],
      pageCount: 3
    })).toEqual({ required: false, startPage: 3 });
  });
});
