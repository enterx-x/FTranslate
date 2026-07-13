import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  buildPdfDocumentOutline,
  type ExtractedPdfBlock,
  type PositionedPdfTextItem
} from './pdfTextStructure';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const pdfBlockExtractionCache = new WeakMap<Uint8Array, Promise<ExtractedPdfBlock[]>>();
const completedPdfBlockCache = new WeakMap<Uint8Array, ExtractedPdfBlock[]>();

export function extractPdfBlocksFromData(
  pdfData: Uint8Array,
  isCancelled: () => boolean = () => false
): Promise<ExtractedPdfBlock[]> {
  const completed = completedPdfBlockCache.get(pdfData);
  if (completed) {
    return Promise.resolve(isCancelled() ? [] : completed);
  }
  const extraction = getOrCreatePdfBlockExtraction(pdfData, async () => {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
    let pdfDocument: PDFDocumentProxy | null = null;

    try {
      pdfDocument = await loadingTask.promise;
      // This document is owned by the shared extraction job, not by a viewer.
      // Let it finish once so reader, figure extraction, and PPT generation can reuse it.
      return await extractPdfBlocksFromDocument(pdfDocument);
    } finally {
      if (pdfDocument) {
        await pdfDocument.destroy();
      } else {
        await loadingTask.destroy();
      }
    }
  });
  return extraction.then((blocks) => (isCancelled() ? [] : blocks));
}

export function extractPdfBlocksFromCachedDocument(
  pdfData: Uint8Array,
  pdfDocument: PDFDocumentProxy,
  isCancelled: () => boolean = () => false
): Promise<ExtractedPdfBlock[]> {
  const completed = completedPdfBlockCache.get(pdfData);
  if (completed) {
    return Promise.resolve(completed);
  }
  // A viewer owns this PDFDocumentProxy and may destroy it on navigation. Do not expose
  // its in-flight promise to longer-lived figure/PPT consumers; only share a completed result.
  return extractPdfBlocksFromDocument(pdfDocument, isCancelled).then((blocks) => {
    if (!isCancelled()) {
      completedPdfBlockCache.set(pdfData, blocks);
    }
    return blocks;
  });
}

export async function extractPdfBlocksFromDocument(
  pdfDocument: PDFDocumentProxy,
  isCancelled: () => boolean = () => false
): Promise<ExtractedPdfBlock[]> {
  const outlinePages: Array<{ page: number; items: PositionedPdfTextItem[] }> = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (isCancelled()) {
      return [];
    }

    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    outlinePages.push({
      page: pageNumber,
      items: toPositionedTextItems(textContent.items, viewport, pageNumber)
    });
  }

  return buildPdfDocumentOutline(outlinePages);
}

function toPositionedTextItems(
  items: unknown[],
  viewport: pdfjsLib.PageViewport,
  pageNumber: number
): PositionedPdfTextItem[] {
  return items
    .map((item) => {
      const record = item as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };

      if (!record.str?.trim() || !record.transform || record.transform.length < 6) {
        return null;
      }

      const [x, y] = viewport.convertToViewportPoint(record.transform[4], record.transform[5]);
      const positionedItem: PositionedPdfTextItem = {
        str: record.str,
        x,
        y,
        width: Math.max(1, record.width ?? 1),
        height: Math.max(1, record.height ?? 1),
        page: pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height
      };
      return positionedItem;
    })
    .filter((item): item is PositionedPdfTextItem => item !== null);
}

function getOrCreatePdfBlockExtraction(
  pdfData: Uint8Array,
  create: () => Promise<ExtractedPdfBlock[]>
): Promise<ExtractedPdfBlock[]> {
  const existing = pdfBlockExtractionCache.get(pdfData);
  if (existing) {
    return existing;
  }
  const extraction = create();
  pdfBlockExtractionCache.set(pdfData, extraction);
  void extraction.then(
    (blocks) => {
      completedPdfBlockCache.set(pdfData, blocks);
    },
    () => pdfBlockExtractionCache.delete(pdfData)
  );
  return extraction;
}
