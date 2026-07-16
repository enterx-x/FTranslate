import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import type {
  PresentationDraft,
  PresentationFigureCandidate,
  PresentationFigureCropBox
} from './presentationOutline';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface RenderedPdfPage {
  canvas: HTMLCanvasElement;
  scale: number;
  renderOriginX: number;
  renderOriginY: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  nativeImages: PdfNativeImageAsset[];
}

export interface FigureExtractionProgress {
  processed: number;
  total: number;
  pageNumber: number;
  stage: 'rendering-page' | 'extracting-figure';
}

export interface PdfFigurePagePreview {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  pageWidth: number;
  pageHeight: number;
}

interface FigureCropOptions {
  maxFigures?: number;
  renderScale?: number;
  isCancelled?: () => boolean;
  onFigureExtracted?: (figure: PresentationFigureCandidate) => void;
  onProgress?: (progress: FigureExtractionProgress) => void;
}

const DEFAULT_RENDER_SCALE = 2;
const DEFAULT_MAX_FIGURES = 10;
const MIN_NATIVE_IMAGE_AREA_RATIO = 0.08;
const MIN_NATIVE_IMAGE_PANEL_AREA_RATIO = 0.012;
const MIN_NATIVE_IMAGE_CROP_OVERLAP_RATIO = 0.1;
const MIN_NATIVE_IMAGE_PANEL_CROP_OVERLAP_RATIO = 0.025;
const MIN_NATIVE_IMAGE_SELF_OVERLAP_RATIO = 0.55;
const MIN_NATIVE_IMAGE_DISPLAY_SIDE = 36;
const MIN_NATIVE_IMAGE_MATERIALIZE_DISPLAY_SIDE = 32;
const MIN_NATIVE_IMAGE_MATERIALIZE_PIXELS = 1_200;
const MIN_NATIVE_IMAGE_PIXELS = 10_000;
const MAX_NATIVE_IMAGE_PIXELS = 12_000_000;
const MAX_NATIVE_IMAGES_PER_PAGE = 48;
const MAX_NATIVE_COMPOSITE_IMAGES = 16;
const MIN_NATIVE_COMPOSITE_CROP_COVERAGE_RATIO = 0.16;
const NATIVE_SINGLE_DOMINANCE_RATIO = 0.72;
const PAGE_CROP_TRIM_PADDING = 14;
const MIN_PAGE_CROP_TRIM_REDUCTION_RATIO = 0.08;
const PDF_IMAGE_KIND = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3
} as const;

export interface PdfNativeImageAsset {
  id: string;
  pageNumber: number;
  bbox: PresentationFigureCropBox;
  dataUrl: string;
  mimeType: 'image/png';
  pixelWidth: number;
  pixelHeight: number;
}

interface ExtractedFigureImageAsset {
  dataUrl: string;
  mimeType: 'image/png';
  pixelWidth: number;
  pixelHeight: number;
  extractionMethod: 'native-image' | 'native-image-composite' | 'page-crop';
}

export interface PdfOperatorListLike {
  fnArray: number[];
  argsArray: unknown[][];
}

interface NativeImagePaintReference {
  id: string;
  imageData?: PdfJsImageData;
  objectId?: string;
}

interface NativeImageMaterializationCandidate {
  index: number;
  ref: NativeImagePaintReference;
  bbox: PresentationFigureCropBox;
  imageData: PdfJsImageData;
  score: number;
}

interface PdfJsImageData {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: CanvasImageSource;
}

export interface PdfPageWithImageObjects {
  imageCoordinates?: ArrayLike<number> | null;
  objs?: {
    has?: (objectId: string) => boolean;
    get?: (objectId: string) => unknown;
  };
}

export interface ImagePixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FindPixelBoundsOptions {
  padding?: number;
  minContentPixels?: number;
}

export function shouldCollectNativePdfImages(
  figures: PresentationFigureCandidate[]
): boolean {
  return figures.some(
    (figure) =>
      figure.cropManuallyAdjusted !== true &&
      (figure.figureKind === 'setup' || figure.figureKind === 'case')
  );
}

export function buildPdfPageRenderRegion(
  figures: PresentationFigureCandidate[]
): PresentationFigureCropBox | null {
  const cropBoxes = figures
    .filter((figure) => figure.cropBox)
    .map((figure) =>
      figure.cropManuallyAdjusted === true
        ? figure.cropBox!
        : expandCropBoxForRendering(figure.cropBox!)
    );
  if (cropBoxes.length === 0) {
    return null;
  }

  const pageWidth = cropBoxes[0].pageWidth;
  const pageHeight = cropBoxes[0].pageHeight;
  const left = clamp(Math.min(...cropBoxes.map((box) => box.x)), 0, pageWidth - 1);
  const top = clamp(Math.min(...cropBoxes.map((box) => box.y)), 0, pageHeight - 1);
  const right = clamp(
    Math.max(...cropBoxes.map((box) => box.x + box.width)),
    left + 1,
    pageWidth
  );
  const bottom = clamp(
    Math.max(...cropBoxes.map((box) => box.y + box.height)),
    top + 1,
    pageHeight
  );

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    pageWidth,
    pageHeight
  };
}

