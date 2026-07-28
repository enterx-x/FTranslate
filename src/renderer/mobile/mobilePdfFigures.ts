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
import type { MobileStructuredTable, MobileTranslationEntry } from './mobileTypes';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const MOBILE_PDF_FIGURE_VERSION = 3;

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
  table?: MobileStructuredTable;
}

export function resolveMobilePdfFigureOrder(
  region: Pick<MobilePdfFigureRegion, 'kind' | 'hasTextCaption' | 'captionHash' | 'order'>,
  captionOrders: ReadonlyMap<string, number>,
  captionTextOrders?: ReadonlyMap<string, number>,
  captionText?: string
): number {
  const captionTextOrder = buildMobilePdfCaptionLookupKeys(captionText ?? '')
    .map((key) => captionTextOrders?.get(key))
    .find((order) => order !== undefined);
  const captionOrder = region.hasTextCaption
    ? captionOrders.get(region.captionHash) ?? captionTextOrder
    : undefined;
  if (captionOrder === undefined || !Number.isFinite(captionOrder)) {
    return region.order;
  }
  return captionOrder + (region.kind === 'table' ? 0.25 : -0.25);
}

export function normalizeMobilePdfCaptionText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

export function buildMobilePdfCaptionLookupKeys(value: string): string[] {
  const normalized = normalizeMobilePdfCaptionText(value);
  if (!normalized) {
    return [];
  }
  const keys = [`text:${normalized}`];
  const label = normalized.match(/^(fig(?:ure)?|table)\.?\s*([ivxlcdm]+|\d+[a-z]?)/iu);
  if (label) {
    keys.push(`label:${label[1].startsWith('fig') ? 'fig' : 'table'}:${label[2]}`);
  }
  return keys;
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
    figureTextHashes: region.hiddenTextHashes,
    ...(region.table ? { figureTable: region.table } : {})
  };
}

