import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  buildPdfDocumentOutline,
  hashText,
  type ExtractedPdfBlock,
  type PdfBlockBounds,
  type PositionedPdfTextItem
} from '../lib/pdfTextStructure';
import type { MobileTranslationEntry } from './mobileTypes';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const MOBILE_PDF_FIGURE_VERSION = 2;

export interface PdfPaintedImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfCaptionAnchor {
  kind: 'figure' | 'table';
  label: string;
  original: string;
  bounds: PdfBlockBounds;
  captionHash: string;
  hasTextCaption: boolean;
  blockOrder: number;
}

export interface MobilePdfFigureRegion {
  id: string;
  page: number;
  kind: 'figure' | 'table';
  caption: string;
  captionHash: string;
  hasTextCaption: boolean;
  order: number;
  bounds: Required<Pick<PdfBlockBounds, 'x' | 'y' | 'width' | 'height' | 'pageWidth' | 'pageHeight'>>;
  captionBounds?: PdfBlockBounds;
  hiddenTextHashes: string[];
}

export function resolveMobilePdfFigureOrder(
  region: Pick<MobilePdfFigureRegion, 'kind' | 'hasTextCaption' | 'captionHash' | 'order'>,
  captionOrders: ReadonlyMap<string, number>
): number {
  const captionOrder = region.hasTextCaption ? captionOrders.get(region.captionHash) : undefined;
  if (captionOrder === undefined || !Number.isFinite(captionOrder)) {
    return region.order;
  }
  return captionOrder + (region.kind === 'table' ? 0.25 : -0.25);
}

export function createMobileFigureEntry(region: MobilePdfFigureRegion): MobileTranslationEntry {
  return {
    sourceHash: region.id,
    page: region.page,
    original: region.caption,
    translation: '',
    translatedAt: new Date().toISOString(),
    model: '',
    origin: 'figure',
    order: region.order,
    figureVersion: MOBILE_PDF_FIGURE_VERSION,
    figureKind: region.kind,
    figureBounds: region.bounds,
    figureCaptionHash: region.captionHash,
    figureHasTextCaption: region.hasTextCaption,
    figureTextHashes: region.hiddenTextHashes
  };
}

interface DetectPdfFigureRegionsInput {
  page: number;
  pageWidth: number;
  pageHeight: number;
  blocks: ExtractedPdfBlock[];
  anchors: PdfCaptionAnchor[];
  imageBounds: PdfPaintedImageBounds[];
}

export async function extractPdfFigureRegionsFromPage(
  page: PDFPageProxy,
  pageNumber: number,
  prepared?: { items: PositionedPdfTextItem[]; blocks: ExtractedPdfBlock[] }
): Promise<MobilePdfFigureRegion[]> {
  const viewport = page.getViewport({ scale: 1 });
  const items = prepared?.items ?? await readPositionedPdfTextItems(page, pageNumber);
  const blocks = prepared?.blocks ?? buildPdfDocumentOutline([{ page: pageNumber, items }]);
  const anchors = buildPdfCaptionAnchors(items, blocks);
  if (anchors.length === 0) {
    return [];
  }
  const imageBounds = await collectPaintedImageBounds(page, viewport.transform, viewport.width, viewport.height);
  return detectPdfFigureRegions({
    page: pageNumber,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    blocks,
    anchors,
    imageBounds
  });
}