export async function enrichPresentationDraftWithPdfFigureCrops(
  draft: PresentationDraft,
  pdfData: Uint8Array,
  options: FigureCropOptions = {}
): Promise<PresentationDraft> {
  if (typeof document === 'undefined') {
    return draft;
  }

  const candidates = draft.figures
    .filter((figure) => figure.selected !== false && figure.cropBox && !figure.imageDataUrl)
    .slice(0, options.maxFigures ?? DEFAULT_MAX_FIGURES);

  if (candidates.length === 0) {
    return draft;
  }

  const extractedFigures = await extractPdfFigureAssets(pdfData, candidates, options);
  const updatedFigures = new Map(
    extractedFigures
      .filter((figure) => figure.imageDataUrl)
      .map((figure) => [figure.imageId, figure])
  );

  if (updatedFigures.size === 0) {
    return draft;
  }

  return mergeFigureUpdatesIntoDraft(draft, updatedFigures);
}

export async function extractPdfFigureAssets(
  pdfData: Uint8Array,
  figures: PresentationFigureCandidate[],
  options: FigureCropOptions = {}
): Promise<PresentationFigureCandidate[]> {
  if (typeof document === 'undefined') {
    return figures;
  }

  const candidates = figures
    .filter((figure) => figure.selected !== false && figure.cropBox)
    .slice(0, options.maxFigures ?? DEFAULT_MAX_FIGURES);

  if (candidates.length === 0) {
    return figures;
  }

  const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy | null = null;
  try {
    pdfDocument = await loadingTask.promise;
    const updatedFigures = new Map<string, PresentationFigureCandidate>();
    const candidatesByPage = groupFigureCandidatesByPage(candidates);
    let processed = 0;

    for (const [pageNumber, pageFigures] of candidatesByPage) {
      if (options.isCancelled?.()) {
        break;
      }

      options.onProgress?.({
        processed,
        total: candidates.length,
        pageNumber,
        stage: 'rendering-page'
      });
      const renderedPages = new Map<number, RenderedPdfPage>();
      const collectNativeImages = shouldCollectNativePdfImages(pageFigures);
      const page = await getRenderedPage(
        pdfDocument,
        renderedPages,
        pageNumber,
        options.renderScale,
        collectNativeImages,
        collectNativeImages ? null : buildPdfPageRenderRegion(pageFigures)
      );
      try {
        for (const figure of pageFigures) {
          if (options.isCancelled?.()) {
            break;
          }
          const cropBox = figure.cropBox;
          if (!cropBox) {
            processed += 1;
            continue;
          }

          options.onProgress?.({
            processed,
            total: candidates.length,
            pageNumber,
            stage: 'extracting-figure'
          });
          // Scientific figures often combine vector labels, axes and raster panels.
          // Photo-heavy setup/case figures use embedded panels only as geometry hints;
          // the final export still comes from the rendered page and keeps vector labels.
          const nativeGuidedCropBox =
            figure.cropManuallyAdjusted !== true && (figure.figureKind === 'setup' || figure.figureKind === 'case')
              ? buildNativeGuidedFigureCropBox(page.nativeImages, cropBox)
              : null;
          // Native images are reliable vertical anchors, but one PDF panel may not
          // represent the complete multi-panel figure. Keep the caption-inferred
          // column width and only use the native group to remove prose above/below.
          const effectiveCropBox = nativeGuidedCropBox
            ? alignCropToDetectedColumn(
                {
                  ...cropBox,
                  y: nativeGuidedCropBox.y,
                  height: nativeGuidedCropBox.height
                },
                page.pageWidth
              )
            : cropBox;
          const figureImage = cropFigureFromPage(page, effectiveCropBox, {
            expand: figure.cropManuallyAdjusted !== true && !nativeGuidedCropBox,
            trim: figure.cropManuallyAdjusted !== true
          }) ?? (await extractNativeFigureImage(page.nativeImages, effectiveCropBox));
          processed += 1;
          if (!figureImage) {
            continue;
          }

          const updatedFigure = {
            ...figure,
            imageDataUrl: figureImage.dataUrl,
            imageMimeType: figureImage.mimeType,
            imageExtractionMethod: figureImage.extractionMethod,
            imagePixelWidth: figureImage.pixelWidth,
            imagePixelHeight: figureImage.pixelHeight,
            cropBox: effectiveCropBox,
            cropStatus: 'image-ready'
          } satisfies PresentationFigureCandidate;
          updatedFigures.set(figure.imageId, updatedFigure);
          if (!options.isCancelled?.()) {
            options.onFigureExtracted?.(updatedFigure);
          }
        }
      } finally {
        releaseRenderedPage(page);
        renderedPages.clear();
      }
    }

    if (updatedFigures.size === 0) {
      return figures;
    }

    return figures.map((figure) => updatedFigures.get(figure.imageId) ?? figure);
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

export async function renderPdfFigurePagePreview(
  pdfData: Uint8Array,
  pageNumber: number,
  renderScale = 1.25
): Promise<PdfFigurePagePreview> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    pdfDocument = await loadingTask.promise;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.numPages) {
      throw new Error(`PDF page ${pageNumber} is outside the document range.`);
    }
    const page = await pdfDocument.getPage(pageNumber);
    const unitViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: renderScale });
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot create canvas context for PDF page preview.');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.88),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      pageWidth: unitViewport.width,
      pageHeight: unitViewport.height
    };
  } finally {
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    if (pdfDocument) await pdfDocument.destroy();
    else await loadingTask.destroy();
  }
}