interface DetectPdfFigureRegionsInput {
  page: number;
  pageWidth: number;
  pageHeight: number;
  blocks: ExtractedPdfBlock[];
  anchors: PdfCaptionAnchor[];
  imageBounds: PdfPaintedImageBounds[];
  textItems?: PositionedPdfTextItem[];
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
    imageBounds,
    textItems: items
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
    const captionMarkerCount = (
      block.original.match(/\b(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]/giu) ?? []
    ).length;
    const matchingRawLine = block.bounds ? findRawLineAtBounds(rawLines, block.bounds) : undefined;
    if (
      block.type !== 'caption' ||
      !label ||
      !block.bounds ||
      captionMarkerCount > 1 ||
      (matchingRawLine && looksLikeInlineFigureReferenceLine(matchingRawLine, rawLines))
    ) {
      return;
    }
    const key = `${label.kind}:${label.label}`;
    const markerItem = items.find((item) => {
        const itemLabel = parseCaptionLabel(item.str);
        const centerX = item.x + item.width / 2;
        const centerY = item.y + item.height / 2;
        return item.page === block.page &&
          itemLabel?.kind === label.kind &&
          itemLabel.label === label.label &&
          centerX >= block.bounds!.x - 3 &&
          centerX <= block.bounds!.x + block.bounds!.width + 3 &&
          centerY >= block.bounds!.y - 3 &&
          centerY <= block.bounds!.y + block.bounds!.height + 3;
      });
    const firstLineItems = markerItem
      ? items.filter((item) => (
        item.page === markerItem.page &&
        item.x >= block.bounds!.x - 2 &&
        item.x + item.width <= block.bounds!.x + block.bounds!.width + 2 &&
        Math.abs(item.y - markerItem.y) <= Math.max(4, markerItem.height * 0.85)
      ))
      : [];
    const captionItems = markerItem
      ? collectStandaloneCaptionItems(items, markerItem, firstLineItems, label.kind === 'table')
      : [];
    const expandedCaptionBounds = captionItems.length > 0
      ? boundsForPositionedItems(captionItems, markerItem?.pageWidth, markerItem?.pageHeight)
      : block.bounds;
    const hasGeometricContinuation = captionItems.some((item) => (
      item.y > block.bounds!.y + block.bounds!.height + Math.max(0.25, item.height * 0.05)
    ));
    const captionOriginal = hasGeometricContinuation
      ? normalizePositionedCaptionItems(captionItems)
      : block.original;
    anchors.set(key, {
      ...label,
      original: captionOriginal,
      bounds: expandedCaptionBounds,
      captionHash: hasGeometricContinuation
        ? hashText(`caption|${block.page}|${label.kind}|${label.label}|${captionOriginal}`)
        : block.sourceHash,
      hasTextCaption: !hasGeometricContinuation,
      blockOrder: index
    });
  });

  for (const line of rawLines) {
    const label = parseCaptionLabel(line.original);
    const strongCaptionLine = /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*:\s+\p{Lu}/iu.test(line.original.trim());
    if (
      !label ||
      looksLikeInlineFigureReferenceLine(line, rawLines) ||
      (!strongCaptionLine && isBoundsInsideParagraphBlock(line.bounds, blocks))
    ) {
      continue;
    }
    const key = `${label.kind}:${label.label}`;
    if (anchors.has(key)) {
      continue;
    }
    const markerItem = items.find((item) => (
      isStandaloneCaptionMarker(item.str) &&
      parseCaptionLabel(item.str)?.kind === label.kind &&
      parseCaptionLabel(item.str)?.label === label.label &&
      Math.abs(item.y - line.bounds.y) <= Math.max(4, item.height * 0.85) &&
      item.x >= line.bounds.x - 2 &&
      item.x + item.width <= line.bounds.x + line.bounds.width + 2
    ));
    const firstLineItems = markerItem
      ? items.filter((item) => (
        item.page === markerItem.page &&
        item.x >= line.bounds.x - 2 &&
        item.x + item.width <= line.bounds.x + line.bounds.width + 2 &&
        Math.abs(item.y - markerItem.y) <= Math.max(4, markerItem.height * 0.85)
      ))
      : [];
    const captionItems = markerItem
      ? collectStandaloneCaptionItems(items, markerItem, firstLineItems)
      : [];
    const captionBounds = captionItems.length > 0
      ? boundsForPositionedItems(captionItems, markerItem?.pageWidth, markerItem?.pageHeight)
      : line.bounds;
    const captionOriginal = captionItems.length > 0
      ? normalizePositionedCaptionItems(captionItems)
      : line.original;
    const sameScopeBlocks = blocks.filter((block) => block.bounds && horizontalOverlapRatio(block.bounds, captionBounds) > 0.2);
    const nextBlockIndex = blocks.findIndex((block) => (
      sameScopeBlocks.includes(block) && Boolean(block.bounds && block.bounds.y > captionBounds.y)
    ));
    anchors.set(key, {
      ...label,
      original: captionOriginal,
      bounds: captionBounds,
      captionHash: hashText(`caption|${items[0]?.page ?? 1}|${label.kind}|${label.label}|${captionOriginal}`),
      hasTextCaption: false,
      blockOrder: nextBlockIndex >= 0 ? nextBlockIndex : blocks.length
    });
  }

  for (const item of items) {
    const label = parseCaptionLabel(item.str);
    const standaloneCaptionMarker = isStandaloneCaptionMarker(item.str);
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
      (!standaloneCaptionMarker && isBoundsInsideParagraphBlock({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        pageWidth: item.pageWidth,
        pageHeight: item.pageHeight
      }, blocks))
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
    const captionItems = standaloneCaptionMarker
      ? collectStandaloneCaptionItems(items, item, sameLine)
      : sameLine;
    const maxX = Math.max(...captionItems.map((candidate) => candidate.x + candidate.width));
    const maxY = Math.max(...captionItems.map((candidate) => candidate.y + candidate.height));
    const bounds: PdfBlockBounds = {
      x: item.x,
      y: Math.min(...captionItems.map((candidate) => candidate.y)),
      width: Math.max(1, maxX - item.x),
      height: Math.max(1, maxY - Math.min(...captionItems.map((candidate) => candidate.y))),
      pageWidth: item.pageWidth,
      pageHeight: item.pageHeight
    };
    const original = normalizePositionedCaptionItems(captionItems);
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
  const minimumTableHeight = Math.max(24, input.pageHeight * 0.03);
  const pageMarginY = Math.max(18, input.pageHeight * 0.045);
  const sortedAnchors = [...input.anchors].sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);

  return sortedAnchors.flatMap((anchor): MobilePdfFigureRegion[] => {
    const scope = anchor.kind === 'table'
      ? expandTableCaptionScope(resolveCaptionScope(anchor.bounds, input.pageWidth, input.pageHeight), anchor.bounds, input.pageWidth)
      : resolveCaptionScope(anchor.bounds, input.pageWidth, input.pageHeight);
    const sameScopeAnchors = sortedAnchors.filter((candidate) => (
      candidate !== anchor && horizontalOverlapRatio(candidate.bounds, scope) > 0.5
    ));
    const unresolvedForwardRoughBounds = anchor.kind === 'table'
      ? resolveTableBounds(anchor, sameScopeAnchors, input.blocks, scope, input.pageHeight, minimumTableHeight)
      : resolveFigureBounds(anchor, sameScopeAnchors, input.blocks, scope, pageMarginY, minimumHeight);
    const forwardRoughBounds = anchor.kind === 'table' && input.textItems && unresolvedForwardRoughBounds
      ? trimTableBoundsAtTextGap(input.textItems, scope, unresolvedForwardRoughBounds, minimumTableHeight)
      : unresolvedForwardRoughBounds;
    const forwardStructuredTable = anchor.kind === 'table' && input.textItems && forwardRoughBounds
      ? reconstructPdfTableFromTextItems(input.textItems, anchor, scope, forwardRoughBounds)
      : null;
    const reverseStructuredTable = anchor.kind === 'table' && input.textItems && !forwardStructuredTable
      ? reconstructPdfTableAboveCaption(input.textItems, anchor, scope, input.pageHeight, minimumTableHeight)
      : null;
    const structuredTable = forwardStructuredTable ?? reverseStructuredTable;
    const roughBounds = structuredTable?.bounds ?? forwardRoughBounds;
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
    const paintedContentBounds = usePaintedUnion && input.textItems
      ? expandPaintedBoundsWithAdjacentText(paintedUnion!, input.textItems, roughBounds, anchor.bounds, input.pageWidth, input.pageHeight)
      : paintedUnion;
    const wideCaptionContentBounds = usePaintedUnion && input.textItems
      ? expandPaintedBoundsAcrossWideCaption(
          paintedContentBounds!,
          input.textItems,
          roughBounds,
          anchor.bounds,
          input.pageWidth,
          input.pageHeight
        )
      : paintedContentBounds;
    const wideCaptionVectorBounds = !structuredTable && !usePaintedUnion && input.textItems && anchor.kind === 'figure'
      ? expandPaintedBoundsAcrossWideCaption(
          roughBounds,
          input.textItems,
          roughBounds,
          anchor.bounds,
          input.pageWidth,
          input.pageHeight
        )
      : roughBounds;
    const paintedCropLimit = anchor.kind === 'figure' && anchor.bounds.width >= input.pageWidth * 0.62
      ? { x: 0, y: roughBounds.y, width: input.pageWidth, height: roughBounds.height }
      : roughBounds;
    const unresolvedCrop = structuredTable?.bounds ??
      (usePaintedUnion ? expandBounds(wideCaptionContentBounds!, 4, paintedCropLimit) : wideCaptionVectorBounds);
    const heightLimitedCrop = !structuredTable && !usePaintedUnion && unresolvedCrop.height > input.pageHeight * 0.5
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
    if (
      crop.width < 40 ||
      (!structuredTable && crop.height < (anchor.kind === 'table' ? minimumTableHeight : minimumHeight))
    ) {
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
      crop.height.toFixed(2),
      structuredTable ? JSON.stringify(structuredTable.table) : ''
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
      hiddenTextHashes,
      ...(structuredTable ? { table: structuredTable.table } : {})
    }];
  });
}

