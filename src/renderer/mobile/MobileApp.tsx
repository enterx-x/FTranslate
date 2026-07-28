import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import type { ArxivPaper } from '../../shared/arxiv';
import { MobileArxivScreen, type MobileArxivTranslation } from './MobileArxivScreen';
import { MobileBottomNav, type MobileView } from './MobileBottomNav';
import { MobileLibraryScreen } from './MobileLibraryScreen';
import { MobileReaderScreen } from './MobileReaderScreen';
import {
  buildCachedLocalOcrBlocks,
  recognizePdfPagesLocally,
  resolveLocalOcrResumeState,
  runWhileMobileOcrJobActive,
  settleMobileTaskWithin,
  stitchMobileCrossPageParagraphs
} from './mobileLocalOcr';
import {
  createMobileLibraryWriteQueue,
  downloadPdfFile,
  loadMobileLibrary,
  loadPaperTranslations,
  loadTranslationPreferences,
  readPdfBytes,
  removeStoredPdfFile,
  removeStoredPaper,
  requestPersistentMobileStorage,
  savePaperTranslations,
  savePdfFile,
  saveTranslationPreferences
} from './mobileStorage';
import {
  createArxivMobilePaper,
  createImportedMobilePaper,
  createLocalPaperId,
  isMobilePaperSourceEquivalent,
  mergeTranslationEntry,
  MOBILE_LOCAL_OCR_VERSION,
  replaceMobileFigurePageEntries,
  replaceMobileOcrPageEntries,
  updateMobilePaper,
  upsertMobilePaper,
  type MobilePaper,
  type MobileTranslationEntry,
  type MobileTranslationSession
} from './mobileTypes';
import {
  createMobileFigureEntry,
  MOBILE_PDF_FIGURE_VERSION
} from './mobilePdfFigures';
import { resolveMobileStartupState } from './mobileStartup';
import './mobile.css';

interface MobileOcrJob {
  cancelled: boolean;
  promise: Promise<void>;
}

