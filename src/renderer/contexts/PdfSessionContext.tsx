import type { Dispatch, SetStateAction } from 'react';
import { createRequiredContext } from './createRequiredContext';
import type { PdfState, PdfViewMode } from '../hooks/usePdfSession';
import type { PdfViewportState } from '../lib/pdfViewportSync';

export interface PdfSessionContextValue {
  pdf: PdfState | null;
  setPdf: Dispatch<SetStateAction<PdfState | null>>;
  translatedPdf: PdfState | null;
  setTranslatedPdf: Dispatch<SetStateAction<PdfState | null>>;
  translatedMonoPdf: PdfState | null;
  setTranslatedMonoPdf: Dispatch<SetStateAction<PdfState | null>>;
  pdfViewMode: PdfViewMode;
  setPdfViewMode: Dispatch<SetStateAction<PdfViewMode>>;
  pdfViewportState: PdfViewportState | null;
  setPdfViewportState: Dispatch<SetStateAction<PdfViewportState | null>>;
  currentPage: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  pageCount: number;
  setPageCount: Dispatch<SetStateAction<number>>;
  scale: number;
  setScale: Dispatch<SetStateAction<number>>;
  displayedPdf: PdfState | null;
  parallelTranslationPdf: PdfState | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageChange: (page: number) => void;
}

export const [PdfSessionProvider, usePdfSessionContext] =
  createRequiredContext<PdfSessionContextValue>('PdfSessionContext');
