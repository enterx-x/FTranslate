import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import englishLanguageUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import {
  buildPdfReaderPageOutline,
  hashText,
  type ExtractedBlockType,
  type ExtractedPdfBlock,
  type PositionedPdfTextItem
} from '../lib/pdfTextStructure';
import { extractPdfFigureRegionsFromPage, type MobilePdfFigureRegion } from './mobilePdfFigures';
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
  figures: MobilePdfFigureRegion[];
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

export function excludeFigureRegionTextItems<TItem extends PositionedPdfTextItem>(
  items: TItem[],
  regions: MobilePdfFigureRegion[]
): TItem[] {
  if (regions.length === 0) {
    return items;
  }
  return items.filter((item) => !regions.some((region) => {
    if (region.page !== item.page) {
      return false;
    }
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    const captionBounds = region.captionBounds;
    if (
      captionBounds &&
      centerX >= captionBounds.x - 3 &&
      centerX <= captionBounds.x + captionBounds.width + 3 &&
      centerY >= captionBounds.y - 3 &&
      centerY <= captionBounds.y + captionBounds.height + 3
    ) {
      return false;
    }
    return centerX >= region.bounds.x &&
      centerX <= region.bounds.x + region.bounds.width &&
      centerY >= region.bounds.y &&
      centerY <= region.bounds.y + region.bounds.height;
  }));
}

type OcrImageRecognizer = (
  image: HTMLCanvasElement,
  page: number
) => Promise<{ text: string; confidence?: number; blocks?: OcrLayoutBlock[] | null }>;

interface RenderedLocalOcrPage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export const MOBILE_OCR_FAST_LONG_EDGE = 2100;
export const MOBILE_OCR_PRECISE_LONG_EDGE = 2600;