export async function extractPdfFigureRegions(
  pdfData: Uint8Array,
  options: {
    isCancelled?: () => boolean;
    onPageExtracted?: (page: number, pageCount: number, regions: MobilePdfFigureRegion[]) => Promise<void> | void;
    pageTimeoutMs?: number;
    saveTimeoutMs?: number;
    cleanupTimeoutMs?: number;
  } = {}
): Promise<{ pageCount: number; regions: MobilePdfFigureRegion[]; cancelled: boolean }> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy | null = null;
  const regions: MobilePdfFigureRegion[] = [];
  try {
    pdfDocument = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (options.isCancelled?.()) {
        return { pageCount: pdfDocument.numPages, regions, cancelled: true };
      }
      const page = await withTimeout(
        pdfDocument.getPage(pageNumber),
        options.pageTimeoutMs ?? 45_000,
        `第 ${pageNumber} 页图表读取超时。`
      );
      try {
        const pageRegions = await withTimeout(
          extractPdfFigureRegionsFromPage(page, pageNumber),
          options.pageTimeoutMs ?? 45_000,
          `第 ${pageNumber} 页图表分析超时。`
        );
        regions.push(...pageRegions);
        await withTimeout(
          Promise.resolve(options.onPageExtracted?.(pageNumber, pdfDocument.numPages, pageRegions)),
          options.saveTimeoutMs ?? 30_000,
          `第 ${pageNumber} 页图表缓存写入超时。`
        );
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: pdfDocument.numPages, regions, cancelled: false };
  } finally {
    if (pdfDocument) {
      await settleWithin(pdfDocument.destroy(), options.cleanupTimeoutMs ?? 2_500);
    } else {
      await settleWithin(loadingTask.destroy(), options.cleanupTimeoutMs ?? 2_500);
    }
  }
}

export function buildPdfCaptionAnchors(
  items: PositionedPdfTextItem[],
  blocks: ExtractedPdfBlock[]
): PdfCaptionAnchor[] {
  const anchors = new Map<string, PdfCaptionAnchor>();
  const rawLines = buildRawPdfTextLines(items);
  blocks.forEach((block, index) => {
    const label = parseCaptionLabel(block.original);
    const matchingRawLine = block.bounds ? findRawLineAtBounds(rawLines, block.bounds) : undefined;
    if (
      block.type !== 'caption' ||
      !label ||
      !block.bounds ||
      (matchingRawLine && looksLikeInlineFigureReferenceLine(matchingRawLine, rawLines))
    ) {
      return;
    }
    const key = `${label.kind}:${label.label}`;
    anchors.set(key, {
      ...label,
      original: block.original,
      bounds: block.bounds,
      captionHash: block.sourceHash,
      hasTextCaption: true,
      blockOrder: index
    });
  });

  for (const line of rawLines) {
    const label = parseCaptionLabel(line.original);
    if (
      !label ||
      looksLikeInlineFigureReferenceLine(line, rawLines) ||
      isBoundsInsideParagraphBlock(line.bounds, blocks)
    ) {
      continue;
    }
    const key = `${label.kind}:${label.label}`;
    if (anchors.has(key)) {
      continue;
    }
    const sameScopeBlocks = blocks.filter((block) => block.bounds && horizontalOverlapRatio(block.bounds, line.bounds) > 0.2);
    const nextBlockIndex = blocks.findIndex((block) => (
      sameScopeBlocks.includes(block) && Boolean(block.bounds && block.bounds.y > line.bounds.y)
    ));
    anchors.set(key, {
      ...label,
      original: line.original,
      bounds: line.bounds,
      captionHash: hashText(`caption|${items[0]?.page ?? 1}|${label.kind}|${label.label}|${line.original}`),
      hasTextCaption: false,
      blockOrder: nextBlockIndex >= 0 ? nextBlockIndex : blocks.length
    });
  }

  for (const item of items) {
    const label = parseCaptionLabel(item.str);
    const rawLine = findRawLineAtBounds(rawLines, {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      pageWidth: item.pageWidth,
      pageHeight: item.pageHeight
    });
    if (
      !label ||
      (rawLine && looksLikeInlineFigureReferenceLine(rawLine, rawLines)) ||
      isBoundsInsideParagraphBlock({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        pageWidth: item.pageWidth,
        pageHeight: item.pageHeight
      }, blocks)
    ) {
      continue;
    }
    const key = `${label.kind}:${label.label}`;
    if (anchors.has(key)) {
      continue;
    }
    const sameLine = items
      .filter((candidate) => (
        candidate.x >= item.x - 2 &&
        Math.abs(candidate.y - item.y) <= Math.max(4, item.height * 0.85)
      ))
      .sort((left, right) => left.x - right.x);
    const maxX = Math.max(...sameLine.map((candidate) => candidate.x + candidate.width));
    const maxY = Math.max(...sameLine.map((candidate) => candidate.y + candidate.height));
    const bounds: PdfBlockBounds = {
      x: item.x,
      y: Math.min(...sameLine.map((candidate) => candidate.y)),
      width: Math.max(1, maxX - item.x),
      height: Math.max(1, maxY - Math.min(...sameLine.map((candidate) => candidate.y))),
      pageWidth: item.pageWidth,
      pageHeight: item.pageHeight
    };
    const original = normalizePdfLine(sameLine.map((candidate) => candidate.str).join(' '));
    const nextBlockIndex = blocks.findIndex((block) => Boolean(block.bounds && block.bounds.y > bounds.y));
    anchors.set(key, {
      ...label,
      original,
      bounds,
      captionHash: hashText(`caption|${item.page}|${label.kind}|${label.label}|${original}`),
      hasTextCaption: false,
      blockOrder: nextBlockIndex >= 0 ? nextBlockIndex : blocks.length
    });
  }

  return Array.from(anchors.values()).sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
}