function MobileApp() {
  const [view, setView] = useState<MobileView>('library');
  const [library, setLibrary] = useState<MobilePaper[]>([]);
  const libraryRef = useRef<MobilePaper[]>([]);
  const libraryHydratedRef = useRef(false);
  const libraryChangedBeforeHydrationRef = useRef(false);
  const libraryWriterRef = useRef<ReturnType<typeof createMobileLibraryWriteQueue> | null>(null);
  libraryWriterRef.current ??= createMobileLibraryWriteQueue();
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const activePaperIdRef = useRef<string | null>(null);
  const activePaperSourceKeyRef = useRef<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [translations, setTranslations] = useState<MobileTranslationEntry[]>([]);
  const translationsRef = useRef<MobileTranslationEntry[]>([]);
  const translationCacheByPaperRef = useRef(new Map<string, MobileTranslationEntry[]>());
  const translationWriteQueuesRef = useRef(new Map<string, Promise<void>>());
  const ocrJobsRef = useRef(new Map<string, MobileOcrJob>());
  const paperCleanupJobsRef = useRef(new Map<string, Promise<void>>());
  const [translationSession, setTranslationSession] = useState<MobileTranslationSession>({
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: ''
  });
  const translationSessionRef = useRef(translationSession);
  const translationSessionHydratedRef = useRef(false);
  const translationSessionChangedBeforeHydrationRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [savingPaperId, setSavingPaperId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const downloadAbortRef = useRef<AbortController | null>(null);

  const activePaper = useMemo(
    () => (activePaperId ? library.find((paper) => paper.id === activePaperId) ?? null : null),
    [activePaperId, library]
  );

  const commitLibrary = useCallback(async (updater: (current: MobilePaper[]) => MobilePaper[]) => {
    const nextLibrary = updater(libraryRef.current);
    if (!libraryHydratedRef.current) {
      libraryChangedBeforeHydrationRef.current = true;
    }
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    await libraryWriterRef.current?.(nextLibrary);
    return nextLibrary;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestPersistentMobileStorage();
    void Promise.allSettled([loadMobileLibrary(), loadTranslationPreferences()])
      .then(([libraryResult, preferencesResult]) => {
        if (cancelled) {
          return;
        }
        const resolved = resolveMobileStartupState({
          libraryResult,
          preferencesResult,
          currentLibrary: libraryRef.current,
          currentPreferences: translationSessionRef.current,
          libraryChanged: libraryChangedBeforeHydrationRef.current,
          preferencesChanged: translationSessionChangedBeforeHydrationRef.current
        });
        libraryHydratedRef.current = true;
        translationSessionHydratedRef.current = true;
        libraryRef.current = resolved.library;
        translationSessionRef.current = resolved.preferences;
        setLibrary(resolved.library);
        setTranslationSession(resolved.preferences);
        if (libraryChangedBeforeHydrationRef.current && libraryResult.status === 'fulfilled') {
          void libraryWriterRef.current?.(resolved.library).catch((error) => {
            if (!cancelled) {
              setNotice(`合并并保存论文库失败：${formatError(error)}`);
            }
          });
        }
        if (resolved.errors.length > 0) {
          setNotice(`读取部分本机资料失败：${resolved.errors.map(formatError).join('；')}`);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          libraryHydratedRef.current = true;
          translationSessionHydratedRef.current = true;
          setNotice(`恢复当前设备资料失败：${formatError(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenPaper = useCallback(async (paper: MobilePaper) => {
    if (
      activePaperIdRef.current === paper.id
      && activePaperSourceKeyRef.current === buildPaperSourceKey(paper)
      && pdfData
    ) {
      await commitLibrary((current) => updateMobilePaper(current, paper.id, { lastOpenedAt: new Date().toISOString() }));
      setView('reader');
      setNotice('');
      return;
    }
    setBusy(true);
    setNotice(`正在打开 ${paper.title}…`);
    try {
      await waitForPaperTranslationWrites(paper.id);
      const [sourceBytes, cachedTranslations] = await Promise.all([
        readPdfBytes(paper.sourcePdf),
        loadPaperTranslations(paper.id)
      ]);
      setPdfData(sourceBytes);
      translationCacheByPaperRef.current.set(paper.id, cachedTranslations);
      translationsRef.current = cachedTranslations;
      setTranslations(cachedTranslations);
      activePaperIdRef.current = paper.id;
      activePaperSourceKeyRef.current = buildPaperSourceKey(paper);
      setActivePaperId(paper.id);
      await commitLibrary((current) => updateMobilePaper(current, paper.id, { lastOpenedAt: new Date().toISOString() }));
      setView('reader');
      setNotice('');
    } catch (error) {
      setNotice(`打开 PDF 失败：${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [commitLibrary, pdfData]);

  async function handleImportPdf(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setNotice('只能导入 PDF 文件。');
      return;
    }
    setBusy(true);
    try {
      const paperId = createLocalPaperId(file.name, file.size, file.lastModified);
      await waitForDeletedPaperCleanup(paperId);
      const existing = libraryRef.current.find((paper) => paper.id === paperId);
      const storedPdf = await savePdfFile({ paperId, file, kind: 'source' });
      const paper = createImportedMobilePaper({ id: paperId, fileName: file.name, storedPdf });
      const nextLibrary = await commitLibrary((current) => upsertMobilePaper(current, paper));
      const cleanupWarning = await clearReplacedSourceData(existing, paper);
      await handleOpenPaper(nextLibrary.find((item) => item.id === paperId) ?? paper);
      setNotice(cleanupWarning || 'PDF 已保存到当前浏览器；全文原文正在后台提取。');
    } catch (error) {
      setNotice(`导入 PDF 失败：${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveArxivPaper(paper: ArxivPaper, translation?: MobileArxivTranslation): Promise<void> {
    if (downloadAbortRef.current) {
      return;
    }
    const abortController = new AbortController();
    downloadAbortRef.current = abortController;
    setSavingPaperId(paper.stableId);
    setNotice(`正在下载 arXiv:${paper.stableId}…`);
    try {
      const paperId = `arxiv-${paper.stableId.replace(/[^a-z0-9._-]+/giu, '-')}`;
      await waitForDeletedPaperCleanup(paperId);
      const existing = libraryRef.current.find((item) => item.id === paperId);
      const storedPdf = await downloadPdfFile({
        paperId,
        url: paper.pdfUrl,
        fileName: `${paper.stableId}-${paper.title.slice(0, 72)}.pdf`,
        signal: abortController.signal
      });
      const mobilePaper = createArxivMobilePaper({
        paper,
        storedPdf,
        titleZh: translation?.titleZh,
        abstractZh: translation?.abstractZh
      });
      const nextLibrary = await commitLibrary((current) => upsertMobilePaper(current, mobilePaper));
      const cleanupWarning = await clearReplacedSourceData(existing, mobilePaper);
      await handleOpenPaper(nextLibrary.find((item) => item.id === mobilePaper.id) ?? mobilePaper);
      setNotice(cleanupWarning || 'arXiv 论文已保存到当前浏览器；全文原文正在后台提取。');
    } catch (error) {
      setNotice(`保存 arXiv 论文失败：${formatError(error)}`);
    } finally {
      if (downloadAbortRef.current === abortController) {
        downloadAbortRef.current = null;
      }
      setSavingPaperId(null);
    }
  }

  async function handleRemovePaper(paper: MobilePaper): Promise<void> {
    if (!window.confirm(`从本机论文库移除“${paper.title}”？这会删除当前浏览器中的 PDF 和翻译缓存。`)) {
      return;
    }
    setBusy(true);
    try {
      const ocrJob = ocrJobsRef.current.get(paper.id);
      if (ocrJob) {
        ocrJob.cancelled = true;
      }
      await commitLibrary((current) => current.filter((item) => item.id !== paper.id));
      if (activePaperId === paper.id) {
        activePaperIdRef.current = null;
        activePaperSourceKeyRef.current = null;
        setActivePaperId(null);
        setPdfData(null);
        translationsRef.current = [];
        setTranslations([]);
      }
      translationCacheByPaperRef.current.delete(paper.id);
      let removalNotice = '论文已从当前浏览器移除。';
      try {
        await removeStoredPaper(paper.id);
      } catch (cleanupError) {
        removalNotice = `论文已移除，但部分本地文件未能清理：${formatError(cleanupError)}`;
      }
      const cleanupJob = finishDeletedPaperCleanup(paper.id, ocrJob?.promise);
      paperCleanupJobsRef.current.set(paper.id, cleanupJob);
      void cleanupJob.then(() => {
        if (paperCleanupJobsRef.current.get(paper.id) === cleanupJob) {
          paperCleanupJobsRef.current.delete(paper.id);
        }
      });
      setNotice(removalNotice);
    } catch (error) {
      setNotice(`移除论文失败：${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function finishDeletedPaperCleanup(paperId: string, ocrJob?: Promise<void>): Promise<void> {
    if (ocrJob) {
      await ocrJob.catch(() => undefined);
    }
    // A page-save timeout cannot cancel the underlying Filesystem/IndexedDB
    // request. Drain the latest queue before the final delete so it cannot
    // recreate an orphan translation file after the UI already removed it.
    while (true) {
      const queuedWrite = translationWriteQueuesRef.current.get(paperId);
      if (!queuedWrite) {
        break;
      }
      await queuedWrite.catch(() => undefined);
      if (translationWriteQueuesRef.current.get(paperId) === queuedWrite) {
        translationWriteQueuesRef.current.delete(paperId);
      }
    }
    translationCacheByPaperRef.current.delete(paperId);
    if (!libraryRef.current.some((item) => item.id === paperId)) {
      await removeStoredPaper(paperId).catch(() => undefined);
    }
  }

  async function waitForDeletedPaperCleanup(paperId: string): Promise<void> {
    const cleanupJob = paperCleanupJobsRef.current.get(paperId);
    if (!cleanupJob) {
      return;
    }
    const settled = await settleMobileTaskWithin(cleanupJob, 5_000);
    if (!settled) {
      throw new Error('同一论文的旧 OCR/缓存任务仍在结束，请稍后再导入。');
    }
  }

  async function handleUpdatePaperMetadata(
    paperId: string,
    updates: Pick<MobilePaper, 'customTitle' | 'tags'>
  ): Promise<void> {
    try {
      await commitLibrary((current) => updateMobilePaper(current, paperId, updates));
      setNotice('论文名称和标签已保存。');
    } catch (error) {
      setNotice(`保存论文信息失败：${formatError(error)}`);
      throw error;
    }
  }

  async function handleSaveTranslations(paperId: string, entries: MobileTranslationEntry[]): Promise<void> {
    const cachedEntries = translationCacheByPaperRef.current.get(paperId)
      ?? (activePaperIdRef.current === paperId ? translationsRef.current : []);
    const next = entries.reduce(mergeTranslationEntry, cachedEntries);
    translationCacheByPaperRef.current.set(paperId, next);
    if (activePaperIdRef.current === paperId) {
      translationsRef.current = next;
      setTranslations(next);
    }

    const previousWrite = translationWriteQueuesRef.current.get(paperId) ?? Promise.resolve();
    const currentWrite = previousWrite
      .catch(() => undefined)
      .then(() => savePaperTranslations(paperId, next));
    translationWriteQueuesRef.current.set(paperId, currentWrite);
    try {
      await currentWrite;
    } finally {
      if (translationWriteQueuesRef.current.get(paperId) === currentWrite) {
        translationWriteQueuesRef.current.delete(paperId);
      }
    }
  }

  async function replacePaperOcrPage(
    paperId: string,
    page: number,
    entries: MobileTranslationEntry[]
  ): Promise<void> {
    await waitForPaperTranslationWrites(paperId);
    let cachedEntries = translationCacheByPaperRef.current.get(paperId);
    if (!cachedEntries) {
      cachedEntries = await loadPaperTranslations(paperId);
    }
    const next = replaceMobileOcrPageEntries(cachedEntries, page, entries);
    await persistPaperTranslationSet(paperId, next);
  }

  async function replacePaperFigurePage(
    paperId: string,
    page: number,
    entries: MobileTranslationEntry[]
  ): Promise<void> {
    await waitForPaperTranslationWrites(paperId);
    let cachedEntries = translationCacheByPaperRef.current.get(paperId);
    if (!cachedEntries) {
      cachedEntries = await loadPaperTranslations(paperId);
    }
    const next = replaceMobileFigurePageEntries(cachedEntries, page, entries);
    await persistPaperTranslationSet(paperId, next);
  }

  async function persistPaperTranslationSet(
    paperId: string,
    next: MobileTranslationEntry[]
  ): Promise<void> {
    translationCacheByPaperRef.current.set(paperId, next);
    if (activePaperIdRef.current === paperId) {
      translationsRef.current = next;
      setTranslations(next);
    }
    const previousWrite = translationWriteQueuesRef.current.get(paperId) ?? Promise.resolve();
    const currentWrite = previousWrite
      .catch(() => undefined)
      .then(() => savePaperTranslations(paperId, next));
    translationWriteQueuesRef.current.set(paperId, currentWrite);
    try {
      await currentWrite;
    } finally {
      if (translationWriteQueuesRef.current.get(paperId) === currentWrite) {
        translationWriteQueuesRef.current.delete(paperId);
      }
    }
  }

  async function waitForPaperTranslationWrites(paperId: string): Promise<void> {
    await translationWriteQueuesRef.current.get(paperId);
  }

  function startPaperLocalOcr(paper: MobilePaper, restart = false): Promise<void> {
    const existing = ocrJobsRef.current.get(paper.id);
    if (existing) {
      return existing.promise;
    }
    const job: MobileOcrJob = { cancelled: false, promise: Promise.resolve() };
    job.promise = (async () => {
      const resetCache = restart
        || paper.localOcrVersion !== MOBILE_LOCAL_OCR_VERSION
        || (paper.localOcrStatus === 'failed' && paper.visionOcrCompleted === true);
      try {
        await commitLibrary((current) => updateMobilePaper(current, paper.id, {
          localOcrVersion: MOBILE_LOCAL_OCR_VERSION,
          localOcrStatus: 'running',
          localOcrError: undefined,
          ...(resetCache ? {
            visionOcrLastPage: undefined,
            visionOcrCompleted: false,
            visionOcrProcessedPages: []
          } : {})
        }));
        const [sourceBytes, loadedEntries] = await Promise.all([
          readPdfBytes(paper.sourcePdf),
          loadPaperTranslations(paper.id)
        ]);
        let cachedEntries = translationCacheByPaperRef.current.get(paper.id) ?? loadedEntries;
        const reusableExtractionEntries = cachedEntries.filter((entry) => (
          entry.origin === 'text' || entry.origin === 'ocr' || entry.origin === 'vision'
        ));
        if (resetCache) {
          cachedEntries = cachedEntries.filter((entry) => (
            entry.origin !== 'text' &&
            entry.origin !== 'ocr' &&
            entry.origin !== 'vision' &&
            entry.origin !== 'figure'
          ));
          await persistPaperTranslationSet(paper.id, cachedEntries);
        } else {
          translationCacheByPaperRef.current.set(paper.id, cachedEntries);
        }
        const currentPaper = libraryRef.current.find((item) => item.id === paper.id) ?? paper;
        const cachedBlocks = buildCachedLocalOcrBlocks(cachedEntries);
        const resume = resolveLocalOcrResumeState({
          textBlockCount: 0,
          cachedBlocks,
          pageCount: Math.max(currentPaper.pageCount ?? 0, 1),
          processedPages: resetCache ? [] : currentPaper.visionOcrProcessedPages,
          legacyLastPage: resetCache ? undefined : currentPaper.visionOcrLastPage,
          legacyCompleted: resetCache ? false : currentPaper.visionOcrCompleted
        });
        if (!resume.required && cachedBlocks.length > 0) {
          await commitLibrary((current) => updateMobilePaper(current, paper.id, {
            pageCount: Math.max(currentPaper.pageCount ?? currentPaper.visionOcrLastPage ?? 1, 1),
            visionOcrLastPage: Math.max(currentPaper.pageCount ?? currentPaper.visionOcrLastPage ?? 1, 1),
            visionOcrCompleted: true,
            localOcrVersion: MOBILE_LOCAL_OCR_VERSION,
            localOcrStatus: 'completed',
            localOcrError: undefined
          }));
          return;
        }
        const result = await recognizePdfPagesLocally(sourceBytes, {
          startPage: resume.startPage,
          isCancelled: () => job.cancelled,
          onPageRecognized: async ({
            page,
            pageCount: totalPages,
            blocks: pageBlocks,
            source,
            extractionMode,
            extractionWarning,
            figures
          }) => {
            const isCurrentJob = () => (
              !job.cancelled
              && ocrJobsRef.current.get(paper.id) === job
              && libraryRef.current.some((item) => item.id === paper.id)
            );
            if (!isCurrentJob()) {
              return;
            }
            const previousByHash = new Map(
              [
                ...(resetCache ? reusableExtractionEntries : []),
                ...(translationCacheByPaperRef.current.get(paper.id) ?? cachedEntries)
              ]
                .map((entry) => [entry.sourceHash, entry])
            );
            const entries = pageBlocks.map((item): MobileTranslationEntry => {
              const previous = previousByHash.get(item.block.sourceHash);
              return {
                sourceHash: item.block.sourceHash,
                page: item.block.page,
                original: item.block.original,
                translation: previous?.translation ?? '',
                translatedAt: previous?.translatedAt ?? new Date().toISOString(),
                model: previous?.model ?? '',
                ...(previous?.baseURL ? { baseURL: previous.baseURL } : {}),
                origin: source,
                extractionMode,
                ...(extractionWarning ? { extractionWarning } : {}),
                order: item.order,
                blockType: item.block.type
              };
            });
            if (!await runWhileMobileOcrJobActive(
              isCurrentJob,
              () => replacePaperOcrPage(paper.id, page, entries)
            )) {
              return;
            }
            if (!await runWhileMobileOcrJobActive(
              isCurrentJob,
              () => replacePaperFigurePage(paper.id, page, figures.map(createMobileFigureEntry))
            )) {
              return;
            }
            await runWhileMobileOcrJobActive(isCurrentJob, () => commitLibrary((current) => {
              const target = current.find((item) => item.id === paper.id);
              const processedPages = Array.from(new Set([
                ...(target?.visionOcrProcessedPages ?? []),
                page
              ])).sort((left, right) => left - right);
              return updateMobilePaper(current, paper.id, {
                pageCount: totalPages,
                visionOcrLastPage: page,
                visionOcrCompleted: false,
                visionOcrProcessedPages: processedPages,
                localOcrVersion: MOBILE_LOCAL_OCR_VERSION,
                localOcrStatus: 'running',
                localOcrError: undefined
              });
            }).then(() => undefined));
          }
        });
        if (
          result.cancelled
          || job.cancelled
          || ocrJobsRef.current.get(paper.id) !== job
          || !libraryRef.current.some((item) => item.id === paper.id)
        ) {
          return;
        }
        const extractedEntries = translationCacheByPaperRef.current.get(paper.id) ?? [];
        const finalEntries = stitchMobileCrossPageParagraphs(extractedEntries);
        if (finalEntries !== extractedEntries) {
          await persistPaperTranslationSet(paper.id, finalEntries);
        }
        const finalBlockCount = buildCachedLocalOcrBlocks(finalEntries).length;
        const figureCount = finalEntries.filter((entry) => (
          entry.origin === 'figure' && entry.figureVersion === MOBILE_PDF_FIGURE_VERSION
        )).length;
        await commitLibrary((current) => updateMobilePaper(current, paper.id, {
          pageCount: result.pageCount,
          visionOcrLastPage: Math.max(1, result.lastProcessedPage),
          visionOcrCompleted: true,
          localOcrVersion: MOBILE_LOCAL_OCR_VERSION,
          localOcrStatus: finalBlockCount > 0 ? 'completed' : 'failed',
          localOcrError: finalBlockCount > 0 ? undefined : '没有从文字层或本地 OCR 中提取到有效正文。',
          figureExtractionVersion: MOBILE_PDF_FIGURE_VERSION,
          figureCount
        }));
      } catch (error) {
        const shouldReportFailure = (
          !job.cancelled
          && ocrJobsRef.current.get(paper.id) === job
          && libraryRef.current.some((item) => item.id === paper.id)
        );
        // Promise.race cannot cancel a timed-out IndexedDB write. Mark the job
        // inactive first so a late page callback cannot resurrect "running".
        job.cancelled = true;
        if (shouldReportFailure) {
          await commitLibrary((current) => updateMobilePaper(current, paper.id, {
            localOcrVersion: MOBILE_LOCAL_OCR_VERSION,
            localOcrStatus: 'failed',
            localOcrError: formatError(error),
            visionOcrCompleted: false
          }));
        }
      } finally {
        if (ocrJobsRef.current.get(paper.id) === job) {
          ocrJobsRef.current.delete(paper.id);
        }
        // Wake the single-job scheduler after the current paper releases its slot.
        // A library commit normally renders before `finally`, while the job is still
        // registered, so queued papers otherwise have no later state change to start them.
        setLibrary((current) => [...current]);
      }
    })();
    ocrJobsRef.current.set(paper.id, job);
    return job.promise;
  }

  useEffect(() => {
    if (busy || ocrJobsRef.current.size > 0) {
      return;
    }
    const nextPaper = library.find((paper) => (
      paper.localOcrVersion !== MOBILE_LOCAL_OCR_VERSION ||
      !paper.localOcrStatus ||
      paper.localOcrStatus === 'pending' ||
      paper.localOcrStatus === 'running'
    ));
    if (nextPaper) {
      void startPaperLocalOcr(nextPaper);
    }
  }, [busy, library]);

  const handleProgressChange = useCallback((page: number, pageCount: number) => {
    if (!activePaperId) {
      return;
    }
    void commitLibrary((current) => updateMobilePaper(current, activePaperId, { lastPage: page, pageCount }))
      .catch((error) => setNotice(`保存阅读进度失败：${formatError(error)}`));
  }, [activePaperId, commitLibrary]);

  async function handleTranslationSessionChange(session: MobileTranslationSession): Promise<void> {
    if (!session.baseURL.trim() || !session.model.trim()) {
      throw new Error('Base URL 和 Model 不能为空。');
    }
    if (!translationSessionHydratedRef.current) {
      translationSessionChangedBeforeHydrationRef.current = true;
    }
    translationSessionRef.current = session;
    setTranslationSession(session);
    await saveTranslationPreferences(session);
  }

  async function clearReplacedSourceData(existing: MobilePaper | undefined, incoming: MobilePaper): Promise<string> {
    if (!existing || isMobilePaperSourceEquivalent(existing, incoming)) {
      return '';
    }
    await waitForPaperTranslationWrites(incoming.id);
    translationCacheByPaperRef.current.set(incoming.id, []);
    await savePaperTranslations(incoming.id, []);
    const staleFiles = [
      existing.translatedPdf,
      existing.sourcePdf.path !== incoming.sourcePdf.path ? existing.sourcePdf : undefined
    ].filter((pdf): pdf is MobilePaper['sourcePdf'] => Boolean(pdf));
    const cleanup = await Promise.allSettled(staleFiles.map((pdf) => removeStoredPdfFile(pdf)));
    return cleanup.some((result) => result.status === 'rejected')
      ? '论文已更新并清空旧译文，但有旧文件未能删除；不影响当前阅读。'
      : '';
  }

  return (
    <div className="mobile-app">
      <main className="mobile-app-main">
        {view === 'library' ? (
          <MobileLibraryScreen
            papers={library}
            activePaperId={activePaperId}
            busy={busy}
            onImportPdf={handleImportPdf}
            onOpenPaper={handleOpenPaper}
            onRemovePaper={handleRemovePaper}
            onUpdatePaper={handleUpdatePaperMetadata}
          />
        ) : null}
        <div className="mobile-view-layer" hidden={view !== 'search'}>
          <MobileArxivScreen
            savingPaperId={savingPaperId}
            translationSession={translationSession}
            onSavePaper={handleSaveArxivPaper}
            onCancelSave={() => downloadAbortRef.current?.abort()}
            onTranslationSessionChange={handleTranslationSessionChange}
          />
        </div>
        {activePaper && pdfData ? (
          <div className="mobile-view-layer" hidden={view !== 'reader'}>
            <MobileReaderScreen
              key={activePaper.id}
              paper={activePaper}
              pdfData={pdfData}
              translations={translations}
              translationSession={translationSession}
              onBack={() => setView('library')}
              onProgressChange={handleProgressChange}
              onRequestOcr={() => startPaperLocalOcr(activePaper)}
              onSaveTranslation={(entry) => handleSaveTranslations(activePaper.id, [entry])}
              onReplacePageEntries={(page, entries) => replacePaperOcrPage(activePaper.id, page, entries)}
              onReplaceFigureEntries={(page, entries) => replacePaperFigurePage(activePaper.id, page, entries)}
              onFigureExtractionComplete={(figureCount) => commitLibrary((current) => updateMobilePaper(current, activePaper.id, {
                figureExtractionVersion: MOBILE_PDF_FIGURE_VERSION,
                figureCount
              })).then(() => undefined)}
              onTranslationSessionChange={handleTranslationSessionChange}
            />
          </div>
        ) : null}
      </main>

      {view !== 'reader' ? (
        <MobileBottomNav view={view} readerEnabled={Boolean(activePaper && pdfData)} onChange={setView} />
      ) : null}

      {notice ? <div className="mobile-global-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')}>×</button></div> : null}
    </div>
  );
}

class MobileErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Mobile reader render failed', error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <main className="mobile-fatal-error" role="alert">
        <strong>手机阅读器遇到异常</strong>
        <p>论文数据仍保留在当前浏览器中。请先重新加载；不要清除 Safari 网站数据。</p>
        <details><summary>错误详情</summary><code>{this.state.error.message}</code></details>
        <button type="button" onClick={() => window.location.reload()}>重新加载</button>
      </main>
    );
  }
}

export default function MobileAppRoot() {
  return <MobileErrorBoundary><MobileApp /></MobileErrorBoundary>;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildPaperSourceKey(paper: MobilePaper): string {
  return paper.sourceRevision
    || paper.sourcePdf.contentHash
    || `${paper.sourcePdf.path}|${paper.sourcePdf.byteLength}`;
}