export interface LocalOcrCandidate {
  text: string;
  confidence?: number;
  paragraphs: LocalOcrParagraph[];
}

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
    pageTimeoutMs?: number;
    saveTimeoutMs?: number;
    cleanupTimeoutMs?: number;
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
      recognizeImage = async (image) => {
        const result = await worker.recognize(
          image,
          { rotateAuto: true },
          { text: true, blocks: true }
        );
        return {
          text: result.data.text,
          confidence: result.data.confidence,
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
      const page = await withMobileTaskTimeout(
        pdfDocument.getPage(pageNumber),
        options.pageTimeoutMs ?? 120_000,
        `第 ${pageNumber} 页加载超时，请重新打开后从该页继续。`
      );
      try {
        const pageResult = await withMobileTaskTimeout((async (): Promise<{
          blocks: LocalOcrBlock[];
          source: 'text' | 'ocr';
          figures: MobilePdfFigureRegion[];
        }> => {
          let embedded: EmbeddedPdfTextResult = { blocks: [], outlineBlocks: [], items: [] };
          try {
            embedded = await extractEmbeddedPdfTextBlocks(page, pageNumber);
          } catch (textLayerError) {
            console.warn(`PDF page ${pageNumber} text-layer extraction failed; falling back to local OCR.`, textLayerError);
            options.onProgress?.({
              page: pageNumber,
              pageCount,
              progress: 0,
              status: `第 ${pageNumber} / ${pageCount} 页文字层读取异常，正在改用本地 OCR…`
            });
          }
          let figures: MobilePdfFigureRegion[] = [];
          try {
            figures = await extractPdfFigureRegionsFromPage(page, pageNumber, {
              items: embedded.items,
              blocks: embedded.outlineBlocks
            });
          } catch (figureError) {
            console.warn(`PDF page ${pageNumber} figure extraction failed; continuing with text.`, figureError);
          }
          if (embedded.items.length > 0 && figures.length > 0) {
            const proseItems = excludeFigureRegionTextItems(embedded.items, figures);
            if (proseItems.length < embedded.items.length) {
              embedded = buildEmbeddedPdfTextResult(proseItems, pageNumber, true);
            }
          }
          if (embedded.blocks.length > 0) {
            options.onProgress?.({
              page: pageNumber,
              pageCount,
              progress: 1,
              status: `第 ${pageNumber} / ${pageCount} 页已直接读取 PDF 文字层和图表。`
            });
            return { blocks: embedded.blocks, source: 'text', figures };
          }
          const recognizer = await ensureOcrRecognizer();
          let rendered = await renderPdfPageForLocalOcr(page, MOBILE_OCR_FAST_LONG_EDGE);
          let recognized = await recognizeRenderedLocalOcrPage(recognizer, rendered, pageNumber);
          let selected: LocalOcrCandidate = {
            text: recognized.text,
            confidence: recognized.confidence ?? resolveOcrLayoutConfidence(recognized.blocks),
            paragraphs: extractLocalOcrParagraphs(recognized.text, recognized.blocks, {
              page: pageNumber,
              pageWidth: rendered.width,
              pageHeight: rendered.height
            })
          };
          if (needsPreciseLocalOcrRetry(selected)) {
            options.onProgress?.({
              page: pageNumber,
              pageCount,
              progress: 0,
              status: `第 ${pageNumber} / ${pageCount} 页快速识别质量不足，正在自动精扫…`
            });
            rendered = await renderPdfPageForLocalOcr(page, MOBILE_OCR_PRECISE_LONG_EDGE);
            recognized = await recognizeRenderedLocalOcrPage(recognizer, rendered, pageNumber);
            const precise: LocalOcrCandidate = {
              text: recognized.text,
              confidence: recognized.confidence ?? resolveOcrLayoutConfidence(recognized.blocks),
              paragraphs: extractLocalOcrParagraphs(recognized.text, recognized.blocks, {
                page: pageNumber,
                pageWidth: rendered.width,
                pageHeight: rendered.height
              })
            };
            selected = selectBestLocalOcrCandidate(selected, precise);
          }
          return { blocks: buildLocalOcrBlocks(pageNumber, selected.paragraphs), source: 'ocr', figures };
        })(), options.pageTimeoutMs ?? 120_000, `第 ${pageNumber} 页处理超过 120 秒，已保存前面页面；重新打开后会从本页继续。`);
        await withMobileTaskTimeout(
          Promise.resolve(options.onPageRecognized?.({ page: pageNumber, pageCount, ...pageResult })),
          options.saveTimeoutMs ?? 30_000,
          `第 ${pageNumber} 页写入本地缓存超时；已保存的更早页面不会丢失，重新打开后会从该页继续。`
        );
        lastProcessedPage = pageNumber;
        recognizedBlockCount += pageResult.blocks.length;
      } finally {
        page.cleanup();
      }
    }

    options.onProgress?.({
      page: pageCount,
      pageCount,
      progress: 1,
      status: '最后一页已保存，正在完成全文原文索引…'
    });
    return { pageCount, lastProcessedPage, recognizedBlockCount, cancelled: false };
  } finally {
    if (ocrWorkerRef.current) {
      await settleMobileTaskWithin(ocrWorkerRef.current.terminate(), options.cleanupTimeoutMs ?? 2_500);
    }
    if (pdfDocument) {
      await settleMobileTaskWithin(pdfDocument.destroy(), options.cleanupTimeoutMs ?? 2_500);
    } else {
      await settleMobileTaskWithin(loadingTask.destroy(), options.cleanupTimeoutMs ?? 2_500);
    }
  }
}

export async function withMobileTaskTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