interface PdfTableTextSegment extends PdfPaintedImageBounds {
  text: string;
}

interface PdfTableTextLine {
  y: number;
  height: number;
  segments: PdfTableTextSegment[];
}

interface ReconstructedPdfTable {
  table: MobileStructuredTable;
  bounds: PdfPaintedImageBounds;
}

export function reconstructPdfTableFromTextItems(
  items: PositionedPdfTextItem[],
  anchor: PdfCaptionAnchor,
  scope: PdfBlockBounds,
  roughBounds: PdfPaintedImageBounds
): ReconstructedPdfTable | null {
  return reconstructPdfTableFromTextItemsAtDensity(items, anchor, scope, roughBounds, false) ??
    reconstructPdfTableFromTextItemsAtDensity(items, anchor, scope, roughBounds, true);
}

function reconstructPdfTableFromTextItemsAtDensity(
  items: PositionedPdfTextItem[],
  anchor: PdfCaptionAnchor,
  scope: PdfBlockBounds,
  roughBounds: PdfPaintedImageBounds,
  compactColumns: boolean
): ReconstructedPdfTable | null {
  const lines = buildPdfTableTextLines(items, scope, roughBounds, compactColumns);
  const multiCellLines = lines.filter((line) => line.segments.length >= 2 && line.segments.length <= 12);
  if (multiCellLines.length < 3) {
    return null;
  }

  const countFrequency = new Map<number, number>();
  multiCellLines.forEach((line) => {
    countFrequency.set(line.segments.length, (countFrequency.get(line.segments.length) ?? 0) + 1);
  });
  const [modalColumnCount, modalFrequency = 0] = [...countFrequency.entries()]
    .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0] ?? [];
  const firstMultiCellLine = multiCellLines[0];
  const headerAddsSparseLeadingColumn = Boolean(
    modalColumnCount &&
    firstMultiCellLine &&
    firstMultiCellLine.segments.length === modalColumnCount + 1 &&
    firstMultiCellLine.segments.length <= 12 &&
    modalFrequency >= 2
  );
  const columnCount = headerAddsSparseLeadingColumn
    ? firstMultiCellLine.segments.length
    : modalColumnCount;
  const frequency = countFrequency.get(columnCount ?? 0) ?? 0;
  if (
    !columnCount ||
    columnCount < 2 ||
    columnCount > 12 ||
    (!headerAddsSparseLeadingColumn && frequency < (columnCount === 2 ? 3 : 2))
  ) {
    return null;
  }

  const dominantLines = lines.filter((line) => line.segments.length === columnCount);
  if (dominantLines.length < (headerAddsSparseLeadingColumn ? 1 : 2)) {
    return null;
  }
  const columnCenters = Array.from({ length: columnCount }, (_, columnIndex) => medianNumber(
    dominantLines.map((line) => {
      const segment = line.segments[columnIndex];
      return segment.x + segment.width / 2;
    })
  ));
  if (columnCenters.some((center, index) => (
    !Number.isFinite(center) || (index > 0 && center - columnCenters[index - 1] < 10)
  ))) {
    return null;
  }

  const firstMultiCellIndex = lines.findIndex((line) => line.segments.length >= 2);
  const firstDominantIndex = lines.findIndex((line) => line.segments.length === columnCount);
  if (firstMultiCellIndex < 0 || firstDominantIndex < firstMultiCellIndex || firstDominantIndex - firstMultiCellIndex > 5) {
    return null;
  }
  const hasWrappedHeader = firstDominantIndex > firstMultiCellIndex;
  const headerStartIndex = firstMultiCellIndex;
  const bodyStartIndex = hasWrappedHeader ? firstDominantIndex : firstDominantIndex + 1;
  const minimumPopulatedCells = Math.max(2, Math.ceil(columnCount * 0.6));
  const assignedLines = lines.map((line) => assignPdfTableLine(line, columnCenters));
  const strongBodyIndices = assignedLines
    .map((cells, index) => ({ cells, index }))
    .filter(({ cells, index }) => index >= bodyStartIndex && countPopulatedTableCells(cells) >= minimumPopulatedCells)
    .map(({ index }) => index);
  if (strongBodyIndices.length < 2) {
    return null;
  }
  const candidateLastBodyIndex = strongBodyIndices[strongBodyIndices.length - 1];
  const adjacentLineSteps = lines
    .slice(headerStartIndex, candidateLastBodyIndex + 1)
    .slice(1)
    .map((line, index) => line.y - lines[headerStartIndex + index].y)
    .filter((step) => step > 0);
  const typicalLineStep = medianNumber(adjacentLineSteps) || 8;
  const tableBreakThreshold = Math.max(22, typicalLineStep * 2.4);
  let lastBodyIndex = candidateLastBodyIndex;
  let strongRowsBeforeBreak = 0;
  for (let index = bodyStartIndex; index <= candidateLastBodyIndex; index += 1) {
    if (countPopulatedTableCells(assignedLines[index]) >= minimumPopulatedCells) {
      strongRowsBeforeBreak += 1;
    }
    if (
      index > bodyStartIndex &&
      strongRowsBeforeBreak >= 2 &&
      lines[index].y - lines[index - 1].y > tableBreakThreshold
    ) {
      lastBodyIndex = index - 1;
      break;
    }
  }
  if (lastBodyIndex === candidateLastBodyIndex) {
    for (let index = candidateLastBodyIndex + 1; index < lines.length; index += 1) {
      const gap = lines[index].y - lines[index - 1].y;
      if (gap > Math.max(36, typicalLineStep * 4)) {
        break;
      }
      if (looksLikePdfTableSummaryCells(assignedLines[index])) {
        lastBodyIndex = index;
        break;
      }
      if (countPopulatedTableCells(assignedLines[index]) >= minimumPopulatedCells) {
        break;
      }
    }
  }
  const selectedLines = lines.slice(headerStartIndex, lastBodyIndex + 1);
  const selectedAssignedLines = assignedLines.slice(headerStartIndex, lastBodyIndex + 1);

  const headerLineCount = Math.max(1, bodyStartIndex - headerStartIndex);
  const headers = Array.from({ length: columnCount }, () => '');
  selectedAssignedLines.slice(0, headerLineCount).forEach((cells) => appendPdfTableCells(headers, cells));
  if (headers.filter(Boolean).length < Math.ceil(columnCount * 0.7)) {
    return null;
  }

  const bodyLines = selectedLines.slice(headerLineCount);
  const bodyCells = selectedAssignedLines.slice(headerLineCount);
  const strongBodyY = bodyLines
    .map((line, index) => ({ line, cells: bodyCells[index] }))
    .filter(({ cells }) => countPopulatedTableCells(cells) >= minimumPopulatedCells)
    .map(({ line }) => line.y);
  const rowStep = medianNumber(strongBodyY.slice(1).map((y, index) => y - strongBodyY[index])) || 8;
  const rows: string[][] = [];
  bodyLines.forEach((line, index) => {
    const cells = bodyCells[index];
    const previousLine = bodyLines[index - 1];
    const populatedCells = countPopulatedTableCells(cells);
    const summaryRow = looksLikePdfTableSummaryCells(cells);
    const continuesPrevious = !summaryRow && rows.length > 0 && Boolean(previousLine) && (
      line.y - previousLine.y < Math.max(2.8, rowStep * 0.62) ||
      populatedCells < minimumPopulatedCells
    );
    if (continuesPrevious) {
      appendPdfTableCells(rows[rows.length - 1], cells);
    } else if (populatedCells >= minimumPopulatedCells || summaryRow) {
      rows.push(cells.map((cell) => normalizePdfTableCell(cell)));
    }
  });

  const normalizedHeaders = headers.map((header) => normalizePdfTableCell(header));
  const normalizedRows = normalizeSparseLeadingTableGroups(rows
    .map((row) => row.map((cell) => normalizePdfTableCell(cell)))
    .filter((row) => (
      countPopulatedTableCells(row) >= minimumPopulatedCells ||
      looksLikePdfTableSummaryCells(row)
    )));
  const populatedRatio = normalizedRows.reduce(
    (total, row) => total + countPopulatedTableCells(row),
    0
  ) / Math.max(1, normalizedRows.length * columnCount);
  const averageCellLength = normalizedRows.flat().reduce((total, cell) => total + cell.length, 0) /
    Math.max(1, normalizedRows.length * columnCount);
  const averageHeaderLength = normalizedHeaders.reduce((total, header) => total + header.length, 0) /
    Math.max(1, normalizedHeaders.length);
  const maximumCellLength = Math.max(0, ...normalizedRows.flat().map((cell) => cell.length));
  const formulaHeavyCellRatio = normalizedRows.flat().filter(isFormulaHeavyTableCell).length /
    Math.max(1, normalizedRows.length * columnCount);
  const repeatedHeaderToken = hasRepeatedPdfTableHeaderToken(normalizedHeaders);
  const numericHeaderRatio = calculatePdfTableNumericHeaderRatio(normalizedHeaders);
  const hasIndexedColumnHeader = normalizedHeaders.some((header) =>
    /\b(?:rollout|trial|episode|index|step|task)\b/iu.test(header)
  );
  if (
    normalizedRows.length < 2 ||
    (columnCount >= 3 && normalizedHeaders.some((header) => !header)) ||
    populatedRatio < 0.68 ||
    averageCellLength > (columnCount === 2 ? 72 : 110) ||
    maximumCellLength > 260 ||
    (normalizedRows.length <= 3 && maximumCellLength > 180) ||
    (formulaHeavyCellRatio >= 0.55 && averageHeaderLength > 28) ||
    (columnCount === 2 && repeatedHeaderToken) ||
    (numericHeaderRatio >= 0.55 && !hasIndexedColumnHeader)
  ) {
    return null;
  }

  const tableSegments = selectedLines.flatMap((line) => line.segments);
  const minX = Math.min(...tableSegments.map((segment) => segment.x));
  const minY = Math.min(...tableSegments.map((segment) => segment.y));
  const maxX = Math.max(...tableSegments.map((segment) => segment.x + segment.width));
  const maxY = Math.max(...tableSegments.map((segment) => segment.y + segment.height));
  const bounds = clampBounds({
    x: Math.max(scope.x, minX - 5),
    y: Math.max(roughBounds.y, minY - 4),
    width: Math.min(scope.x + scope.width, maxX + 5) - Math.max(scope.x, minX - 5),
    height: Math.min(roughBounds.y + roughBounds.height, maxY + 4) - Math.max(roughBounds.y, minY - 4)
  }, anchor.bounds.pageWidth ?? scope.x + scope.width, anchor.bounds.pageHeight ?? roughBounds.y + roughBounds.height);

  return {
    table: { headers: normalizedHeaders, rows: normalizedRows },
    bounds
  };
}