function groupFigureCandidatesByPage(
  candidates: PresentationFigureCandidate[]
): Map<number, PresentationFigureCandidate[]> {
  const grouped = new Map<number, PresentationFigureCandidate[]>();
  for (const figure of candidates) {
    const pageFigures = grouped.get(figure.pageNumber) ?? [];
    pageFigures.push(figure);
    grouped.set(figure.pageNumber, pageFigures);
  }
  return grouped;
}

function releaseRenderedPage(page: RenderedPdfPage): void {
  page.canvas.width = 1;
  page.canvas.height = 1;
  page.nativeImages.length = 0;
}

export function mergePdfFigureAssetUpdate(
  figures: PresentationFigureCandidate[],
  updatedFigure: PresentationFigureCandidate
): PresentationFigureCandidate[] {
  return figures.map((figure) => (figure.imageId === updatedFigure.imageId ? updatedFigure : figure));
}

export function mergeExtractedFigureAssetsIntoDraft(
  draft: PresentationDraft,
  assets: PresentationFigureCandidate[]
): PresentationDraft {
  const assetsById = new Map(assets.map((figure) => [figure.imageId, figure]));
  const assetsBySource = new Map(assets.map((figure) => [getFigureSourceKey(figure), figure]));
  const mergeFigure = (figure: PresentationFigureCandidate): PresentationFigureCandidate => {
    const asset = assetsById.get(figure.imageId) ?? assetsBySource.get(getFigureSourceKey(figure));
    if (!asset) return figure;
    return {
      ...figure,
      selected: asset.selected,
      cropBox: asset.cropBox ?? figure.cropBox,
      cropStatus: asset.cropStatus ?? figure.cropStatus,
      imageDataUrl: asset.imageDataUrl,
      imageMimeType: asset.imageMimeType,
      imageExtractionMethod: asset.imageExtractionMethod,
      imagePixelWidth: asset.imagePixelWidth,
      imagePixelHeight: asset.imagePixelHeight,
      figureLabel: asset.figureLabel ?? figure.figureLabel,
      assetType: asset.assetType ?? figure.assetType,
      cropManuallyAdjusted: asset.cropManuallyAdjusted ?? figure.cropManuallyAdjusted
    };
  };
  const figures = draft.figures.map(mergeFigure);
  const figureById = new Map(figures.map((figure) => [figure.imageId, figure]));
  return {
    ...draft,
    figures,
    slides: draft.slides.map((slide) => ({
      ...slide,
      figures: slide.figures.map((figure) => figureById.get(figure.imageId) ?? mergeFigure(figure))
    }))
  };
}

function getFigureSourceKey(figure: PresentationFigureCandidate): string {
  return `${figure.pageNumber}:${(figure.figureLabel ?? figure.caption).trim().toLowerCase()}`;
}

function mergeFigureUpdatesIntoDraft(
  draft: PresentationDraft,
  updatedFigures: Map<string, PresentationFigureCandidate>
): PresentationDraft {
  const nextFigures = draft.figures.map((figure) => updatedFigures.get(figure.imageId) ?? figure);
  const figureById = new Map(nextFigures.map((figure) => [figure.imageId, figure]));

  return {
    ...draft,
    figures: nextFigures,
    slides: draft.slides.map((slide) => ({
      ...slide,
      figures: slide.figures.map((figure) => figureById.get(figure.imageId) ?? figure)
    }))
  };
}

async function getRenderedPage(
  pdfDocument: PDFDocumentProxy,
  cache: Map<number, RenderedPdfPage>,
  pageNumber: number,
  renderScale = DEFAULT_RENDER_SCALE,
  collectNativeImages = false,
  renderRegion: PresentationFigureCropBox | null = null
): Promise<RenderedPdfPage> {
  const cached = cache.get(pageNumber);
  if (cached) {
    return cached;
  }

  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: renderScale });
  const unitViewport = page.getViewport({ scale: 1 });
  const safeRenderRegion = renderRegion
    ? {
        x: clamp(renderRegion.x, 0, unitViewport.width - 1),
        y: clamp(renderRegion.y, 0, unitViewport.height - 1),
        width: clamp(renderRegion.width, 1, unitViewport.width - renderRegion.x),
        height: clamp(renderRegion.height, 1, unitViewport.height - renderRegion.y)
      }
    : null;
  // `getOperatorList()` plus `recordImages` can be substantially slower than
  // the high-resolution page render itself. Most scientific charts are
  // vector-heavy and are exported from the rendered page, so only collect
  // embedded-image geometry for photo-heavy setup/case candidates.
  const operatorListPromise = collectNativeImages
    ? page.getOperatorList().catch(() => null)
    : null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((safeRenderRegion?.width ?? unitViewport.width) * renderScale));
  canvas.height = Math.max(1, Math.ceil((safeRenderRegion?.height ?? unitViewport.height) * renderScale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Cannot create canvas context for PDF figure crop.');
  }

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: safeRenderRegion
      ? [1, 0, 0, 1, -safeRenderRegion.x * renderScale, -safeRenderRegion.y * renderScale]
      : undefined,
    recordImages: collectNativeImages
  }).promise;
  const operatorList = operatorListPromise ? await operatorListPromise : null;
  const nativeImages = operatorList
    ? extractNativePdfImagesFromRenderedPage(
        page as unknown as PdfPageWithImageObjects,
        operatorList as PdfOperatorListLike,
        pageNumber,
        unitViewport.width,
        unitViewport.height
      )
    : [];
  const renderedPage = {
    canvas,
    scale: renderScale,
    renderOriginX: safeRenderRegion?.x ?? 0,
    renderOriginY: safeRenderRegion?.y ?? 0,
    pageNumber,
    pageWidth: unitViewport.width,
    pageHeight: unitViewport.height,
    nativeImages
  };
  cache.set(pageNumber, renderedPage);
  page.cleanup();
  return renderedPage;
}

