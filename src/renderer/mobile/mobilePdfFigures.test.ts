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

  it('absorbs a geometric multi-line legend into its figure instead of leaving it as prose', () => {
    const pageItem = (...args: Parameters<typeof item>): PositionedPdfTextItem => ({
      ...item(...args),
      page: 9
    });
    const items: PositionedPdfTextItem[] = [
      pageItem('Fig. 1.', 312, 402, 31, 8),
      pageItem('HiWET capabilities in simulation and real-world deployment.', 347, 402, 217, 8),
      pageItem('(a)-(c) Whole-body redundancy exploitation for diverse reaching tasks.', 312, 414, 252, 8),
      pageItem('(d) Sim-to-sim transfer with world-frame trajectory tracking.', 312, 426, 252, 8),
      pageItem('where red curves are traced by an LED attached to the end-effector.', 312, 438, 252, 8),
      pageItem('29, 19]. Combined with end-effector stabilization methods.', 312, 494, 252, 9)
    ];
    const blocks = [
      block(
        'fig-1',
        'Fig. 1. HiWET capabilities in simulation and real-world deployment.',
        'caption',
        312,
        402,
        252,
        8
      )
    ];

    expect(buildPdfCaptionAnchors(items, blocks)).toEqual([
      expect.objectContaining({
        kind: 'figure',
        label: '1',
        hasTextCaption: false,
        original: expect.stringContaining('(a)-(c) Whole-body redundancy exploitation'),
        bounds: expect.objectContaining({ height: 44 })
      })
    ]);
    expect(buildPdfCaptionAnchors(items, blocks)[0].original).not.toContain('29, 19]');
  });

  it('keeps a tightly led second caption line with the caption instead of leaking it into prose', () => {
    const pageItem = (...args: Parameters<typeof item>): PositionedPdfTextItem => ({
      ...item(...args),
      page: 9
    });
    const items = [
      pageItem('Figure 8: Ablation of view-invariant motion distribu-', 315.407, 556.717, 227.385, 9.9626),
      pageItem('tion balancing (“Balance”) on motion reconstruction.', 315.407, 568.672, 225.724, 9.9626)
    ];
    const blocks = [
      block(
        'figure-8',
        'Figure 8: Ablation of view-invariant motion distribu-',
        'caption',
        315.407,
        556.717,
        227.385,
        9.9626
      )
    ];

    const anchors = buildPdfCaptionAnchors(items, blocks);
    expect(anchors).toEqual([
      expect.objectContaining({
        kind: 'figure',
        label: '8',
        hasTextCaption: false,
        original: 'Figure 8: Ablation of view-invariant motion distribution balancing (“Balance”) on motion reconstruction.'
      })
    ]);
    expect(anchors[0].bounds.height).toBeCloseTo(21.9176, 4);
  });

  it('collects every line of a full-width caption that starts in the left half', () => {
    const blocks = [
      block(
        'table-1',
        'Table 1: Statistical overview of robot manipulation data. The corpus aggregates',
        'caption',
        70,
        88,
        470,
        10
      ),
      block(
        'caption-tail',
        'demonstrations across 30 distinct embodiments and 14,000 hours of interaction.',
        'paragraph',
        70,
        101,
        470,
        10
      )
    ];
    const pageItem = (...args: Parameters<typeof item>): PositionedPdfTextItem => ({
      ...item(...args),
      page: 9
    });
    const textItems = [
      pageItem('Table 1:', 70, 88, 44, 10),
      pageItem('Statistical overview of robot manipulation data. The corpus aggregates', 120, 88, 420, 10),
      pageItem('demonstrations across 30 distinct embodiments and 14,000 hours of interaction.', 70, 101, 470, 10),
      pageItem('Robot Type Camera Views EEF Type Source Hours', 140, 114, 330, 10)
    ];

    expect(buildPdfCaptionAnchors(textItems, blocks)).toEqual([
      expect.objectContaining({
        kind: 'table',
        label: '1',
        hasTextCaption: false,
        original: expect.stringContaining('demonstrations across 30 distinct embodiments'),
        bounds: expect.objectContaining({ height: 23 })
      })
    ]);
    expect(buildPdfCaptionAnchors(textItems, blocks)[0].original).not.toContain('Robot Type');
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

  it('does not absorb a spaced table header and rows into a punctuation-free table caption', () => {
    const blocks = [
      block(
        'followup',
        'The structured comparison remains selectable and readable on a narrow mobile screen.',
        'paragraph',
        72,
        320,
        468,
        16
      )
    ];
    const textItems = [
      item('TABLE I: Safety policy comparison', 72, 180, 210, 12),
      item('Method', 72, 206, 42, 10),
      item('Success', 150, 206, 42, 10),
      item('Collision', 205, 206, 46, 10),
      item('Runtime', 260, 206, 42, 10),
      item('Baseline RL', 72, 226, 64, 10),
      item('71%', 150, 226, 24, 10),
      item('18%', 205, 226, 24, 10),
      item('12 ms', 260, 226, 30, 10),
      item('CBF policy', 72, 246, 58, 10),
      item('86%', 150, 246, 24, 10),
      item('4%', 205, 246, 18, 10),
      item('18 ms', 260, 246, 30, 10),
      item('Ours', 72, 266, 28, 10),
      item('94%', 150, 266, 24, 10),
      item('1%', 205, 266, 18, 10),
      item('16 ms', 260, 266, 30, 10)
    ];
    const anchors = buildPdfCaptionAnchors(textItems, blocks);

    expect(anchors).toEqual([
      expect.objectContaining({
        kind: 'table',
        label: 'I',
        original: 'TABLE I: Safety policy comparison',
        hasTextCaption: false
      })
    ]);
    const regions = detectPdfFigureRegions({
      page: 1,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors,
      imageBounds: [],
      textItems
    });
    expect(regions).toHaveLength(1);
    expect(regions[0].table).toEqual({
      headers: ['Method', 'Success', 'Collision', 'Runtime'],
      rows: [
        ['Baseline RL', '71%', '18%', '12 ms'],
        ['CBF policy', '86%', '4%', '18 ms'],
        ['Ours', '94%', '1%', '16 ms']
      ]
    });
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

  it('reconstructs a right-column table whose caption is below it and embedded in a wider prose block', () => {
    const blocks = [
      block(
        'interleaved-prose',
        'The controller remains stable while Table 2: Quantitative performance under perturbations.',
        'paragraph',
        54,
        92,
        504,
        112
      )
    ];
    const textItems = [
      item('The controller remains stable.', 54, 100, 210, 8),
      item('Method', 330, 100, 52, 8),
      item('Progress', 405, 100, 52, 8),
      item('Duration', 478, 100, 52, 8),
      item('OpenHLM', 330, 118, 52, 8),
      item('92%', 405, 118, 30, 8),
      item('31 s', 478, 118, 30, 8),
      item('Baseline', 330, 136, 52, 8),
      item('76%', 405, 136, 30, 8),
      item('45 s', 478, 136, 30, 8),
      item('Ablation', 330, 154, 52, 8),
      item('68%', 405, 154, 30, 8),
      item('53 s', 478, 154, 30, 8),
      item('The next sentence remains in the left column.', 54, 176, 210, 8),
      item('Table 2:', 330, 176, 48, 8),
      item('Quantitative performance under perturbations.', 384, 176, 150, 8),
      item('Three policy variants are compared using identical trials.', 330, 188, 204, 8),
      item('All values report the mean over three seeds.', 330, 200, 204, 8)
    ];
    const anchors = buildPdfCaptionAnchors(textItems, blocks);
    expect(anchors).toEqual([
      expect.objectContaining({
        kind: 'table',
        label: '2',
        hasTextCaption: false,
        original: 'Table 2: Quantitative performance under perturbations. Three policy variants are compared using identical trials. All values report the mean over three seeds.'
      })
    ]);
    expect(anchors[0].bounds.height).toBeGreaterThan(28);

    const regions = detectPdfFigureRegions({
      page: 10,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors,
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.y).toBeLessThan(110);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeLessThan(175);
    expect(regions[0].table).toEqual({
      headers: ['Method', 'Progress', 'Duration'],
      rows: [
        ['OpenHLM', '92%', '31 s'],
        ['Baseline', '76%', '45 s'],
        ['Ablation', '68%', '53 s']
      ]
    });
  });

  it('reconstructs a table whose multi-row category leaves the leading column sparse', () => {
    const blocks = [
      block('table-ix', 'TABLE IX: Details of the Observation Space and Privileged Information.', 'caption', 160, 62, 300, 12),
      block('body', 'The teacher leverages privileged information after the table.', 'paragraph', 54, 360, 245, 30)
    ];
    const textItems = [
      item('Category', 70, 92, 52, 8),
      item('Observation Term', 150, 92, 82, 8),
      item('Noise', 320, 92, 36, 8),
      item('Description', 390, 92, 64, 8),
      item('Base Angular Velocity', 150, 112, 98, 8),
      item('0.05', 320, 112, 24, 8),
      item('History of base angular velocity.', 390, 112, 142, 8),
      item('Proprioception', 70, 128, 62, 8),
      item('Joint Positions', 150, 128, 72, 8),
      item('0.015', 320, 128, 28, 8),
      item('History of joint positions.', 390, 128, 126, 8),
      item('Previous Actions', 150, 144, 78, 8),
      item('-', 320, 144, 8, 8),
      item('Joint target history.', 390, 144, 96, 8),
      item('Clean Proprioception', 150, 160, 92, 8),
      item('0.0', 320, 160, 20, 8),
      item('Noise-free history.', 390, 160, 92, 8),
      item('Root Linear Velocity', 150, 176, 92, 8),
      item('0.0', 320, 176, 20, 8),
      item('Linear velocity in the global frame.', 390, 176, 150, 8),
      item('Privileged', 70, 192, 52, 8),
      item('Body Velocity', 150, 192, 72, 8),
      item('0.0', 320, 192, 20, 8),
      item('Linear velocity of key bodies.', 390, 192, 132, 8),
      item('Body Height', 150, 208, 62, 8),
      item('0.0', 320, 208, 20, 8),
      item('Height of pelvis and feet.', 390, 208, 126, 8)
    ];
    const anchors = buildPdfCaptionAnchors(textItems, blocks);
    const regions = detectPdfFigureRegions({
      page: 15,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors,
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table).toEqual({
      headers: ['Category', 'Observation Term', 'Noise', 'Description'],
      rows: [
        ['Proprioception', 'Base Angular Velocity', '0.05', 'History of base angular velocity.'],
        ['', 'Joint Positions', '0.015', 'History of joint positions.'],
        ['', 'Previous Actions', '-', 'Joint target history.'],
        ['Privileged', 'Clean Proprioception', '0.0', 'Noise-free history.'],
        ['', 'Root Linear Velocity', '0.0', 'Linear velocity in the global frame.'],
        ['', 'Body Velocity', '0.0', 'Linear velocity of key bodies.'],
        ['', 'Body Height', '0.0', 'Height of pelvis and feet.']
      ]
    });
  });

  it('keeps a compact three-row academic table below its caption', () => {
    const blocks = [
      block('table-vii', 'TABLE VII: Comparison with the baseline.', 'caption', 54, 500, 245, 10),
      block('next-prose', 'The following analysis explains the remaining failure cases.', 'paragraph', 54, 558, 245, 20)
    ];
    const textItems = [
      item('Method', 60, 516, 42, 6),
      item('SR', 135, 516, 20, 6),
      item('Error', 205, 516, 34, 6),
      item('RMA', 60, 527, 28, 6),
      item('70%', 135, 527, 24, 6),
      item('99.1', 205, 527, 28, 6),
      item('HAIC', 60, 538, 32, 6),
      item('100%', 135, 538, 28, 6),
      item('64.8', 205, 538, 28, 6)
    ];
    const regions = detectPdfFigureRegions({
      page: 9,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors(textItems, blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table?.rows).toHaveLength(2);
    expect(regions[0].bounds.height).toBeLessThan(40);
  });

  it('reconstructs a compact indexed table above its caption', () => {
    const blocks = [
      block(
        'table-4',
        'Table 4: Chosen pairs for long-horizon task evaluation.',
        'caption',
        108,
        713,
        396,
        20
      )
    ];
    const textItems = [
      item('rollout index', 114, 679, 38, 7),
      item('0', 169, 679, 4, 7),
      item('1', 205, 679, 4, 7),
      item('2', 248, 679, 4, 7),
      item('fruit 1', 114, 690, 18, 7),
      item('banana', 160, 690, 21, 7),
      item('peach', 198, 690, 17, 7),
      item('lemon', 239, 690, 18, 7),
      item('fruit 2', 114, 698, 18, 7),
      item('peach', 162, 698, 17, 7),
      item('lemon', 198, 698, 18, 7),
      item('banana', 240, 698, 21, 7)
    ];
    const regions = detectPdfFigureRegions({
      page: 28,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors(textItems, blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table).toEqual({
      headers: ['rollout index', '0', '1', '2'],
      rows: [
        ['fruit 1', 'banana', 'peach', 'lemon'],
        ['fruit 2', 'peach', 'lemon', 'banana']
      ]
    });
  });

  it('does not truncate a long table at a sentence-like description cell', () => {
    const blocks = [
      block('table-v', 'TABLE V: Motion information summary.', 'caption', 54, 70, 504, 12),
      block(
        'row-description',
        'Skip back, pivot through a hand-to-headstand, drop, flip, and bounce back.',
        'paragraph',
        300,
        146,
        258,
        9
      )
    ];
    const textItems = [
      item('Motion ID', 60, 96, 45, 8),
      item('Motion Source', 160, 96, 70, 8),
      item('Motion Description', 300, 96, 100, 8),
      ...Array.from({ length: 8 }, (_, index) => {
        const y = 110 + index * 22;
        return [
          item(String(index + 1), 60, y, 12, 8),
          item(`CMU-${85 + index}`, 160, y, 60, 8),
          item(
            index === 2
              ? 'Skip back, pivot through a hand-to-headstand, drop, flip, and bounce back.'
              : `Motion description ${index + 1}.`,
            300,
            y,
            250,
            8
          )
        ];
      }).flat()
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

    expect(regions).toHaveLength(1);
    expect(regions[0].table?.rows).toHaveLength(8);
    expect(regions[0].bounds.y).toBeLessThan(100);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeGreaterThan(260);
  });

  it('keeps every row when a long table was merged with prose below it', () => {
    const blocks = [
      block('table-1', 'Table 1: Statistical overview of robot manipulation data.', 'caption', 70, 70, 470, 12),
      block(
        'polluted-table-tail',
        'ego, wrist × 2 Grp/Dex Real/Sim 2391.7 Grp/Dex Real 1198.2 Grp Real 13.8 Grp Sim 195.8 Total: 30 embodiments. The next section starts below.',
        'paragraph',
        95,
        380,
        445,
        190
      ),
      block(
        'next-prose',
        'The next section starts below the complete table and explains the spatial grounding dataset.',
        'paragraph',
        70,
        620,
        470,
        34
      )
    ];
    const textItems = [
      item('Robot Type', 145, 102, 62, 8),
      item('Camera Views', 255, 102, 68, 8),
      item('EEF Type', 365, 102, 45, 8),
      item('Source', 430, 102, 38, 8),
      item('Hours', 500, 102, 34, 8),
      ...Array.from({ length: 30 }, (_, index) => {
        const y = 116 + index * 15;
        return [
          item(`Robot ${index + 1}`, 145, y, 58, 8),
          item(index % 2 === 0 ? 'ego, wrist × 2' : '3rd', 255, y, 72, 8),
          item(index % 3 === 0 ? 'Grp/Dex' : 'Grp', 365, y, 44, 8),
          item(index % 4 === 0 ? 'Real/Sim' : 'Real', 430, y, 46, 8),
          item(`${100 + index}.0`, 500, y, 34, 8)
        ];
      }).flat(),
      item('Total: 30 embodiments', 145, 582, 108, 8),
      item('3435.0', 500, 582, 38, 8),
      item('The next section starts below the complete table.', 70, 620, 300, 8)
    ];
    const regions = detectPdfFigureRegions({
      page: 12,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table?.rows).toHaveLength(31);
    expect(regions[0].table?.rows.at(-1)).toEqual(['Total: 30 embodiments', '', '', '', '3435.0']);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeGreaterThan(590);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeLessThan(620);
    expect(regions[0].hiddenTextHashes).toContain('polluted-table-tail');
    expect(regions[0].hiddenTextHashes).not.toContain('next-prose');
  });

  it('stops a full-width table before a separated two-column prose section', () => {
    const blocks = [
      block('table-x', 'TABLE X: Reward Functions for the Humanoid-Object Interaction Task.', 'caption', 180, 60, 250, 10)
    ];
    const textItems = [
      item('Term Expression', 60, 82, 220, 8),
      item('Weight Description', 330, 82, 220, 8),
      ...Array.from({ length: 6 }, (_, index) => {
        const y = 96 + index * 12;
        return [
          item(`Reward ${index + 1} exp(-error ${index + 1})`, 60, y, 220, 8),
          item(`0.${index + 1} Tracks target ${index + 1}.`, 330, y, 220, 8)
        ];
      }).flat(),
      item('These targets are processed by a low-level controller.', 60, 205, 220, 8),
      item('Machine state estimation runs on the control PC.', 330, 205, 220, 8),
      item('The controller computes joint torques.', 60, 217, 220, 8),
      item('The policy sends target joint angles.', 330, 217, 220, 8)
    ];
    const regions = detectPdfFigureRegions({
      page: 16,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].table?.rows).toHaveLength(6);
    expect(regions[0].table?.rows.flat().join(' ')).not.toContain('Machine state');
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeLessThan(190);
  });

  it('keeps the final numeric row when a former table cell prefixes the following prose', () => {
    const blocks = [
      block('table-i', 'TABLE I: Domain-randomization and termination thresholds.', 'caption', 49, 62, 251, 24),
      block('last-label', 'End-Effector Z-Error (m) 0.25', 'paragraph', 49, 313, 102, 7),
      block('orphan-cell', '0.375', 'paragraph', 212, 313, 21, 7),
      block(
        'next-prose',
        '0.375 and the current base action remains available to the residual policy.',
        'paragraph',
        49,
        313,
        251,
        74
      )
    ];
    const textItems = [
      item('Parameter Item', 55, 96, 70, 7),
      item('Moderate', 137, 96, 45, 7),
      item('Aggressive', 212, 96, 50, 7),
      ...Array.from({ length: 21 }, (_, index) => {
        const y = 106 + index * 9.5;
        return [
          item(`Parameter ${index + 1}`, 55, y, 62, 7),
          item(`0.${index + 1}`, 137, y, 24, 7),
          item(`0.${index + 2}`, 212, y, 24, 7)
        ];
      }).flat(),
      item('Torso Pos. Z / Ori. Error', 49, 303, 72, 7),
      item('0.25 m / 0.8 rad', 137, 303, 48, 7),
      item('0.375 m / 1.2 rad', 212, 303, 54, 7),
      item('End-Effector Z-Error (m)', 49, 313, 73, 7),
      item('0.25', 137, 313, 20, 7),
      item('0.375', 212, 313, 21, 7),
      item('and the current base action remains available to the residual policy.', 49, 341, 251, 10)
    ];
    const regions = detectPdfFigureRegions({
      page: 5,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeGreaterThan(320);
    expect(regions[0].hiddenTextHashes).toContain('orphan-cell');
    expect(regions[0].table?.rows.at(-1)).toEqual(['End-Effector Z-Error (m)', '0.25', '0.375']);
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

  it('does not reject a standalone figure caption just because chart labels sit directly above it', () => {
    const items = [
      item('Task Progress Cola Shelf Bottle Jar Toy Sword', 55, 100, 420, 9),
      item('Figure 12:', 55, 112, 58, 9),
      item('Per-task breakdown of heterogeneous co-training results.', 119, 112, 310, 9)
    ];

    expect(buildPdfCaptionAnchors(items, [])).toEqual([
      expect.objectContaining({
        kind: 'figure',
        label: '12',
        original: 'Figure 12: Per-task breakdown of heterogeneous co-training results.',
        hasTextCaption: false
      })
    ]);
  });

  it('recovers a strong figure caption even when reader reflow embedded it in a paragraph', () => {
    const items = [
      item('Dynamics-aware World Model', 376, 104, 137, 10),
      item('Fig. 3: Overview of our Dynamics-aware World Model.', 312, 125, 193, 8),
      item('It predicts object dynamics from proprioception.', 508, 125, 55, 8)
    ];
    const blocks = [
      block(
        'embedded-figure-caption',
        'World models are used for robust control Fig. 3: Overview of our Dynamics-aware World Model.',
        'paragraph',
        312,
        100,
        251,
        52
      )
    ];

    expect(buildPdfCaptionAnchors(items, blocks)).toEqual([
      expect.objectContaining({
        kind: 'figure',
        label: '3',
        original: 'Fig. 3: Overview of our Dynamics-aware World Model. It predicts object dynamics from proprioception.'
      })
    ]);
  });

  it('separates side-by-side figure and table captions that share one PDF baseline', () => {
    const items = [
      item('Fig. 10:', 49, 375.7, 26, 8),
      item('Comparison of relative object states.', 78, 375.7, 205, 8),
      item('TABLE VIII:', 312, 369.6, 48, 8),
      item('Ablation study on contact reward thresholds.', 363, 369.6, 200, 8)
    ];
    const blocks = [
      block(
        'caption-collision',
        'Fig. 10: Comparison of relative object states. TABLE VIII: Ablation study on contact reward thresholds.',
        'caption',
        49,
        369,
        514,
        18
      )
    ];

    expect(buildPdfCaptionAnchors(items, blocks).map((anchor) => ({
      kind: anchor.kind,
      label: anchor.label,
      original: anchor.original
    }))).toEqual([
      {
        kind: 'table',
        label: 'VIII',
        original: 'TABLE VIII: Ablation study on contact reward thresholds.'
      },
      {
        kind: 'figure',
        label: '10',
        original: 'Fig. 10: Comparison of relative object states.'
      }
    ]);
  });

  it('does not turn an inline Table IX continuation into a table region', () => {
    const items = [
      item('The observation details are given in', 49, 558, 251, 10),
      item('Table IX.', 49, 570, 38, 10)
    ];

    expect(buildPdfCaptionAnchors(items, [])).toEqual([]);
  });

  it('keeps a strong table caption after an unfinished prose line', () => {
    const items = [
      item('These results validate that the explicit predictor is robust and', 49, 560, 251, 10),
      item('TABLE VII:', 49, 573, 45, 8),
      item('Compared to the RMA baseline, HAIC achieves lower tracking errors.', 98, 573, 202, 8)
    ];

    expect(buildPdfCaptionAnchors(items, [])).toEqual([
      expect.objectContaining({
        kind: 'table',
        label: 'VII',
        original: 'TABLE VII: Compared to the RMA baseline, HAIC achieves lower tracking errors.'
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

  it('does not let chart-axis text with an embedded prose sentence truncate the figure crop', () => {
    const blocks = [
      block(
        'mixed-chart-labels',
        'Predicted MuJoCo Reference Motion x (m) y (m) 0.0 2.5 5.0. The prediction converges effectively.',
        'paragraph',
        54,
        82,
        245,
        222
      ),
      block(
        'caption-10',
        'Fig. 10: Comparison of relative object states in the robot local frame.',
        'caption',
        54,
        330,
        245,
        24
      )
    ];
    const regions = detectPdfFigureRegions({
      page: 9,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: []
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.y).toBeLessThan(70);
    expect(regions[0].bounds.height).toBeGreaterThan(240);
    expect(regions[0].hiddenTextHashes).toContain('mixed-chart-labels');
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

  it('expands a raster crop to adjacent vector labels without swallowing a distant page heading', () => {
    const blocks = [
      block('title', 'Learning Versatile Humanoid Manipulation', 'heading', 100, 48, 410, 28),
      block('figure-label', 'Whole Body Controller', 'heading', 220, 142, 160, 14),
      block('caption-1', 'Fig. 1: System overview.', 'caption', 54, 452, 504, 24)
    ];
    const imageBounds: PdfPaintedImageBounds[] = [
      { x: 90, y: 164, width: 432, height: 246 }
    ];
    const textItems = [
      item('Learning Versatile Humanoid Manipulation', 100, 48, 410, 28),
      item('Whole Body Controller', 220, 142, 160, 14),
      item('Fig. 1: System overview.', 54, 452, 504, 24)
    ];
    const regions = detectPdfFigureRegions({
      page: 1,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds,
      textItems
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.y).toBeLessThanOrEqual(142);
    expect(regions[0].bounds.y).toBeGreaterThan(80);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeGreaterThanOrEqual(410);
  });

  it('keeps horizontally distant vector labels inside a wide-caption figure crop', () => {
    const blocks = [
      block('title', 'Being-H0: Vision language action learning', 'heading', 100, 40, 410, 28),
      block('diagram-label', 'Extension and post-training alignment', 'paragraph', 350, 94, 174, 174),
      block('outer-axis-label', 'Number of Embodiments', 'paragraph', 533, 142, 80, 10),
      block('caption-3', 'Figure 3: Physical instruction tuning across the complete model.', 'caption', 70, 286, 473, 90)
    ];
    const regions = detectPdfFigureRegions({
      page: 8,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [{ x: 67, y: 79, width: 164, height: 183 }],
      textItems: [
        item('Being-H0: Vision language action learning', 100, 40, 410, 28),
        item('Extension and post-training alignment', 350, 94, 174, 174),
        item('Number of Embodiments', 533, 142, 80, 10),
        item('Figure 3: Physical instruction tuning across the complete model.', 70, 286, 473, 90)
      ]
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.x).toBeLessThanOrEqual(67);
    expect(regions[0].bounds.x + regions[0].bounds.width).toBeGreaterThanOrEqual(611);
    expect(regions[0].bounds.y).toBeGreaterThan(60);
    expect(regions[0].hiddenTextHashes).not.toContain('title');
  });

  it('includes an outer axis label in a full-width vector figure without raster images', () => {
    const blocks = [
      block('axis-label', 'Number of Embodiments', 'paragraph', 533, 142, 80, 10),
      block('caption-3', 'Figure 3: Comparison of training scale and embodiment diversity.', 'caption', 70, 286, 473, 36)
    ];
    const regions = detectPdfFigureRegions({
      page: 9,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds: [],
      textItems: [
        item('Number of Embodiments', 533, 142, 80, 10),
        item('Figure 3: Comparison of training scale and embodiment diversity.', 70, 286, 473, 36)
      ]
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.x + regions[0].bounds.width).toBeGreaterThanOrEqual(611);
    expect(regions[0].hiddenTextHashes).toContain('axis-label');
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