function buildPdfTableTextLines(
  items: PositionedPdfTextItem[],
  scope: PdfBlockBounds,
  roughBounds: PdfPaintedImageBounds,
  compactColumns: boolean
): PdfTableTextLine[] {
  const candidates = items.filter((item) => {
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    return (
      centerX >= scope.x && centerX <= scope.x + scope.width &&
      centerY >= roughBounds.y && centerY <= roughBounds.y + roughBounds.height
    );
  }).sort((left, right) => left.y - right.y || left.x - right.x);
  const groups: PositionedPdfTextItem[][] = [];
  for (const item of candidates) {
    const group = groups.find((candidate) => (
      Math.abs(medianNumber(candidate.map((entry) => entry.y)) - item.y) <= Math.max(1.8, Math.min(2.6, item.height * 0.42))
    ));
    if (group) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups.flatMap((group): PdfTableTextLine[] => {
    const sorted = [...group].sort((left, right) => left.x - right.x);
    const medianHeight = medianNumber(sorted.map((item) => item.height)) || 6;
    // Academic tables often leave only a narrow printable gutter between a
    // range cell and the next label. A prose-sized gap merges those columns.
    const segmentGap = compactColumns
      ? Math.max(2.2, medianHeight * 0.32)
      : Math.max(5.5, medianHeight * 0.8);
    const segmentGroups: PositionedPdfTextItem[][] = [];
    for (const item of sorted) {
      const segment = segmentGroups[segmentGroups.length - 1];
      const previous = segment?.[segment.length - 1];
      if (!segment || (previous && item.x - (previous.x + previous.width) > segmentGap)) {
        segmentGroups.push([item]);
      } else {
        segment.push(item);
      }
    }
    const segments = segmentGroups.flatMap((segmentItems): PdfTableTextSegment[] => {
      const text = normalizePdfLine(segmentItems.map((item) => item.str).join(' '));
      if (!text) {
        return [];
      }
      const minX = Math.min(...segmentItems.map((item) => item.x));
      const minY = Math.min(...segmentItems.map((item) => item.y));
      const maxX = Math.max(...segmentItems.map((item) => item.x + item.width));
      const maxY = Math.max(...segmentItems.map((item) => item.y + item.height));
      return [{ text, x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
    });
    return segments.length > 0
      ? [{
          y: medianNumber(sorted.map((item) => item.y)),
          height: medianHeight,
          segments
        }]
      : [];
  }).sort((left, right) => left.y - right.y);
}

function assignPdfTableLine(line: PdfTableTextLine, columnCenters: number[]): string[] {
  const cells = Array.from({ length: columnCenters.length }, () => '');
  for (const segment of line.segments) {
    const center = segment.x + segment.width / 2;
    const columnIndex = columnCenters.reduce((bestIndex, candidate, index) => (
      Math.abs(candidate - center) < Math.abs(columnCenters[bestIndex] - center) ? index : bestIndex
    ), 0);
    cells[columnIndex] = joinPdfTableCellText(cells[columnIndex], segment.text);
  }
  return cells;
}

function appendPdfTableCells(target: string[], incoming: string[]): void {
  incoming.forEach((cell, index) => {
    target[index] = joinPdfTableCellText(target[index] ?? '', cell);
  });
}

function joinPdfTableCellText(left: string, right: string): string {
  const previous = left.trim();
  const next = right.trim();
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }
  return /[-\u00ad\u2010-\u2015]$/u.test(previous)
    ? `${previous}${next}`
    : `${previous} ${next}`;
}

function normalizePdfTableCell(value: string): string {
  return normalizePdfLine(value).replace(/\s*\u0000\s*/gu, ' ').trim();
}

function countPopulatedTableCells(cells: string[]): number {
  return cells.filter((cell) => cell.trim()).length;
}

function looksLikePdfTableSummaryCells(cells: string[]): boolean {
  const populated = cells.filter((cell) => cell.trim());
  return populated.length >= 2 &&
    populated.length <= 3 &&
    /^(?:total|average|mean|overall|all)\b/iu.test(populated[0]);
}

function normalizeSparseLeadingTableGroups(rows: string[][]): string[][] {
  if (rows.length < 4 || rows[0]?.length < 2) {
    return rows;
  }
  const labelIndices = rows
    .map((row, index) => ({ index, label: row[0]?.trim() ?? '' }))
    .filter(({ label }) => Boolean(label))
    .map(({ index }) => index);
  const emptyLeadingCells = rows.length - labelIndices.length;
  if (labelIndices.length < 2 || emptyLeadingCells < 2) {
    return rows;
  }
  const normalized = rows.map((row) => [...row]);
  labelIndices.forEach((labelIndex, groupIndex) => {
    const targetIndex = groupIndex === 0
      ? 0
      : Math.floor((labelIndices[groupIndex - 1] + labelIndex) / 2);
    if (
      targetIndex < labelIndex &&
      !normalized[targetIndex][0]?.trim()
    ) {
      normalized[targetIndex][0] = normalized[labelIndex][0];
      normalized[labelIndex][0] = '';
    }
  });
  return normalized;
}

function isFormulaHeavyTableCell(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  const formulaTokens = text.match(/:=|\|\||[_^]|[=+*/<>]|[∑∏√στωφθψ]/gu) ?? [];
  return formulaTokens.length >= 2 || (formulaTokens.length >= 1 && /\d/u.test(text));
}

function hasRepeatedPdfTableHeaderToken(headers: string[]): boolean {
  const tokens = headers
    .join(' ')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const structuralTokens = new Set(['term', 'weight', 'method', 'range', 'parameter', 'metric', 'value']);
  const frequency = new Map<string, number>();
  tokens.forEach((token) => {
    if (structuralTokens.has(token)) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  });
  return [...frequency.values()].some((count) => count >= 2);
}

function calculatePdfTableNumericHeaderRatio(headers: string[]): number {
  const tokens = headers.join(' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  const numericTokens = tokens.filter((token) => /^\d+$/u.test(token)).length;
  return numericTokens / Math.max(1, tokens.length);
}

function medianNumber(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
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
  const normalized = line.original.trim();
  if (!/^(?:fig\.?|figure|table)\s*[\divxlcdm]+[:.]/iu.test(normalized)) {
    return false;
  }
  const strongCaptionWords = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    /^(?:fig\.?|figure|table)\s*[\divxlcdm]+\s*:\s+\p{Lu}/iu.test(normalized) &&
    strongCaptionWords.length >= 6
  ) {
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
  const proseConnectors = previous.original.match(
    /\b(?:a|an|and|are|as|at|by|for|from|given|in|is|of|on|the|to|was|were|with)\b/giu
  ) ?? [];
  return words.length >= 6 &&
    proseConnectors.length >= 2 &&
    !/[.!?。！？][)\]"']*$/u.test(previous.original.trim());
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
    const pageWidth = line.find((item) => typeof item.pageWidth === 'number' && item.pageWidth > 0)?.pageWidth ?? 0;
    for (const item of line.sort((left, right) => left.x - right.x)) {
      const segment = segments[segments.length - 1];
      const previous = segment?.[segment.length - 1];
      const separatesParallelCaptions = Boolean(
        segment &&
        pageWidth > 0 &&
        segment.some((candidate) => /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]/iu.test(candidate.str.trim())) &&
        /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]/iu.test(item.str.trim()) &&
        segment[0].x < pageWidth / 2 &&
        item.x >= pageWidth / 2
      );
      if (!segment || separatesParallelCaptions || (previous && item.x - (previous.x + previous.width) > 34)) {
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
      (
        block.type === 'heading' ||
        block.bounds.width >= scope.width * 0.72
      ) &&
      block.bounds.y > top + minimumHeight
    )).map((block) => block.bounds!.y - 6)
  ].reduce((nearest, y) => Math.min(nearest, y), pageHeight - Math.max(18, pageHeight * 0.045));
  const bottom = nextBoundary;
  return bottom - top >= minimumHeight
    ? { x: scope.x, y: top, width: scope.width, height: bottom - top }
    : null;
}