async function extractNativeFigureImage(
  nativeImages: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox
): Promise<ExtractedFigureImageAsset | null> {
  const panelImages = selectNativePdfImagesForCropBox(nativeImages, cropBox);
  if (panelImages.length === 0) {
    return null;
  }

  const singleImage = selectNativePdfImageForCropBox(nativeImages, cropBox);
  if (singleImage && shouldUseSingleNativeImage(singleImage, panelImages, cropBox)) {
    return {
      dataUrl: singleImage.dataUrl,
      mimeType: singleImage.mimeType,
      pixelWidth: singleImage.pixelWidth,
      pixelHeight: singleImage.pixelHeight,
      extractionMethod: 'native-image'
    };
  }

  if (panelImages.length >= 2 && getCombinedCropCoverageRatio(panelImages, cropBox) >= MIN_NATIVE_COMPOSITE_CROP_COVERAGE_RATIO) {
    return composeNativeImagesForCropBox(panelImages, cropBox);
  }

  return singleImage
    ? {
        dataUrl: singleImage.dataUrl,
        mimeType: singleImage.mimeType,
        pixelWidth: singleImage.pixelWidth,
        pixelHeight: singleImage.pixelHeight,
        extractionMethod: 'native-image'
      }
    : null;
}

function shouldUseSingleNativeImage(
  image: PdfNativeImageAsset,
  panelImages: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox
): boolean {
  if (panelImages.length <= 1) {
    return true;
  }

  const imageOverlap = getIntersectionArea(image.bbox, cropBox);
  const combinedOverlap = panelImages.reduce((total, panel) => total + getIntersectionArea(panel.bbox, cropBox), 0);
  if (combinedOverlap <= 0) {
    return true;
  }

  const overlapCropRatio = imageOverlap / getBoxArea(cropBox);
  return overlapCropRatio >= 0.35 || imageOverlap / combinedOverlap >= NATIVE_SINGLE_DOMINANCE_RATIO;
}

async function composeNativeImagesForCropBox(
  images: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox
): Promise<ExtractedFigureImageAsset | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  const scale = getNativeCompositeScale(cropBox);
  const pixelWidth = Math.max(1, Math.round(cropBox.width * scale));
  const pixelHeight = Math.max(1, Math.round(cropBox.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, pixelWidth, pixelHeight);

  let drawnCount = 0;
  for (const image of images) {
    const element = await loadImageElement(image.dataUrl);
    if (!element) {
      continue;
    }
    const dx = (image.bbox.x - cropBox.x) * scale;
    const dy = (image.bbox.y - cropBox.y) * scale;
    const dw = image.bbox.width * scale;
    const dh = image.bbox.height * scale;
    if (dw <= 1 || dh <= 1) {
      continue;
    }
    context.drawImage(element, dx, dy, dw, dh);
    drawnCount += 1;
  }

  if (drawnCount === 0) {
    return null;
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    mimeType: 'image/png',
    pixelWidth,
    pixelHeight,
    extractionMethod: 'native-image-composite'
  };
}

