import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import englishLanguageUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import {
  hashText,
  type ExtractedBlockType,
  type ExtractedPdfBlock
} from '../lib/pdfTextStructure';
import type { MobileTranslationEntry } from './mobileTypes';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface LocalOcrParagraph {
  original: string;
  type: ExtractedBlockType;
}

export interface LocalOcrBlock {
  block: ExtractedPdfBlock;
  order: number;
}

export interface LocalOcrPageResult {
  page: number;
  pageCount: number;
  blocks: LocalOcrBlock[];
}

export interface LocalOcrProgress {
  page: number;
  pageCount: number;
  progress: number;
  status: string;
}

export interface LocalOcrRunResult {
  pageCount: number;
  lastProcessedPage: number;
  recognizedBlockCount: number;
  cancelled: boolean;
}

export interface LocalOcrResumeStateInput {
  textBlockCount: number;
  cachedBlocks: ExtractedPdfBlock[];
  pageCount: number;
  processedPages?: number[];
  legacyLastPage?: number;
  legacyCompleted?: boolean;
}

interface OcrLayoutBlock {
  paragraphs?: Array<{ text?: string }>;
}

type OcrImageRecognizer = (
  imageDataUrl: string,
  page: number
) => Promise<{ text: string; blocks?: OcrLayoutBlock[] | null }>;

interface OcrTestGlobal {
  __FTRANSLATE_MOBILE_OCR_TEST__?: OcrImageRecognizer;
}

export async function recognizePdfPagesLocally(
  pdfData: Uint8Array,
  options: {
    startPage?: number;
    isCancelled?: () => boolean;
    onDocumentReady?: (pageCount: number) => void;
    onProgress?: (progress: LocalOcrProgress) => void;
    onPageRecognized?: (result: LocalOcrPageResult) => Promise<void> | void;
    recognizeImage?: OcrImageRecognizer;
  } = {}
): Promise<LocalOcrRunResult> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy | null = null;
  let ocrWorker: Worker | null = null;
  let lastProcessedPage = Math.max(0, (options.startPage ?? 1) - 1);
  let recognizedBlockCount = 0;
  let activePage = Math.max(1, options.startPage ?? 1);
  let pageCount = 0;
  try {
    pdfDocument = await loadingTask.promise;
    pageCount = pdfDocument.numPages;
    const startPage = Math.min(pageCount, Math.max(1, options.startPage ?? 1));
    activePage = startPage;
    options.onDocumentReady?.(pageCount);

    const injectedRecognizer = options.recognizeImage
      ?? (globalThis as typeof globalThis & OcrTestGlobal).__FTRANSLATE_MOBILE_OCR_TEST__;
    let recognizeImage = injectedRecognizer;
    if (!recognizeImage) {
      options.onProgress?.({
        page: activePage,
        pageCount,
        progress: 0,
        status: '正在加载本地 OCR 引擎；首次使用需要下载并缓存英文识别数据…'
      });
      ocrWorker = await createWorker(
        'eng',
        OEM.LSTM_ONLY,
        {
          workerPath: tesseractWorkerUrl,
          corePath: tesseractCoreUrl,
          langPath: englishLanguageUrl.slice(0, englishLanguageUrl.lastIndexOf('/')),
          logger: (message) => {
            options.onProgress?.({
              page: activePage,
              pageCount,
              progress: clampProgress(message.progress),
              status: describeOcrStage(message.status, activePage, pageCount)
            });
          }
        }
      );
      await ocrWorker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        user_defined_dpi: '220'
      });
      const worker = ocrWorker;
      recognizeImage = async (imageDataUrl) => {
        const result = await worker.recognize(
          imageDataUrl,
          { rotateAuto: true },
          { text: true, blocks: true }
        );
        return {
          text: result.data.text,
          blocks: result.data.blocks as OcrLayoutBlock[] | null
        };
      };
    }

    for (let pageNumber = startPage; pageNumber <= pageCount; pageNumber += 1) {
      if (options.isCancelled?.()) {
        return { pageCount, lastProcessedPage, recognizedBlockCount, cancelled: true };
      }
      activePage = pageNumber;
      options.onProgress?.({
        page: pageNumber,
        pageCount,
        progress: 0,
        status: `正在本地识别第 ${pageNumber} / ${pageCount} 页…`
      });
      const page = await pdfDocument.getPage(pageNumber);
      try {
        const imageDataUrl = await renderPdfPageForLocalOcr(page);
        const recognized = await recognizeImage(imageDataUrl, pageNumber);
        const paragraphs = extractLocalOcrParagraphs(recognized.text, recognized.blocks);
        const blocks = buildLocalOcrBlocks(pageNumber, paragraphs);
        await options.onPageRecognized?.({ page: pageNumber, pageCount, blocks });
        lastProcessedPage = pageNumber;
        recognizedBlockCount += blocks.length;
      } finally {
        page.cleanup();
      }
    }

    return { pageCount, lastProcessedPage, recognizedBlockCount, cancelled: false };
  } finally {
    if (ocrWorker) {
      await ocrWorker.terminate();
    }
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

export function calculateLocalOcrRenderScale(
  pageWidth: number,
  pageHeight: number,
  maxLongEdge = 1800
): number {
  const longEdge = Math.max(pageWidth, pageHeight);
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    return 1;
  }
  return Math.min(2.4, Math.max(0.6, maxLongEdge / longEdge));
}

