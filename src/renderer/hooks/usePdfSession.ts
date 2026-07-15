import { useMemo, useState } from 'react';
import type { PdfViewportState } from '../lib/pdfViewportSync';

export interface PdfState {
  filePath: string;
  fileName: string;
  data: Uint8Array;
}

export type PdfViewMode = 'source' | 'parallel' | 'translated';

export function resolveDisplayedPdf(
  pdfViewMode: PdfViewMode,
  pdf: PdfState | null,
  _translatedPdf: PdfState | null,
  translatedMonoPdf: PdfState | null
): PdfState | null {
  return pdfViewMode === 'translated' ? translatedMonoPdf : pdf;
}

export function resolveParallelTranslationPdf(
  translatedMonoPdf: PdfState | null,
  _translatedPdf: PdfState | null
): PdfState | null {
  return translatedMonoPdf;
}

export function usePdfSession() {
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [translatedPdf, setTranslatedPdf] = useState<PdfState | null>(null);
  const [translatedMonoPdf, setTranslatedMonoPdf] = useState<PdfState | null>(null);
  const [pdfViewMode, setPdfViewMode] = useState<PdfViewMode>('source');
  const [pdfViewportState, setPdfViewportState] = useState<PdfViewportState | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);

  const displayedPdf = useMemo(
    () => resolveDisplayedPdf(pdfViewMode, pdf, translatedPdf, translatedMonoPdf),
    [pdf, pdfViewMode, translatedMonoPdf, translatedPdf]
  );
  const parallelTranslationPdf = useMemo(
    () => resolveParallelTranslationPdf(translatedMonoPdf, translatedPdf),
    [translatedMonoPdf, translatedPdf]
  );

  return {
    pdf,
    setPdf,
    translatedPdf,
    setTranslatedPdf,
    translatedMonoPdf,
    setTranslatedMonoPdf,
    pdfViewMode,
    setPdfViewMode,
    pdfViewportState,
    setPdfViewportState,
    currentPage,
    setCurrentPage,
    pageCount,
    setPageCount,
    scale,
    setScale,
    displayedPdf,
    parallelTranslationPdf
  };
}