function getNativeCompositeScale(cropBox: PresentationFigureCropBox): number {
  const targetWidth = clamp(cropBox.width * 2, 900, 2200);
  const targetHeight = clamp(cropBox.height * 2, 520, 1800);
  const scale = Math.min(targetWidth / cropBox.width, targetHeight / cropBox.height);
  const maxPixelScale = Math.sqrt(MAX_NATIVE_IMAGE_PIXELS / Math.max(1, cropBox.width * cropBox.height));
  return Math.max(1, Math.min(scale, maxPixelScale));
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function cropFigureFromPage(
  page: RenderedPdfPage,
  cropBox: PresentationFigureCropBox,
  options: { expand?: boolean; trim?: boolean } = {}
): ExtractedFigureImageAsset | null {
  const safeCropBox = options.expand === false ? cropBox : expandCropBoxForRendering(cropBox);
  const sx = clamp(Math.round((safeCropBox.x - page.renderOriginX) * page.scale), 0, page.canvas.width - 1);
  const sy = clamp(Math.round((safeCropBox.y - page.renderOriginY) * page.scale), 0, page.canvas.height - 1);
  const sw = clamp(Math.round(safeCropBox.width * page.scale), 1, page.canvas.width - sx);
  const sh = clamp(Math.round(safeCropBox.height * page.scale), 1, page.canvas.height - sy);
  if (sw <= 1 || sh <= 1) {
    return null;
  }

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const cropContext = cropCanvas.getContext('2d');
  if (!cropContext) {
    return null;
  }

  cropContext.drawImage(page.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const outputCanvas = options.trim === false
    ? cropCanvas
    : trimCanvasToNonWhiteContent(cropCanvas, cropContext) ?? cropCanvas;
  const dataUrl = outputCanvas.toDataURL('image/png');
  const pixelWidth = outputCanvas.width;
  const pixelHeight = outputCanvas.height;
  cropCanvas.width = 1;
  cropCanvas.height = 1;
  if (outputCanvas !== cropCanvas) {
    outputCanvas.width = 1;
    outputCanvas.height = 1;
  }
  return {
    dataUrl,
    mimeType: 'image/png',
    pixelWidth,
    pixelHeight,
    extractionMethod: 'page-crop'
  };
}

function trimCanvasToNonWhiteContent(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D
): HTMLCanvasElement | null {
  if (canvas.width <= 1 || canvas.height <= 1) {
    return null;
  }

  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const bounds = findNonWhitePixelBounds(imageData.data, canvas.width, canvas.height, {
    padding: PAGE_CROP_TRIM_PADDING,
    minContentPixels: Math.max(24, Math.floor(canvas.width * canvas.height * 0.0002))
  });
  if (!bounds || !shouldTrimCanvas(canvas.width, canvas.height, bounds)) {
    return null;
  }

  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = bounds.width;
  trimmedCanvas.height = bounds.height;
  const trimmedContext = trimmedCanvas.getContext('2d');
  if (!trimmedContext) {
    return null;
  }

  trimmedContext.drawImage(
    canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  return trimmedCanvas;
}

function shouldTrimCanvas(width: number, height: number, bounds: ImagePixelBounds): boolean {
  const removedWidthRatio = 1 - bounds.width / width;
  const removedHeightRatio = 1 - bounds.height / height;
  return (
    bounds.width > 1 &&
    bounds.height > 1 &&
    (removedWidthRatio >= MIN_PAGE_CROP_TRIM_REDUCTION_RATIO || removedHeightRatio >= MIN_PAGE_CROP_TRIM_REDUCTION_RATIO)
  );
}

export function findNonWhitePixelBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: FindPixelBoundsOptions = {}
): ImagePixelBounds | null {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return null;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let contentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!isNonWhitePixel(pixels, index)) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      contentPixels += 1;
    }
  }

  const minContentPixels = options.minContentPixels ?? Math.max(16, Math.floor(width * height * 0.0004));
  if (contentPixels < minContentPixels || maxX < minX || maxY < minY) {
    return null;
  }

  const padding = Math.max(0, Math.round(options.padding ?? 0));
  const x = clamp(minX - padding, 0, width - 1);
  const y = clamp(minY - padding, 0, height - 1);
  const right = clamp(maxX + padding, 0, width - 1);
  const bottom = clamp(maxY + padding, 0, height - 1);
  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1
  };
}

function isNonWhitePixel(pixels: Uint8ClampedArray, index: number): boolean {
  const alpha = pixels[index + 3] ?? 0;
  if (alpha < 24) {
    return false;
  }

  const red = pixels[index] ?? 255;
  const green = pixels[index + 1] ?? 255;
  const blue = pixels[index + 2] ?? 255;
  return red < 246 || green < 246 || blue < 246;
}

export function selectNativePdfImageForCropBox(
  images: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox
): PdfNativeImageAsset | null {
  return getNativeImageCropMatches(images, cropBox, MIN_NATIVE_IMAGE_CROP_OVERLAP_RATIO)[0]?.image ?? null;
}

export function selectNativePdfImagesForCropBox(
  images: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox
): PdfNativeImageAsset[] {
  return getNativeImageCropMatches(
    images,
    cropBox,
    MIN_NATIVE_IMAGE_PANEL_CROP_OVERLAP_RATIO,
    MIN_NATIVE_IMAGE_PANEL_AREA_RATIO
  )
    .sort((a, b) => a.image.bbox.y - b.image.bbox.y || a.image.bbox.x - b.image.bbox.x)
    .slice(0, MAX_NATIVE_COMPOSITE_IMAGES)
    .map((match) => match.image);
}

export function buildNativeGuidedFigureCropBox(
  images: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox
): PresentationFigureCropBox | null {
  const seedPanels = selectNativePdfImagesForCropBox(images, cropBox);
  const panels = expandNativePanelGroup(images, seedPanels, cropBox);
  if (panels.length === 0) {
    return null;
  }

  const left = Math.min(...panels.map((panel) => panel.bbox.x));
  const top = Math.min(...panels.map((panel) => panel.bbox.y));
  const right = Math.max(...panels.map((panel) => panel.bbox.x + panel.bbox.width));
  const bottom = Math.max(...panels.map((panel) => panel.bbox.y + panel.bbox.height));
  const unionWidth = Math.max(1, right - left);
  const unionHeight = Math.max(1, bottom - top);
  if ((unionWidth * unionHeight) / Math.max(1, getBoxArea(cropBox)) < 0.08) {
    return null;
  }

  // Keep nearby vector panel titles and callouts while excluding surrounding prose.
  const marginX = clamp(unionWidth * 0.08, 10, cropBox.pageWidth * 0.04);
  const marginTop = clamp(unionHeight * 0.12, 12, cropBox.pageHeight * 0.045);
  const marginBottom = clamp(unionHeight * 0.1, 10, cropBox.pageHeight * 0.04);
  const x = clamp(left - marginX, 0, cropBox.pageWidth - 1);
  const y = clamp(top - marginTop, 0, cropBox.pageHeight - 1);
  const maxRight = clamp(right + marginX, x + 1, cropBox.pageWidth);
  const maxBottom = clamp(bottom + marginBottom, y + 1, cropBox.pageHeight);
  return {
    x: roundNumber(x),
    y: roundNumber(y),
    width: roundNumber(maxRight - x),
    height: roundNumber(maxBottom - y),
    pageWidth: cropBox.pageWidth,
    pageHeight: cropBox.pageHeight
  };
}

