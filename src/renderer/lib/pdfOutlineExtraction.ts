import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  buildPdfDocumentOutline,
  type ExtractedPdfBlock,
  type PositionedPdfTextItem
} from './pdfTextStructure';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfBlocksFromData(
  pdfData: Uint8Array,
  isCancelled: () => boolean = () => false
): Promise<ExtractedPdfBlock[]> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy | null = null;

  try {
    pdfDocument = await loadingTask.promise;
    return await extractPdfBlocksFromDocument(pdfDocument, isCancelled);
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
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
