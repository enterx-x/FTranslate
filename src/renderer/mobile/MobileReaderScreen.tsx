import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MathText } from '../components/MathText';
import { PdfViewer } from '../components/PdfViewer';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import { MobileTranslationSettingsDialog } from './MobileTranslationSettingsDialog';
import {
  askAcademicSelectionQuestion,
  MOBILE_AI_PAGE_REFLOW_VERSION,
  needsAcademicPageAiReview,
  reflowAndTranslateAcademicPage,
  translateAcademicSelection,
  translateAcademicText,
  type AcademicTranslationContext
} from './mobileTranslation';
import { buildCachedLocalOcrBlocks, buildLocalOcrBlocks } from './mobileLocalOcr';
import {
  buildMobilePdfCaptionLookupKeys,
  createMobileFigureEntry,
  createMobilePdfFigureRenderer,
  extractPdfFigureRegions,
  MOBILE_PDF_FIGURE_VERSION,
  resolveMobilePdfFigureOrder,
  type MobilePdfFigureRegion,
  type MobilePdfFigureRenderer
} from './mobilePdfFigures';
import type {
  MobileAcademicTerm,
  MobilePaper,
  MobileStructuredTable,
  MobileTranslationEntry,
  MobileTranslationSession
} from './mobileTypes';
import { summarizeMobileExtractionSources } from './mobileExtractionSource';
import { formatMobileAcademicText } from './mobileLatex';
import { isTranslationEntryCurrent } from './mobileTypes';
import {
  calculateMobileSelectionPopoverPosition,
  isEnglishAcademicSelection,
  normalizeMobileSelectionText
} from './mobileSelection';

type MobileReaderMode = 'bilingual' | 'pdf';
type PendingTranslation =
  | { type: 'all' }
  | { type: 'selection' }
  | { type: 'question' };

interface MobileReaderScreenProps {
  paper: MobilePaper;
  pdfData: Uint8Array;
  translations: MobileTranslationEntry[];
  translationSession: MobileTranslationSession;
  onBack: () => void;
  onProgressChange: (page: number, pageCount: number) => void;
  onRequestOcr: () => Promise<void>;
  onSaveTranslation: (entry: MobileTranslationEntry) => Promise<void>;
  onReplacePageEntries: (page: number, entries: MobileTranslationEntry[]) => Promise<void>;
  onReplaceFigureEntries: (page: number, entries: MobileTranslationEntry[]) => Promise<void>;
  onFigureExtractionComplete: (figureCount: number) => Promise<void>;
  onTranslationSessionChange: (session: MobileTranslationSession) => Promise<void>;
}

type MobileReaderFeedItem =
  | { kind: 'block'; block: ExtractedPdfBlock; page: number; order: number }
  | { kind: 'figure'; entry: MobileTranslationEntry; region: MobilePdfFigureRegion; page: number; order: number };

interface SelectionPopoverState {
  text: string;
  width: number;
  left: number;
  top: number;
  maxHeight: number;
  surroundingOriginal: string;
  surroundingTranslation: string;
  translation?: string;
  loading?: boolean;
  error?: string;
}

interface SelectionQuestionDialogState {
  text: string;
  surroundingOriginal: string;
  surroundingTranslation: string;
  question: string;
  answer?: string;
  loading?: boolean;
  error?: string;
}

function buildPageAcademicTranslationContext(
  documentTitle: string,
  entries: MobileTranslationEntry[],
  page: number,
  currentPageText: string
): AcademicTranslationContext {
  const previousEntries = entries
    .filter((entry) => (
      entry.page < page &&
      entry.origin !== 'figure' &&
      entry.original.trim() &&
      entry.translation.trim()
    ))
    .sort((left, right) => (
      left.page - right.page ||
      (left.order ?? left.page * 1000) - (right.order ?? right.page * 1000)
    ));
  const introducedTerms: MobileAcademicTerm[] = [];
  const seenTerms = new Set<string>();
  for (const entry of previousEntries) {
    for (const term of entry.introducedTerms ?? []) {
      const key = term.english.trim().toLocaleLowerCase();
      if (!key || seenTerms.has(key)) {
        continue;
      }
      seenTerms.add(key);
      introducedTerms.push(term);
    }
  }
  const normalizedPageText = currentPageText.toLocaleLowerCase().replace(/\s+/gu, ' ');
  const prioritizedTerms: MobileAcademicTerm[] = [];
  const prioritizedKeys = new Set<string>();
  const appendTerm = (term: MobileAcademicTerm): void => {
    const key = term.english.trim().toLocaleLowerCase();
    if (!key || prioritizedKeys.has(key) || prioritizedTerms.length >= 80) {
      return;
    }
    prioritizedKeys.add(key);
    prioritizedTerms.push(term);
  };
  introducedTerms
    .filter((term) => normalizedPageText.includes(term.english.toLocaleLowerCase()))
    .forEach(appendTerm);
  introducedTerms.slice().reverse().forEach(appendTerm);
  return {
    documentTitle,
    introducedTerms: prioritizedTerms,
    previousBilingualParagraphs: previousEntries.slice(-4).map((entry) => ({
      original: entry.original,
      translation: entry.translation,
      ...(entry.blockType ? { type: entry.blockType } : {})
    }))
  };
}

