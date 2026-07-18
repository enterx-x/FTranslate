import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { PdfViewer } from '../components/PdfViewer';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import { MobileTranslationSettingsDialog } from './MobileTranslationSettingsDialog';
import {
  MOBILE_AI_PAGE_REFLOW_VERSION,
  needsAcademicPageAiReview,
  reflowAndTranslateAcademicPage,
  translateAcademicText
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
  MobilePaper,
  MobileTranslationEntry,
  MobileTranslationSession
} from './mobileTypes';
import { summarizeMobileExtractionSources } from './mobileExtractionSource';
import { isTranslationEntryCurrent } from './mobileTypes';

type MobileReaderMode = 'bilingual' | 'pdf';
type PendingTranslation =
  | { type: 'all' }
  | { type: 'selection' };

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
  left: number;
  top: number;
  maxHeight: number;
  translation?: string;
  loading?: boolean;
  error?: string;
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
  const pendingTranslationRef = useRef<PendingTranslation | null>(null);
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
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  const translationByHash = useMemo(
    () => new Map(translations.map((entry) => [entry.sourceHash, entry])),
    [translations]
  );
  const figureEntries = useMemo(() => translations.filter((entry) => (
    entry.origin === 'figure' &&
    entry.figureVersion === MOBILE_PDF_FIGURE_VERSION &&
    Boolean(entry.figureBounds)
  )), [translations]);
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
    const hasFigures = figureEntries.length > 0;
    if (!hasFigures) {
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
  }, [figureEntries.length > 0, paper.id, pdfData]);

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
    updateStatus = true
  ): Promise<boolean> {
    if (!session.apiKey.trim()) {
      return false;
    }
    setTranslatingHash(block.sourceHash);
    if (updateStatus) {
      setStatus(`正在翻译第 ${block.page} 页段落…`);
    }
    try {
      const translation = await translateAcademicText(block.original, session);
      const cached = translationByHash.get(block.sourceHash);
      await onSaveTranslation({
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
        ...(Number.isFinite(cached?.aiReflowVersion) ? { aiReflowVersion: cached?.aiReflowVersion } : {})
      });
      if (updateStatus) {
        setStatus('译文已直接写在对应英文段落下方，并缓存在本机。');
      }
      return true;
    } catch (error) {
      if (updateStatus) {
        setStatus(`翻译失败：${formatError(error)}`);
      }
      return false;
    } finally {
      setTranslatingHash(null);
    }
  }

  async function reflowAndTranslatePage(
    page: number,
    pageBlocks: ExtractedPdfBlock[],
    session: MobileTranslationSession
  ): Promise<number> {
    setTranslatingHash(pageBlocks[0]?.sourceHash ?? `ocr-page-${page}`);
    try {
      const bilingualParagraphs = await reflowAndTranslateAcademicPage(
        pageBlocks.map((block, index) => ({
          index,
          type: block.type,
          text: block.original
        })),
        session
      );
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
        aiReflowVersion: MOBILE_AI_PAGE_REFLOW_VERSION
      }));
      await onReplacePageEntries(page, entries);
      return entries.length;
    } finally {
      setTranslatingHash(null);
    }
  }

  async function handleTranslateAll(session = translationSession): Promise<void> {
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

    stopTranslationRef.current = false;
    setTranslatingAll(true);
    let succeeded = 0;
    let failed = 0;
    let completedPages = 0;
    let failedPage = 0;
    let failedReason = '';
    let aiComparedPages = 0;
    let preservedLocalPages = 0;
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
      setStatus(`正在让 AI 对照逐段结果与连续全文，检查并翻译第 ${page} 页（${completedPages + 1} / ${pageTargets.length} 页）…`);
      try {
        succeeded += await reflowAndTranslatePage(page, sourcePageBlocks, session);
        aiComparedPages += 1;
      } catch (error) {
        preservedLocalPages += 1;
        const reflowError = formatError(error);
        setStatus(`第 ${page} 页 AI 整页结果未通过安全校验：${reflowError}；已保留本地段落并继续逐段翻译。`);
        for (const block of pageBlocks) {
          if (stopTranslationRef.current) {
            break;
          }
          if (await translateBlock(block, session, false)) {
            succeeded += 1;
          } else {
            failed += 1;
            failedPage = page;
            failedReason = reflowError;
            break;
          }
        }
      }
      if (!stopTranslationRef.current && failed === 0) {
        completedPages += 1;
        setStatus(`第 ${page} 页译文已全部缓存，准备处理下一页…`);
      }
    }
    setTranslatingAll(false);
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
  }

  function handleBilingualModeClick(): void {
    setMode('bilingual');
    setReadingImmersive(false);
  }

  function handleFeedScroll(): void {
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

  function captureSelection(): void {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().replace(/\s+/gu, ' ').trim() ?? '';
      if (!selection || !text || text.length > 800 || !bilingualPageRef.current) {
        return;
      }
      const anchorNode = selection.anchorNode;
      if (!anchorNode || !bilingualPageRef.current.contains(anchorNode)) {
        return;
      }
      const rect = selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      const top = Math.max(74, Math.min(window.innerHeight - 180, (rect?.bottom ?? 80) + 8));
      setSelectionPopover({
        text,
        left: Math.max(12, Math.min(window.innerWidth - 292, rect?.left ?? 12)),
        top,
        maxHeight: Math.max(140, window.innerHeight - top - 12)
      });
    }, 30);
  }

  async function translateSelection(session = translationSession): Promise<void> {
    if (!selectionPopover) {
      return;
    }
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'selection' };
      setSettingsOpen(true);
      return;
    }
    setSelectionPopover({ ...selectionPopover, loading: true, error: undefined });
    try {
      const translation = await translateAcademicText(selectionPopover.text, session);
      setSelectionPopover({ ...selectionPopover, translation, loading: false });
    } catch (error) {
      setSelectionPopover({ ...selectionPopover, loading: false, error: formatError(error) });
    }
  }

  return (
    <section className={`mobile-screen mobile-reader-screen${mode === 'bilingual' && readingImmersive ? ' is-reading-immersive' : ''}`} aria-label="PDF 阅读与翻译">
      <header className="mobile-reader-header">
        <button type="button" className="mobile-reader-back" onClick={onBack} aria-label="返回论文库">‹</button>
        <div>
          <strong>{paper.customTitle || paper.titleZh || paper.title}</strong>
          <span>第 {currentPage}{pageCount ? ` / ${pageCount}` : ''} 页</span>
        </div>
        <button type="button" className="mobile-reader-more" disabled={translatingAll || Boolean(translatingHash)} onClick={() => setSettingsOpen(true)} aria-label="翻译设置">•••</button>
      </header>

      <div className="mobile-reader-mode-bar" role="group" aria-label="阅读模式">
        <button type="button" className={mode === 'bilingual' ? 'active' : ''} onClick={handleBilingualModeClick}>连续双语</button>
        <button type="button" className={mode === 'pdf' ? 'active' : ''} onClick={() => {
          setReadingImmersive(false);
          setMode('pdf');
        }}>原始 PDF</button>
      </div>

      {mode === 'bilingual' ? (
        <div className="mobile-bilingual-reader">
          <div className="mobile-bilingual-toolbar">
            <span>{needsLocalOcr
              ? paper.localOcrStatus === 'failed'
                ? '全文原文提取失败'
                : `导入后全文提取 · ${paper.visionOcrLastPage ?? 0}${paper.pageCount ? ` / ${paper.pageCount}` : ''} 页${extractionSource.textPages || extractionSource.ocrPages ? ` · ${extractionSource.label}` : ''}`
              : `${translatedCount} / ${readableBlocks.length} 段已译 · ${extractionSource.label}${figureEntries.length ? ` · ${figureEntries.length} 个图表` : ''}${pendingTranslationCount ? ` · ${pendingTranslationCount} 段待翻译` : ''}${staleTranslationCount ? ` · ${staleTranslationCount} 段待更新` : ''}${aiReviewPendingCount ? ` · ${aiReviewPendingCount} 段待 AI 对照` : ''}`}</span>
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
            onPointerUp={captureSelection}
            onTouchEnd={captureSelection}
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
                <p>{extractionSource.detail} 结果已逐页保存在本机。点击“翻译全文”后，每页会把逐段结果和连续全文一起交给 AI 对照；只整理异常边界并生成中文。</p>
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
                      <MobilePdfFigureCanvas renderer={figureRenderer} region={item.region} />
                      {!item.region.hasTextCaption ? <figcaption>{item.region.caption}</figcaption> : null}
                    </figure>
                  </Fragment>
                );
              }
              const block = item.block;
              const cached = translationByHash.get(block.sourceHash);
              return (
                <Fragment key={block.id}>
                  {startsPage ? <div className="mobile-bilingual-page-break">第 {block.page} 页</div> : null}
                  <article data-pdf-page={block.page} className={`mobile-bilingual-block is-${block.type}`}>
                    <div className="mobile-block-original">
                      {block.type === 'heading' ? <h2>{block.original}</h2> : <p>{block.original}</p>}
                    </div>
                    {cached?.translation.trim() ? (
                      <div className="mobile-block-translation">
                        <p>{cached.translation}</p>
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
        <aside className="mobile-selection-popover" style={{ left: selectionPopover.left, top: selectionPopover.top, maxHeight: selectionPopover.maxHeight }}>
          <button type="button" className="mobile-selection-close" onClick={() => setSelectionPopover(null)}>×</button>
          <strong>{selectionPopover.text}</strong>
          {selectionPopover.translation ? <p>{selectionPopover.translation}</p> : null}
          {selectionPopover.error ? <p className="is-error">{selectionPopover.error}</p> : null}
          {!selectionPopover.translation ? <button type="button" disabled={selectionPopover.loading} onClick={() => void translateSelection()}>{selectionPopover.loading ? '翻译中…' : '翻译选中文本'}</button> : null}
        </aside>
      ) : null}

      {settingsOpen ? (
        <MobileTranslationSettingsDialog
          session={translationSession}
          title="全文段落翻译设置"
          submitLabel={pendingTranslationRef.current ? '保存并开始翻译' : '保存设置'}
          onClose={() => {
            pendingTranslationRef.current = null;
            setSettingsOpen(false);
          }}
          onSave={async (next) => {
            await onTranslationSessionChange(next);
            const pending = pendingTranslationRef.current;
            pendingTranslationRef.current = null;
            setSettingsOpen(false);
            setStatus('翻译设置已更新；API Key 已保存在当前设备。');
            if (pending?.type === 'all') {
              void handleTranslateAll(next);
            } else if (pending?.type === 'selection') {
              void translateSelection(next);
            }
          }}
        />
      ) : null}
    </section>
  );
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
    hiddenTextHashes: entry.figureTextHashes ?? []
  };
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
