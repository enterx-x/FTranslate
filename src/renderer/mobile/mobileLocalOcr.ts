import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import englishLanguageUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import {
  buildPdfDocumentOutline,
  hashText,
  type ExtractedBlockType,
  type ExtractedPdfBlock,
  type PositionedPdfTextItem
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
  source: 'text' | 'ocr';
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

export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLayoutLine {
  text?: string;
  confidence?: number;
  bbox?: OcrBoundingBox;
}

export interface OcrLayoutParagraph {
  text?: string;
  confidence?: number;
  bbox?: OcrBoundingBox;
  lines?: OcrLayoutLine[];
}

export interface OcrLayoutBlock {
  text?: string;
  confidence?: number;
  bbox?: OcrBoundingBox;
  blocktype?: string;
  paragraphs?: OcrLayoutParagraph[];
}

export interface OcrPageLayoutContext {
  page: number;
  pageWidth: number;
  pageHeight: number;
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
  const ocrWorkerRef: { current: Worker | null } = { current: null };
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
    const ensureOcrRecognizer = async (): Promise<OcrImageRecognizer> => {
      if (recognizeImage) {
        return recognizeImage;
      }
      options.onProgress?.({
        page: activePage,
        pageCount,
        progress: 0,
        status: '正在加载本地 OCR 引擎；首次使用需要下载并缓存英文识别数据…'
      });
      ocrWorkerRef.current = await createWorker(
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
      await ocrWorkerRef.current.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '0',
        user_defined_dpi: '300'
      });
      const worker = ocrWorkerRef.current;
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
      const initializedRecognizer = recognizeImage;
      if (!initializedRecognizer) {
        throw new Error('本地 OCR 引擎初始化失败。');
      }
      return initializedRecognizer;
    };

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
        const embeddedBlocks = await extractEmbeddedPdfTextBlocks(page, pageNumber);
        let blocks: LocalOcrBlock[];
        let source: 'text' | 'ocr';
        if (embeddedBlocks.length > 0) {
          blocks = embeddedBlocks;
          source = 'text';
          options.onProgress?.({
            page: pageNumber,
            pageCount,
            progress: 1,
            status: `第 ${pageNumber} / ${pageCount} 页已直接读取 PDF 文字层。`
          });
        } else {
          const rendered = await renderPdfPageForLocalOcr(page);
          const recognizer = await ensureOcrRecognizer();
          const recognized = await recognizer(rendered.imageDataUrl, pageNumber);
          const paragraphs = extractLocalOcrParagraphs(recognized.text, recognized.blocks, {
            page: pageNumber,
            pageWidth: rendered.width,
            pageHeight: rendered.height
          });
          blocks = buildLocalOcrBlocks(pageNumber, paragraphs);
          source = 'ocr';
        }
        await options.onPageRecognized?.({ page: pageNumber, pageCount, blocks, source });
        lastProcessedPage = pageNumber;
        recognizedBlockCount += blocks.length;
      } finally {
        page.cleanup();
      }
    }

    return { pageCount, lastProcessedPage, recognizedBlockCount, cancelled: false };
  } finally {
    if (ocrWorkerRef.current) {
      await ocrWorkerRef.current.terminate();
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
  maxLongEdge = 2600
): number {
  const longEdge = Math.max(pageWidth, pageHeight);
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    return 1;
  }
  return Math.min(3.4, Math.max(0.6, maxLongEdge / longEdge));
}

