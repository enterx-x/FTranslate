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
}

interface FigureCropOptions {
  maxFigures?: number;
  renderScale?: number;
  isCancelled?: () => boolean;
}

const DEFAULT_RENDER_SCALE = 2;
const DEFAULT_MAX_FIGURES = 10;

export async function enrichPresentationDraftWithPdfFigureCrops(
  draft: PresentationDraft,
  pdfData: Uint8Array,
  options: FigureCropOptions = {}
): Promise<PresentationDraft> {
  if (typeof document === 'undefined') {
    return draft;
  }

  const candidates = draft.figures
    .filter((figure) => figure.selected !== false && figure.cropBox)
    .slice(0, options.maxFigures ?? DEFAULT_MAX_FIGURES);

  if (candidates.length === 0) {
    return draft;
  }

  const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy | null = null;
  const renderedPages = new Map<number, RenderedPdfPage>();

  try {
    pdfDocument = await loadingTask.promise;
    const updatedFigures = new Map<string, PresentationFigureCandidate>();

    for (const figure of candidates) {
      if (options.isCancelled?.()) {
        break;
      }

      const cropBox = figure.cropBox;
      if (!cropBox) {
        continue;
      }

      const page = await getRenderedPage(pdfDocument, renderedPages, figure.pageNumber, options.renderScale);
      const imageDataUrl = cropFigureFromPage(page, cropBox);
      if (!imageDataUrl) {
        continue;
      }

      updatedFigures.set(figure.imageId, {
        ...figure,
        imageDataUrl,
        imageMimeType: 'image/png',
        cropStatus: 'image-ready'
      });
    }

    if (updatedFigures.size === 0) {
      return draft;
    }

    return mergeFigureUpdatesIntoDraft(draft, updatedFigures);
  } finally {
    renderedPages.clear();
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
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
  renderScale = DEFAULT_RENDER_SCALE
): Promise<RenderedPdfPage> {
  const cached = cache.get(pageNumber);
  if (cached) {
    return cached;
  }

  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: renderScale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Cannot create canvas context for PDF figure crop.');
  }

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const renderedPage = { canvas, scale: renderScale };
  cache.set(pageNumber, renderedPage);
  page.cleanup();
  return renderedPage;
}

function cropFigureFromPage(page: RenderedPdfPage, cropBox: PresentationFigureCropBox): string | null {
  const sx = clamp(Math.round(cropBox.x * page.scale), 0, page.canvas.width - 1);
  const sy = clamp(Math.round(cropBox.y * page.scale), 0, page.canvas.height - 1);
  const sw = clamp(Math.round(cropBox.width * page.scale), 1, page.canvas.width - sx);
  const sh = clamp(Math.round(cropBox.height * page.scale), 1, page.canvas.height - sy);
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
  return cropCanvas.toDataURL('image/png');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