function trimTableBoundsAtTextGap(
  items: PositionedPdfTextItem[],
  scope: PdfBlockBounds,
  roughBounds: PdfPaintedImageBounds,
  minimumHeight: number
): PdfPaintedImageBounds {
  const candidates = items
    .filter((item) => {
      const centerX = item.x + item.width / 2;
      const centerY = item.y + item.height / 2;
      return centerX >= scope.x &&
        centerX <= scope.x + scope.width &&
        centerY >= roughBounds.y &&
        centerY <= roughBounds.y + roughBounds.height;
    })
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const rows: Array<{ y: number; bottom: number; text: string }> = [];
  for (const item of candidates) {
    const row = rows.find((candidate) => (
      Math.abs(candidate.y - item.y) <= Math.max(2.5, item.height * 0.45)
    ));
    if (row) {
      row.y = Math.min(row.y, item.y);
      row.bottom = Math.max(row.bottom, item.y + item.height);
      row.text = `${row.text} ${item.str}`.trim();
    } else {
      rows.push({ y: item.y, bottom: item.y + item.height, text: item.str });
    }
  }
  rows.sort((left, right) => left.y - right.y);
  if (rows.length < 7) {
    return roughBounds;
  }
  const rowSteps = rows.slice(1).map((row, index) => row.y - rows[index].y).filter((step) => step > 0);
  const typicalStep = medianNumber(rowSteps) || 8;
  const breakThreshold = Math.max(22, typicalStep * 2.25);
  const breakIndex = rows.findIndex((row, index) => (
    index >= 5 &&
    row.y - rows[index - 1].y > breakThreshold &&
    !/^(?:total|average|mean|overall|all)\b/iu.test(row.text.trim())
  ));
  if (breakIndex < 0) {
    return roughBounds;
  }
  const bottom = Math.min(
    roughBounds.y + roughBounds.height,
    rows[breakIndex - 1].bottom + 5
  );
  return bottom - roughBounds.y >= minimumHeight
    ? { ...roughBounds, height: bottom - roughBounds.y }
    : roughBounds;
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
  if (looksLikeDenseTableText(original)) {
    return false;
  }
  if (/^[+\-−–—±]?\d+(?:\.\d+)?\s+\p{Ll}/u.test(original)) {
    return false;
  }
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
  const figureGutterAllowance = Math.max(8, gutter);
  return bounds.x + bounds.width / 2 <= split
    ? { x: margin, y: 0, width: split + figureGutterAllowance - margin, height: pageHeight }
    : {
        x: split - figureGutterAllowance,
        y: 0,
        width: pageWidth - margin - split + figureGutterAllowance,
        height: pageHeight
      };
}