export function detectPdfFigureRegions(input: DetectPdfFigureRegionsInput): MobilePdfFigureRegion[] {
  const minimumHeight = Math.max(38, input.pageHeight * 0.05);
  const pageMarginY = Math.max(18, input.pageHeight * 0.045);
  const sortedAnchors = [...input.anchors].sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);

  return sortedAnchors.flatMap((anchor): MobilePdfFigureRegion[] => {
    const scope = resolveCaptionScope(anchor.bounds, input.pageWidth, input.pageHeight);
    const sameScopeAnchors = sortedAnchors.filter((candidate) => (
      candidate !== anchor && horizontalOverlapRatio(candidate.bounds, scope) > 0.5
    ));
    const roughBounds = anchor.kind === 'table'
      ? resolveTableBounds(anchor, sameScopeAnchors, input.blocks, scope, input.pageHeight, minimumHeight)
      : resolveFigureBounds(anchor, sameScopeAnchors, input.blocks, scope, pageMarginY, minimumHeight);
    if (!roughBounds) {
      return [];
    }

    const paintedImages = input.imageBounds.filter((bounds) => (
      horizontalOverlapRatio(bounds, roughBounds) > 0.18 && verticalOverlapRatio(bounds, roughBounds) > 0.18
    ));
    const paintedUnion = paintedImages.length > 0 ? unionBounds(paintedImages) : null;
    const usePaintedUnion = Boolean(
      paintedUnion &&
      paintedUnion.width * paintedUnion.height >= input.pageWidth * input.pageHeight * 0.012 &&
      paintedUnion.height >= minimumHeight * 0.75
    );
    const unresolvedCrop = usePaintedUnion ? expandBounds(paintedUnion!, 4, roughBounds) : roughBounds;
    const heightLimitedCrop = !usePaintedUnion && unresolvedCrop.height > input.pageHeight * 0.5
      ? {
          ...unresolvedCrop,
          y: unresolvedCrop.y + unresolvedCrop.height - input.pageHeight * 0.5,
          height: input.pageHeight * 0.5
        }
      : unresolvedCrop;
    const crop = clampBounds(
      heightLimitedCrop,
      input.pageWidth,
      input.pageHeight
    );
    if (crop.width < 40 || crop.height < minimumHeight) {
      return [];
    }

    const hiddenTextHashes = input.blocks
      .filter((block) => (
        block.type !== 'caption' &&
        block.bounds &&
        !looksLikeProseBoundary(block) &&
        boundsCenterInside(block.bounds, crop)
      ))
      .map((block) => block.sourceHash);
    const orderOffset = anchor.kind === 'table' ? 0.25 : -0.25;
    const sourceHash = hashText([
      MOBILE_PDF_FIGURE_VERSION,
      input.page,
      anchor.kind,
      anchor.captionHash,
      crop.x.toFixed(2),
      crop.y.toFixed(2),
      crop.width.toFixed(2),
      crop.height.toFixed(2)
    ].join('|'));
    return [{
      id: `pdf-figure-${input.page}-${sourceHash}`,
      page: input.page,
      kind: anchor.kind,
      caption: anchor.original,
      captionHash: anchor.captionHash,
      hasTextCaption: anchor.hasTextCaption,
      order: (input.page - 1) * 1000 + anchor.blockOrder + orderOffset,
      bounds: {
        ...crop,
        pageWidth: input.pageWidth,
        pageHeight: input.pageHeight
      },
      captionBounds: anchor.bounds,
      hiddenTextHashes
    }];
  });
}