export function extractLocalOcrParagraphs(
  text: string,
  blocks?: OcrLayoutBlock[] | null
): LocalOcrParagraph[] {
  const layoutParagraphs = (blocks ?? [])
    .flatMap((block) => block.paragraphs ?? [])
    .map((paragraph) => normalizeOcrParagraph(paragraph.text ?? ''))
    .filter(Boolean);
  const candidates = layoutParagraphs.length > 0
    ? layoutParagraphs
    : splitOcrTextIntoParagraphStrings(text);
  return candidates
    .map((original) => ({ original, type: classifyOcrParagraph(original) }))
    .slice(0, 120);
}

export function buildLocalOcrBlocks(page: number, paragraphs: LocalOcrParagraph[]): LocalOcrBlock[] {
  return paragraphs.map((paragraph, index) => {
    const section = `OCR Page ${page}`;
    const sourceHash = hashText(`${page}|${index}|${paragraph.type}|${section}|${paragraph.original}`);
    return {
      order: (page - 1) * 1000 + index,
      block: {
        id: `local-ocr-${page}-${index}-${sourceHash}`,
        section,
        original: paragraph.original,
        translation: '',
        type: paragraph.type,
        page,
        sourceHash
      }
    };
  });
}

export function buildCachedLocalOcrBlocks(entries: MobileTranslationEntry[]): ExtractedPdfBlock[] {
  return entries
    .filter((entry) => entry.origin === 'ocr' || entry.origin === 'vision')
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.entry.order) ? Number(left.entry.order) : left.entry.page * 1000 + left.index;
      const rightOrder = Number.isFinite(right.entry.order) ? Number(right.entry.order) : right.entry.page * 1000 + right.index;
      return leftOrder - rightOrder;
    })
    .map(({ entry }) => ({
      id: `local-ocr-cache-${entry.sourceHash}`,
      section: `OCR Page ${entry.page}`,
      original: entry.original,
      translation: entry.translation,
      type: isExtractedBlockType(entry.blockType) ? entry.blockType : 'paragraph',
      page: entry.page,
      sourceHash: entry.sourceHash
    }));
}

export function resolveLocalOcrResumeState(input: LocalOcrResumeStateInput): {
  required: boolean;
  startPage: number;
} {
  const normalizedPageCount = Math.max(1, Math.trunc(input.pageCount) || 1);
  const coveredPages = new Set<number>();
  for (const page of input.processedPages ?? []) {
    const normalizedPage = Math.trunc(Number(page));
    if (Number.isFinite(normalizedPage) && normalizedPage >= 1 && normalizedPage <= normalizedPageCount) {
      coveredPages.add(normalizedPage);
    }
  }
  for (const block of input.cachedBlocks) {
    const normalizedPage = Math.trunc(Number(block.page));
    if (Number.isFinite(normalizedPage) && normalizedPage >= 1 && normalizedPage <= normalizedPageCount) {
      coveredPages.add(normalizedPage);
    }
  }

  let firstMissingPage: number | undefined;
  for (let page = 1; page <= normalizedPageCount; page += 1) {
    if (!coveredPages.has(page)) {
      firstMissingPage = page;
      break;
    }
  }
  const coverageComplete = firstMissingPage === undefined;

  return {
    required: input.textBlockCount === 0 && !coverageComplete,
    startPage: firstMissingPage ?? normalizedPageCount
  };
}

async function renderPdfPageForLocalOcr(page: PDFPageProxy): Promise<string> {
  const baseViewport = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: calculateLocalOcrRenderScale(baseViewport.width, baseViewport.height)
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('当前浏览器无法创建扫描页识别画布。');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  canvas.width = 1;
  canvas.height = 1;
  return dataUrl;
}

function splitOcrTextIntoParagraphStrings(text: string): string[] {
  return text
    .replace(/\r\n?/gu, '\n')
    .split(/\n\s*\n+/gu)
    .map(normalizeOcrParagraph)
    .filter(Boolean);
}

function normalizeOcrParagraph(value: string): string {
  return value
    .trim()
    .replace(/([A-Za-z])-\s*\n\s*([a-z])/gu, '$1$2')
    .replace(/\s*\n\s*/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function classifyOcrParagraph(text: string): ExtractedBlockType {
  if (/^(?:figure|fig\.|table)\s*\d+/iu.test(text)) {
    return 'caption';
  }
  if (/^(?:[A-Za-z]\s*)?[=≈∑∫]|[A-Za-z]\s*=\s*[^,.]{2,}$/u.test(text)) {
    return 'formula';
  }
  const words = text.split(/\s+/u);
  const letters = text.match(/[A-Za-z]/gu) ?? [];
  const uppercase = text.match(/[A-Z]/gu) ?? [];
  const looksLikeHeading = text.length <= 120
    && words.length <= 16
    && !/[.!?;:]$/u.test(text)
    && (uppercase.length / Math.max(1, letters.length) > 0.55 || words.every((word) => /^[A-Z0-9(]/u.test(word)));
  return looksLikeHeading ? 'heading' : 'paragraph';
}

function describeOcrStage(status: string, page: number, pageCount: number): string {
  if (status === 'recognizing text') {
    return `正在本地识别第 ${page} / ${pageCount} 页…`;
  }
  if (status.includes('language')) {
    return '正在加载并缓存英文 OCR 数据；只需首次等待…';
  }
  return '正在初始化手机本地 OCR 引擎…';
}

function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function isExtractedBlockType(value: unknown): value is ExtractedBlockType {
  return value === 'heading' || value === 'paragraph' || value === 'caption' || value === 'formula';
}