function expandTableCaptionScope(
  scope: PdfBlockBounds,
  captionBounds: PdfBlockBounds,
  pageWidth: number
): PdfBlockBounds {
  const expandedX = Math.max(0, Math.min(scope.x, captionBounds.x - 8));
  const right = Math.min(pageWidth, scope.x + scope.width);
  return {
    ...scope,
    x: expandedX,
    width: Math.max(1, right - expandedX)
  };
}

function reconstructPdfTableAboveCaption(
  items: PositionedPdfTextItem[],
  anchor: PdfCaptionAnchor,
  scope: PdfBlockBounds,
  pageHeight: number,
  minimumHeight: number
): ReconstructedPdfTable | null {
  const bottom = anchor.bounds.y - 5;
  if (bottom <= minimumHeight) {
    return null;
  }
  const candidates = [0.12, 0.2, 0.32, 0.48]
    .map((pageFraction) => {
      const top = Math.max(0, bottom - Math.max(minimumHeight, pageHeight * pageFraction));
      return reconstructPdfTableFromTextItems(items, anchor, scope, {
        x: scope.x,
        y: top,
        width: scope.width,
        height: bottom - top
      });
    })
    .filter((candidate): candidate is ReconstructedPdfTable => Boolean(candidate));
  return candidates.sort((left, right) => (
    right.table.rows.length - left.table.rows.length ||
    right.table.headers.filter(Boolean).length - left.table.headers.filter(Boolean).length ||
    left.bounds.height - right.bounds.height
  ))[0] ?? null;
}

