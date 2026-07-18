import { describe, expect, it } from 'vitest';
import {
  buildCachedLocalOcrBlocks,
  buildCompatiblePdfTextBlocks,
  buildEmbeddedPdfTextResult,
  buildLocalOcrBlocks,
  calculateLocalOcrRenderScale,
  collectMobilePdfTextStreamItems,
  collectMobilePdfTextItems,
  excludeFigureRegionTextItems,
  extractLocalOcrParagraphs,
  MOBILE_OCR_FAST_LONG_EDGE,
  MOBILE_OCR_PRECISE_LONG_EDGE,
  needsPreciseLocalOcrRetry,
  selectBestLocalOcrCandidate,
  runWhileMobileOcrJobActive,
  resolveLocalOcrResumeState,
  settleMobileTaskWithin,
  withMobileTaskTimeout
} from './mobileLocalOcr';

describe('mobile scanned PDF local OCR', () => {
  it('reads PDF.js text chunks through getReader without requiring ReadableStream async iteration', async () => {
    let readIndex = 0;
    const chunks = [
      {
        items: {
          0: { str: 'Humanoid robots promise general-purpose assistance.' },
          length: 1
        }
      },
      {
        items: {
          0: { str: 'We first develop an RL-based lower-body controller.' },
          1: { str: 'The original PDF text layer must be preserved.' },
          length: 2
        }
      }
    ];
    let released = false;
    const stream = {
      getReader: () => ({
        read: async () => readIndex < chunks.length
          ? { done: false, value: chunks[readIndex++] }
          : { done: true },
        releaseLock: () => {
          released = true;
        }
      })
    };

    const items = await collectMobilePdfTextStreamItems(stream);

    expect(items.map((item) => (item as { str: string }).str)).toEqual([
      'Humanoid robots promise general-purpose assistance.',
      'We first develop an RL-based lower-body controller.',
      'The original PDF text layer must be preserved.'
    ]);
    expect(released).toBe(true);
  });

  it('reads Safari-style array-like PDF text items without requiring flatMap or string.trim', () => {
    const stringLike = { toString: () => 'Humanoid robots remain stable.' };
    const arrayLikeItems = {
      0: {
        str: stringLike,
        transform: { 0: 1, 1: 0, 2: 0, 3: 1, 4: 42, 5: 710, length: 6 },
        width: '180',
        height: 12,
        hasEOL: true
      },
      1: {
        str: 'This item keeps its text even when coordinates are malformed.',
        transform: { length: 0 },
        hasEOL: true
      },
      length: 2
    };

    const result = collectMobilePdfTextItems(arrayLikeItems, {
      width: 612,
      height: 792,
      convertToViewportPoint: (x, y) => [x, 792 - y]
    }, 1);

    expect(result.runs.map((run) => run.str)).toEqual([
      'Humanoid robots remain stable.',
      'This item keeps its text even when coordinates are malformed.'
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ str: 'Humanoid robots remain stable.', x: 42, y: 82 });
  });

  it('keeps readable PDF text through compatibility reflow when structured reflow throws', () => {
    const runs = [
      { str: 'ABSTRACT', hasEOL: true },
      { str: 'Humanoid robots promise general-purpose assistance, yet real-world manipulation remains challenging.', hasEOL: true },
      { str: 'We develop an RL-based lower-body controller that preserves stability during complex manipulation.', hasEOL: true }
    ];
    const items = runs.map((run, index) => ({
      str: run.str,
      x: 40,
      y: 80 + index * 16,
      width: 500,
      height: 12,
      page: 1,
      pageWidth: 612,
      pageHeight: 792
    }));

    const result = buildEmbeddedPdfTextResult(items, 1, false, runs, () => {
      throw new TypeError('Safari text item is not iterable');
    });

    expect(result.mode).toBe('compatibility');
    expect(result.blocks.map((item) => item.block.original).join(' ')).toContain('Humanoid robots promise');
    expect(result.warning).toContain('兼容重排');
  });

  it('joins line-end hyphenation in compatibility text without fragmenting the paragraph', () => {
    const blocks = buildCompatiblePdfTextBlocks(2, [
      { str: 'The contact-aware inter-', hasEOL: true },
      { str: 'action policy remains stable under bounded disturbances.', hasEOL: true },
      { str: 'It preserves the original paragraph for continuous reading.', hasEOL: true }
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].block.original).toBe(
      'The contact-aware interaction policy remains stable under bounded disturbances. It preserves the original paragraph for continuous reading.'
    );
  });

  it('removes text painted inside a detected figure or table before paragraph reflow', () => {
    const items = [
      { str: 'TABLE I: Results', x: 50, y: 90, width: 180, height: 10, page: 3 },
      { str: 'Mobile ✓ ✗ ✗', x: 60, y: 125, width: 120, height: 10, page: 3 },
      { str: 'Table I highlights a remaining gap in prior systems.', x: 50, y: 245, width: 250, height: 10, page: 3 }
    ];
    const filtered = excludeFigureRegionTextItems(items, [{
      id: 'table-1',
      page: 3,
      kind: 'table',
      caption: 'TABLE I: Results',
      captionHash: 'caption-1',
      hasTextCaption: true,
      order: 2000.25,
      bounds: { x: 40, y: 80, width: 520, height: 130, pageWidth: 612, pageHeight: 792 },
      captionBounds: { x: 48, y: 86, width: 190, height: 18, pageWidth: 612, pageHeight: 792 },
      hiddenTextHashes: []
    }]);

    expect(filtered.map((entry) => entry.str)).toEqual([
      'TABLE I: Results',
      'Table I highlights a remaining gap in prior systems.'
    ]);
  });

  it('does not let the final page or PDF worker cleanup remain pending forever', async () => {
    const never = new Promise<void>(() => undefined);

    await expect(withMobileTaskTimeout(never, 5, '第 14 页处理超时')).rejects.toThrow('第 14 页处理超时');
    await expect(settleMobileTaskWithin(never, 5)).resolves.toBe(false);
    await expect(settleMobileTaskWithin(Promise.resolve(), 50)).resolves.toBe(true);
  });

  it('does not continue a late page-save callback after its OCR job was cancelled', async () => {
    let active = true;
    let releaseWrite: (() => void) | undefined;
    const write = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const step = runWhileMobileOcrJobActive(() => active, () => write);
    active = false;
    releaseWrite?.();

    await expect(step).resolves.toBe(false);
    await expect(runWhileMobileOcrJobActive(() => false, () => Promise.resolve())).resolves.toBe(false);
  });

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

  it('uses a smaller fast pass and only retries weak OCR pages at the precise size', () => {
    expect(MOBILE_OCR_FAST_LONG_EDGE).toBeLessThan(MOBILE_OCR_PRECISE_LONG_EDGE);
    expect(calculateLocalOcrRenderScale(595, 842, MOBILE_OCR_FAST_LONG_EDGE)).toBeCloseTo(2.49, 2);
    expect(calculateLocalOcrRenderScale(595, 842, MOBILE_OCR_PRECISE_LONG_EDGE)).toBeCloseTo(3.09, 2);

    expect(needsPreciseLocalOcrRetry({
      text: 'The controller remains stable under bounded disturbances and preserves safe operation.',
      confidence: 91,
      paragraphs: [{ type: 'paragraph', original: 'The controller remains stable under bounded disturbances and preserves safe operation.' }]
    })).toBe(false);
    expect(needsPreciseLocalOcrRetry({
      text: 'The controller remains stable under bounded disturbances.',
      confidence: 61,
      paragraphs: [{ type: 'paragraph', original: 'The controller remains stable under bounded disturbances.' }]
    })).toBe(true);
    expect(needsPreciseLocalOcrRetry({
      text: 'EE 4 age manipulation of',
      confidence: 88,
      paragraphs: []
    })).toBe(true);
  });

  it('does not let an empty or weaker precise retry overwrite a usable fast result', () => {
    const fast = {
      text: 'A complete fast-pass paragraph remains readable and should survive a failed retry.',
      confidence: 74,
      paragraphs: [{
        type: 'paragraph' as const,
        original: 'A complete fast-pass paragraph remains readable and should survive a failed retry.'
      }]
    };
    const emptyPrecise = { text: '', confidence: 0, paragraphs: [] };
    const betterPrecise = {
      text: 'A complete precise paragraph remains readable and restores additional scientific details safely.',
      confidence: 91,
      paragraphs: [{
        type: 'paragraph' as const,
        original: 'A complete precise paragraph remains readable and restores additional scientific details safely.'
      }]
    };

    expect(selectBestLocalOcrCandidate(fast, emptyPrecise)).toBe(fast);
    expect(selectBestLocalOcrCandidate(fast, betterPrecise)).toBe(betterPrecise);
  });

  it('does not prefer a higher-confidence precise retry that truncated most of the page', () => {
    const fast = {
      text: 'The controller remains stable under bounded disturbances and preserves safe operation across every evaluated task.',
      confidence: 63,
      paragraphs: [{
        type: 'paragraph' as const,
        original: 'The controller remains stable under bounded disturbances and preserves safe operation across every evaluated task.'
      }]
    };
    const truncatedPrecise = {
      text: 'Safe operation.',
      confidence: 98,
      paragraphs: [{ type: 'paragraph' as const, original: 'Safe operation.' }]
    };

    expect(selectBestLocalOcrCandidate(fast, truncatedPrecise)).toBe(fast);
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