function expandNativePanelGroup(
  images: PdfNativeImageAsset[],
  seedPanels: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox
): PdfNativeImageAsset[] {
  if (seedPanels.length === 0) {
    return [];
  }

  const selected = new Map(seedPanels.map((panel) => [panel.id, panel]));
  const searchMarginX = cropBox.width * 0.65;
  const searchMarginY = cropBox.height * 0.12;
  const searchBox: PresentationFigureCropBox = {
    x: Math.max(0, cropBox.x - searchMarginX),
    y: Math.max(0, cropBox.y - searchMarginY),
    width: Math.min(cropBox.pageWidth, cropBox.x + cropBox.width + cropBox.width * 0.2) - Math.max(0, cropBox.x - searchMarginX),
    height: Math.min(cropBox.pageHeight, cropBox.y + cropBox.height + searchMarginY) - Math.max(0, cropBox.y - searchMarginY),
    pageWidth: cropBox.pageWidth,
    pageHeight: cropBox.pageHeight
  };

  for (let pass = 0; pass < 3; pass += 1) {
    const selectedPanels = [...selected.values()];
    const groupBox = getUnionCropBox(selectedPanels.map((panel) => panel.bbox), cropBox);
    let changed = false;
    for (const image of images) {
      if (selected.has(image.id) || !isMaterialNativePanel(image, searchBox)) {
        continue;
      }
      const horizontalGap = getAxisGap(
        groupBox.x,
        groupBox.x + groupBox.width,
        image.bbox.x,
        image.bbox.x + image.bbox.width
      );
      const verticalGap = getAxisGap(
        groupBox.y,
        groupBox.y + groupBox.height,
        image.bbox.y,
        image.bbox.y + image.bbox.height
      );
      const maxHorizontalGap = Math.max(24, Math.min(groupBox.width, image.bbox.width) * 0.55);
      const maxVerticalGap = Math.max(24, Math.min(groupBox.height, image.bbox.height) * 0.55);
      if (horizontalGap <= maxHorizontalGap && verticalGap <= maxVerticalGap) {
        selected.set(image.id, image);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return [...selected.values()]
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    .slice(0, MAX_NATIVE_COMPOSITE_IMAGES);
}

function isMaterialNativePanel(image: PdfNativeImageAsset, searchBox: PresentationFigureCropBox): boolean {
  const pixelArea = image.pixelWidth * image.pixelHeight;
  const minDisplaySide = Math.min(image.bbox.width, image.bbox.height);
  const overlapArea = getIntersectionArea(image.bbox, searchBox);
  return (
    pixelArea >= MIN_NATIVE_IMAGE_PIXELS &&
    minDisplaySide >= MIN_NATIVE_IMAGE_DISPLAY_SIDE &&
    overlapArea / Math.max(1, getBoxArea(image.bbox)) >= 0.5
  );
}

function getUnionCropBox(
  boxes: PresentationFigureCropBox[],
  fallback: PresentationFigureCropBox
): PresentationFigureCropBox {
  if (boxes.length === 0) return fallback;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    pageWidth: fallback.pageWidth,
    pageHeight: fallback.pageHeight
  };
}

function getAxisGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, aStart - bEnd, bStart - aEnd);
}

function alignCropToDetectedColumn(cropBox: PresentationFigureCropBox, pageWidth: number): PresentationFigureCropBox {
  const center = cropBox.x + cropBox.width / 2;
  const gutterCenter = pageWidth / 2;
  const right = cropBox.x + cropBox.width;
  const looksLikeRightColumn =
    center > gutterCenter && cropBox.x < gutterCenter && cropBox.width <= pageWidth * 0.55;
  if (!looksLikeRightColumn) {
    return cropBox;
  }

  const x = gutterCenter + Math.max(4, pageWidth * 0.008);
  return {
    ...cropBox,
    x: roundNumber(x),
    width: roundNumber(Math.max(1, right - x))
  };
}

interface NativeImageCropMatch {
  image: PdfNativeImageAsset;
  score: number;
}

