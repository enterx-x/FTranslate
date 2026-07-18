import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ExtractedPdfBlock, PositionedPdfTextItem } from '../lib/pdfTextStructure';
import {
  buildMobilePdfCaptionLookupKeys,
  buildPdfCaptionAnchors,
  createMobileFigureEntry,
  createMobilePdfFigureRenderer,
  detectPdfFigureRegions,
  resolveMobilePdfFigureOrder,
  type MobilePdfFigureRegion,
  type PdfPaintedImageBounds
} from './mobilePdfFigures';

describe('resolveMobilePdfFigureOrder', () => {
  it('rebases a stale cached figure order directly before its current caption', () => {
    expect(resolveMobilePdfFigureOrder({
      kind: 'figure',
      hasTextCaption: true,
      captionHash: 'caption-1',
      order: 7.75
    }, new Map([['caption-1', 4]]))).toBe(3.75);
  });

  it('places a table after its caption and falls back when no caption block survives', () => {
    expect(resolveMobilePdfFigureOrder({
      kind: 'table',
      hasTextCaption: true,
      captionHash: 'table-i',
      order: 2.25
    }, new Map([['table-i', 9]]))).toBe(9.25);
    expect(resolveMobilePdfFigureOrder({
      kind: 'figure',
      hasTextCaption: true,
      captionHash: 'missing',
      order: 5.75
    }, new Map())).toBe(5.75);
  });

  it('keeps a figure beside its caption after AI reflow changes the caption hash', () => {
    const captionTextOrders = new Map(
      buildMobilePdfCaptionLookupKeys('Fig. 2. Quantitative contact results after AI correction.')
        .map((key) => [key, 2010] as const)
    );
    expect(resolveMobilePdfFigureOrder({
      kind: 'figure',
      hasTextCaption: true,
      captionHash: 'old-caption-hash',
      order: 2001
    }, new Map(), captionTextOrders, 'Fig. 2: Contact results.')).toBe(2009.75);
  });
});

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
});

function block(
  sourceHash: string,
  original: string,
  type: ExtractedPdfBlock['type'],
  x: number,
  y: number,
  width: number,
  height: number
): ExtractedPdfBlock {
  return {
    id: sourceHash,
    section: 'Page 9',
    original,
    translation: '',
    type,
    page: 9,
    sourceHash,
    bounds: { x, y, width, height, pageWidth: 612, pageHeight: 792 }
  };
}

function item(str: string, x: number, y: number, width: number, height: number): PositionedPdfTextItem {
  return { str, x, y, width, height, page: 1, pageWidth: 612, pageHeight: 792 };
}