export function extractLocalOcrParagraphs(
  text: string,
  blocks?: OcrLayoutBlock[] | null,
  layoutContext?: OcrPageLayoutContext
): LocalOcrParagraph[] {
  const positionedParagraphs = extractPositionedOcrParagraphs(blocks, layoutContext);
  if (positionedParagraphs.length > 0) {
    return positionedParagraphs;
  }
  const layoutParagraphs = (blocks ?? [])
    .flatMap((block) => block.paragraphs ?? [])
    .map((paragraph) => normalizeOcrParagraph(paragraph.text ?? ''))
    .filter(Boolean);
  const fallbackParagraphs = splitOcrTextIntoParagraphStrings(text);
  const fragmentedLayout = looksLikeFragmentedOcrLayout(layoutParagraphs);
  const preferFallback = shouldPreferFallbackOcrParagraphs(layoutParagraphs, fallbackParagraphs, fragmentedLayout);
  const candidates = (preferFallback ? fallbackParagraphs : layoutParagraphs.length > 0 ? layoutParagraphs : fallbackParagraphs)
    .filter(isUsefulOcrCandidate);
  return repairOcrParagraphFragments(candidates, fragmentedLayout && !preferFallback)
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
    .filter((entry) => entry.origin === 'text' || entry.origin === 'ocr' || entry.origin === 'vision')
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

async function extractEmbeddedPdfTextBlocks(page: PDFPageProxy, pageNumber: number): Promise<LocalOcrBlock[]> {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const items = textContent.items.flatMap((rawItem): PositionedPdfTextItem[] => {
    const item = rawItem as {
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    };
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
  const blocks = buildPdfDocumentOutline([{ page: pageNumber, items }]);
  const rawLetterCount = countOcrLetters(items.map((item) => item.str).join(' '));
  const extractedLetterCount = countOcrLetters(blocks.map((block) => block.original).join(' '));
  if (rawLetterCount < 60 || extractedLetterCount < 30 || blocks.length === 0) {
    return [];
  }
  return blocks.map((block, index) => ({
    block,
    order: (pageNumber - 1) * 1000 + index
  }));
}

async function renderPdfPageForLocalOcr(page: PDFPageProxy): Promise<{
  imageDataUrl: string;
  width: number;
  height: number;
}> {
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
  const imageDataUrl = canvas.toDataURL('image/png');
  const width = canvas.width;
  const height = canvas.height;
  canvas.width = 1;
  canvas.height = 1;
  return { imageDataUrl, width, height };
}

function extractPositionedOcrParagraphs(
  blocks?: OcrLayoutBlock[] | null,
  layoutContext?: OcrPageLayoutContext
): LocalOcrParagraph[] {
  if (!layoutContext || !blocks?.length) {
    return [];
  }
  const items = blocks
    .filter((block) => !isNonTextOcrBlock(block.blocktype))
    .flatMap((block) => block.paragraphs ?? [])
    .flatMap((paragraph) => paragraph.lines ?? [])
    .flatMap((line): PositionedPdfTextItem[] => {
      const original = normalizeOcrParagraph(line.text ?? '');
      const bbox = line.bbox;
      const confidence = Number(line.confidence);
      if (!original || !bbox || (Number.isFinite(confidence) && confidence < 35 && countOcrWords(original) < 8)) {
        return [];
      }
      return [{
        str: original,
        x: bbox.x0,
        y: bbox.y0,
        width: Math.max(1, bbox.x1 - bbox.x0),
        height: Math.max(1, bbox.y1 - bbox.y0),
        page: layoutContext.page,
        pageWidth: layoutContext.pageWidth,
        pageHeight: layoutContext.pageHeight
      }];
    });
  if (items.length === 0) {
    return [];
  }
  return buildPdfDocumentOutline([{ page: layoutContext.page, items }])
    .map((block) => ({ original: block.original, type: block.type }))
    .slice(0, 120);
}

function isNonTextOcrBlock(blockType: string | undefined): boolean {
  return Boolean(blockType && /(IMAGE|LINE|NOISE|UNKNOWN)/iu.test(blockType));
}

function splitOcrTextIntoParagraphStrings(text: string): string[] {
  return text
    .replace(/\r\n?/gu, '\n')
    .split(/\n\s*\n+/gu)
    .map(normalizeOcrParagraph)
    .filter(Boolean);
}

function shouldPreferFallbackOcrParagraphs(
  layoutParagraphs: string[],
  fallbackParagraphs: string[],
  fragmentedLayout: boolean
): boolean {
  return fragmentedLayout
    && fallbackParagraphs.length > 0
    && fallbackParagraphs.length < layoutParagraphs.length
    && canonicalOcrText(layoutParagraphs) === canonicalOcrText(fallbackParagraphs);
}

function repairOcrParagraphFragments(candidates: string[], coalesceFragmentedSet: boolean): string[] {
  const repaired: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeOcrParagraph(candidate);
    if (!normalized) {
      continue;
    }
    const previous = repaired.at(-1);
    if (previous && shouldJoinOcrParagraphFragments(previous, normalized)) {
      repaired[repaired.length - 1] = joinOcrParagraphFragments(previous, normalized);
    } else {
      repaired.push(normalized);
    }
  }
  if (coalesceFragmentedSet && looksLikeFragmentedOcrLayout(repaired)) {
    return repaired.length > 0
      ? [repaired.reduce(joinOcrParagraphFragments)]
      : [];
  }
  return repaired;
}

function shouldJoinOcrParagraphFragments(previous: string, next: string): boolean {
  if (/[A-Za-z]-$/u.test(previous) && /^[a-z]/u.test(next)) {
    return true;
  }
  return !/[.!?;:]$/u.test(previous)
    && /^[a-z]/u.test(next)
    && classifyOcrParagraph(previous) === 'paragraph'
    && classifyOcrParagraph(next) === 'paragraph';
}

function joinOcrParagraphFragments(previous: string, next: string): string {
  if (/[A-Za-z]-$/u.test(previous) && /^[a-z]/u.test(next)) {
    return normalizeOcrParagraph(`${previous.slice(0, -1)}${next}`);
  }
  return normalizeOcrParagraph(`${previous} ${next}`);
}

function looksLikeFragmentedOcrLayout(paragraphs: string[]): boolean {
  if (paragraphs.length < 3) {
    return false;
  }
  const wordCounts = paragraphs.map(countOcrWords);
  const shortFragments = wordCounts.filter((count) => count <= 3).length;
  const sorted = [...wordCounts].sort((left, right) => left - right);
  const medianWordCount = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return shortFragments / paragraphs.length >= 0.45 || medianWordCount <= 5;
}

function canonicalOcrText(paragraphs: string[]): string {
  return paragraphs.join(' ').toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function countOcrWords(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function countOcrLetters(value: string): number {
  return value.match(/\p{L}/gu)?.length ?? 0;
}

function isUsefulOcrCandidate(value: string): boolean {
  const text = normalizeOcrParagraph(value);
  if (!text || /^\d{1,5}$/u.test(text) || /^[A-Z]{1,3}$/u.test(text)) {
    return false;
  }
  const words = text.split(/\s+/u).filter(Boolean);
  const letters = text.match(/[A-Za-z]/gu) ?? [];
  if (letters.length === 0) {
    return /[=≈∑∫]/u.test(text);
  }
  if (words.length <= 3 && /^[a-z]/u.test(text) && !/[.!?;:]$/u.test(text)) {
    return false;
  }
  if (words.length === 1 && letters.length < 4) {
    return false;
  }
  return true;
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