export async function settleMobileTaskWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const settled = promise.then(() => true, () => true);
  const timeout = new Promise<false>((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve(false), Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export async function runWhileMobileOcrJobActive(
  isActive: () => boolean,
  action: () => Promise<void>
): Promise<boolean> {
  if (!isActive()) {
    return false;
  }
  await action();
  return isActive();
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

export function needsPreciseLocalOcrRetry(input: {
  text: string;
  confidence?: number;
  paragraphs: LocalOcrParagraph[];
}): boolean {
  const rawWordCount = countOcrWords(normalizeOcrParagraph(input.text));
  const retainedWordCount = input.paragraphs.reduce(
    (total, paragraph) => total + countOcrWords(paragraph.original),
    0
  );
  if (input.paragraphs.length === 0) {
    return true;
  }
  if (Number.isFinite(input.confidence) && Number(input.confidence) < 70) {
    return true;
  }
  return rawWordCount >= 12 && retainedWordCount / rawWordCount < 0.5;
}

export function selectBestLocalOcrCandidate<T extends LocalOcrCandidate>(fast: T, precise: T): T {
  const fastWordCount = countCandidateWords(fast);
  const preciseWordCount = countCandidateWords(precise);
  if (fastWordCount >= 8 && preciseWordCount / fastWordCount < 0.55) {
    return fast;
  }
  return scoreLocalOcrCandidate(precise) > scoreLocalOcrCandidate(fast) ? precise : fast;
}

function countCandidateWords(candidate: LocalOcrCandidate): number {
  return candidate.paragraphs.reduce(
    (total, paragraph) => total + countOcrWords(paragraph.original),
    0
  );
}

function scoreLocalOcrCandidate(candidate: LocalOcrCandidate): number {
  if (candidate.paragraphs.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const retainedWordCount = countCandidateWords(candidate);
  const rawWordCount = countOcrWords(normalizeOcrParagraph(candidate.text));
  const confidence = Number.isFinite(candidate.confidence) ? Number(candidate.confidence) : 70;
  const averageParagraphWords = retainedWordCount / candidate.paragraphs.length;
  const retentionRatio = rawWordCount > 0 ? Math.min(1, retainedWordCount / rawWordCount) : 1;
  const shortParagraphRatio = candidate.paragraphs.filter((paragraph) => countOcrWords(paragraph.original) < 4).length
    / candidate.paragraphs.length;
  return confidence * 2
    + Math.min(80, retainedWordCount / 4)
    + Math.min(20, averageParagraphWords)
    + retentionRatio * 20
    - shortParagraphRatio * 30;
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

interface EmbeddedPdfTextResult {
  blocks: LocalOcrBlock[];
  outlineBlocks: ExtractedPdfBlock[];
  items: PositionedPdfTextItem[];
}

async function extractEmbeddedPdfTextBlocks(page: PDFPageProxy, pageNumber: number): Promise<EmbeddedPdfTextResult> {
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
  return buildEmbeddedPdfTextResult(items, pageNumber);
}

function buildEmbeddedPdfTextResult(
  items: PositionedPdfTextItem[],
  pageNumber: number,
  allowShortText = false
): EmbeddedPdfTextResult {
  const blocks = buildPdfReaderPageOutline(pageNumber, items);
  const rawLetterCount = countOcrLetters(items.map((item) => item.str).join(' '));
  const extractedLetterCount = countOcrLetters(blocks.map((block) => block.original).join(' '));
  if ((!allowShortText && (rawLetterCount < 60 || extractedLetterCount < 30)) || blocks.length === 0) {
    return { blocks: [], outlineBlocks: blocks, items };
  }
  return {
    blocks: blocks.map((block, index) => ({
      block,
      order: (pageNumber - 1) * 1000 + index
    })),
    outlineBlocks: blocks,
    items
  };
}

async function renderPdfPageForLocalOcr(page: PDFPageProxy, maxLongEdge: number): Promise<RenderedLocalOcrPage> {
  const baseViewport = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: calculateLocalOcrRenderScale(baseViewport.width, baseViewport.height, maxLongEdge)
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
  const width = canvas.width;
  const height = canvas.height;
  return { canvas, width, height };
}

async function recognizeRenderedLocalOcrPage(
  recognizer: OcrImageRecognizer,
  rendered: RenderedLocalOcrPage,
  page: number
): ReturnType<OcrImageRecognizer> {
  try {
    return await recognizer(rendered.canvas, page);
  } finally {
    // Tesseract has consumed the pixels once the recognition promise settles.
    // Release the large backing store before rendering a possible precise pass.
    rendered.canvas.width = 1;
    rendered.canvas.height = 1;
  }
}

function resolveOcrLayoutConfidence(blocks?: OcrLayoutBlock[] | null): number | undefined {
  const values = (blocks ?? []).flatMap((block) => {
    const lines = (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []);
    const lineValues = lines.map((line) => Number(line.confidence)).filter(Number.isFinite);
    if (lineValues.length > 0) {
      return lineValues;
    }
    const paragraphValues = (block.paragraphs ?? [])
      .map((paragraph) => Number(paragraph.confidence))
      .filter(Number.isFinite);
    if (paragraphValues.length > 0) {
      return paragraphValues;
    }
    const blockConfidence = Number(block.confidence);
    return Number.isFinite(blockConfidence) ? [blockConfidence] : [];
  });
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
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
  return buildPdfReaderPageOutline(layoutContext.page, items)
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
    const previous = repaired[repaired.length - 1];
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