describe('mobile PDF figure recovery', () => {
  it('destroys a failed PDF loading task instead of leaking the worker', async () => {
    const destroy = vi.fn(async () => undefined);
    const loadingError = new Error('broken PDF');

    await expect(createMobilePdfFigureRenderer(new Uint8Array([1]), {
      loadingTask: {
        promise: Promise.reject(loadingError),
        destroy
      }
    })).rejects.toBe(loadingError);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('evicts a rejected page render so a transient Safari canvas failure can retry', async () => {
    const cleanup = vi.fn();
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const page = {
      cleanup,
      getViewport: () => ({ width: 100, height: 200 }),
      render
    };
    const getPage = vi.fn()
      .mockRejectedValueOnce(new Error('temporary page failure'))
      .mockResolvedValueOnce(page);
    const destroy = vi.fn(async () => undefined);
    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: ''
    };
    const makeCanvas = () => ({
      width: 0,
      height: 0,
      getContext: () => context
    }) as unknown as HTMLCanvasElement;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: makeCanvas }
    });
    const renderer = await createMobilePdfFigureRenderer(new Uint8Array([1]), {
      loadingTask: {
        promise: Promise.resolve({ getPage, destroy } as unknown as PDFDocumentProxy),
        destroy: vi.fn(async () => undefined)
      }
    });
    const region: MobilePdfFigureRegion = {
      id: 'figure-1',
      page: 1,
      kind: 'figure',
      caption: 'Fig. 1',
      captionHash: 'caption-1',
      hasTextCaption: true,
      order: 0,
      bounds: { x: 0, y: 0, width: 50, height: 50, pageWidth: 100, pageHeight: 200 },
      hiddenTextHashes: []
    };

    await expect(renderer.renderRegion(makeCanvas(), region)).rejects.toThrow('temporary page failure');
    await expect(renderer.renderRegion(makeCanvas(), region)).resolves.toBeUndefined();
    expect(getPage).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledOnce();
    await renderer.destroy();
  });

  it('does not paint a late PDF page into a canvas after the reader was destroyed', async () => {
    let resolvePage: ((page: unknown) => void) | undefined;
    const pendingPage = new Promise<unknown>((resolve) => {
      resolvePage = resolve;
    });
    const getPage = vi.fn(() => pendingPage);
    const documentDestroy = vi.fn(async () => undefined);
    const drawImage = vi.fn();
    const context = { drawImage, fillRect: vi.fn(), fillStyle: '' };
    const makeCanvas = () => ({
      width: 0,
      height: 0,
      getContext: () => context
    }) as unknown as HTMLCanvasElement;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: makeCanvas }
    });
    const renderer = await createMobilePdfFigureRenderer(new Uint8Array([1]), {
      loadingTask: {
        promise: Promise.resolve({ getPage, destroy: documentDestroy } as unknown as PDFDocumentProxy),
        destroy: vi.fn(async () => undefined)
      }
    });
    const region: MobilePdfFigureRegion = {
      id: 'figure-late',
      page: 1,
      kind: 'figure',
      caption: 'Fig. late',
      captionHash: 'caption-late',
      hasTextCaption: true,
      order: 0,
      bounds: { x: 0, y: 0, width: 50, height: 50, pageWidth: 100, pageHeight: 200 },
      hiddenTextHashes: []
    };
    const renderPromise = renderer.renderRegion(makeCanvas(), region);
    await renderer.destroy();
    resolvePage?.({
      cleanup: vi.fn(),
      getViewport: () => ({ width: 100, height: 200 }),
      render: () => ({ promise: Promise.resolve() })
    });

    await expect(renderPromise).resolves.toBeUndefined();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('groups a split PDF text line into a figure caption anchor', () => {
    const items: PositionedPdfTextItem[] = [
      { str: 'Fig.', x: 313, y: 157, width: 18, height: 10, page: 9, pageWidth: 612, pageHeight: 792 },
      { str: '6:', x: 334, y: 157, width: 12, height: 10, page: 9, pageWidth: 612, pageHeight: 792 },
      { str: 'Real-world results', x: 349, y: 157, width: 95, height: 10, page: 9, pageWidth: 612, pageHeight: 792 }
    ];

    expect(buildPdfCaptionAnchors(items, [])).toEqual([
      expect.objectContaining({ kind: 'figure', label: '6', original: 'Fig. 6: Real-world results' })
    ]);
  });

  it('recognizes an IEEE table caption without punctuation after the Roman numeral', () => {
    const blocks = [
      block('table-i', 'TABLE I COMPARISON OF VISUAL-TACTILE DATASETS.', 'caption', 180, 52, 252, 24)
    ];

    expect(buildPdfCaptionAnchors([], blocks)).toEqual([
      expect.objectContaining({
        kind: 'table',
        label: 'I',
        original: 'TABLE I COMPARISON OF VISUAL-TACTILE DATASETS.',
        hasTextCaption: true
      })
    ]);
  });

  it('reconstructs a multi-line academic table into readable rows instead of a page crop', () => {
    const blocks = [
      block('table-i', 'TABLE I: Comparisons to previous humanoid manipulation learning systems', 'caption', 54, 78, 245, 12),
      block('section-a', 'A. Humanoid Whole-Body Control and Teleoperation for Manipulation', 'heading', 54, 225, 245, 22)
    ];
    const textItems = [
      item('End-Effector', 147, 105, 34, 6),
      item('Whole-', 205, 105, 20, 6),
      item('Touch', 237, 105, 16, 6),
      item('Touch', 270, 105, 16, 6),
      item('Method', 82, 108.6, 21, 6),
      item('Dexterity', 152, 112.3, 25, 6),
      item('Body', 208, 112.3, 14, 6),
      item('Sensing', 235, 112.3, 21, 6),
      item('Modeling', 266, 112.3, 26, 6),
      item('OmniH2O [1]', 74, 121.8, 38, 6),
      item('Dex-Hand Full', 145, 121.8, 40, 6),
      item('✓', 212, 121.8, 5, 6),
      item('✗', 243, 121.8, 5, 6),
      item('✗', 277, 121.8, 5, 6),
      item('ViTacFormer [12]', 69, 130.7, 48, 6),
      item('Dex-Hand Full', 145, 130.7, 40, 6),
      item('✗', 212, 130.7, 5, 6),
      item('✓', 243, 130.7, 5, 6),
      item('✓', 277, 130.7, 5, 6),
      item('Ours', 86, 139.6, 14, 6),
      item('Dex-Hand Full', 145, 139.6, 40, 6),
      item('✓', 212, 139.6, 5, 6),
      item('✓', 243, 139.6, 5, 6),
      item('✓', 277, 139.6, 5, 6)
    ];
    const regions = detectPdfFigureRegions({
      page: 3,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table).toEqual({
      headers: ['Method', 'End-Effector Dexterity', 'Whole-Body', 'Touch Sensing', 'Touch Modeling'],
      rows: [
        ['OmniH2O [1]', 'Dex-Hand Full', '✓', '✗', '✗'],
        ['ViTacFormer [12]', 'Dex-Hand Full', '✗', '✓', '✓'],
        ['Ours', 'Dex-Hand Full', '✓', '✓', '✓']
      ]
    });
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeLessThan(170);
    expect(createMobileFigureEntry(regions[0]).figureTable).toEqual(regions[0].table);
  });

  it('keeps adjacent table columns separate when the printable gap is narrow', () => {
    const blocks = [
      block('table-iv', 'TABLE IV: Domain randomizations', 'caption', 54, 292, 245, 12)
    ];
    const textItems = [
      item('Parameter', 66.3, 310.3, 36.2, 8.4),
      item('Range', 136.6, 310.3, 21.7, 8.4),
      item('Parameter', 173.2, 310.3, 36.2, 8.4),
      item('Range', 250.7, 310.3, 21.7, 8.4),
      item('Angular velocity', 66.3, 323.9, 54.5, 8.4),
      item('± 0.2 rad/s', 129.6, 323.9, 35.7, 8.4),
      item('Static friction', 173.2, 323.9, 44.4, 8.4),
      item('[0.6, 1.0]', 245.4, 323.9, 32.4, 8.4),
      item('Joint velocity', 66.3, 332.3, 43.9, 8.4),
      item('± 1.5 rad/s', 129.6, 332.3, 35.7, 8.4),
      item('Base mass', 173.2, 332.3, 34.2, 8.4),
      item('[-5.0, 5.0] kg', 236.7, 332.3, 49.8, 8.4)
    ];
    const regions = detectPdfFigureRegions({
      page: 13,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems
    });

    expect(regions[0].table).toEqual({
      headers: ['Parameter', 'Range', 'Parameter', 'Range'],
      rows: [
        ['Angular velocity', '± 0.2 rad/s', 'Static friction', '[0.6, 1.0]'],
        ['Joint velocity', '± 1.5 rad/s', 'Base mass', '[-5.0, 5.0] kg']
      ]
    });
  });

  it('falls back to the PDF crop for formula-heavy regions that only resemble a two-column table', () => {
    const blocks = [
      block('table-vi', 'TABLE VI: Reward terms', 'caption', 54, 70, 245, 12)
    ];
    const textItems = [
      item('Term Weight Term Tracking Rewards Linear velocity', 60, 92, 128, 8),
      item('Weight 1.0 Torso roll Regularization', 205, 92, 90, 8),
      item('r_vel := exp(-||v_xy-v*_xy||^2 / sigma_v^2)', 60, 104, 128, 8),
      item('r_roll := exp(-(phi-phi*)^2 / sigma_r^2)', 205, 104, 90, 8),
      item('Energy r_E := -sum |tau dot q|^2', 60, 116, 128, 8),
      item('Action rate r_a := -||a_t-a_t-1||^2', 205, 116, 90, 8),
      item('Undesired contacts indicator force threshold', 60, 128, 128, 8),
      item('Feet slide contact velocity penalty', 205, 128, 90, 8)
    ];
    const regions = detectPdfFigureRegions({
      page: 14,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table).toBeUndefined();
  });

  it('falls back when a numeric data row was mistaken for the table header', () => {
    const blocks = [
      block('table-1', 'Table 1: 3D reconstruction results in simulation.', 'caption', 54, 70, 245, 12)
    ];
    const textItems = [
      item('B 1 0.126 0.704', 60, 92, 70, 8),
      item('0.178', 150, 92, 30, 8),
      item('0.386', 200, 92, 30, 8),
      item('0.287', 250, 92, 30, 8),
      item('B 2 0.150 0.674', 60, 104, 70, 8),
      item('0.188', 150, 104, 30, 8),
      item('0.331', 200, 104, 30, 8),
      item('0.291', 250, 104, 30, 8),
      item('All 0.188 0.669', 60, 116, 70, 8),
      item('0.162', 150, 116, 30, 8),
      item('0.339', 200, 116, 30, 8),
      item('0.314', 250, 116, 30, 8)
    ];
    const regions = detectPdfFigureRegions({
      page: 11,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table).toBeUndefined();
  });

  it('does not create a figure crop from a wrapped inline Fig. reference', () => {
    const items = [
      item('The tactile signals changed during manipulation, as shown in', 312, 100, 251, 9),
      item('Fig. 2. This result highlights the importance of dense tactile signals.', 312, 112, 251, 9)
    ];

    expect(buildPdfCaptionAnchors(items, [])).toEqual([]);
  });

  it('finds a caption fragment even when graphic labels precede it on the same row', () => {
    const items = [
      item('Chart label', 24, 220, 86, 11),
      item('Fig. 1:', 54, 220, 40, 11),
      item('System overview', 98, 220, 120, 11)
    ];
    expect(buildPdfCaptionAnchors(items, [])).toEqual([
      expect.objectContaining({
        kind: 'figure',
        label: '1',
        original: 'Fig. 1: System overview',
        hasTextCaption: false
      })
    ]);
  });

  it('recovers two vector charts above their captions and hides chart-label text noise', () => {
    const blocks = [
      block('left-prose', 'The policy consistently improves performance across all contact-rich tasks.', 'paragraph', 54, 600, 245, 72),
      block('chart-label-6', 'Insert-T Book Towel Scoop Tea Average', 'paragraph', 329, 84, 210, 56),
      block('caption-6', 'Fig. 6: Real-world results on five contact-rich tasks.', 'caption', 313, 157, 245, 40),
      block('chart-label-7', 'w/o Touch and TD w/o TD Dream Raw Tactile Dream Latent Tactile', 'paragraph', 329, 218, 220, 78),
      block('caption-7', 'Fig. 7: Ablations of HTD.', 'caption', 313, 312, 245, 30),
      block('right-prose', 'These ablations show that predictive touch objectives improve control.', 'paragraph', 313, 352, 245, 60)
    ];
    const anchors = buildPdfCaptionAnchors([], blocks);
    const regions = detectPdfFigureRegions({
      page: 9,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors,
      imageBounds: []
    });

    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({
      captionHash: 'caption-6',
      hiddenTextHashes: ['chart-label-6']
    });
    expect(regions[0].bounds.y).toBeLessThan(70);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeLessThanOrEqual(153);
    expect(regions[1]).toMatchObject({
      captionHash: 'caption-7',
      hiddenTextHashes: ['chart-label-7']
    });
    expect(regions[1].bounds.y).toBeGreaterThanOrEqual(200);
    expect(regions[1].bounds.y + regions[1].bounds.height).toBeLessThanOrEqual(308);
  });

  it('uses the embedded raster union instead of including the page title above a figure', () => {
    const blocks = [
      block('title', 'Learning Versatile Humanoid Manipulation', 'heading', 100, 48, 410, 28),
      block('caption-1', 'Fig. 1: Our system enables versatile manipulation.', 'caption', 54, 612, 504, 36)
    ];
    const imageBounds: PdfPaintedImageBounds[] = [
      { x: 48, y: 177, width: 510, height: 421 }
    ];
    const regions = detectPdfFigureRegions({
      page: 1,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.y).toBeGreaterThan(160);
    expect(regions[0].bounds.y).toBeLessThan(180);
    expect(regions[0].hiddenTextHashes).not.toContain('title');
  });

  it('keeps table-internal headings inside a tall vector table crop', () => {
    const blocks = [
      block('caption-vi', 'TABLE VI: Reward terms', 'caption', 54, 70, 245, 12),
      block('tracking', 'Tracking Rewards', 'heading', 54, 116, 245, 10),
      block('regularization', 'Regularization', 'heading', 54, 220, 245, 10),
      block('formulae', 'r vel = exp velocity reward terms', 'formula', 54, 130, 245, 300),
      block('body', 'This paragraph resumes after the complete reward table and explains the stability terms.', 'paragraph', 54, 480, 245, 44)
    ];
    const regions = detectPdfFigureRegions({
      page: 14,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: []
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.y).toBeLessThan(90);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeGreaterThan(450);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeLessThanOrEqual(480);
  });
});