export interface MobilePdfFigureRenderer {
  renderRegion: (canvas: HTMLCanvasElement, region: MobilePdfFigureRegion) => Promise<void>;
  destroy: () => Promise<void>;
}

export interface MobilePdfFigureRendererOptions {
  loadingTask?: {
    promise: Promise<PDFDocumentProxy>;
    destroy: () => Promise<void>;
  };
}

export async function createMobilePdfFigureRenderer(
  pdfData: Uint8Array,
  options: MobilePdfFigureRendererOptions = {}
): Promise<MobilePdfFigureRenderer> {
  const loadingTask = options.loadingTask ?? pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy;
  try {
    pdfDocument = await loadingTask.promise;
  } catch (error) {
    await settleWithin(Promise.resolve().then(() => loadingTask.destroy()), 2_500);
    throw error;
  }
  const pageCache = new Map<number, Promise<{ canvas: HTMLCanvasElement; scale: number }>>();
  let destroyed = false;

  const getPageCanvas = (pageNumber: number): Promise<{ canvas: HTMLCanvasElement; scale: number }> => {
    const cached = pageCache.get(pageNumber);
    if (cached) {
      return cached;
    }
    const pending = (async () => {
      const page = await pdfDocument.getPage(pageNumber);
      try {
        const scale = Math.min(2, Math.max(1.5, Number(globalThis.devicePixelRatio) || 1));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) {
          throw new Error('当前浏览器无法创建论文插图画布。');
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        return { canvas, scale };
      } finally {
        page.cleanup();
      }
    })();
    pageCache.set(pageNumber, pending);
    void pending.then(() => {
      while (pageCache.size > 3) {
        const oldestPage = pageCache.keys().next().value as number | undefined;
        if (oldestPage === undefined || oldestPage === pageNumber) {
          break;
        }
        const evicted = pageCache.get(oldestPage);
        pageCache.delete(oldestPage);
        void evicted?.then(({ canvas }) => {
          canvas.width = 1;
          canvas.height = 1;
        }, () => undefined);
      }
    }, () => {
      // A transient Safari canvas or PDF.js failure must not poison retries.
      if (pageCache.get(pageNumber) === pending) {
        pageCache.delete(pageNumber);
      }
    });
    return pending;
  };

  return {
    async renderRegion(canvas, region) {
      if (destroyed) {
        return;
      }
      const renderedPage = await getPageCanvas(region.page);
      if (destroyed) {
        return;
      }
      const xScale = renderedPage.canvas.width / region.bounds.pageWidth;
      const yScale = renderedPage.canvas.height / region.bounds.pageHeight;
      const sourceX = Math.max(0, Math.round(region.bounds.x * xScale));
      const sourceY = Math.max(0, Math.round(region.bounds.y * yScale));
      const sourceWidth = Math.max(1, Math.min(renderedPage.canvas.width - sourceX, Math.round(region.bounds.width * xScale)));
      const sourceHeight = Math.max(1, Math.min(renderedPage.canvas.height - sourceY, Math.round(region.bounds.height * yScale)));
      const outputScale = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight));
      canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
      canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        throw new Error('当前浏览器无法显示论文插图。');
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        renderedPage.canvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );
    },
    async destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      const cachedPages = Array.from(pageCache.values());
      pageCache.clear();
      for (const cachedPage of cachedPages) {
        void cachedPage.then(({ canvas }) => {
          canvas.width = 1;
          canvas.height = 1;
        }, () => undefined);
      }
      await settleWithin(pdfDocument.destroy(), 2_500);
    }
  };
}

async function readPositionedPdfTextItems(page: PDFPageProxy, pageNumber: number): Promise<PositionedPdfTextItem[]> {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  return textContent.items.flatMap((rawItem): PositionedPdfTextItem[] => {
    const item = rawItem as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!item.str?.trim() || !item.transform || item.transform.length < 6) {
      return [];
    }
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return [{
      str: item.str,
      x,
      y,
      width: Math.max(1, item.width ?? 1),
      height: Math.max(1, item.height ?? 1),
      page: pageNumber,
      pageWidth: viewport.width,
      pageHeight: viewport.height
    }];
  });
}

