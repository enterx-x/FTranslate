import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ExtractedPdfBlock, PositionedPdfTextItem } from '../lib/pdfTextStructure';
import {
  buildPdfCaptionAnchors,
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