function isStandaloneCaptionMarker(value: string): boolean {
  return /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]$/iu.test(value.trim());
}

function collectStandaloneCaptionItems(
  items: PositionedPdfTextItem[],
  anchor: PositionedPdfTextItem,
  firstLine: PositionedPdfTextItem[],
  stopAtSentenceBoundary = false
): PositionedPdfTextItem[] {
  const maximumBottom = anchor.y + Math.max(72, (anchor.pageHeight ?? 792) * 0.13);
  const pageWidth = anchor.pageWidth ?? 0;
  const firstLineMinX = Math.min(...firstLine.map((candidate) => candidate.x));
  const firstLineMaxX = Math.max(...firstLine.map((candidate) => candidate.x + candidate.width));
  const firstLineSpansPage = pageWidth > 0 && (
    firstLineMaxX - firstLineMinX >= pageWidth * 0.56 ||
    (firstLineMinX < pageWidth * 0.42 && firstLineMaxX > pageWidth * 0.58)
  );
  const maximumRight = firstLineSpansPage
    ? pageWidth
    : pageWidth > 0 && anchor.x < pageWidth * 0.48
    ? pageWidth * 0.52
    : pageWidth || Number.POSITIVE_INFINITY;
  const candidates = items
    .filter((candidate) => (
      candidate.page === anchor.page &&
      candidate.y >= anchor.y - Math.max(2, anchor.height * 0.3) &&
      candidate.y <= maximumBottom &&
      candidate.x >= anchor.x - 2 &&
      candidate.x + candidate.width <= maximumRight + 2
    ))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const rows: PositionedPdfTextItem[][] = [];
  for (const candidate of candidates) {
    const row = rows.find((entries) => (
      Math.abs(entries[0].y - candidate.y) <= Math.max(2.5, entries[0].height * 0.55, candidate.height * 0.55)
    ));
    if (row) {
      row.push(candidate);
    } else {
      rows.push([candidate]);
    }
  }
  const collected = [...firstLine];
  const collectedEndsSentence = (): boolean => /[.!?。！？]\s*$/u.test(
    [...collected]
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((candidate) => candidate.str)
      .join(' ')
      .trim()
  );
  if (stopAtSentenceBoundary && collectedEndsSentence()) {
    return Array.from(new Set(collected));
  }
  let previousBottom = Math.max(...firstLine.map((candidate) => candidate.y + candidate.height));
  for (const row of rows) {
    const rowTop = Math.min(...row.map((candidate) => candidate.y));
    if (rowTop <= anchor.y + Math.max(2.5, anchor.height * 0.55)) {
      continue;
    }
    const medianHeight = medianNumber(row.map((candidate) => candidate.height)) || anchor.height;
    if (rowTop - previousBottom > Math.max(10, medianHeight * 1.5)) {
      break;
    }
    if (stopAtSentenceBoundary && looksLikeTableRowAfterCaption(row)) {
      break;
    }
    collected.push(...row);
    previousBottom = Math.max(...row.map((candidate) => candidate.y + candidate.height));
    if (stopAtSentenceBoundary && collectedEndsSentence()) {
      break;
    }
    if (collected.length >= 48) {
      break;
    }
  }
  return Array.from(new Set(collected));
}

function looksLikeTableRowAfterCaption(row: PositionedPdfTextItem[]): boolean {
  const ordered = row
    .filter((item) => item.str.trim())
    .sort((left, right) => left.x - right.x);
  if (ordered.length < 2) {
    return false;
  }
  const medianHeight = medianNumber(ordered.map((item) => item.height)) || 8;
  const cellGap = Math.max(10, medianHeight * 1.25);
  return ordered.slice(1).some((item, index) => (
    item.x - (ordered[index].x + ordered[index].width) >= cellGap
  ));
}