function getNativeImageCropMatches(
  images: PdfNativeImageAsset[],
  cropBox: PresentationFigureCropBox,
  minOverlapCropRatio: number,
  minImageAreaRatio = MIN_NATIVE_IMAGE_AREA_RATIO
): NativeImageCropMatch[] {
  const cropArea = getBoxArea(cropBox);
  if (cropArea <= 0) {
    return [];
  }

  return images
    .map((image) => {
      const imageArea = getBoxArea(image.bbox);
      const overlapArea = getIntersectionArea(image.bbox, cropBox);
      const pixelArea = image.pixelWidth * image.pixelHeight;
      const minDisplaySide = Math.min(image.bbox.width, image.bbox.height);
      if (imageArea <= 0 || overlapArea <= 0 || pixelArea < MIN_NATIVE_IMAGE_PIXELS || minDisplaySide < MIN_NATIVE_IMAGE_DISPLAY_SIDE) {
        return null;
      }

      const imageAreaRatio = imageArea / cropArea;
      const overlapCropRatio = overlapArea / cropArea;
      const overlapSelfRatio = overlapArea / imageArea;
      if (
        imageAreaRatio < minImageAreaRatio ||
        overlapCropRatio < minOverlapCropRatio ||
        overlapSelfRatio < MIN_NATIVE_IMAGE_SELF_OVERLAP_RATIO
      ) {
        return null;
      }

      return {
        image,
        score:
          overlapSelfRatio * 3 +
          overlapCropRatio * 3 +
          Math.min(imageAreaRatio, 1.5) +
          Math.min(pixelArea / 1_000_000, 1)
      };
    })
    .filter((match): match is NativeImageCropMatch => match !== null)
    .sort((a, b) => b.score - a.score);
}

export function extractNativePdfImagesFromRenderedPage(
  page: PdfPageWithImageObjects,
  operatorList: PdfOperatorListLike,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number
): PdfNativeImageAsset[] {
  const coordinates = decodePdfImageCoordinateBoxes(page.imageCoordinates, pageNumber, pageWidth, pageHeight);
  const imageRefs = extractNativeImagePaintReferences(operatorList);
  if (coordinates.length === 0 || imageRefs.length === 0) {
    return [];
  }

  return imageRefs
    .map((imageRef, index) => {
      const bbox = coordinates[index];
      if (!bbox) {
        return null;
      }
      const imageData = imageRef.imageData ?? getResolvedPdfImageObject(page, imageRef.objectId);
      if (!imageData || !shouldMaterializeNativeImage(imageData, bbox)) {
        return null;
      }
      return {
        index,
        ref: imageRef,
        bbox,
        imageData,
        score: getNativeImageMaterializationScore(imageData, bbox)
      };
    })
    .filter((candidate): candidate is NativeImageMaterializationCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NATIVE_IMAGES_PER_PAGE)
    .sort((a, b) => a.index - b.index)
    .map((candidate) => {
      const imageData = candidate.imageData;
      const dataUrl = pdfJsImageDataToDataUrl(imageData);
      if (!dataUrl) {
        return null;
      }

      return {
        id: `${candidate.ref.id}-${candidate.index}`,
        pageNumber,
        bbox: candidate.bbox,
        dataUrl,
        mimeType: 'image/png' as const,
        pixelWidth: imageData.width,
        pixelHeight: imageData.height
      };
    })
    .filter((image): image is PdfNativeImageAsset => image !== null);
}

function shouldMaterializeNativeImage(imageData: PdfJsImageData, bbox: PresentationFigureCropBox): boolean {
  const pixelArea = imageData.width * imageData.height;
  const minDisplaySide = Math.min(bbox.width, bbox.height);
  return (
    imageData.width > 0 &&
    imageData.height > 0 &&
    pixelArea >= MIN_NATIVE_IMAGE_MATERIALIZE_PIXELS &&
    pixelArea <= MAX_NATIVE_IMAGE_PIXELS &&
    minDisplaySide >= MIN_NATIVE_IMAGE_MATERIALIZE_DISPLAY_SIDE
  );
}

function getNativeImageMaterializationScore(imageData: PdfJsImageData, bbox: PresentationFigureCropBox): number {
  const displayArea = getBoxArea(bbox);
  const pixelArea = imageData.width * imageData.height;
  return displayArea + Math.min(pixelArea, MAX_NATIVE_IMAGE_PIXELS) / 10_000;
}

function getCombinedCropCoverageRatio(images: PdfNativeImageAsset[], cropBox: PresentationFigureCropBox): number {
  const cropArea = getBoxArea(cropBox);
  if (cropArea <= 0) {
    return 0;
  }
  return images.reduce((total, image) => total + getIntersectionArea(image.bbox, cropBox), 0) / cropArea;
}

function extractNativeImagePaintReferences(operatorList: PdfOperatorListLike): NativeImagePaintReference[] {
  const refs: NativeImagePaintReference[] = [];
  const ops = pdfjsLib.OPS;
  operatorList.fnArray.forEach((fn, index) => {
    const args = operatorList.argsArray[index] ?? [];
    if (fn === ops.paintImageXObject) {
      const objectId = typeof args[0] === 'string' ? args[0] : undefined;
      if (objectId) {
        refs.push({ id: objectId, objectId });
      }
      return;
    }

    if (fn === ops.paintInlineImageXObject && isPdfJsImageData(args[0])) {
      refs.push({ id: `inline-${index}`, imageData: args[0] });
    }
  });

  return refs;
}