interface RawPdfTextLine {
  original: string;
  bounds: PdfBlockBounds;
}

function findRawLineAtBounds(lines: RawPdfTextLine[], bounds: PdfBlockBounds): RawPdfTextLine | undefined {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return lines.find((line) => (
    centerX >= line.bounds.x - 3 &&
    centerX <= line.bounds.x + line.bounds.width + 3 &&
    centerY >= line.bounds.y - 3 &&
    centerY <= line.bounds.y + line.bounds.height + 3
  ));
}

function isBoundsInsideParagraphBlock(bounds: PdfBlockBounds, blocks: ExtractedPdfBlock[]): boolean {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return blocks.some((block) => (
    block.type === 'paragraph' &&
    block.bounds &&
    centerX >= block.bounds.x - 3 &&
    centerX <= block.bounds.x + block.bounds.width + 3 &&
    centerY >= block.bounds.y - 3 &&
    centerY <= block.bounds.y + block.bounds.height + 3
  ));
}

function looksLikeInlineFigureReferenceLine(line: RawPdfTextLine, lines: RawPdfTextLine[]): boolean {
  if (!/^(fig\.?|figure)\s*\d+[:.]/iu.test(line.original.trim())) {
    return false;
  }
  const previous = lines
    .filter((candidate) => (
      candidate !== line &&
      Math.abs(candidate.bounds.x - line.bounds.x) <= 24 &&
      candidate.bounds.y < line.bounds.y &&
      line.bounds.y - candidate.bounds.y <= Math.max(18, candidate.bounds.height * 2, line.bounds.height * 2)
    ))
    .sort((left, right) => right.bounds.y - left.bounds.y)[0];
  if (!previous) {
    return false;
  }
  const words = previous.original.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 6 && !/[.!?。！？][)\]"']*$/u.test(previous.original.trim());
}

function buildRawPdfTextLines(items: PositionedPdfTextItem[]): RawPdfTextLine[] {
  const groups: PositionedPdfTextItem[][] = [];
  for (const item of [...items].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const line = groups.find((candidate) => Math.abs(candidate[0].y - item.y) <= Math.max(3, candidate[0].height * 0.7));
    if (line) {
      line.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups.flatMap((line) => {
    const segments: PositionedPdfTextItem[][] = [];
    for (const item of line.sort((left, right) => left.x - right.x)) {
      const segment = segments[segments.length - 1];
      const previous = segment?.[segment.length - 1];
      if (!segment || (previous && item.x - (previous.x + previous.width) > 34)) {
        segments.push([item]);
      } else {
        segment.push(item);
      }
    }
    return segments.map((segment) => {
      const minX = Math.min(...segment.map((item) => item.x));
      const minY = Math.min(...segment.map((item) => item.y));
      const maxX = Math.max(...segment.map((item) => item.x + item.width));
      const maxY = Math.max(...segment.map((item) => item.y + item.height));
      return {
        original: normalizePdfLine(segment.map((item) => item.str).join(' ')),
        bounds: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          pageWidth: segment[0].pageWidth,
          pageHeight: segment[0].pageHeight
        }
      };
    });
  });
}

async function collectPaintedImageBounds(
  page: PDFPageProxy,
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number
): Promise<PdfPaintedImageBounds[]> {
  const operatorList = await page.getOperatorList();
  const ops = pdfjsLib.OPS as Record<string, number>;
  const imageOps = new Set([
    ops.paintImageXObject,
    ops.paintInlineImageXObject,
    ops.paintImageMaskXObject,
    ops.paintSolidColorImageMask
  ]);
  let transform = [...viewportTransform];
  const stack: number[][] = [];
  const images: PdfPaintedImageBounds[] = [];
  operatorList.fnArray.forEach((operation, index) => {
    const args = (operatorList.argsArray[index] ?? []) as unknown[];
    if (operation === ops.save) {
      stack.push([...transform]);
      return;
    }
    if (operation === ops.restore) {
      transform = stack.pop() ?? [...viewportTransform];
      return;
    }
    if (operation === ops.transform && args.length >= 6) {
      transform = multiplyMatrices(transform, args.slice(0, 6).map(Number));
      return;
    }
    if (!imageOps.has(operation)) {
      return;
    }
    const corners = [
      transformPoint(transform, 0, 0),
      transformPoint(transform, 1, 0),
      transformPoint(transform, 0, 1),
      transformPoint(transform, 1, 1)
    ];
    const minX = Math.min(...corners.map(([x]) => x));
    const minY = Math.min(...corners.map(([, y]) => y));
    const maxX = Math.max(...corners.map(([x]) => x));
    const maxY = Math.max(...corners.map(([, y]) => y));
    const bounds = clampBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, pageWidth, pageHeight);
    if (bounds.width >= 12 && bounds.height >= 12 && bounds.width * bounds.height >= 180) {
      images.push(bounds);
    }
  });
  return images;
}