export function MobileReaderScreen({
  paper,
  pdfData,
  translations,
  translationSession,
  onBack,
  onProgressChange,
  onRequestOcr,
  onSaveTranslation,
  onReplacePageEntries,
  onReplaceFigureEntries,
  onFigureExtractionComplete,
  onTranslationSessionChange
}: MobileReaderScreenProps) {
  const bilingualPageRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const readerScrollTopRef = useRef(0);
  const restoredFeedRef = useRef(false);
  const stopTranslationRef = useRef(false);
  const translationRunRef = useRef(false);
  const pendingTranslationRef = useRef<PendingTranslation | null>(null);
  const selectionCaptureTimerRef = useRef<number | null>(null);
  const selectionRequestIdRef = useRef(0);
  const selectionQuestionRequestIdRef = useRef(0);
  const selectionTranslationCacheRef = useRef(new Map<string, string>());
  const figureMigrationRef = useRef('');
  const replaceFigureEntriesRef = useRef(onReplaceFigureEntries);
  const figureExtractionCompleteRef = useRef(onFigureExtractionComplete);
  const [mode, setMode] = useState<MobileReaderMode>('bilingual');
  const [currentPage, setCurrentPage] = useState(Math.max(1, paper.lastPage));
  const [pageCount, setPageCount] = useState(Math.max(0, paper.pageCount ?? 0));
  const [scale, setScale] = useState(1);
  const [fitWidthRequestId, setFitWidthRequestId] = useState(0);
  const [blocks, setBlocks] = useState<ExtractedPdfBlock[]>([]);
  const [extracting, setExtracting] = useState(true);
  const [status, setStatus] = useState(() => formatInitialReaderStatus(paper, translations));
  const [translatingHash, setTranslatingHash] = useState<string | null>(null);
  const [translatingAll, setTranslatingAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null);
  const [selectionQuestionDialog, setSelectionQuestionDialog] = useState<SelectionQuestionDialogState | null>(null);
  const [readingImmersive, setReadingImmersive] = useState(false);
  const [figureRenderer, setFigureRenderer] = useState<MobilePdfFigureRenderer | null>(null);

  useEffect(() => {
    replaceFigureEntriesRef.current = onReplaceFigureEntries;
    figureExtractionCompleteRef.current = onFigureExtractionComplete;
  }, [onFigureExtractionComplete, onReplaceFigureEntries]);

  useEffect(() => {
    restoredFeedRef.current = false;
    readerScrollTopRef.current = 0;
    setReadingImmersive(false);
    setBlocks(buildCachedLocalOcrBlocks(translations));
    setPageCount(Math.max(0, paper.pageCount ?? 0));
    setExtracting(false);
  }, [paper.id, pdfData]);

  useEffect(() => {
    const cachedOcrBlocks = buildCachedLocalOcrBlocks(translations);
    setBlocks(cachedOcrBlocks);
  }, [translations]);

  useEffect(() => {
    setPageCount((count) => Math.max(count, paper.pageCount ?? 0));
    setStatus(formatInitialReaderStatus(paper, translations));
  }, [paper.localOcrError, paper.localOcrStatus, paper.pageCount, paper.visionOcrLastPage]);

  useEffect(() => {
    onProgressChange(currentPage, pageCount);
  }, [currentPage, onProgressChange, pageCount]);

  useEffect(() => {
    const container = bilingualPageRef.current;
    if (!container || blocks.length === 0 || restoredFeedRef.current) {
      return;
    }
    const target = container.querySelector<HTMLElement>(`[data-pdf-page="${Math.max(1, paper.lastPage)}"]`);
    if (target) {
      container.scrollTop = Math.max(0, target.offsetTop - container.offsetTop - 12);
      readerScrollTopRef.current = container.scrollTop;
    }
    restoredFeedRef.current = true;
  }, [blocks, paper.lastPage]);

  useEffect(() => {
    if (mode !== 'bilingual') {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (bilingualPageRef.current) {
        bilingualPageRef.current.scrollTop = readerScrollTopRef.current;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => () => {
    stopTranslationRef.current = true;
    selectionRequestIdRef.current += 1;
    selectionQuestionRequestIdRef.current += 1;
    if (selectionCaptureTimerRef.current !== null) {
      window.clearTimeout(selectionCaptureTimerRef.current);
    }
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'bilingual') {
      return;
    }
    const handleSelectionChange = (): void => scheduleSelectionCapture(false);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [mode, paper.id, translationSession.baseURL, translationSession.model]);

  const translationByHash = useMemo(
    () => new Map(translations.map((entry) => [entry.sourceHash, entry])),
    [translations]
  );
  const figureEntries = useMemo(() => translations.filter((entry) => (
    entry.origin === 'figure' &&
    entry.figureVersion === MOBILE_PDF_FIGURE_VERSION &&
    Boolean(entry.figureBounds)
  )), [translations]);
  const requiresFigureRenderer = useMemo(() => figureEntries.some((entry) => (
    entry.figureKind !== 'table' || !entry.figureTable
  )), [figureEntries]);
  const extractionSource = useMemo(
    () => summarizeMobileExtractionSources(translations, paper.pageCount),
    [paper.pageCount, translations]
  );
  const hiddenFigureTextHashes = useMemo(() => new Set(
    figureEntries.flatMap((entry) => entry.figureTextHashes ?? [])
  ), [figureEntries]);
  const readableBlocks = useMemo(
    () => blocks.filter((block) => !hiddenFigureTextHashes.has(block.sourceHash)),
    [blocks, hiddenFigureTextHashes]
  );
  const feedItems = useMemo(() => {
    const textItems: MobileReaderFeedItem[] = readableBlocks.map((block, index) => ({
      kind: 'block',
      block,
      page: block.page,
      order: translationByHash.get(block.sourceHash)?.order ?? (block.page - 1) * 1000 + index
    }));
    const currentBlockOrders = new Map(readableBlocks.map((block, index) => [
      block.sourceHash,
      translationByHash.get(block.sourceHash)?.order ?? (block.page - 1) * 1000 + index
    ]));
    const currentCaptionTextOrders = new Map(readableBlocks.flatMap((block, index) => {
      if (block.type !== 'caption') {
        return [];
      }
      const order = translationByHash.get(block.sourceHash)?.order ?? (block.page - 1) * 1000 + index;
      return buildMobilePdfCaptionLookupKeys(block.original).map((key) => [key, order] as const);
    }));
    const figureItems: MobileReaderFeedItem[] = figureEntries.flatMap((entry) => {
      const region = figureEntryToRegion(entry);
      return region
        ? [{
            kind: 'figure',
            entry,
            region,
            page: entry.page,
            order: resolveMobilePdfFigureOrder(
              region,
              currentBlockOrders,
              currentCaptionTextOrders,
              region.caption
            )
          }]
        : [];
    });
    return [...textItems, ...figureItems].sort((left, right) => left.order - right.order || left.page - right.page);
  }, [figureEntries, readableBlocks, translationByHash]);

  useEffect(() => {
    if (!requiresFigureRenderer) {
      setFigureRenderer(null);
      return;
    }
    let cancelled = false;
    let activeRenderer: MobilePdfFigureRenderer | null = null;
    void createMobilePdfFigureRenderer(pdfData).then((renderer) => {
      if (cancelled) {
        void renderer.destroy();
        return;
      }
      activeRenderer = renderer;
      setFigureRenderer(renderer);
    }).catch((error) => {
      if (!cancelled) {
        setStatus(`论文插图读取失败：${formatError(error)}`);
      }
    });
    return () => {
      cancelled = true;
      if (activeRenderer) {
        void activeRenderer.destroy();
      }
    };
  }, [paper.id, pdfData, requiresFigureRenderer]);

  useEffect(() => {
    if (
      paper.localOcrStatus !== 'completed' ||
      paper.figureExtractionVersion === MOBILE_PDF_FIGURE_VERSION
    ) {
      return;
    }
    const migrationKey = `${paper.id}:${MOBILE_PDF_FIGURE_VERSION}`;
    if (figureMigrationRef.current === migrationKey) {
      return;
    }
    figureMigrationRef.current = migrationKey;
    let cancelled = false;
    setStatus('正在从本机原 PDF 恢复论文图表；不会上传，也不会调用 DeepSeek…');
    void extractPdfFigureRegions(pdfData, {
      isCancelled: () => cancelled,
      onPageExtracted: async (page, pageTotal, regions) => {
        if (cancelled) {
          return;
        }
        await replaceFigureEntriesRef.current(page, regions.map(createMobileFigureEntry));
        if (cancelled) {
          return;
        }
        setStatus(`正在恢复论文图表：第 ${page} / ${pageTotal} 页…`);
      }
    }).then(async (result) => {
      if (cancelled || result.cancelled) {
        return;
      }
      await figureExtractionCompleteRef.current(result.regions.length);
      if (cancelled) {
        return;
      }
      setStatus(result.regions.length > 0
        ? `已从原 PDF 恢复 ${result.regions.length} 个图表，并插入连续阅读位置。`
        : '全文图表检查完成；该 PDF 未发现可定位的图表。');
    }).catch((error) => {
      if (!cancelled) {
        figureMigrationRef.current = '';
        setStatus(`图表恢复未完成：${formatError(error)}；文字与译文缓存不受影响。`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [paper.figureExtractionVersion, paper.id, paper.localOcrStatus, pdfData]);

  const translatedCount = readableBlocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(cached && isTranslationEntryCurrent(cached, translationSession));
  }).length;
  const staleTranslationCount = readableBlocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(cached?.translation.trim() && !isTranslationEntryCurrent(cached, translationSession));
  }).length;
  const pendingTranslationCount = readableBlocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(cached && !cached.translation.trim());
  }).length;
  const aiReviewPendingCount = readableBlocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(
      cached?.translation.trim() &&
      isTranslationEntryCurrent(cached, translationSession) &&
      needsAcademicPageAiReview(cached)
    );
  }).length;
  const ocrBusy = paper.localOcrStatus === 'pending' || paper.localOcrStatus === 'running';
  const needsLocalOcr = paper.localOcrStatus !== 'completed';

  async function translateBlock(
    block: ExtractedPdfBlock,
    session: MobileTranslationSession,
    updateStatus = true,
    context: AcademicTranslationContext = {}
  ): Promise<MobileTranslationEntry | null> {
    if (!session.apiKey.trim()) {
      return null;
    }
    setTranslatingHash(block.sourceHash);
    if (updateStatus) {
      setStatus(`正在翻译第 ${block.page} 页段落…`);
    }
    try {
      const translation = await translateAcademicText(block.original, session, context);
      const cached = translationByHash.get(block.sourceHash);
      const entry: MobileTranslationEntry = {
        sourceHash: block.sourceHash,
        page: block.page,
        original: block.original,
        translation,
        translatedAt: new Date().toISOString(),
        model: session.model,
        baseURL: session.baseURL.trim().replace(/\/+$/u, ''),
        ...(cached?.origin ? { origin: cached.origin } : {}),
        ...(cached?.extractionMode ? { extractionMode: cached.extractionMode } : {}),
        ...(cached?.extractionWarning ? { extractionWarning: cached.extractionWarning } : {}),
        ...(Number.isFinite(cached?.order) ? { order: cached?.order } : {}),
        ...(cached?.blockType ? { blockType: cached.blockType } : {}),
        ...(Number.isFinite(cached?.aiReflowVersion) ? { aiReflowVersion: cached?.aiReflowVersion } : {}),
        ...(cached?.introducedTerms?.length ? { introducedTerms: cached.introducedTerms } : {})
      };
      await onSaveTranslation(entry);
      if (updateStatus) {
        setStatus('译文已直接写在对应英文段落下方，并缓存在本机。');
      }
      return entry;
    } catch (error) {
      if (updateStatus) {
        setStatus(`翻译失败：${formatError(error)}`);
        return null;
      }
      throw error;
    } finally {
      setTranslatingHash(null);
    }
  }

  async function reflowAndTranslatePage(
    page: number,
    pageBlocks: ExtractedPdfBlock[],
    session: MobileTranslationSession,
    context: AcademicTranslationContext
  ): Promise<MobileTranslationEntry[]> {
    setTranslatingHash(pageBlocks[0]?.sourceHash ?? `ocr-page-${page}`);
    try {
      const result = await reflowAndTranslateAcademicPage(
        pageBlocks.map((block, index) => ({
          index,
          type: block.type,
          text: block.original
        })),
        session,
        context
      );
      const bilingualParagraphs = result.paragraphs;
      const rebuiltBlocks = buildLocalOcrBlocks(page, bilingualParagraphs.map((paragraph) => ({
        original: paragraph.original,
        type: paragraph.type
      })));
      const sourceEntries = pageBlocks
        .map((block) => translationByHash.get(block.sourceHash))
        .filter((entry): entry is MobileTranslationEntry => Boolean(entry));
      const pageOrigin: MobileTranslationEntry['origin'] = sourceEntries.some((entry) => (
        entry.origin === 'ocr' || entry.origin === 'vision'
      )) ? 'ocr' : 'text';
      const extractionMode: MobileTranslationEntry['extractionMode'] = pageOrigin === 'ocr'
        ? 'ocr'
        : sourceEntries.find((entry) => entry.extractionMode)?.extractionMode ?? 'structured';
      const extractionWarning = sourceEntries.find((entry) => entry.extractionWarning)?.extractionWarning;
      const translatedAt = new Date().toISOString();
      const baseURL = session.baseURL.trim().replace(/\/+$/u, '');
      const entries = rebuiltBlocks.map((item, index): MobileTranslationEntry => ({
        sourceHash: item.block.sourceHash,
        page,
        original: item.block.original,
        translation: bilingualParagraphs[index]?.translation ?? '',
        translatedAt,
        model: session.model,
        baseURL,
        origin: pageOrigin,
        extractionMode,
        ...(extractionWarning ? { extractionWarning } : {}),
        order: item.order,
        blockType: item.block.type,
        aiReflowVersion: MOBILE_AI_PAGE_REFLOW_VERSION,
        ...(index === 0 && result.terminology.length
          ? { introducedTerms: result.terminology }
          : {})
      }));
      await onReplacePageEntries(page, entries);
      return entries;
    } finally {
      setTranslatingHash(null);
    }
  }

  async function handleTranslateAll(session = translationSession): Promise<void> {
    if (translationRunRef.current) {
      setStatus('全文翻译已经在进行，请等待当前页完成或点击停止。');
      return;
    }
    if (paper.localOcrStatus !== 'completed') {
      setStatus('全文原文尚未提取完成；导入任务会先逐页缓存全部原文，完成后再点击全文翻译。');
      return;
    }
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'all' };
      setSettingsOpen(true);
      return;
    }
    const targets = readableBlocks.filter((block) => {
      const cached = translationByHash.get(block.sourceHash);
      return !cached ||
        !isTranslationEntryCurrent(cached, session) ||
        needsAcademicPageAiReview(cached);
    });
    if (targets.length === 0) {
      setStatus('全文译文均由当前翻译配置生成，无需更新。');
      return;
    }

    closeSelectionPopover();
    translationRunRef.current = true;
    stopTranslationRef.current = false;
    setTranslatingAll(true);
    let succeeded = 0;
    let failed = 0;
    let completedPages = 0;
    let failedPage = 0;
    let failedReason = '';
    let aiComparedPages = 0;
    let preservedLocalPages = 0;
    try {
    let coherenceEntries = Array.from(translationByHash.values()).filter((entry) => (
      entry.translation.trim() && isTranslationEntryCurrent(entry, session)
    ));
    const groupedTargets = new Map<number, ExtractedPdfBlock[]>();
    for (const block of targets) {
      groupedTargets.set(block.page, [...(groupedTargets.get(block.page) ?? []), block]);
    }
    const pageTargets = Array.from(groupedTargets.entries()).sort(([left], [right]) => left - right);
    for (const [page, pageBlocks] of pageTargets) {
      if (stopTranslationRef.current || failed > 0) {
        break;
      }
      const sourcePageBlocks = readableBlocks.filter((block) => block.page === page);
      const academicContext = buildPageAcademicTranslationContext(
        paper.title,
        coherenceEntries,
        page,
        sourcePageBlocks.map((block) => block.original).join(' ')
      );
      setStatus(`正在让 AI 对照逐段结果、连续全文和前文术语，检查并翻译第 ${page} 页（${completedPages + 1} / ${pageTargets.length} 页）…`);
      try {
        const entries = await reflowAndTranslatePage(page, sourcePageBlocks, session, academicContext);
        succeeded += entries.length;
        coherenceEntries = [
          ...coherenceEntries.filter((entry) => entry.page !== page),
          ...entries
        ];
        aiComparedPages += 1;
      } catch (error) {
        preservedLocalPages += 1;
        const reflowError = formatError(error);
        setStatus(`第 ${page} 页 AI 整页结果未通过安全校验：${reflowError}；已保留本地段落并继续逐段翻译。`);
        for (const block of pageBlocks) {
          if (stopTranslationRef.current) {
            break;
          }
          try {
            const entry = await translateBlock(block, session, false, academicContext);
            if (!entry) {
              throw new Error('翻译接口没有返回可保存的段落。');
            }
            succeeded += 1;
            coherenceEntries = [
              ...coherenceEntries.filter((candidate) => candidate.sourceHash !== entry.sourceHash),
              entry
            ];
          } catch (blockError) {
            failed += 1;
            failedPage = page;
            failedReason = `整页校验：${reflowError}；逐段请求：${formatError(blockError)}`;
            break;
          }
        }
      }
      if (!stopTranslationRef.current && failed === 0) {
        completedPages += 1;
        setStatus(`第 ${page} 页译文已全部缓存，准备处理下一页…`);
      }
    }
    const stopped = stopTranslationRef.current;
    stopTranslationRef.current = false;
    const reflowSummary = aiComparedPages > 0 || preservedLocalPages > 0
      ? `；AI 已对照逐段与连续全文 ${aiComparedPages} 页${preservedLocalPages ? `，另有 ${preservedLocalPages} 页整页结果未通过安全校验并保留本地结构` : ''}`
      : '';
    if (failed > 0) {
      setStatus(`全文处理在第 ${failedPage} 页停止${failedReason ? `：${failedReason}` : ''}。已完成 ${completedPages} 页、${succeeded} 段${reflowSummary}；成功译文仍保存在本机。`);
    } else if (stopped) {
      setStatus(`已停止全文翻译；本次完成 ${completedPages} 页、${succeeded} 段${reflowSummary}，已完成译文仍保存在本机。`);
    } else {
      setStatus(`全文翻译完成：${completedPages} 页、${succeeded} 个段落的中文已逐页缓存${reflowSummary}。`);
    }
    } catch (error) {
      setStatus(`全文翻译意外停止：${formatError(error)}。已经成功写入的页面仍保存在本机，可再次点击继续。`);
    } finally {
      setTranslatingAll(false);
      translationRunRef.current = false;
      stopTranslationRef.current = false;
    }
  }

  function handleBilingualModeClick(): void {
    setMode('bilingual');
    setReadingImmersive(false);
  }

  function handleFeedScroll(): void {
    if (selectionPopover) {
      closeSelectionPopover(false);
    }
    const scrollContainer = bilingualPageRef.current;
    if (scrollContainer) {
      const nextScrollTop = scrollContainer.scrollTop;
      const scrollDelta = nextScrollTop - readerScrollTopRef.current;
      if (nextScrollTop < 28) {
        setReadingImmersive(false);
      } else if (nextScrollTop > 84 && scrollDelta > 8) {
        setReadingImmersive(true);
      } else if (scrollDelta < -12) {
        setReadingImmersive(false);
      }
      readerScrollTopRef.current = nextScrollTop;
    }
    if (scrollFrameRef.current !== null) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = bilingualPageRef.current;
      if (!container) {
        return;
      }
      const threshold = container.getBoundingClientRect().top + 24;
      const visibleBlock = Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page]'))
        .find((element) => element.getBoundingClientRect().bottom > threshold);
      const page = Number(visibleBlock?.dataset.pdfPage);
      if (Number.isInteger(page) && page > 0) {
        setCurrentPage(page);
      }
    });
  }

  function scheduleSelectionCapture(closeWhenEmpty: boolean): void {
    if (selectionCaptureTimerRef.current !== null) {
      window.clearTimeout(selectionCaptureTimerRef.current);
    }
    selectionCaptureTimerRef.current = window.setTimeout(() => {
      selectionCaptureTimerRef.current = null;
      captureSelection(closeWhenEmpty);
    }, 90);
  }

  function captureSelection(closeWhenEmpty: boolean): void {
    const selection = window.getSelection();
    const text = normalizeMobileSelectionText(selection?.toString() ?? '');
    const page = bilingualPageRef.current;
    if (!selection || selection.isCollapsed || !text || !page || selection.rangeCount === 0) {
      if (closeWhenEmpty) {
        closeSelectionPopover(false);
      }
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = selectionNodeElement(range.startContainer);
    const endElement = selectionNodeElement(range.endContainer);
    const startOriginal = startElement?.closest('.mobile-block-original');
    const endOriginal = endElement?.closest('.mobile-block-original');
    if (
      !startOriginal ||
      startOriginal !== endOriginal ||
      !page.contains(startOriginal) ||
      !isEnglishAcademicSelection(text)
    ) {
      if (closeWhenEmpty) {
        closeSelectionPopover(false);
      }
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
      return;
    }
    const visualViewport = window.visualViewport;
    const position = calculateMobileSelectionPopoverPosition(rect, {
      width: visualViewport?.width ?? window.innerWidth,
      height: visualViewport?.height ?? window.innerHeight,
      offsetLeft: visualViewport?.offsetLeft ?? 0,
      offsetTop: visualViewport?.offsetTop ?? 0
    });
    const article = startOriginal.closest('.mobile-bilingual-block');
    const surroundingOriginal = startOriginal.getAttribute('data-source-text')?.trim()
      || startOriginal.textContent?.replace(/\s+/gu, ' ').trim()
      || '';
    const surroundingTranslation = article?.querySelector('.mobile-block-translation')
      ?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    const cacheKey = buildSelectionTranslationCacheKey(
      translationSession,
      text,
      surroundingOriginal
    );
    selectionRequestIdRef.current += 1;
    setSelectionPopover({
      text,
      ...position,
      surroundingOriginal,
      surroundingTranslation,
      ...(selectionTranslationCacheRef.current.get(cacheKey)
        ? { translation: selectionTranslationCacheRef.current.get(cacheKey) }
        : {})
    });
  }

  async function translateSelection(session = translationSession): Promise<void> {
    const selected = selectionPopover;
    if (!selected || selected.loading) {
      return;
    }
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'selection' };
      setSettingsOpen(true);
      return;
    }
    const cacheKey = buildSelectionTranslationCacheKey(
      session,
      selected.text,
      selected.surroundingOriginal
    );
    const cachedTranslation = selectionTranslationCacheRef.current.get(cacheKey);
    if (cachedTranslation) {
      setSelectionPopover((current) => current?.text === selected.text
        ? { ...current, translation: cachedTranslation, loading: false, error: undefined }
        : current);
      return;
    }
    const requestId = selectionRequestIdRef.current + 1;
    selectionRequestIdRef.current = requestId;
    setSelectionPopover((current) => current?.text === selected.text
      ? { ...current, loading: true, error: undefined }
      : current);
    try {
      const translation = await translateAcademicSelection(selected.text, session, {
        documentTitle: paper.title,
        surroundingOriginal: selected.surroundingOriginal,
        surroundingTranslation: selected.surroundingTranslation
      });
      if (selectionRequestIdRef.current !== requestId) {
        return;
      }
      rememberSelectionTranslation(cacheKey, translation);
      setSelectionPopover((current) => current?.text === selected.text
        ? { ...current, translation, loading: false, error: undefined }
        : current);
    } catch (error) {
      if (selectionRequestIdRef.current !== requestId) {
        return;
      }
      setSelectionPopover((current) => current?.text === selected.text
        ? { ...current, loading: false, error: formatError(error) }
        : current);
    }
  }

  function openSelectionQuestionDialog(): void {
    const selected = selectionPopover;
    if (!selected) {
      return;
    }
    selectionQuestionRequestIdRef.current += 1;
    setSelectionQuestionDialog({
      text: selected.text,
      surroundingOriginal: selected.surroundingOriginal,
      surroundingTranslation: selected.surroundingTranslation,
      question: ''
    });
    closeSelectionPopover();
  }

  async function askSelectionQuestion(session = translationSession): Promise<void> {
    const dialog = selectionQuestionDialog;
    if (!dialog || dialog.loading) {
      return;
    }
    const question = dialog.question.trim();
    if (!question) {
      setSelectionQuestionDialog((current) => current
        ? { ...current, error: '请先输入你想问的问题。' }
        : current);
      return;
    }
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'question' };
      setSettingsOpen(true);
      return;
    }
    const requestId = selectionQuestionRequestIdRef.current + 1;
    selectionQuestionRequestIdRef.current = requestId;
    setSelectionQuestionDialog((current) => current
      ? { ...current, loading: true, answer: undefined, error: undefined }
      : current);
    try {
      const answer = await askAcademicSelectionQuestion(dialog.text, question, session, {
        documentTitle: paper.title,
        surroundingOriginal: dialog.surroundingOriginal,
        surroundingTranslation: dialog.surroundingTranslation
      });
      if (selectionQuestionRequestIdRef.current !== requestId) {
        return;
      }
      setSelectionQuestionDialog((current) => current?.text === dialog.text
        ? { ...current, answer, loading: false, error: undefined }
        : current);
    } catch (error) {
      if (selectionQuestionRequestIdRef.current !== requestId) {
        return;
      }
      setSelectionQuestionDialog((current) => current?.text === dialog.text
        ? { ...current, loading: false, error: formatError(error) }
        : current);
    }
  }

  function closeSelectionQuestionDialog(): void {
    selectionQuestionRequestIdRef.current += 1;
    if (pendingTranslationRef.current?.type === 'question') {
      pendingTranslationRef.current = null;
    }
    setSelectionQuestionDialog(null);
  }

  function rememberSelectionTranslation(key: string, translation: string): void {
    const cache = selectionTranslationCacheRef.current;
    if (cache.size >= 100) {
      const oldestKey = cache.keys().next().value;
      if (typeof oldestKey === 'string') {
        cache.delete(oldestKey);
      }
    }
    cache.set(key, translation);
  }

  function closeSelectionPopover(clearNativeSelection = true): void {
    selectionRequestIdRef.current += 1;
    setSelectionPopover(null);
    if (clearNativeSelection) {
      window.getSelection()?.removeAllRanges();
    }
  }

  return (
    <section className={`mobile-screen mobile-reader-screen${mode === 'bilingual' && readingImmersive ? ' is-reading-immersive' : ''}`} aria-label="PDF 阅读与翻译">
      <header className="mobile-reader-header">
        <button type="button" className="mobile-reader-back" onClick={() => {
          closeSelectionPopover();
          onBack();
        }} aria-label="返回论文库">‹</button>
        <div>
          <strong>{paper.customTitle || paper.titleZh || paper.title}</strong>
          <span>第 {currentPage}{pageCount ? ` / ${pageCount}` : ''} 页</span>
        </div>
        <button type="button" className="mobile-reader-more" disabled={translatingAll || Boolean(translatingHash)} onClick={() => setSettingsOpen(true)} aria-label="翻译设置">•••</button>
      </header>

      <div className="mobile-reader-mode-bar" role="group" aria-label="阅读模式">
        <button type="button" className={mode === 'bilingual' ? 'active' : ''} onClick={handleBilingualModeClick}>连续双语</button>
        <button type="button" className={mode === 'pdf' ? 'active' : ''} onClick={() => {
          closeSelectionPopover();
          setReadingImmersive(false);
          setMode('pdf');
        }}>原始 PDF</button>
      </div>

      {mode === 'bilingual' ? (
        <div className="mobile-bilingual-reader">
          <div className="mobile-bilingual-toolbar">
            <span className="mobile-bilingual-summary">
              <span>{needsLocalOcr
                ? paper.localOcrStatus === 'failed'
                  ? '全文原文提取失败'
                  : `导入后全文提取 · ${paper.visionOcrLastPage ?? 0}${paper.pageCount ? ` / ${paper.pageCount}` : ''} 页${extractionSource.textPages || extractionSource.ocrPages ? ` · ${extractionSource.label}` : ''}`
                : `${translatedCount} / ${readableBlocks.length} 段已译 · ${extractionSource.label}${figureEntries.length ? ` · ${figureEntries.length} 个图表` : ''}${pendingTranslationCount ? ` · ${pendingTranslationCount} 段待翻译` : ''}${staleTranslationCount ? ` · ${staleTranslationCount} 段待更新` : ''}${aiReviewPendingCount ? ` · ${aiReviewPendingCount} 段待 AI 对照` : ''}`}</span>
              <small>长按或双击英文，可翻译或向 AI 提问</small>
            </span>
            <button
              type="button"
              disabled={ocrBusy || (!translatingAll && (extracting || (!needsLocalOcr && readableBlocks.length === 0) || Boolean(translatingHash)))}
              className={translatingAll ? 'is-stop' : ''}
              onClick={() => {
                if (translatingAll) {
                  stopTranslationRef.current = true;
                  setStatus('将在当前段落完成后停止…');
                } else if (paper.localOcrStatus === 'failed') {
                  void onRequestOcr();
                } else {
                  void handleTranslateAll();
                }
              }}
            >
              {ocrBusy ? '正在提取' : paper.localOcrStatus === 'failed' ? '重新提取' : translatingAll ? '停止' : aiReviewPendingCount ? 'AI 对照并翻译' : translatedCount || staleTranslationCount ? '翻译剩余' : '翻译全文'}
            </button>
          </div>
          {extractionSource.warning ? (
            <details className="mobile-extraction-diagnostic">
              <summary>{extractionSource.ocrPages ? '文字层已降级，查看原因' : '文字层兼容处理说明'}</summary>
              <p>{extractionSource.warning}</p>
            </details>
          ) : null}
          <div
            ref={bilingualPageRef}
            className="mobile-bilingual-page"
            onScroll={handleFeedScroll}
            onPointerUp={() => scheduleSelectionCapture(true)}
            onTouchEnd={() => scheduleSelectionCapture(true)}
          >
            {extracting ? <div className="mobile-reader-loading">正在读取本机原文缓存…</div> : null}
            {!extracting && readableBlocks.length === 0 && needsLocalOcr ? (
              <div className="mobile-reader-loading mobile-ocr-empty">
                <strong>{paper.localOcrStatus === 'failed' ? '全文原文提取遇到问题' : '正在导入后提取全文'}</strong>
                <p>每页优先直接读取 PDF 文字层；没有文字层时才在当前设备本地 OCR。此阶段不会调用 DeepSeek，也不会产生中文。</p>
                {paper.localOcrStatus === 'failed' ? <button type="button" onClick={() => void onRequestOcr()}>重新提取</button> : null}
              </div>
            ) : null}
            {!extracting && needsLocalOcr && readableBlocks.length > 0 ? (
              <div className="mobile-ocr-resume">
                <span>全文原文尚未提取完成；已完成页面已经逐页保存在本机，当前不会自动翻译。</span>
                {paper.localOcrStatus === 'failed' ? <button type="button" onClick={() => void onRequestOcr()}>从断点继续</button> : null}
              </div>
            ) : null}
            {!extracting && !needsLocalOcr && readableBlocks.length > 0 && translatedCount === 0 && staleTranslationCount === 0 ? (
              <div className="mobile-bilingual-intro">
                <strong>全文原文已提取</strong>
                <p>{extractionSource.detail} 结果已逐页保存在本机。点击“翻译全文”后，每页会把逐段结果、连续全文、前文术语与相邻双语上下文一起交给 AI；只整理异常边界，并保持科研术语和论述衔接一致。阅读时长按或双击英文词语即可打开选词翻译。</p>
                <button type="button" onClick={() => void handleTranslateAll()}>开始全文翻译</button>
              </div>
            ) : null}
            {feedItems.map((item, index) => {
              const startsPage = index === 0 || feedItems[index - 1].page !== item.page;
              if (item.kind === 'figure') {
                return (
                  <Fragment key={item.entry.sourceHash}>
                    {startsPage ? <div className="mobile-bilingual-page-break">第 {item.page} 页</div> : null}
                    <figure data-pdf-page={item.page} className={`mobile-pdf-figure is-${item.region.kind}`}>
                      {item.region.kind === 'table' && item.region.table
                        ? <MobilePdfStructuredTable table={item.region.table} caption={item.region.caption} />
                        : <MobilePdfFigureCanvas renderer={figureRenderer} region={item.region} />}
                      {!item.region.hasTextCaption ? <figcaption>{item.region.caption}</figcaption> : null}
                    </figure>
                  </Fragment>
                );
              }
              const block = item.block;
              const cached = translationByHash.get(block.sourceHash);
              const formattedOriginal = formatMobileAcademicText(block.original, block.type);
              const formattedTranslation = cached?.translation.trim()
                ? formatMobileAcademicText(
                    cached.translation,
                    /[\u3400-\u9fff]/u.test(cached.translation) ? 'paragraph' : block.type
                  )
                : '';
              return (
                <Fragment key={block.id}>
                  {startsPage ? <div className="mobile-bilingual-page-break">第 {block.page} 页</div> : null}
                  <article data-pdf-page={block.page} className={`mobile-bilingual-block is-${block.type}`}>
                    <div className="mobile-block-original" data-source-text={block.original}>
                      {block.type === 'heading'
                        ? <h2><MathText text={formattedOriginal} /></h2>
                        : <p><MathText text={formattedOriginal} /></p>}
                    </div>
                    {cached?.translation.trim() ? (
                      <div className="mobile-block-translation">
                        <p><MathText text={formattedTranslation} /></p>
                      </div>
                    ) : null}
                  </article>
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mobile-pdf-reader">
          <div className="mobile-pdf-toolbar">
            <button type="button" className="mobile-fit-width" onClick={() => setFitWidthRequestId((value) => value + 1)}>适宽</button>
            <button type="button" aria-label="缩小 PDF" onClick={() => setScale((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}>－</button>
            <span>{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="放大 PDF" onClick={() => setScale((value) => Math.min(2.4, Number((value + 0.1).toFixed(2))))}>＋</button>
            <em>支持双指缩放</em>
          </div>
          <PdfViewer
            pdfData={pdfData}
            fileName={paper.sourcePdf.fileName}
            currentPage={currentPage}
            scale={scale}
            enableTouchZoom
            fitWidthRequestId={fitWidthRequestId}
            onScaleChange={setScale}
            onDocumentLoad={(count) => setPageCount(count)}
            onCurrentPageChange={setCurrentPage}
            onStatusChange={setStatus}
          />
        </div>
      )}

      <footer className="mobile-reader-status"><span>{status}</span></footer>

      {selectionPopover ? (
        <aside
          className="mobile-selection-popover"
          role="dialog"
          aria-label="选中内容操作"
          style={{
            left: selectionPopover.left,
            top: selectionPopover.top,
            width: selectionPopover.width,
            maxHeight: selectionPopover.maxHeight
          }}
        >
          <button type="button" className="mobile-selection-close" aria-label="关闭选中内容操作" onClick={() => closeSelectionPopover()}>×</button>
          <span className="mobile-selection-label">选中内容</span>
          <strong>{selectionPopover.text}</strong>
          {selectionPopover.translation ? <p role="status">{selectionPopover.translation}</p> : null}
          {selectionPopover.error ? <p className="is-error" role="alert">{selectionPopover.error}</p> : null}
          <div className="mobile-selection-actions">
            {!selectionPopover.translation ? (
              <button
                type="button"
                disabled={selectionPopover.loading || translatingAll}
                onClick={() => void translateSelection()}
              >
                {selectionPopover.loading ? '翻译中…' : translatingAll ? '全文翻译进行中' : selectionPopover.error ? '重试翻译' : '翻译选中内容'}
              </button>
            ) : null}
            <button
              type="button"
              className="is-secondary"
              disabled={selectionPopover.loading || translatingAll}
              onClick={openSelectionQuestionDialog}
            >
              向 AI 提问
            </button>
          </div>
        </aside>
      ) : null}

      {selectionQuestionDialog ? (
        <div className="mobile-dialog-backdrop" role="presentation" onClick={closeSelectionQuestionDialog}>
          <section
            className="mobile-translation-dialog mobile-selection-question-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="向 AI 提问"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-dialog-handle" />
            <header>
              <strong>向 AI 提问</strong>
              <button type="button" onClick={closeSelectionQuestionDialog}>关闭</button>
            </header>
            <p>仅把所选英文、所在原文段落、论文标题、已有译文和你的问题发送给当前配置的 AI 接口；不会改写或缓存论文正文。</p>
            <blockquote>
              <span>选中原文</span>
              <p>{selectionQuestionDialog.text}</p>
            </blockquote>
            <label htmlFor="mobile-selection-question">
              你想问什么？
              <textarea
                id="mobile-selection-question"
                autoFocus
                maxLength={1200}
                rows={3}
                disabled={selectionQuestionDialog.loading}
                value={selectionQuestionDialog.question}
                placeholder="例如：这句话在本文方法中起什么作用？"
                onChange={(event) => setSelectionQuestionDialog((current) => current
                  ? { ...current, question: event.target.value, error: undefined }
                  : current)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void askSelectionQuestion();
                  }
                }}
              />
            </label>
            {selectionQuestionDialog.answer ? (
              <div className="mobile-selection-answer" role="status" aria-live="polite">
                <span>AI 回答</span>
                <p><MathText text={selectionQuestionDialog.answer} /></p>
              </div>
            ) : null}
            {selectionQuestionDialog.error ? (
              <p className="mobile-dialog-error" role="alert">{selectionQuestionDialog.error}</p>
            ) : null}
            <button
              type="button"
              className="mobile-dialog-primary"
              disabled={selectionQuestionDialog.loading || !selectionQuestionDialog.question.trim()}
              onClick={() => void askSelectionQuestion()}
            >
              {selectionQuestionDialog.loading
                ? 'AI 正在回答…'
                : selectionQuestionDialog.answer
                  ? '重新提问'
                  : '发送问题'}
            </button>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <MobileTranslationSettingsDialog
          session={translationSession}
          title="全文翻译、选词与 AI 提问设置"
          submitLabel={pendingTranslationRef.current ? '保存并继续' : '保存设置'}
          requireApiKey={Boolean(pendingTranslationRef.current)}
          onClose={() => {
            pendingTranslationRef.current = null;
            setSettingsOpen(false);
          }}
          onSave={async (next) => {
            await onTranslationSessionChange(next);
            const pending = pendingTranslationRef.current;
            pendingTranslationRef.current = null;
            setSettingsOpen(false);
            setStatus('AI 设置已更新；API Key 已保存在当前设备。');
            if (pending?.type === 'all') {
              void handleTranslateAll(next);
            } else if (pending?.type === 'selection') {
              void translateSelection(next);
            } else if (pending?.type === 'question') {
              void askSelectionQuestion(next);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function selectionNodeElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
}

function buildSelectionTranslationCacheKey(
  session: MobileTranslationSession,
  text: string,
  surroundingOriginal: string
): string {
  return [
    session.baseURL.trim().replace(/\/+$/u, '').toLocaleLowerCase(),
    session.model.trim().toLocaleLowerCase(),
    text.toLocaleLowerCase(),
    surroundingOriginal.slice(0, 320).toLocaleLowerCase()
  ].join('\u0000');
}

function figureEntryToRegion(entry: MobileTranslationEntry): MobilePdfFigureRegion | null {
  const bounds = entry.figureBounds;
  if (
    entry.origin !== 'figure' ||
    !bounds ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    !Number.isFinite(bounds.pageWidth) ||
    !Number.isFinite(bounds.pageHeight) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.pageWidth <= 0 ||
    bounds.pageHeight <= 0
  ) {
    return null;
  }
  return {
    id: entry.sourceHash,
    page: Math.max(1, Math.trunc(entry.page)),
    kind: entry.figureKind === 'table' ? 'table' : 'figure',
    caption: entry.original,
    captionHash: entry.figureCaptionHash ?? entry.sourceHash,
    hasTextCaption: entry.figureHasTextCaption !== false,
    order: Number.isFinite(entry.order) ? Number(entry.order) : (entry.page - 1) * 1000,
    bounds,
    hiddenTextHashes: entry.figureTextHashes ?? [],
    ...(entry.figureTable ? { table: entry.figureTable } : {})
  };
}

function MobilePdfStructuredTable({
  table,
  caption
}: {
  table: MobileStructuredTable;
  caption: string;
}) {
  const minimumWidth = Math.max(520, table.headers.length * 128);
  return (
    <div className="mobile-pdf-table-shell">
      <div className="mobile-pdf-table-scroll" role="region" aria-label={`可横向滚动的表格：${caption}`} tabIndex={0}>
        <table style={{ minWidth: `${minimumWidth}px` }}>
          <thead>
            <tr>
              {table.headers.map((header, index) => <th key={`${index}:${header}`} scope="col">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}:${row.join('|')}`}>
                {row.map((cell, columnIndex) => columnIndex === 0
                  ? <th key={`${columnIndex}:${cell}`} scope="row">{cell}</th>
                  : <td key={`${columnIndex}:${cell}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="mobile-pdf-table-hint">左右滑动查看完整表格</span>
    </div>
  );
}

function MobilePdfFigureCanvas({
  renderer,
  region
}: {
  renderer: MobilePdfFigureRenderer | null;
  region: MobilePdfFigureRegion;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderState, setRenderState] = useState<'waiting' | 'rendering' | 'ready' | 'failed'>('waiting');

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || !renderer) {
      setRenderState('waiting');
      return;
    }
    let cancelled = false;
    let started = false;
    const render = () => {
      if (started || cancelled) {
        return;
      }
      started = true;
      setRenderState('rendering');
      void renderer.renderRegion(canvas, region).then(() => {
        if (!cancelled) {
          setRenderState('ready');
        }
      }).catch(() => {
        if (!cancelled) {
          setRenderState('failed');
        }
      });
    };
    if (typeof IntersectionObserver === 'undefined') {
      render();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        render();
      }
    }, { rootMargin: '480px 0px' });
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [region, renderer]);

  return (
    <div
      ref={hostRef}
      className={`mobile-pdf-figure-canvas is-${renderState}`}
      style={{ aspectRatio: `${region.bounds.width} / ${region.bounds.height}` }}
    >
      <canvas ref={canvasRef} aria-label={`${region.kind === 'table' ? '表格' : '插图'}：${region.caption}`} />
      {renderState === 'waiting' || renderState === 'rendering' ? <span>正在从原 PDF 显示图表…</span> : null}
      {renderState === 'failed' ? <span>该图表暂时无法显示，可切换到原始 PDF 查看。</span> : null}
    </div>
  );
}

function formatLocalOcrStatus(paper: MobilePaper): string {
  if (paper.localOcrStatus === 'completed') {
    return `全文原文已提取${paper.pageCount ? `，共 ${paper.pageCount} 页` : ''}；尚未自动翻译。`;
  }
  if (paper.localOcrStatus === 'failed') {
    return `全文原文提取已停止：${paper.localOcrError || '未能识别有效正文'}。已完成页面仍保存在本机。`;
  }
  if (paper.localOcrStatus === 'running') {
    return `正在处理第 ${paper.visionOcrLastPage ?? 0}${paper.pageCount ? ` / ${paper.pageCount}` : ''} 页；优先文字层、无文字层才本地 OCR，不会调用 DeepSeek。`;
  }
  return 'PDF 已导入，正在等待全文原文提取；不会自动翻译。';
}

function formatInitialReaderStatus(
  paper: MobilePaper,
  translations: MobileTranslationEntry[]
): string {
  const restoredCount = translations.filter((entry) => entry.translation.trim()).length;
  return paper.localOcrStatus === 'completed' && restoredCount > 0
    ? `已恢复 ${restoredCount} 段本地译文和原文缓存。`
    : formatLocalOcrStatus(paper);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