function decodePdfImageCoordinateBoxes(
  imageCoordinates: ArrayLike<number> | null | undefined,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number
): PresentationFigureCropBox[] {
  if (!imageCoordinates || imageCoordinates.length < 6) {
    return [];
  }

  const boxes: PresentationFigureCropBox[] = [];
  for (let index = 0; index + 5 < imageCoordinates.length; index += 6) {
    const xValues = [
      imageCoordinates[index] * pageWidth,
      imageCoordinates[index + 2] * pageWidth,
      imageCoordinates[index + 4] * pageWidth
    ];
    const yValues = [
      imageCoordinates[index + 1] * pageHeight,
      imageCoordinates[index + 3] * pageHeight,
      imageCoordinates[index + 5] * pageHeight
    ];
    const minX = clamp(Math.min(...xValues), 0, pageWidth);
    const maxX = clamp(Math.max(...xValues), 0, pageWidth);
    const minY = clamp(Math.min(...yValues), 0, pageHeight);
    const maxY = clamp(Math.max(...yValues), 0, pageHeight);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 1 || height <= 1) {
      continue;
    }

    boxes.push({
      x: roundNumber(minX),
      y: roundNumber(minY),
      width: roundNumber(width),
      height: roundNumber(height),
      pageWidth: roundNumber(pageWidth),
      pageHeight: roundNumber(pageHeight)
    });
  }

  return boxes;
}

function getResolvedPdfImageObject(page: PdfPageWithImageObjects, objectId?: string): PdfJsImageData | null {
  if (!objectId || !page.objs?.has?.(objectId)) {
    return null;
  }

  try {
    const imageData = page.objs.get?.(objectId);
    return isPdfJsImageData(imageData) ? imageData : null;
  } catch {
    return null;
  }
}

function pdfJsImageDataToDataUrl(imageData: PdfJsImageData | null): string | null {
  if (!imageData || imageData.width <= 0 || imageData.height <= 0) {
    return null;
  }

  const pixelArea = imageData.width * imageData.height;
  if (pixelArea > MAX_NATIVE_IMAGE_PIXELS) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  if (imageData.bitmap) {
    context.drawImage(imageData.bitmap, 0, 0, imageData.width, imageData.height);
    return canvas.toDataURL('image/png');
  }

  if (!imageData.data || !imageData.kind) {
    return null;
  }

  const rgba = context.createImageData(imageData.width, imageData.height);
  if (!fillRgbaFromPdfImageData(rgba.data, imageData)) {
    return null;
  }
  context.putImageData(rgba, 0, 0);
  return canvas.toDataURL('image/png');
}

function fillRgbaFromPdfImageData(output: Uint8ClampedArray, imageData: PdfJsImageData): boolean {
  const source = imageData.data;
  if (!source) {
    return false;
  }

  if (imageData.kind === PDF_IMAGE_KIND.RGBA_32BPP) {
    if (source.length < output.length) {
      return false;
    }
    output.set(source.subarray(0, output.length));
    return true;
  }

  if (imageData.kind === PDF_IMAGE_KIND.RGB_24BPP) {
    const expectedLength = imageData.width * imageData.height * 3;
    if (source.length < expectedLength) {
      return false;
    }
    for (let sourceIndex = 0, outputIndex = 0; sourceIndex < expectedLength; sourceIndex += 3, outputIndex += 4) {
      output[outputIndex] = source[sourceIndex];
      output[outputIndex + 1] = source[sourceIndex + 1];
      output[outputIndex + 2] = source[sourceIndex + 2];
      output[outputIndex + 3] = 255;
    }
    return true;
  }

  if (imageData.kind === PDF_IMAGE_KIND.GRAYSCALE_1BPP) {
    const totalPixels = imageData.width * imageData.height;
    for (let pixelIndex = 0, outputIndex = 0; pixelIndex < totalPixels; pixelIndex += 1, outputIndex += 4) {
      const byte = source[pixelIndex >> 3];
      if (byte === undefined) {
        return false;
      }
      const bit = 7 - (pixelIndex & 7);
      const value = byte & (1 << bit) ? 255 : 0;
      output[outputIndex] = value;
      output[outputIndex + 1] = value;
      output[outputIndex + 2] = value;
      output[outputIndex + 3] = 255;
    }
    return true;
  }

  return false;
}

function isPdfJsImageData(value: unknown): value is PdfJsImageData {
  const imageData = value as Partial<PdfJsImageData> | null;
  const width = imageData?.width;
  const height = imageData?.height;
  return Boolean(
    imageData &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      typeof width === 'number' &&
      typeof height === 'number' &&
      width > 0 &&
      height > 0 &&
      (imageData.bitmap || imageData.data)
  );
}

function getBoxArea(box: PresentationFigureCropBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function getIntersectionArea(a: PresentationFigureCropBox, b: PresentationFigureCropBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function expandCropBoxForRendering(cropBox: PresentationFigureCropBox): PresentationFigureCropBox {
  const marginX = clamp(cropBox.width * 0.025, 6, 18);
  const marginTop = clamp(cropBox.height * 0.04, 8, 24);
  const marginBottom = clamp(cropBox.height * 0.012, 4, 8);
  return {
    x: Math.max(0, cropBox.x - marginX),
    y: Math.max(0, cropBox.y - marginTop),
    width: cropBox.width + marginX * 2,
    height: cropBox.height + marginTop + marginBottom,
    pageWidth: cropBox.pageWidth,
    pageHeight: cropBox.pageHeight
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}