function resolveFigureBounds(
  anchor: PdfCaptionAnchor,
  anchors: PdfCaptionAnchor[],
  blocks: ExtractedPdfBlock[],
  scope: PdfBlockBounds,
  pageMarginY: number,
  minimumHeight: number
): PdfPaintedImageBounds | null {
  const captionTop = anchor.bounds.y;
  const previousCaptionBottom = anchors
    .filter((candidate) => candidate.bounds.y < captionTop)
    .reduce((bottom, candidate) => Math.max(bottom, candidate.bounds.y + candidate.bounds.height + 7), pageMarginY);
  let top = previousCaptionBottom;
  const proseBottom = blocks
    .filter((block) => (
      block.bounds &&
      looksLikeProseBoundary(block) &&
      horizontalOverlapRatio(block.bounds, scope) > 0.35 &&
      block.bounds.width >= scope.width * 0.62 &&
      block.bounds.y + block.bounds.height < captionTop - minimumHeight
    ))
    .reduce((bottom, block) => Math.max(bottom, block.bounds!.y + block.bounds!.height + 7), top);
  top = Math.max(top, proseBottom);
  const bottom = captionTop - 6;
  return bottom - top >= minimumHeight
    ? { x: scope.x, y: top, width: scope.width, height: bottom - top }
    : null;
}

function resolveTableBounds(
  anchor: PdfCaptionAnchor,
  anchors: PdfCaptionAnchor[],
  blocks: ExtractedPdfBlock[],
  scope: PdfBlockBounds,
  pageHeight: number,
  minimumHeight: number
): PdfPaintedImageBounds | null {
  const top = anchor.bounds.y + anchor.bounds.height + 5;
  const nextBoundary = [
    ...anchors.filter((candidate) => candidate.bounds.y > top).map((candidate) => candidate.bounds.y - 6),
    ...blocks.filter((block) => (
      block.bounds &&
      looksLikeTableFollowingBoundary(block) &&
      horizontalOverlapRatio(block.bounds, scope) > 0.35 &&
      block.bounds.y > top + minimumHeight
    )).map((block) => block.bounds!.y - 6)
  ].reduce((nearest, y) => Math.min(nearest, y), pageHeight - Math.max(18, pageHeight * 0.045));
  const bottom = Math.min(nextBoundary, top + pageHeight * 0.5);
  return bottom - top >= minimumHeight
    ? { x: scope.x, y: top, width: scope.width, height: bottom - top }
    : null;
}

function looksLikeTableFollowingBoundary(block: ExtractedPdfBlock): boolean {
  if (block.type === 'heading') {
    return /^([IVX]+|\d+(?:\.\d+)*|[A-Z])\.\s+/u.test(block.original.trim()) ||
      /^(appendix|references)$/iu.test(block.original.trim());
  }
  if (block.type !== 'paragraph') {
    return false;
  }
  const original = block.original.trim();
  const words = original.match(/[\p{L}\p{N}]+/gu) ?? [];
  const mathPollution = (original.match(/[=∑∫√∞≤≥≠≈→∥⊙⋆^_{}\u0000-\u001f]/gu) ?? []).length;
  return words.length >= 12 && mathPollution < 3 && /[.!?][)\]"']*$/u.test(original);
}