function boundsForPositionedItems(
  items: PositionedPdfTextItem[],
  pageWidth?: number,
  pageHeight?: number
): PdfBlockBounds {
  const minX = Math.min(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    pageWidth,
    pageHeight
  };
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

function looksLikeFigureInteriorText(value: string): boolean {
  const text = value.trim();
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const numericWords = words.filter((word) => /\d/u.test(word)).length;
  const panelMarkers = text.match(/\([a-z]\)/gu) ?? [];
  const chartUnits = text.match(/\((?:m|s|deg|rad|hz|kg|n)\)/giu) ?? [];
  return panelMarkers.length >= 2 ||
    chartUnits.length >= 2 ||
    (words.length >= 8 && numericWords / words.length >= 0.34) ||
    looksLikeDenseTableText(text);
}

function looksLikeDenseTableText(value: string): boolean {
  const text = value.trim();
  const decimalValues = text.match(/(?:^|\s)[+\-−–—±]?\d+\.\d+(?=\s|$)/gu) ?? [];
  const categoricalCells = text.match(
    /\b(?:real(?:\/sim)?|sim|grp(?:\/dex)?|dex|ego|wrist|3rd|hours?|source)\b/giu
  ) ?? [];
  return decimalValues.length >= 4 || categoricalCells.length >= 6;
}

function looksLikeProseBoundary(block: ExtractedPdfBlock): boolean {
  if (block.type === 'heading') {
    return true;
  }
  if (block.type !== 'paragraph') {
    return false;
  }
  if (looksLikeFigureInteriorText(block.original)) {
    return false;
  }
  const words = block.original.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 12 && /[.!?。！？]/u.test(block.original);
}

function normalizePdfLine(value: string): string {
  return value
    .replace(/\s+([,.;:!?%\]])/gu, '$1')
    .replace(/([([])\s+/gu, '$1')
    .replace(/(\d)\.\s+(\d)/gu, '$1.$2')
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1-$2')
    .replace(/(\d)\s*\/\s*(\d)/gu, '$1/$2')
    .replace(/\s+([’'])s\b/gu, '$1s')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizePositionedCaptionItems(items: PositionedPdfTextItem[]): string {
  const sorted = [...items].sort((left, right) => left.y - right.y || left.x - right.x);
  let value = '';
  let previous: PositionedPdfTextItem | undefined;
  for (const item of sorted) {
    const text = item.str.trim();
    if (!text) {
      continue;
    }
    const startsWrappedLine = Boolean(previous) &&
      Math.abs(item.y - previous!.y) > Math.max(2.5, item.height * 0.55, previous!.height * 0.55);
    if (startsWrappedLine && /(\p{L})-$/u.test(value) && /^\p{Ll}/u.test(text)) {
      value = `${value.slice(0, -1)}${text}`;
    } else {
      value = value ? `${value} ${text}` : text;
    }
    previous = item;
  }
  return normalizePdfLine(value);
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

function expandPaintedBoundsWithAdjacentText(
  paintedBounds: PdfPaintedImageBounds,
  items: PositionedPdfTextItem[],
  roughBounds: PdfPaintedImageBounds,
  captionBounds: PdfBlockBounds,
  pageWidth: number,
  pageHeight: number
): PdfPaintedImageBounds {
  let expanded = paintedBounds;
  const proximity = Math.max(16, Math.min(pageWidth, pageHeight) * 0.03);
  for (let pass = 0; pass < 3; pass += 1) {
    const neighborhood = expandBounds(expanded, proximity, roughBounds);
    const adjacentText = items
      .map((item): PdfPaintedImageBounds => ({
        x: item.x,
        y: item.y,
        width: Math.max(1, item.width),
        height: Math.max(1, item.height)
      }))
      .filter((bounds) => (
        boundsCenterInside(bounds, roughBounds) &&
        boundsCenterInside(bounds, neighborhood) &&
        !boundsCenterInside(bounds, expandBounds(captionBounds, 3, {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight
        }))
      ));
    if (adjacentText.length === 0) {
      break;
    }
    const next = unionBounds([expanded, ...adjacentText]);
    if (
      Math.abs(next.x - expanded.x) < 0.1 &&
      Math.abs(next.y - expanded.y) < 0.1 &&
      Math.abs(next.width - expanded.width) < 0.1 &&
      Math.abs(next.height - expanded.height) < 0.1
    ) {
      break;
    }
    expanded = next;
  }
  return expanded;
}

function expandPaintedBoundsAcrossWideCaption(
  paintedBounds: PdfPaintedImageBounds,
  items: PositionedPdfTextItem[],
  roughBounds: PdfPaintedImageBounds,
  captionBounds: PdfBlockBounds,
  pageWidth: number,
  pageHeight: number
): PdfPaintedImageBounds {
  if (captionBounds.width < pageWidth * 0.62) {
    return paintedBounds;
  }
  const verticalMargin = Math.max(18, Math.min(pageWidth, pageHeight) * 0.035);
  const verticalBand = {
    x: roughBounds.x,
    y: Math.max(roughBounds.y, paintedBounds.y - verticalMargin),
    width: roughBounds.width,
    height: Math.min(
      roughBounds.y + roughBounds.height,
      paintedBounds.y + paintedBounds.height + verticalMargin
    ) - Math.max(roughBounds.y, paintedBounds.y - verticalMargin)
  };
  const captionExclusion = expandBounds(captionBounds, 3, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight
  });
  const distantFigureLabels = items
    .filter((item) => isLikelyFigureLabelText(item.str))
    .map((item): PdfPaintedImageBounds => ({
      x: item.x,
      y: item.y,
      width: Math.max(1, item.width),
      height: Math.max(1, item.height)
    }))
    .filter((bounds) => {
      const centerY = bounds.y + bounds.height / 2;
      return centerY >= verticalBand.y &&
        centerY <= verticalBand.y + verticalBand.height &&
        horizontalOverlapRatio(bounds, verticalBand) > 0.2 &&
        !boundsCenterInside(bounds, captionExclusion);
    });
  if (distantFigureLabels.length === 0) {
    return paintedBounds;
  }
  return unionBounds([paintedBounds, ...distantFigureLabels]);
}

function isLikelyFigureLabelText(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 140) {
    return false;
  }
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length <= 24 && !(words.length >= 12 && /[.!?。！？]\s*$/u.test(text));
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
