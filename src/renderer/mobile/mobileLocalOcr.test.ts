import { describe, expect, it } from 'vitest';
import {
  buildCachedLocalOcrBlocks,
  buildCompatiblePdfTextBlocks,
  buildEmbeddedPdfTextResult,
  buildLocalOcrBlocks,
  calculateLocalOcrRenderScale,
  collectMobilePdfTextStreamItems,
  collectMobilePdfTextItems,
  excludeFigureRegionBlocks,
  excludeFigureRegionTextItems,
  extractLocalOcrParagraphs,
  MOBILE_OCR_FAST_LONG_EDGE,
  MOBILE_OCR_PRECISE_LONG_EDGE,
  needsPreciseLocalOcrRetry,
  selectBestLocalOcrCandidate,
  stitchMobileCrossPageParagraphs,
  runWhileMobileOcrJobActive,
  resolveLocalOcrResumeState,
  settleMobileTaskWithin,
  withMobileTaskTimeout
} from './mobileLocalOcr';
import type { MobileTranslationEntry } from './mobileTypes';

describe('mobile scanned PDF local OCR', () => {
  it('stitches lowercase paragraph continuations across adjacent PDF pages', () => {
    const entry = (
      sourceHash: string,
      page: number,
      order: number,
      original: string,
      blockType: MobileTranslationEntry['blockType'] = 'paragraph'
    ): MobileTranslationEntry => ({
      sourceHash,
      page,
      original,
      translation: '',
      translatedAt: '2026-07-28T00:00:00.000Z',
      model: '',
      origin: 'text',
      extractionMode: 'structured',
      order,
      blockType
    });
    const figure: MobileTranslationEntry = {
      ...entry('figure', 1, 1000.5, 'Figure 1: Overview.', 'caption'),
      origin: 'figure',
      figureVersion: 1,
      figureKind: 'figure'
    };

    const stitched = stitchMobileCrossPageParagraphs([
      entry('page-1', 1, 1000, 'The latent queries infer future-'),
      figure,
      entry('page-2-first', 2, 2000, 'aware representations from the current observation.'),
      entry('page-2-second', 2, 2001, 'A new paragraph starts here.')
    ]);

    expect(stitched).toEqual(expect.arrayContaining([
      expect.objectContaining({
        page: 1,
        original: 'The latent queries infer future-aware representations from the current observation.',
        blockType: 'paragraph'
      }),
      figure,
      expect.objectContaining({ sourceHash: 'page-2-second' })
    ]));
    expect(stitched.some((candidate) => candidate.sourceHash === 'page-2-first')).toBe(false);
    expect(stitched).toHaveLength(3);
  });

  it('does not stitch page-one contributor notes or formulas into the next page', () => {
    const entries: MobileTranslationEntry[] = [
      {
        sourceHash: 'note',
        page: 1,
        original: '∗ Core contributors',
        translation: '',
        translatedAt: '2026-07-28T00:00:00.000Z',
        model: '',
        origin: 'text',
        order: 1000,
        blockType: 'paragraph'
      },
      {
        sourceHash: 'body',
        page: 2,
        original: 'commands are produced by the policy.',
        translation: '',
        translatedAt: '2026-07-28T00:00:00.000Z',
        model: '',
        origin: 'text',
        order: 2000,
        blockType: 'paragraph'
      },
      {
        sourceHash: 'formula',
        page: 3,
        original: 'L(θ) = ∥a − a∗∥₁',
        translation: '',
        translatedAt: '2026-07-28T00:00:00.000Z',
        model: '',
        origin: 'text',
        order: 3000,
        blockType: 'formula'
      },
      {
        sourceHash: 'definition',
        page: 4,
        original: 'where a∗ denotes the expert action.',
        translation: '',
        translatedAt: '2026-07-28T00:00:00.000Z',
        model: '',
        origin: 'text',
        order: 4000,
        blockType: 'paragraph'
      }
    ];

    expect(stitchMobileCrossPageParagraphs(entries)).toEqual(entries);
  });

  it('does not stitch a lowercase lettered subsection into the preceding page', () => {
    const entries: MobileTranslationEntry[] = [
      {
        sourceHash: 'previous',
        page: 14,
        original: 'No proprioceptive inputs are used for either data source.',
        translation: '',
        translatedAt: '2026-07-28T00:00:00.000Z',
        model: '',
        origin: 'text',
        order: 14000,
        blockType: 'paragraph'
      },
      {
        sourceHash: 'subsection',
        page: 15,
        original: 'b) Robot Platform: The camera captures egocentric RGB images.',
        translation: '',
        translatedAt: '2026-07-28T00:00:00.000Z',
        model: '',
        origin: 'text',
        order: 15000,
        blockType: 'paragraph'
      }
    ];

    expect(stitchMobileCrossPageParagraphs(entries)).toEqual(entries);
  });

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

  it('removes bibliography back-reference page links without changing the publication year', () => {
    const reference = '[35] Guangrun Li et al. H2r: A human-to-robot policy. arXiv preprint, 2025. 2, 3, 4, 13';
    const result = buildEmbeddedPdfTextResult(
      [{ str: reference, x: 55, y: 120, width: 500, height: 10, page: 10, pageWidth: 612, pageHeight: 792 }],
      10,
      true,
      [{ str: reference, hasEOL: true }],
      () => [{
        id: 'reference',
        section: 'References',
        original: reference,
        translation: '',
        type: 'paragraph',
        page: 10,
        sourceHash: 'reference'
      }]
    );

    expect(result.blocks[0].block.original).toBe(
      '[35] Guangrun Li et al. H2r: A human-to-robot policy. arXiv preprint, 2025.'
    );
  });

  it('removes embedded LaTeXiT payloads while preserving the visible formula text', () => {
    const rawItems = [{
      str: 'Extension <latexit sha1_base64="abc123">AAABase64Payload==</latexit> v, t | m alignment',
      transform: [1, 0, 0, 1, 42, 710],
      width: 180,
      height: 12,
      hasEOL: true
    }];

    const result = collectMobilePdfTextItems(rawItems, {
      width: 612,
      height: 792,
      convertToViewportPoint: (x, y) => [x, 792 - y]
    }, 1);

    expect(result.runs.map((run) => run.str)).toEqual(['v, t | m alignment']);
    expect(result.items.map((entry) => entry.str)).toEqual(['v, t | m alignment']);
    expect(result.runs[0].str).not.toContain('latexit');
    expect(result.runs[0].str).not.toContain('AAABase64Payload');
  });

  it('removes a LaTeXiT payload that PDF.js splits across positioned text items', () => {
    const items = [
      { str: 'Extension v, t', x: 42, y: 82, width: 60, height: 12, page: 1, pageWidth: 612, pageHeight: 792 },
      { str: '<latexit sha1_base64="abc123">', x: 104, y: 82, width: 60, height: 12, page: 1, pageWidth: 612, pageHeight: 792 },
      { str: 'AAABase64Payload==</latexit>', x: 166, y: 82, width: 80, height: 12, page: 1, pageWidth: 612, pageHeight: 792 },
      { str: '| m alignment', x: 248, y: 82, width: 70, height: 12, page: 1, pageWidth: 612, pageHeight: 792 }
    ];
    const result = buildEmbeddedPdfTextResult(items, 1, true);

    expect(result.blocks.map(({ block }) => block.original).join(' ')).toContain('Extension v, t | m alignment');
    expect(result.blocks.map(({ block }) => block.original).join(' ')).not.toContain('latexit');
    expect(result.blocks.map(({ block }) => block.original).join(' ')).not.toContain('AAABase64Payload');
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

  it('rejects structured reflow that silently drops substantial text from any reader block type', () => {
    const runs = [
      { str: 'Safe Policy Optimization with Control Barrier Functions', hasEOL: true },
      { str: 'The policy update preserves forward invariance under bounded disturbances.', hasEOL: true },
      { str: 'Fig. 1: Constraint satisfaction remains stable across all evaluated variants.', hasEOL: true },
      { str: 'The controller reduces violations while preserving task performance.', hasEOL: true }
    ];
    const items = runs.map((run, index) => ({
      str: run.str,
      x: 52,
      y: 60 + index * 26,
      width: 480,
      height: index === 0 ? 18 : 10,
      page: 1,
      pageWidth: 612,
      pageHeight: 792
    }));
    const result = buildEmbeddedPdfTextResult(items, 1, false, runs, () => [{
      id: 'incomplete-heading',
      section: runs[0].str,
      original: runs[0].str,
      translation: '',
      type: 'heading',
      page: 1,
      sourceHash: 'incomplete-heading'
    }]);

    expect(result.mode).toBe('compatibility');
    expect(result.warning).toContain('文字完整度不足');
    expect(result.blocks.map((entry) => entry.block.original).join(' ')).toContain(runs[3].str);
  });

  it('rejects a formula reflow that keeps variables but drops mathematical operators', () => {
    const runs = [{ str: 'D = A + F + S', hasEOL: true }];
    const items = [{
      str: runs[0].str,
      x: 160,
      y: 200,
      width: 180,
      height: 14,
      page: 1,
      pageWidth: 612,
      pageHeight: 792
    }];
    const result = buildEmbeddedPdfTextResult(items, 1, true, runs, () => [{
      id: 'incomplete-formula',
      section: 'D A F S',
      original: 'D A F S',
      translation: '',
      type: 'formula',
      page: 1,
      sourceHash: 'incomplete-formula'
    }]);

    expect(result.mode).toBe('compatibility');
    expect(result.warning).toContain('文字完整度不足');
    expect(result.blocks.map((entry) => entry.block.original).join(' ')).toContain('D = A + F + S');
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

  it('removes a raw caption marker when the recovered table renders that caption itself', () => {
    const items = [
      { str: 'Method', x: 330, y: 100, width: 50, height: 10, page: 10 },
      { str: 'Table 2:', x: 330, y: 176, width: 48, height: 10, page: 10 },
      { str: 'Quantitative performance.', x: 384, y: 176, width: 150, height: 10, page: 10 },
      { str: 'The left-column paragraph remains readable.', x: 54, y: 176, width: 210, height: 10, page: 10 }
    ];
    const filtered = excludeFigureRegionTextItems(items, [{
      id: 'table-2',
      page: 10,
      kind: 'table',
      caption: 'Table 2: Quantitative performance.',
      captionHash: 'caption-2',
      hasTextCaption: false,
      order: 9000.25,
      bounds: { x: 322, y: 92, width: 224, height: 76, pageWidth: 612, pageHeight: 792 },
      captionBounds: { x: 330, y: 176, width: 204, height: 10, pageWidth: 612, pageHeight: 792 },
      hiddenTextHashes: []
    }]);

    expect(filtered.map((entry) => entry.str)).toEqual([
      'The left-column paragraph remains readable.'
    ]);
  });

  it('keeps prose connected to a figure edge while removing labels inside the figure', () => {
    const items = [
      { str: 'Task', x: 108, y: 123, width: 20, height: 10, page: 10, pageWidth: 612, pageHeight: 792 },
      { str: 'and', x: 136, y: 123, width: 16, height: 10, page: 10, pageWidth: 612, pageHeight: 792 },
      { str: 'data.', x: 160, y: 123, width: 22, height: 10, page: 10, pageWidth: 612, pageHeight: 792 },
      { str: 'The hu-', x: 200, y: 123, width: 37, height: 10, page: 10, pageWidth: 612, pageHeight: 792 },
      { str: 'The humanoid performs a long-horizon', x: 108, y: 135, width: 129, height: 10, page: 10, pageWidth: 612, pageHeight: 792 },
      { str: 'OpenHLM', x: 330, y: 180, width: 60, height: 12, page: 10, pageWidth: 612, pageHeight: 792 },
      { str: 'Figure 8: Long-horizon task.', x: 277, y: 339, width: 197, height: 10, page: 10, pageWidth: 612, pageHeight: 792 }
    ];
    const filtered = excludeFigureRegionTextItems(items, [{
      id: 'figure-8',
      page: 10,
      kind: 'figure',
      caption: 'Figure 8: Long-horizon task.',
      captionHash: 'caption-8',
      hasTextCaption: true,
      order: 7999.75,
      bounds: { x: 139, y: 122, width: 369, height: 211, pageWidth: 612, pageHeight: 792 },
      captionBounds: { x: 277, y: 339, width: 197, height: 10, pageWidth: 612, pageHeight: 792 },
      hiddenTextHashes: []
    }]);

    expect(filtered.map((entry) => entry.str)).toEqual([
      'Task',
      'and',
      'data.',
      'The hu-',
      'The humanoid performs a long-horizon',
      'Figure 8: Long-horizon task.'
    ]);
  });

  it('does not preserve short diagram labels merely because they touch a figure edge', () => {
    const items = [
      { str: 'and conditioned on language and high-level task descriptors', x: 54, y: 86, width: 246, height: 10, page: 3, pageWidth: 612, pageHeight: 792 },
      { str: 'Object Adapter', x: 313, y: 86, width: 72, height: 10, page: 3, pageWidth: 612, pageHeight: 792 },
      { str: 'Privilege Adapter', x: 492, y: 86, width: 82, height: 10, page: 3, pageWidth: 612, pageHeight: 792 },
      { str: 'Dynamics-aware World Model', x: 350, y: 112, width: 150, height: 10, page: 3, pageWidth: 612, pageHeight: 792 },
      { str: 'demonstrated by WMP and extended to active interaction.', x: 312, y: 145, width: 250, height: 10, page: 3, pageWidth: 612, pageHeight: 792 }
    ];
    const filtered = excludeFigureRegionTextItems(items, [{
      id: 'figure-3',
      page: 3,
      kind: 'figure',
      caption: 'Fig. 3: Dynamics-aware world model.',
      captionHash: 'caption-3',
      hasTextCaption: true,
      order: 2999.75,
      bounds: { x: 312, y: 48, width: 254, height: 80, pageWidth: 612, pageHeight: 792 },
      captionBounds: { x: 312, y: 130, width: 254, height: 12, pageWidth: 612, pageHeight: 792 },
      hiddenTextHashes: []
    }]);

    expect(filtered.map((entry) => entry.str)).toEqual([
      'and conditioned on language and high-level task descriptors',
      'demonstrated by WMP and extended to active interaction.'
    ]);
  });

  it('removes any reconstructed block fully contained by a figure while keeping its caption and surrounding prose', () => {
    const makeBlock = (
      original: string,
      type: 'paragraph' | 'caption',
      x: number,
      y: number,
      width: number,
      height: number
    ) => ({
      block: {
        id: original,
        section: 'Page 1',
        original,
        translation: '',
        type,
        page: 1,
        sourceHash: original,
        bounds: { x, y, width, height, pageWidth: 612, pageHeight: 792 }
      },
      order: y
    });
    const blocks = [
      makeBlock('The surrounding paragraph remains readable.', 'paragraph', 55, 140, 502, 12),
      makeBlock('Hand-Over & Place', 'paragraph', 92, 579, 63, 8),
      makeBlock('Figure 1: Cross-embodiment tasks.', 'caption', 71, 610, 467, 20)
    ];
    const filtered = excludeFigureRegionBlocks(blocks, [{
      id: 'figure-1',
      page: 1,
      kind: 'figure',
      caption: 'Figure 1: Cross-embodiment tasks.',
      captionHash: 'caption-1',
      hasTextCaption: true,
      order: 609.75,
      bounds: { x: 46, y: 160, width: 520, height: 433, pageWidth: 612, pageHeight: 792 },
      captionBounds: { x: 71, y: 610, width: 467, height: 20, pageWidth: 612, pageHeight: 792 },
      hiddenTextHashes: []
    }]);

    expect(filtered.map(({ block }) => block.original)).toEqual([
      'The surrounding paragraph remains readable.',
      'Figure 1: Cross-embodiment tasks.'
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
