import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { PdfViewer } from '../components/PdfViewer';
import { extractPdfBlocksFromData } from '../lib/pdfOutlineExtraction';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import { MobileTranslationSettingsDialog } from './MobileTranslationSettingsDialog';
import { translateAcademicText } from './mobileTranslation';
import {
  buildCachedLocalOcrBlocks,
  recognizePdfPagesLocally,
  resolveLocalOcrResumeState
} from './mobileLocalOcr';
import type {
  MobilePaper,
  MobileTranslationEntry,
  MobileTranslationSession
} from './mobileTypes';
import { isTranslationEntryCurrent } from './mobileTypes';

type MobileReaderMode = 'bilingual' | 'pdf';
type PendingTranslation =
  | { type: 'all' }
  | { type: 'block'; block: ExtractedPdfBlock }
  | { type: 'selection' }
  | { type: 'ocr' };

interface MobileReaderScreenProps {
  paper: MobilePaper;
  pdfData: Uint8Array;
  translations: MobileTranslationEntry[];
  translationSession: MobileTranslationSession;
  onBack: () => void;
  onProgressChange: (page: number, pageCount: number) => void;
  onOcrProgressChange: (lastPage: number, completed: boolean) => Promise<void>;
  onSaveTranslation: (entry: MobileTranslationEntry) => Promise<void>;
  onTranslationSessionChange: (session: MobileTranslationSession) => Promise<void>;
}

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
  onOcrProgressChange,
  onSaveTranslation,
  onTranslationSessionChange
}: MobileReaderScreenProps) {
  const bilingualPageRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const readerScrollTopRef = useRef(0);
  const restoredFeedRef = useRef(false);
  const stopTranslationRef = useRef(false);
  const stopOcrRef = useRef(false);
  const pendingTranslationRef = useRef<PendingTranslation | null>(null);
  const [mode, setMode] = useState<MobileReaderMode>('bilingual');
  const [currentPage, setCurrentPage] = useState(Math.max(1, paper.lastPage));
  const [pageCount, setPageCount] = useState(Math.max(0, paper.pageCount ?? 0));
  const [scale, setScale] = useState(1);
  const [fitWidthRequestId, setFitWidthRequestId] = useState(0);
  const [blocks, setBlocks] = useState<ExtractedPdfBlock[]>([]);
  const [extracting, setExtracting] = useState(true);
  const [status, setStatus] = useState('正在解析 PDF 段落…');
  const [translatingHash, setTranslatingHash] = useState<string | null>(null);
  const [translatingAll, setTranslatingAll] = useState(false);
  const [ocrRequired, setOcrRequired] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null);
  const [readingImmersive, setReadingImmersive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    restoredFeedRef.current = false;
    readerScrollTopRef.current = 0;
    setReadingImmersive(false);
    setBlocks([]);
    setExtracting(true);
    setStatus('正在把 PDF 转换为连续段落…');
    void extractPdfBlocksFromData(pdfData, () => cancelled)
      .then((nextBlocks) => {
        if (!cancelled) {
          const textBlocks = nextBlocks.filter((block) => block.original.trim());
          const cachedOcrBlocks = textBlocks.length === 0 ? buildCachedLocalOcrBlocks(translations) : [];
          const restoredBlocks = textBlocks.length > 0 ? textBlocks : cachedOcrBlocks;
          const restoredLastPage = cachedOcrBlocks.reduce((max, block) => Math.max(max, block.page), 0);
          const knownPageCount = Math.max(paper.pageCount ?? 0, ...nextBlocks.map((block) => block.page), 1);
          const ocrResumeState = resolveLocalOcrResumeState({
            textBlockCount: textBlocks.length,
            cachedBlocks: cachedOcrBlocks,
            pageCount: knownPageCount,
            legacyLastPage: paper.visionOcrLastPage,
            legacyCompleted: paper.visionOcrCompleted
          });
          setBlocks(restoredBlocks);
          setPageCount((count) => Math.max(count, ...nextBlocks.map((block) => block.page), 1));
          setOcrRequired(ocrResumeState.required);
          setExtracting(false);
          setStatus(textBlocks.length
            ? `已转换为连续文章，共 ${nextBlocks.length} 个段落；中文会直接显示在英文下方。`
            : cachedOcrBlocks.length
              ? `已恢复 ${cachedOcrBlocks.length} 个本地 OCR 段落${restoredLastPage < knownPageCount ? '，可继续识别剩余页面。' : '。'}`
              : '检测到 PDF 没有文字层。可先在手机本地 OCR，再把识别出的纯文字交给 DeepSeek 翻译。');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setExtracting(false);
          setOcrRequired(true);
          setStatus(`无法直接提取段落：${formatError(error)} 可改用手机本地 OCR。`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdfData]);

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
    }
    restoredFeedRef.current = true;
  }, [blocks, paper.lastPage]);

  useEffect(() => () => {
    stopTranslationRef.current = true;
    stopOcrRef.current = true;
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  const translationByHash = useMemo(
    () => new Map(translations.map((entry) => [entry.sourceHash, entry])),
    [translations]
  );
  const translatedCount = blocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(cached && isTranslationEntryCurrent(cached, translationSession));
  }).length;
  const staleTranslationCount = blocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(cached?.translation.trim() && !isTranslationEntryCurrent(cached, translationSession));
  }).length;
  const pendingTranslationCount = blocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(cached && !cached.translation.trim());
  }).length;
  const hasOcrBlocks = blocks.some((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return cached?.origin === 'ocr' || cached?.origin === 'vision';
  });
  const needsLocalOcr = ocrRequired || (!extracting && blocks.length === 0);

  async function translateBlock(
    block: ExtractedPdfBlock,
    session: MobileTranslationSession,
    updateStatus = true
  ): Promise<boolean> {
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'block', block };
      setSettingsOpen(true);
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
        ...(Number.isFinite(cached?.order) ? { order: cached?.order } : {}),
        ...(cached?.blockType ? { blockType: cached.blockType } : {})
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

  async function handleTranslateBlock(
    block: ExtractedPdfBlock,
    session = translationSession
  ): Promise<void> {
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'block', block };
      setSettingsOpen(true);
      return;
    }
    await translateBlock(block, session);
  }

  async function handleTranslateAll(session = translationSession): Promise<void> {
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'all' };
      setSettingsOpen(true);
      return;
    }
    const targets = blocks.filter((block) => {
      const cached = translationByHash.get(block.sourceHash);
      return !cached || !isTranslationEntryCurrent(cached, session);
    });
    if (targets.length === 0) {
      setStatus('全文译文均由当前翻译配置生成，无需更新。');
      return;
    }

    stopTranslationRef.current = false;
    setTranslatingAll(true);
    let succeeded = 0;
    let failed = 0;
    for (const block of targets) {
      if (stopTranslationRef.current) {
        break;
      }
      setStatus(`正在翻译全文 ${succeeded + 1} / ${targets.length} 段…`);
      if (await translateBlock(block, session, false)) {
        succeeded += 1;
      } else {
        failed += 1;
        break;
      }
    }
    setTranslatingAll(false);
    const stopped = stopTranslationRef.current;
    stopTranslationRef.current = false;
    if (failed > 0) {
      setStatus(`全文翻译在第 ${succeeded + 1} 段停止：成功 ${succeeded} 段，失败 ${failed} 段；已成功部分仍保存在本机。`);
    } else if (stopped) {
      setStatus(`已停止全文翻译；本次完成 ${succeeded} 段，已完成译文仍保存在本机。`);
    } else {
      setStatus(`全文翻译完成：${succeeded} 个段落的中文已直接排在英文下方。`);
    }
  }

  async function handleRecognizeScan(session = translationSession): Promise<void> {
    if (!session.apiKey.trim()) {
      pendingTranslationRef.current = { type: 'ocr' };
      setSettingsOpen(true);
      return;
    }

    stopOcrRef.current = false;
    setOcrBusy(true);
    const cachedOcrBlocks = buildCachedLocalOcrBlocks(translations);
    const { startPage } = resolveLocalOcrResumeState({
      textBlockCount: 0,
      cachedBlocks: cachedOcrBlocks,
      pageCount: Math.max(pageCount, paper.pageCount ?? 0, 1),
      legacyLastPage: paper.visionOcrLastPage,
      legacyCompleted: paper.visionOcrCompleted
    });
    let recognizedThisRun = 0;
    let translatedThisRun = 0;
    let translationFailure = '';
    try {
      const result = await recognizePdfPagesLocally(pdfData, {
        startPage,
        isCancelled: () => stopOcrRef.current,
        onDocumentReady: (count) => setPageCount(count),
        onProgress: ({ progress, status: progressStatus }) => {
          const percentage = Math.round(progress * 100);
          setStatus(`${progressStatus}${percentage > 0 ? ` ${percentage}%` : ''}`);
        },
        onPageRecognized: async ({ page, pageCount: totalPages, blocks: pageBlocks }) => {
          setStatus(`本地 OCR 已完成第 ${page} / ${totalPages} 页，正在保存识别文字…`);
          if (pageBlocks.length === 0) {
            await onOcrProgressChange(page, false);
            return;
          }
          recognizedThisRun += pageBlocks.length;
          setBlocks((current) => {
            const incomingHashes = new Set(pageBlocks.map((item) => item.block.sourceHash));
            return [...current.filter((block) => !incomingHashes.has(block.sourceHash)), ...pageBlocks.map((item) => item.block)]
              .sort((left, right) => left.page - right.page);
          });
          for (const item of pageBlocks) {
            await onSaveTranslation({
              sourceHash: item.block.sourceHash,
              page: item.block.page,
              original: item.block.original,
              translation: '',
              translatedAt: new Date().toISOString(),
              model: session.model,
              baseURL: session.baseURL.trim().replace(/\/+$/u, ''),
              origin: 'ocr',
              order: item.order,
              blockType: item.block.type
            });
          }
          await onOcrProgressChange(page, false);

          for (let index = 0; index < pageBlocks.length; index += 1) {
            if (stopOcrRef.current || translationFailure) {
              break;
            }
            const item = pageBlocks[index];
            setStatus(`第 ${page} 页本地 OCR 完成，DeepSeek 正在翻译 ${index + 1} / ${pageBlocks.length} 段…`);
            try {
              const translation = await translateAcademicText(item.block.original, session);
              await onSaveTranslation({
                sourceHash: item.block.sourceHash,
                page: item.block.page,
                original: item.block.original,
                translation,
                translatedAt: new Date().toISOString(),
                model: session.model,
                baseURL: session.baseURL.trim().replace(/\/+$/u, ''),
                origin: 'ocr',
                order: item.order,
                blockType: item.block.type
              });
              translatedThisRun += 1;
            } catch (error) {
              translationFailure = formatError(error);
            }
          }
        }
      });
      const incomplete = result.cancelled || result.lastProcessedPage < result.pageCount;
      setOcrRequired(incomplete);
      if (result.cancelled) {
        setStatus(`已停止本地 OCR；本次识别 ${recognizedThisRun} 段、翻译 ${translatedThisRun} 段，已完成内容仍保存在本机。`);
      } else if (result.recognizedBlockCount === 0 && blocks.length === 0) {
        setOcrRequired(true);
        setStatus('手机本地 OCR 没有识别到正文。请切换到原始 PDF 检查页面是否清晰、方向是否正确。');
      } else {
        await onOcrProgressChange(result.lastProcessedPage, true);
        setOcrRequired(false);
        setStatus(translationFailure
          ? `本地 OCR 已完成并保存 ${recognizedThisRun} 段；DeepSeek 翻译停止：${translationFailure}。可点击“翻译剩余”继续。`
          : `扫描 PDF 处理完成：本地识别 ${recognizedThisRun} 段，DeepSeek 翻译 ${translatedThisRun} 段，已按段落重排。`);
      }
    } catch (error) {
      setOcrRequired(true);
      setStatus(`本地 OCR 停止：${formatError(error)} 已完成页面仍保存在本机。`);
    } finally {
      stopOcrRef.current = false;
      setOcrBusy(false);
    }
  }

  function handleBilingualModeClick(): void {
    setMode('bilingual');
    setReadingImmersive(false);
    if (!extracting && needsLocalOcr && !ocrBusy) {
      void handleRecognizeScan();
    }
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
        <button type="button" className="mobile-reader-more" disabled={ocrBusy || translatingAll || Boolean(translatingHash)} onClick={() => setSettingsOpen(true)} aria-label="翻译设置">•••</button>
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
              ? '扫描 PDF · 手机本地 OCR'
              : `${translatedCount} / ${blocks.length} 段已译${pendingTranslationCount ? ` · ${pendingTranslationCount} 段待翻译` : staleTranslationCount ? ` · ${staleTranslationCount} 段待更新` : ''}`}</span>
            <button
              type="button"
              disabled={!ocrBusy && !translatingAll && (extracting || (!needsLocalOcr && blocks.length === 0) || Boolean(translatingHash))}
              className={translatingAll || ocrBusy ? 'is-stop' : ''}
              onClick={() => {
                if (ocrBusy) {
                  stopOcrRef.current = true;
                  setStatus('将在当前扫描页完成后停止…');
                } else if (needsLocalOcr) {
                  void handleRecognizeScan();
                } else if (translatingAll) {
                  stopTranslationRef.current = true;
                  setStatus('将在当前段落完成后停止…');
                } else {
                  void handleTranslateAll();
                }
              }}
            >
              {ocrBusy ? '停止处理' : needsLocalOcr ? blocks.length ? '继续本地识别' : '本地识别扫描件' : translatingAll ? '停止' : translatedCount || staleTranslationCount || pendingTranslationCount ? '翻译剩余' : '翻译全文'}
            </button>
          </div>
          <div
            ref={bilingualPageRef}
            className="mobile-bilingual-page"
            onScroll={handleFeedScroll}
            onPointerUp={captureSelection}
            onTouchEnd={captureSelection}
          >
            {extracting ? <div className="mobile-reader-loading">正在识别全文段落，完成后可像文章一样连续向下阅读…</div> : null}
            {!extracting && blocks.length === 0 && needsLocalOcr ? (
              <div className="mobile-reader-loading mobile-ocr-empty">
                <strong>检测到扫描版 PDF</strong>
                <p>手机会先在本地逐页 OCR，页面图片不会发给 DeepSeek；只有识别出的文字会交给 DeepSeek 翻译，再按“原文在上、中文在下”重排。首次使用需加载一次本地 OCR 组件。</p>
                <button type="button" disabled={ocrBusy} onClick={() => void handleRecognizeScan()}>{ocrBusy ? '正在本地识别…' : '本地识别并翻译'}</button>
              </div>
            ) : null}
            {!extracting && needsLocalOcr && blocks.length > 0 ? (
              <div className="mobile-ocr-resume">
                <span>本地 OCR 尚未完成；已识别的原文和 DeepSeek 译文可以先阅读。</span>
                <button type="button" disabled={ocrBusy} onClick={() => void handleRecognizeScan()}>继续本地识别</button>
              </div>
            ) : null}
            {!extracting && blocks.length > 0 && translatedCount === 0 && staleTranslationCount === 0 ? (
              <div className="mobile-bilingual-intro">
                <strong>{hasOcrBlocks ? '扫描 PDF 已完成本地文字识别' : '普通 PDF 已转为连续文章'}</strong>
                <p>{hasOcrBlocks
                  ? '识别出的英文已经保存在本机；点击“翻译全文”后只把文字交给 DeepSeek，中文会直接排在对应英文下方。'
                  : '点击“翻译全文”后，每段中文会直接排在对应英文下方；原 PDF 始终保留在右侧模式中。'}</p>
                <button type="button" onClick={() => void handleTranslateAll()}>开始全文翻译</button>
              </div>
            ) : null}
            {blocks.map((block, index) => {
              const cached = translationByHash.get(block.sourceHash);
              const startsPage = index === 0 || blocks[index - 1].page !== block.page;
              const hasCurrentTranslation = Boolean(cached?.translation.trim() && isTranslationEntryCurrent(cached, translationSession));
              const showBlockAction = translatingHash === block.sourceHash || !hasCurrentTranslation;
              return (
                <Fragment key={block.id}>
                  {startsPage ? <div className="mobile-bilingual-page-break">第 {block.page} 页</div> : null}
                  <article data-pdf-page={block.page} className={`mobile-bilingual-block is-${block.type}`}>
                    <div className={`mobile-block-original${showBlockAction ? ' has-action' : ''}`}>
                      {block.type === 'heading' ? <h2>{block.original}</h2> : <p>{block.original}</p>}
                      {showBlockAction ? (
                        <button type="button" disabled={Boolean(translatingHash) || ocrBusy} onClick={() => void handleTranslateBlock(block)}>
                          {translatingHash === block.sourceHash
                            ? '翻译中…'
                            : cached?.translation.trim() ? '更新译文' : '译此段'}
                        </button>
                      ) : null}
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
            setStatus('翻译设置已更新；API Key 仅保留在本次运行会话。');
            if (pending?.type === 'all') {
              void handleTranslateAll(next);
            } else if (pending?.type === 'block') {
              void handleTranslateBlock(pending.block, next);
            } else if (pending?.type === 'selection') {
              void translateSelection(next);
            } else if (pending?.type === 'ocr') {
              void handleRecognizeScan(next);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