function resolveCaptionScope(bounds: PdfBlockBounds, pageWidth: number, pageHeight: number): PdfBlockBounds {
  const margin = Math.max(24, pageWidth * 0.075);
  const split = pageWidth / 2;
  const crossesMiddle = bounds.x < split - 18 && bounds.x + bounds.width > split + 18;
  const fullWidth = crossesMiddle || bounds.width >= pageWidth * 0.56;
  if (fullWidth) {
    return { x: margin, y: 0, width: pageWidth - margin * 2, height: pageHeight };
  }
  const gutter = Math.max(5, pageWidth * 0.01);
  return bounds.x + bounds.width / 2 <= split
    ? { x: margin, y: 0, width: split - gutter - margin, height: pageHeight }
    : { x: split + gutter, y: 0, width: pageWidth - margin - split - gutter, height: pageHeight };
}

function parseCaptionLabel(value: string): Pick<PdfCaptionAnchor, 'kind' | 'label'> | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(fig(?:ure)?\.?|table)\s*([\divxlcdm]+)\s*[:.]/iu) ??
    trimmed.match(/^(TABLE)\s+([IVXLCDM\d]+)(?:\s+|$)/u);
  if (!match) {
    return null;
  }
  return {
    kind: /^table$/iu.test(match[1]) ? 'table' : 'figure',
    label: match[2].toUpperCase()
  };
}

function looksLikeProseBoundary(block: ExtractedPdfBlock): boolean {
  if (block.type === 'heading') {
    return true;
  }
  if (block.type !== 'paragraph') {
    return false;
  }
  const words = block.original.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 12 && /[.!?。！？]/u.test(block.original);
}

function normalizePdfLine(value: string): string {
  return value
    .replace(/\s+([,.;:!?%\]])/gu, '$1')
    .replace(/([([])\s+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function horizontalOverlapRatio(left: PdfPaintedImageBounds, right: PdfPaintedImageBounds): number {
  const overlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  return overlap / Math.max(1, Math.min(left.width, right.width));
}

function verticalOverlapRatio(left: PdfPaintedImageBounds, right: PdfPaintedImageBounds): number {
  const overlap = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return overlap / Math.max(1, Math.min(left.height, right.height));
}

function boundsCenterInside(bounds: PdfPaintedImageBounds, container: PdfPaintedImageBounds): boolean {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return centerX >= container.x && centerX <= container.x + container.width && centerY >= container.y && centerY <= container.y + container.height;
}

function unionBounds(bounds: PdfPaintedImageBounds[]): PdfPaintedImageBounds {
  const minX = Math.min(...bounds.map((entry) => entry.x));
  const minY = Math.min(...bounds.map((entry) => entry.y));
  const maxX = Math.max(...bounds.map((entry) => entry.x + entry.width));
  const maxY = Math.max(...bounds.map((entry) => entry.y + entry.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function expandBounds(bounds: PdfPaintedImageBounds, amount: number, limit: PdfPaintedImageBounds): PdfPaintedImageBounds {
  const x = Math.max(limit.x, bounds.x - amount);
  const y = Math.max(limit.y, bounds.y - amount);
  const right = Math.min(limit.x + limit.width, bounds.x + bounds.width + amount);
  const bottom = Math.min(limit.y + limit.height, bounds.y + bounds.height + amount);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function clampBounds(bounds: PdfPaintedImageBounds, pageWidth: number, pageHeight: number): PdfPaintedImageBounds {
  const x = Math.max(0, Math.min(pageWidth - 1, bounds.x));
  const y = Math.max(0, Math.min(pageHeight - 1, bounds.y));
  const right = Math.max(x + 1, Math.min(pageWidth, bounds.x + bounds.width));
  const bottom = Math.max(y + 1, Math.min(pageHeight, bounds.y + bounds.height));
  return { x, y, width: right - x, height: bottom - y };
}

function multiplyMatrices(left: number[], right: number[]): number[] {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function transformPoint(matrix: number[], x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolve) => {
        timeoutId = globalThis.setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
