import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import {
  AI_REASONING_EFFORT_OPTIONS,
  AI_THINKING_MODE_OPTIONS,
  describeAiRuntimeOptions,
  shouldTranslateItem,
  type AiProviderId,
  type GenericChatCompletionInput,
  type AiReasoningEffort,
  type AiThinkingMode
} from '../shared/aiTranslation';
import { formatPdfTranslationProgressMessage } from '../shared/pdfTranslation';
import type { AiAssistantFocus } from './components/AiAssistantPage';
import { AppSidebar, type AppSidebarSection } from './components/AppSidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomePage } from './components/HomePage';
import { buildKnowledgeGraph } from './lib/knowledgeGraph';
import { describeReferenceStrategy } from './lib/appSettings';
import {
  buildPresentationDraft,
  extractFigureCandidates,
  serializePresentationMarkdown,
  type PresentationDraft,
  type PresentationFigureCandidate
} from './lib/presentationOutline';
import type { ArxivPaper } from './lib/arxivClient';
import { arrayBufferToBase64 } from './lib/binaryEncoding';
import { createPresentationPptxBuffer } from './lib/presentationPptx';
import {
  enrichPresentationDraftWithPdfFigureCrops,
  extractPdfFigureAssets,
  mergePdfFigureAssetUpdate
} from './lib/presentationFigureAssets';
import { NotesPanel } from './components/NotesPanel';
import { PdfFigureAssetsPanel } from './components/PdfFigureAssetsPanel';
import { PdfViewer } from './components/PdfViewer';
import { extractPdfBlocksFromData } from './lib/pdfOutlineExtraction';
import { Toolbar } from './components/Toolbar';
import { ConnectedStatusBar } from './components/StatusBar';
import translateIcon from './assets/icons/duotone/translate.svg';
import uploadIcon from './assets/icons/duotone/upload.svg';
import downloadIcon from './assets/icons/duotone/download.svg';
import refreshIcon from './assets/icons/duotone/refresh.svg';
import searchIcon from './assets/icons/duotone/search.svg';
import settingsIcon from './assets/icons/duotone/settings.svg';
import backIcon from './assets/icons/duotone/back.svg';
import forwardIcon from './assets/icons/duotone/forward.svg';
import {
  getDefaultAiCacheFileName,
  cloneJsonDocumentForAi,
  updateAiCacheItem
} from './lib/aiMode';
import { buildPaperCellPrompt } from './lib/paperCellAi';
import {
  buildLiteratureGapPrompt,
  parseLiteratureGapResponse
} from './lib/literatureInsight';
import {
  ensurePaperRow,
  getResearchRowValues
} from './lib/researchWorkbook';
import { buildFreshPdfSessionState } from './lib/projectSession';
import { buildSheetCellsPrompt, cleanSheetCellAiValue, parseSheetCellsAiResponse } from './lib/sheetCellAi';
import type { PaperTutorEvidenceStoreEntry } from './lib/paperTutor';
import {
  exportBilingualMarkdown,
  serializeTranslationDocument,
  type TranslationDocument,
  type TranslationItem
} from './lib/translation';
import type { ExtractedPdfBlock } from './lib/pdfTextStructure';
import {
  buildPaperRecord,
  PAPER_RESEARCH_COLUMNS,
  updatePaperRecord,
  updatePaperSheetCell,
  upsertPaperRecord,
  type PaperRecord,
  type PaperResearchColumnKey
} from './lib/papers';
import { buildCurrentJsonPrompt, buildFullJsonPrompt } from './lib/promptTemplates';
import type {
  PdfFilePayload,
  PdfTranslationResult,
  SaveTextResult
} from './types/electron';
import type {
  AnalyzeLiteratureGapRequest,
  AnalyzeLiteratureGapResult,
  FillResearchCellResult,
  FillResearchCellsRequest
} from './components/ResearchSheetPage';
import { usePaperLibrary } from './hooks/usePaperLibrary';
import {
  readLegacyPapersWithSheetCells,
  useResearchWorkbook
} from './hooks/useResearchWorkbook';
import { usePdfTranslation } from './hooks/usePdfTranslation';
import { useStatusQueue } from './hooks/useStatusQueue';
import { usePdfSession, type PdfState } from './hooks/usePdfSession';
import { useAiTranslation } from './hooks/useAiTranslation';
import { useAiSettings } from './hooks/useAiSettings';
import { useReaderSidePanel } from './hooks/useReaderSidePanel';
import { useRecentProject } from './hooks/useRecentProject';
import { useViewTransition } from './hooks/useViewTransition';
import { useAppSettings } from './hooks/useAppSettings';
import { AiTranslationProvider } from './contexts/AiTranslationContext';
import { PaperLibraryProvider } from './contexts/PaperLibraryContext';
import { PdfSessionProvider } from './contexts/PdfSessionContext';
import { UiProvider, type AppView } from './contexts/UiContext';

type ReaderMode = 'manual' | 'ai';

const ResearchSheetPage = lazy(async () => {
  const module = await import('./components/ResearchSheetPage');
  return { default: module.ResearchSheetPage };
});
const AiAssistantPage = lazy(async () => {
  const module = await import('./components/AiAssistantPage');
  return { default: module.AiAssistantPage };
});
const PaperTutorPage = lazy(async () => {
  const module = await import('./components/PaperTutorPage');
  return { default: module.PaperTutorPage };
});
const KnowledgeGraphPage = lazy(async () => {
  const module = await import('./components/KnowledgeGraphPage');
  return { default: module.KnowledgeGraphPage };
});
const PresentationPage = lazy(async () => {
  const module = await import('./components/PresentationPage');
  return { default: module.PresentationPage };
});
const ArxivSearchPage = lazy(async () => {
  const module = await import('./components/ArxivSearchPage');
  return { default: module.ArxivSearchPage };
});
const SettingsPage = lazy(async () => {
  const module = await import('./components/SettingsPage');
  return { default: module.SettingsPage };
});

export default function App() {
  const [view, setView] = useState<AppView>('home');
  const { getAppMainClassName } = useViewTransition(view);
  const [homeSection, setHomeSection] = useState<'hub' | 'library'>('hub');
  const [aiAssistantFocus, setAiAssistantFocus] = useState<AiAssistantFocus>('analysis');
  const [readerMode, setReaderMode] = useState<ReaderMode>('manual');
  const {
    initialPaperLibraryRaw,
    paperLibrary,
    setPaperLibrary,
    updatePaper: handleUpdatePaper,
    removePaper: handleRemovePaper
  } = usePaperLibrary();
  const legacyPapersWithSheetCells = useMemo(
    () => readLegacyPapersWithSheetCells(initialPaperLibraryRaw, paperLibrary),
    [initialPaperLibraryRaw, paperLibrary]
  );
  const {
    researchWorkbook,
    setResearchWorkbook,
    researchSheetLinks,
    setResearchSheetLinks
  } = useResearchWorkbook(legacyPapersWithSheetCells);
  const [researchFocusPaperId, setResearchFocusPaperId] = useState<string | null>(null);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const {
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
  } = usePdfSession();
  const [presentationDraft, setPresentationDraft] = useState<PresentationDraft | null>(null);
  const {
    translationDocument,
    setTranslationDocument,
    aiCacheDocument,
    setAiCacheDocument,
    currentParagraphIndex,
    setCurrentParagraphIndex,
    aiParagraphIndex,
    setAiParagraphIndex,
    showTranslation,
    setShowTranslation,
    isEditing,
    setIsEditing,
    editingText,
    setEditingText,
    currentItem,
    applyTranslationPayload,
    applyAiCachePayload,
    buildCacheFromPdfBlocks,
    showPreviousParagraph: handlePreviousParagraph,
    showNextParagraph: handleNextParagraph,
    showCurrentTranslation: handleShowTranslation,
    startEditingCurrentTranslation: handleStartEdit,
    applyCurrentEdit,
    resetParagraphDisplay
  } = useAiTranslation();
  const [extractedPdfBlocks, setExtractedPdfBlocks] = useState<ExtractedPdfBlock[]>([]);
  const [pdfFigureAssets, setPdfFigureAssets] = useState<PresentationFigureCandidate[]>([]);
  const [paperTutorEvidenceByPaperId, setPaperTutorEvidenceByPaperId] = useState<
    Record<string, PaperTutorEvidenceStoreEntry>
  >({});
  const [activeNotes, setActiveNotes] = useState('');
  const [isPdfAiSettingsOpen, setIsPdfAiSettingsOpen] = useState(false);
  const {
    isReaderSidePanelCollapsed,
    setIsReaderSidePanelCollapsed,
    readerSidePanelRatio,
    handleReaderSidePanelResizeStart
  } = useReaderSidePanel();
  const [isPresentationGenerating, setIsPresentationGenerating] = useState(false);
  const [isPdfFigureExtracting, setIsPdfFigureExtracting] = useState(false);
  const activePdfPathRef = useRef<string | null>(null);
  const displayedPdfPathRef = useRef<string | null>(null);
  const sourcePdfRef = useRef<PdfState | null>(null);
  const displayedPdfRef = useRef<PdfState | null>(null);
  const pdfViewModeRef = useRef(pdfViewMode);
  const extractedPdfBlocksReadyRef = useRef<(blocks: ExtractedPdfBlock[]) => void>(() => undefined);
  const pdfTranslationRunRef = useRef(0);
  const pdfFigureExtractionRunRef = useRef(0);
  const presentationGenerationRunRef = useRef(0);
  const { statusMessage, statusMessages, setStatusMessage } = useStatusQueue(
    '请在论文库中新建或打开一个翻译项目。'
  );
  const {
    aiSettings,
    aiBalance,
    aiForm,
    isAiBusy,
    setIsAiBusy,
    modelOptions,
    handleProviderChange,
    handleAiFormChange,
    handleSaveAiSettings,
    handleTestAiConnection,
    handleRefreshAiBalance,
    handleRefreshAiModels
  } = useAiSettings(setStatusMessage);
  const {
    pdfTranslationEngine,
    pdfTranslationStatus,
    isPdfTranslationBusy,
    setPdfTranslationStatus,
    setIsPdfTranslationBusy,
    refreshPdfTranslationEngine
  } = usePdfTranslation();

  const activePaper = useMemo(
    () => (activePaperId ? paperLibrary.find((paper) => paper.id === activePaperId) ?? null : null),
    [activePaperId, paperLibrary]
  );
  const activePaperResearchLink = useMemo(
    () => (activePaperId ? researchSheetLinks.find((link) => link.paperId === activePaperId) : undefined),
    [activePaperId, researchSheetLinks]
  );
  const activePaperResearchRowIndex = useMemo(
    () =>
      activePaperResearchLink
        ? researchWorkbook.rows.findIndex((row) => row.id === activePaperResearchLink.rowId)
        : -1,
    [activePaperResearchLink, researchWorkbook.rows]
  );
  const activePaperResearchRowValues = useMemo(
    () =>
      activePaperResearchRowIndex > 0
        ? getResearchRowValues(researchWorkbook, activePaperResearchRowIndex)
        : null,
    [activePaperResearchRowIndex, researchWorkbook]
  );
  const knowledgeGraphSummary = useMemo(
    () =>
      buildKnowledgeGraph({
        papers: paperLibrary,
        workbook: researchWorkbook,
        links: researchSheetLinks,
        maxNodes: 160
      }).stats,
    [paperLibrary, researchWorkbook, researchSheetLinks]
  );
  const appSettings = useAppSettings(view);

  useRecentProject({
    pdfPath: pdf?.filePath,
    translationPath: translationDocument?.sourcePath,
    aiCachePath: aiCacheDocument?.sourcePath
  });

  useEffect(() => {
    sourcePdfRef.current = pdf;
    activePdfPathRef.current = pdf?.filePath ?? null;
  }, [pdf]);

  useEffect(() => {
    displayedPdfRef.current = displayedPdf;
    displayedPdfPathRef.current = displayedPdf?.filePath ?? null;
  }, [displayedPdf]);

  useEffect(() => {
    pdfViewModeRef.current = pdfViewMode;
  }, [pdfViewMode]);

  useEffect(() => {
    if (!activePaperId || view !== 'reader') {
      return;
    }

    setPaperLibrary((library) =>
      library.map((paper) =>
        paper.id === activePaperId ? updatePaperRecord(paper, { lastPage: currentPage }) : paper
      )
    );
  }, [activePaperId, currentPage, view]);

  function buildPdfState(payload: PdfFilePayload): PdfState {
    return {
      filePath: payload.filePath,
      fileName: payload.fileName,
      data: base64ToUint8Array(payload.base64)
    };
  }

  function applyPdfPayload(
    payload: PdfFilePayload,
    initialPage = 1,
    options: { keepTranslatedPdf?: boolean } = {}
  ): PdfState {
    const nextPdf = buildPdfState(payload);

    setPdf(nextPdf);
    if (!options.keepTranslatedPdf) {
      setTranslatedPdf(null);
      setTranslatedMonoPdf(null);
      setPdfViewMode('source');
    }
    setExtractedPdfBlocks([]);
    setPdfFigureAssets([]);
    setAiCacheDocument(null);
    setPdfViewportState(null);
    setCurrentPage(initialPage);
    setAiParagraphIndex(0);
    setPageCount(0);
    return nextPdf;
  }

  function applyTranslatedPdfPayload(payload: PdfFilePayload, monoPayload?: PdfFilePayload | null): PdfState {
    const nextPdf = buildPdfState(payload);

    setTranslatedPdf(nextPdf);
    setTranslatedMonoPdf(monoPayload ? buildPdfState(monoPayload) : null);
    setPdfViewMode(monoPayload ? 'parallel' : 'translated');
    setPdfViewportState(null);
    setPageCount(0);
    return nextPdf;
  }

  function buildPaperTutorTextSnippets(blocks: ExtractedPdfBlock[]): string[] {
    return blocks
      .filter((block) => block.original.trim())
      .slice(0, 24)
      .map((block) => `p.${block.page} ${block.section ? `[${block.section}] ` : ''}${block.original}`);
  }

  function rememberPaperTutorEvidence(
    paperId: string | null | undefined,
    updates: Partial<PaperTutorEvidenceStoreEntry>
  ): void {
    if (!paperId) {
      return;
    }

    setPaperTutorEvidenceByPaperId((current) => {
      const previous = current[paperId] ?? { figures: [], pdfTextSnippets: [] };
      return {
        ...current,
        [paperId]: {
          figures: updates.figures ?? previous.figures,
          pdfTextSnippets: updates.pdfTextSnippets ?? previous.pdfTextSnippets
        }
      };
    });
  }

  function handleExtractedPdfBlocksReady(blocks: ExtractedPdfBlock[]): void {
    setExtractedPdfBlocks(blocks);
    rememberPaperTutorEvidence(activePaperId, {
      pdfTextSnippets: buildPaperTutorTextSnippets(blocks)
    });
  }

  useEffect(() => {
    extractedPdfBlocksReadyRef.current = handleExtractedPdfBlocksReady;
  });

  const handleSourceDocumentLoad = useCallback((nextPageCount: number) => {
    const sourcePdf = sourcePdfRef.current;
    if (sourcePdf && activePdfPathRef.current !== sourcePdf.filePath) {
      return;
    }
    setPageCount(nextPageCount);
    setCurrentPage((page) => Math.min(Math.max(1, page), nextPageCount));
  }, []);

  const handleSourceCurrentPageChange = useCallback((page: number) => {
    const sourcePdf = sourcePdfRef.current;
    if (sourcePdf && activePdfPathRef.current !== sourcePdf.filePath) {
      return;
    }
    setCurrentPage((current) => (current === page ? current : page));
  }, []);

  const handleSourceExtractedTextReady = useCallback((blocks: ExtractedPdfBlock[]) => {
    const sourcePdf = sourcePdfRef.current;
    if (sourcePdf && activePdfPathRef.current === sourcePdf.filePath) {
      extractedPdfBlocksReadyRef.current(blocks);
    }
  }, []);

  const handleParallelTranslationDocumentLoad = useCallback((nextPageCount: number) => {
    const sourcePdf = sourcePdfRef.current;
    if (sourcePdf && activePdfPathRef.current !== sourcePdf.filePath) {
      return;
    }
    setPageCount((count) => Math.max(count, nextPageCount));
  }, []);

  const handleIgnoredExtractedTextReady = useCallback(() => undefined, []);

  const handleDisplayedDocumentLoad = useCallback((nextPageCount: number) => {
    const nextDisplayedPdf = displayedPdfRef.current;
    if (nextDisplayedPdf?.filePath && displayedPdfPathRef.current !== nextDisplayedPdf.filePath) {
      return;
    }
    setPageCount(nextPageCount);
    setCurrentPage((page) => Math.min(Math.max(1, page), nextPageCount));
  }, []);

  const handleDisplayedCurrentPageChange = useCallback((page: number) => {
    const nextDisplayedPdf = displayedPdfRef.current;
    if (nextDisplayedPdf?.filePath && displayedPdfPathRef.current !== nextDisplayedPdf.filePath) {
      return;
    }
    setCurrentPage((current) => (current === page ? current : page));
  }, []);

  const handleDisplayedExtractedTextReady = useCallback((blocks: ExtractedPdfBlock[]) => {
    const sourcePdf = sourcePdfRef.current;
    if (
      pdfViewModeRef.current === 'source' &&
      sourcePdf?.filePath &&
      activePdfPathRef.current === sourcePdf.filePath
    ) {
      extractedPdfBlocksReadyRef.current(blocks);
    }
  }, []);

  function isSamePdfFilePath(left?: string | null, right?: string | null): boolean {
    if (!left || !right) {
      return false;
    }

    return normalizeFilePathForCompare(left) === normalizeFilePathForCompare(right);
  }

  function normalizeFilePathForCompare(value: string): string {
    return value.trim().replace(/\\/gu, '/').toLowerCase();
  }

  function rememberPaper(record: PaperRecord): PaperRecord {
    let nextRecord = record;
    setPaperLibrary((library) => {
      const nextLibrary = upsertPaperRecord(library, record);
      nextRecord = nextLibrary[0];
      return nextLibrary;
    });
    setActivePaperId(nextRecord.id);
    return nextRecord;
  }

  async function handleOpenPaper(paper: PaperRecord): Promise<void> {
    try {
      const result = await window.electronAPI.loadProject({
        pdfPath: paper.pdfPath,
        translationPath: paper.translationPath,
        aiCachePath: paper.aiCachePath,
        translatedPdfPath: paper.translatedPdfPath,
        translatedMonoPdfPath: paper.translatedMonoPdfPath
      });

      if (!result.pdf) {
        setStatusMessage(
          result.errors.length > 0
            ? result.errors.join('；')
            : '无法打开论文记录，请检查 PDF 是否仍在原路径。'
        );
        return;
      }

      const hasDistinctTranslatedPdf = Boolean(
        result.translatedPdf && !isSamePdfFilePath(result.translatedPdf.filePath, result.pdf.filePath)
      );
      const hasDistinctTranslatedMonoPdf = Boolean(
        result.translatedMonoPdf && !isSamePdfFilePath(result.translatedMonoPdf.filePath, result.pdf.filePath)
      );
      const hasReadableTranslatedPdf = hasDistinctTranslatedPdf || hasDistinctTranslatedMonoPdf;
      const resourceWarnings = [...result.errors];

      applyPdfPayload(result.pdf, paper.lastPage, { keepTranslatedPdf: hasReadableTranslatedPdf });
      if (result.translation) {
        applyTranslationPayload(result.translation);
      } else {
        setTranslationDocument(null);
        setCurrentParagraphIndex(0);
        setShowTranslation(false);
      }
      if (result.aiCache) {
        const aiDocument = applyAiCachePayload(result.aiCache);
        if (!aiDocument) {
          resourceWarnings.push('AI 缓存不是 JSON 翻译数组，已只打开手动翻译文件。');
        }
      }
      const translatedDisplayPdf = result.translatedPdf ?? result.translatedMonoPdf;
      if (translatedDisplayPdf && hasReadableTranslatedPdf) {
        applyTranslatedPdfPayload(translatedDisplayPdf, result.translatedPdf ? result.translatedMonoPdf : null);
      }
      const translatedPdfLabel = result.translatedPdf ? '双语 PDF' : '中文 PDF';
      const updated = updatePaperRecord(paper, {
        lastOpenedAt: new Date().toISOString()
      });
      setPaperLibrary((library) =>
        library.map((item) => (item.id === paper.id ? updated : item))
      );
      setActivePaperId(paper.id);
      const cachedTutorEvidence = paperTutorEvidenceByPaperId[paper.id];
      setPdfFigureAssets(cachedTutorEvidence?.figures ?? []);
      setActiveNotes(paper.notes ?? '');
      setView('reader');
      const openedMessage =
        hasReadableTranslatedPdf
          ? `已打开论文并切换到${translatedPdfLabel}：${paper.chineseTitle || paper.englishTitle}`
          : result.aiCache
            ? `已打开论文并自动导入 AI 缓存：${paper.chineseTitle || paper.englishTitle}`
            : `已打开论文：${paper.chineseTitle || paper.englishTitle}`;
      setStatusMessage(
        resourceWarnings.length > 0
          ? `${openedMessage}；部分资源未加载：${resourceWarnings.join('；')}`
          : openedMessage
      );
    } catch (error) {
      setStatusMessage(`打开论文记录失败：${String(error)}`);
    }
  }

  function handleOpenResearchSheet(paper?: PaperRecord): void {
    if (paper) {
      const ensured = ensurePaperRow(researchWorkbook, researchSheetLinks, paper);
      setResearchWorkbook(ensured.workbook);
      setResearchSheetLinks(ensured.links);
      setResearchFocusPaperId(paper.id);
    } else {
      setResearchFocusPaperId(null);
    }

    setView('researchSheet');
  }

  async function handleOpenPdf(): Promise<void> {
    try {
      const payload = await window.electronAPI.openPdf();
      if (!payload) {
        return;
      }

      applyPdfPayload(payload);
      const freshSession = buildFreshPdfSessionState();
      setTranslationDocument(freshSession.translationDocument);
      setAiCacheDocument(freshSession.aiCacheDocument);
      setCurrentParagraphIndex(freshSession.currentParagraphIndex);
      setAiParagraphIndex(freshSession.aiParagraphIndex);
      setShowTranslation(freshSession.showTranslation);
      setIsEditing(freshSession.isEditing);
      setEditingText(freshSession.editingText);
      setActivePaperId(null);
      setActiveNotes('');
      setStatusMessage(`已打开 PDF：${payload.fileName}`);
    } catch (error) {
      setStatusMessage(`打开 PDF 失败：${String(error)}`);
    }
  }

  async function handleOpenTranslation(): Promise<void> {
    try {
      const payload = await window.electronAPI.openTranslation();
      if (!payload) {
        return;
      }

      applyTranslationPayload(payload);
      setStatusMessage(`已打开翻译文件：${payload.fileName}`);
    } catch (error) {
      setStatusMessage(`打开翻译文件失败：${String(error)}`);
    }
  }

  async function handleCheckPdfTranslationEngine(): Promise<void> {
    try {
      const engine = await refreshPdfTranslationEngine();
      setStatusMessage(engine.message);
    } catch (error) {
      const message = `PDF 翻译引擎检查失败：${String(error)}`;
      setPdfTranslationStatus(message);
      setStatusMessage(message);
    }
  }

  async function handleGenerateBilingualPdf(force = false): Promise<void> {
    const sourcePdf = pdf;
    if (!sourcePdf) {
      setStatusMessage('请先打开原文 PDF。');
      return;
    }

    const paper = ensureActivePaperForCurrentPdf();
    if (!paper) {
      setStatusMessage('无法建立论文记录，暂不能生成双语 PDF。');
      return;
    }

    const translationRunId = pdfTranslationRunRef.current + 1;
    pdfTranslationRunRef.current = translationRunId;
    const sourcePdfPath = sourcePdf.filePath;
    const isCurrentTranslation = (): boolean =>
      pdfTranslationRunRef.current === translationRunId && activePdfPathRef.current === sourcePdfPath;

    try {
      setIsPdfTranslationBusy(true);
      setReaderMode('ai');
      setPdfTranslationStatus('正在准备生成双语 PDF...');
      const result = await window.electronAPI.translatePdf({
        paperId: paper.id,
        pdfPath: sourcePdf.filePath,
        outputMode: 'dual',
        force
      });

      if (!isCurrentTranslation()) {
        return;
      }
      applyTranslatedPdfPayload(result.pdf, result.monoPdf);
      rememberTranslatedPdfResult(paper.id, result);
      setStatusMessage(result.message);
      setPdfTranslationStatus(result.message);
    } catch (error) {
      if (!isCurrentTranslation()) {
        return;
      }
      const detail = formatPdfTranslationProgressMessage(String(error)) || String(error);
      const message = `生成双语 PDF 失败：${detail}`;
      setStatusMessage(message);
      setPdfTranslationStatus(message);
    } finally {
      if (pdfTranslationRunRef.current === translationRunId) {
        setIsPdfTranslationBusy(false);
      }
    }
  }

  async function handleImportTranslatedPdf(): Promise<void> {
    if (!pdf) {
      setStatusMessage('请先打开原文 PDF，再导入对应的中文/双语 PDF。');
      return;
    }
    const sourcePdfPath = pdf?.filePath ?? null;
    try {
      const payload = await window.electronAPI.openTranslatedPdf();
      if (!payload) {
        return;
      }

      if (sourcePdfPath && activePdfPathRef.current !== sourcePdfPath) {
        setStatusMessage('当前原文 PDF 已切换，已取消绑定刚选择的中文/双语 PDF。');
        return;
      }

      if (pdf && isSamePdfFilePath(payload.filePath, pdf.filePath)) {
        setStatusMessage('导入的中文/双语 PDF 与当前原文 PDF 是同一个文件，已取消绑定，避免误显示为双语 PDF。');
        return;
      }

      applyTranslatedPdfPayload(payload);
      const paper = ensureActivePaperForCurrentPdf();
      if (paper) {
        setPaperLibrary((library) =>
          library.map((item) =>
            item.id === paper.id
              ? updatePaperRecord(item, {
                  translatedPdfPath: payload.filePath,
                  translatedPdfName: payload.fileName,
                  translatedMonoPdfPath: undefined,
                  translatedMonoPdfName: undefined,
                  translatedPdfMode: 'dual',
                  translatedAt: new Date().toISOString()
                })
              : item
          )
        );
      }
      setStatusMessage(`已导入并显示中文/双语 PDF：${payload.fileName}`);
    } catch (error) {
      setStatusMessage(`导入中文/双语 PDF 失败：${String(error)}`);
    }
  }

  async function handleExportTranslatedPdf(): Promise<void> {
    if (!translatedPdf?.filePath) {
      setStatusMessage('当前没有可导出的双语 PDF，请先生成或导入双语 PDF。');
      return;
    }

    try {
      const result = await window.electronAPI.exportPdf({
        sourcePath: translatedPdf.filePath,
        defaultFileName: translatedPdf.fileName || buildPdfExportFileName(pdf?.fileName)
      });

      if (!result) {
        setStatusMessage('已取消导出双语 PDF。');
        return;
      }

      setStatusMessage(`双语 PDF 已导出：${result.fileName}`);
    } catch (error) {
      setStatusMessage(`导出双语 PDF 失败：${String(error)}`);
    }
  }

  async function handleExtractPdfFigures(): Promise<void> {
    if (!pdf) {
      setStatusMessage('请先打开原文 PDF，再提取文献图片。');
      return;
    }

    const extractionRunId = pdfFigureExtractionRunRef.current + 1;
    pdfFigureExtractionRunRef.current = extractionRunId;
    const sourcePdfPath = pdf.filePath;
    const isCurrentExtraction = (): boolean =>
      pdfFigureExtractionRunRef.current === extractionRunId && activePdfPathRef.current === sourcePdfPath;

    try {
      const evidencePaper = ensureActivePaperForCurrentPdf();
      setIsPdfFigureExtracting(true);
      setStatusMessage('正在解析 PDF caption 并提取文献图片...');
      let blocks = extractedPdfBlocks;
      if (blocks.length === 0) {
        blocks = await extractPdfBlocksFromData(pdf.data);
        if (!isCurrentExtraction()) {
          return;
        }
        setExtractedPdfBlocks(blocks);
        rememberPaperTutorEvidence(evidencePaper?.id ?? activePaperId, {
          pdfTextSnippets: buildPaperTutorTextSnippets(blocks)
        });
      }

      const candidates = extractFigureCandidates(blocks);
      if (candidates.length === 0) {
        if (!isCurrentExtraction()) {
          return;
        }
        setPdfFigureAssets([]);
        rememberPaperTutorEvidence(evidencePaper?.id ?? activePaperId, { figures: [] });
        setStatusMessage('没有在当前 PDF 中识别到 Figure/Table caption，暂未提取到图片。');
        return;
      }
      const visibleCandidates = candidates.slice(0, 8);
      setPdfFigureAssets(candidates);

      const figures = await extractPdfFigureAssets(pdf.data, candidates, {
        maxFigures: 8,
        renderScale: 1.1,
        isCancelled: () => !isCurrentExtraction(),
        onFigureExtracted: (figure) => {
          if (!isCurrentExtraction()) {
            return;
          }
          setPdfFigureAssets((currentFigures) =>
            currentFigures.length > 0
              ? mergePdfFigureAssetUpdate(currentFigures, figure)
              : mergePdfFigureAssetUpdate(visibleCandidates, figure)
          );
        }
      });
      if (!isCurrentExtraction()) {
        return;
      }
      setPdfFigureAssets(figures);
      rememberPaperTutorEvidence(evidencePaper?.id ?? activePaperId, {
        figures,
        pdfTextSnippets: buildPaperTutorTextSnippets(blocks)
      });
      const imageReadyCount = figures.filter((figure) => figure.imageDataUrl).length;
      const nativeImageCount = figures.filter((figure) => figure.imageExtractionMethod === 'native-image').length;
      const nativeCompositeCount = figures.filter((figure) => figure.imageExtractionMethod === 'native-image-composite').length;
      const pageCropCount = figures.filter((figure) => figure.imageExtractionMethod === 'page-crop').length;
      setStatusMessage(
        imageReadyCount > 0
          ? `已识别 ${figures.length} 个图表候选，提取 ${imageReadyCount} 张图像：PDF 内嵌图像 ${nativeImageCount} 张，PDF 内嵌组合 ${nativeCompositeCount} 张，页面裁剪兜底 ${pageCropCount} 张。`
          : `已识别 ${figures.length} 个图表 caption，但未能可靠提取图像；仍可把 caption 提供给 AI。`
      );
    } catch (error) {
      if (isCurrentExtraction()) {
        setStatusMessage(`提取 PDF 图片失败：${String(error)}`);
      }
    } finally {
      if (pdfFigureExtractionRunRef.current === extractionRunId) {
        setIsPdfFigureExtracting(false);
      }
    }
  }

  async function handleGeneratePresentationFromCurrentPdf(): Promise<void> {
    if (!pdf) {
      setStatusMessage('请先打开原文 PDF，再生成组会 PPT。');
      setView('reader');
      return;
    }

    const paper = ensureActivePaperForCurrentPdf();
    if (!paper) {
      setStatusMessage('无法建立论文记录，暂不能生成组会 PPT。');
      return;
    }

    const presentationRunId = presentationGenerationRunRef.current + 1;
    presentationGenerationRunRef.current = presentationRunId;
    const sourcePdfPath = pdf.filePath;
    const isCurrentPresentationGeneration = (): boolean =>
      presentationGenerationRunRef.current === presentationRunId && activePdfPathRef.current === sourcePdfPath;

    setView('presentation');
    try {
      setIsPresentationGenerating(true);
      setStatusMessage('正在从当前 PDF 提取正文、章节和图表 caption...');
      let blocks = extractedPdfBlocks;
      if (blocks.length === 0) {
        blocks = await extractPdfBlocksFromData(pdf.data);
        if (!isCurrentPresentationGeneration()) {
          return;
        }
        setExtractedPdfBlocks(blocks);
        rememberPaperTutorEvidence(paper.id, {
          pdfTextSnippets: buildPaperTutorTextSnippets(blocks)
        });
      }

      let draft = buildPresentationDraft({
        papers: [paper],
        blocks,
        targetSlideCount: 12
      });

      try {
        setStatusMessage('正在生成组会 PPT 大纲，并尝试裁剪关键图表...');
        draft = await withPresentationCropTimeout(
          draft,
          enrichPresentationDraftWithPdfFigureCrops(draft, pdf.data, {
            maxFigures: 4,
            renderScale: 1.25,
            isCancelled: () => !isCurrentPresentationGeneration()
          }),
          12000
        );
      } catch (figureError) {
        console.warn('Failed to crop presentation figures from PDF pages.', figureError);
      }

      if (!isCurrentPresentationGeneration()) {
        return;
      }
      setPresentationDraft(draft);
      setStatusMessage(
        blocks.length > 0
          ? `已从当前 PDF 提取 ${blocks.length} 个正文/图表块，并生成 ${draft.slides.length} 页组会 PPT 草稿。`
          : '未能从当前 PDF 提取可用正文；已生成带缺失提示的基础 PPT 草稿，请确认 PDF 是否可复制文本。'
      );
    } catch (error) {
      const draft = buildPresentationDraft({
        papers: [paper],
        blocks: extractedPdfBlocks,
        targetSlideCount: 12
      });
      if (!isCurrentPresentationGeneration()) {
        return;
      }
      setPresentationDraft(draft);
      setStatusMessage(`PDF 正文提取失败，已生成基础 PPT 草稿：${String(error)}`);
    } finally {
      if (presentationGenerationRunRef.current === presentationRunId) {
        setIsPresentationGenerating(false);
      }
    }
  }

  async function handleExportPresentationMarkdown(draft: PresentationDraft): Promise<void> {
    try {
      const result = await window.electronAPI.saveTextFile({
        content: serializePresentationMarkdown(draft),
        defaultFileName: buildPresentationExportFileName(draft.title, 'md'),
        extension: 'md'
      });

      if (!result) {
        setStatusMessage('已取消导出组会 PPT Markdown 大纲。');
        return;
      }

      setStatusMessage(`组会 PPT Markdown 已导出：${result.fileName}`);
    } catch (error) {
      setStatusMessage(`导出组会 PPT Markdown 失败：${String(error)}`);
    }
  }

  async function handleExportPresentationJson(draft: PresentationDraft): Promise<void> {
    try {
      const result = await window.electronAPI.saveTextFile({
        content: JSON.stringify(draft, null, 2),
        defaultFileName: buildPresentationExportFileName(draft.title, 'json'),
        extension: 'json'
      });

      if (!result) {
        setStatusMessage('已取消导出组会 PPT JSON 大纲。');
        return;
      }

      setStatusMessage(`组会 PPT JSON 已导出：${result.fileName}`);
    } catch (error) {
      setStatusMessage(`导出组会 PPT JSON 失败：${String(error)}`);
    }
  }

  async function handleExportPresentationPptx(draft: PresentationDraft): Promise<void> {
    try {
      setStatusMessage('正在生成可编辑 PowerPoint 文件...');
      const buffer = await createPresentationPptxBuffer(draft);
      const result = await window.electronAPI.exportPptx({
        contentBase64: arrayBufferToBase64(buffer),
        defaultFileName: buildPresentationExportFileName(draft.title, 'pptx')
      });

      if (!result) {
        setStatusMessage('已取消导出组会 PPTX。');
        return;
      }

      setStatusMessage(`组会 PPTX 已导出：${result.fileName}`);
    } catch (error) {
      setStatusMessage(`导出组会 PPTX 失败：${String(error)}`);
    }
  }

  function handleArxivPaperDownloaded(arxivPaper: ArxivPaper, pdfPayload: PdfFilePayload): void {
    const now = new Date().toISOString();
    const record: PaperRecord = {
      id: `paper-${hashText(pdfPayload.filePath)}`,
      pdfPath: pdfPayload.filePath,
      pdfName: pdfPayload.fileName,
      translationPath: '',
      translationName: '',
      aiCachePath: undefined,
      aiCacheName: undefined,
      chineseTitle: '',
      englishTitle: arxivPaper.title || pdfPayload.fileName.replace(/\.[^.]+$/u, ''),
      journal: `arXiv ${arxivPaper.categories[0] ?? ''}`.trim(),
      authors: arxivPaper.authors.join(', '),
      year: arxivPaper.publishedAt?.slice(0, 4) ?? '',
      notes: `arXiv: ${arxivPaper.stableId}\n${arxivPaper.summary}`.trim(),
      lastOpenedAt: now,
      lastPage: 1
    };
    const storedRecord = rememberPaper(record);
    setStatusMessage(`arXiv PDF 已加入论文库：${storedRecord.englishTitle}`);
  }

  function ensureActivePaperForCurrentPdf(): PaperRecord | null {
    if (!pdf) {
      return null;
    }

    const existing = activePaperId
      ? paperLibrary.find((paper) => paper.id === activePaperId && isSamePdfFilePath(paper.pdfPath, pdf.filePath))
      : paperLibrary.find((paper) => isSamePdfFilePath(paper.pdfPath, pdf.filePath));

    if (existing) {
      setActivePaperId(existing.id);
      return existing;
    }

    const now = new Date().toISOString();
    const record: PaperRecord = {
      id: `paper-${hashText(pdf.filePath)}`,
      pdfPath: pdf.filePath,
      pdfName: pdf.fileName,
      translationPath: '',
      translationName: '',
      aiCachePath: undefined,
      aiCacheName: undefined,
      chineseTitle: '',
      englishTitle: pdf.fileName.replace(/\.[^.]+$/u, ''),
      journal: '',
      authors: '',
      year: '',
      notes: '',
      lastOpenedAt: now,
      lastPage: currentPage || 1
    };

    return rememberPaper(record);
  }

  function rememberTranslatedPdfResult(paperId: string, result: PdfTranslationResult): void {
    setPaperLibrary((library) =>
      library.map((paper) =>
        paper.id === paperId
          ? updatePaperRecord(paper, {
              translatedPdfPath: result.translatedPdfPath,
              translatedPdfName: result.translatedPdfName,
              translatedMonoPdfPath: result.translatedMonoPdfPath,
              translatedMonoPdfName: result.translatedMonoPdfName,
              translatedPdfMode: result.translatedPdfMode,
              translationEngine: result.translationEngine,
              translationSourceHash: result.translationSourceHash,
              translatedAt: result.translatedAt,
              translatedProvider: result.translatedProvider,
              translatedModel: result.translatedModel
            })
          : paper
      )
    );
  }

  async function handleNewPdfTranslationProject(): Promise<void> {
    const pdfPayload = await window.electronAPI.openPdf();
    if (!pdfPayload) {
      return;
    }

    try {
      applyPdfPayload(pdfPayload);
      const freshSession = buildFreshPdfSessionState();
      setTranslationDocument(freshSession.translationDocument);
      setAiCacheDocument(freshSession.aiCacheDocument);
      setCurrentParagraphIndex(freshSession.currentParagraphIndex);
      setAiParagraphIndex(freshSession.aiParagraphIndex);
      setShowTranslation(freshSession.showTranslation);
      setIsEditing(freshSession.isEditing);
      setEditingText(freshSession.editingText);
      setTranslatedPdf(null);
      setTranslatedMonoPdf(null);
      setPdfViewMode('source');

      const now = new Date().toISOString();
      const record: PaperRecord = {
        id: `paper-${hashText(pdfPayload.filePath)}`,
        pdfPath: pdfPayload.filePath,
        pdfName: pdfPayload.fileName,
        translationPath: '',
        translationName: '',
        aiCachePath: undefined,
        aiCacheName: undefined,
        chineseTitle: '',
        englishTitle: pdfPayload.fileName.replace(/\.[^.]+$/u, ''),
        journal: '',
        authors: '',
        year: '',
        notes: '',
        lastOpenedAt: now,
        lastPage: 1
      };
      const storedRecord = rememberPaper(record);

      setActiveNotes(storedRecord.notes);
      setView('reader');
      setStatusMessage(`已新建 PDF 翻译项目：${storedRecord.chineseTitle || storedRecord.englishTitle}`);
    } catch (error) {
      setStatusMessage(`新建 PDF 翻译项目失败：${String(error)}`);
    }
  }

  async function handleNewProject(): Promise<void> {
    await handleNewPdfTranslationProject();
  }

  async function handleSaveTranslation(): Promise<void> {
    if (!translationDocument) {
      setStatusMessage('当前没有可保存的翻译文件。');
      return;
    }

    try {
      const result = await window.electronAPI.saveTextFile({
        filePath: translationDocument.sourcePath,
        content: serializeTranslationDocument(translationDocument),
        defaultFileName:
          translationDocument.kind === 'json' ? 'translation.json' : 'translation.md',
        extension: translationDocument.kind === 'json' ? 'json' : 'md'
      });

      if (!result) {
        return;
      }

      setTranslationDocument({
        ...translationDocument,
        sourcePath: result.filePath,
        sourceName: result.fileName
      });
      setStatusMessage(`已保存翻译文件：${result.fileName}`);
    } catch (error) {
      setStatusMessage(`保存翻译失败：${String(error)}`);
    }
  }

  async function handleExportBilingualMarkdown(): Promise<void> {
    if (!translationDocument) {
      setStatusMessage('当前没有可导出的翻译内容。');
      return;
    }

    if (translationDocument.kind !== 'json') {
      setStatusMessage('双语 Markdown 导出仅支持 JSON 翻译文件。');
      return;
    }

    try {
      const result = await window.electronAPI.exportMarkdown({
        content: exportBilingualMarkdown(translationDocument),
        defaultFileName: buildExportFileName(translationDocument.sourceName)
      });

      if (!result) {
        return;
      }

      setStatusMessage(`已导出双语 Markdown：${result.fileName}`);
    } catch (error) {
      setStatusMessage(`导出双语 Markdown 失败：${String(error)}`);
    }
  }

  function handleBuildAiCacheDocument(): void {
    if (extractedPdfBlocks.length === 0) {
      setStatusMessage('还没有可用的 PDF 文本提取结果，请先等待 PDF 渲染完成。');
      return;
    }

    const document = buildCacheFromPdfBlocks(
      extractedPdfBlocks,
      pdf?.fileName,
      aiCacheDocument ?? translationDocument
    );
    setShowTranslation(true);
    setReaderMode('ai');
    setStatusMessage(`已生成 AI JSON 缓存草稿：${document.items.length} 段。`);
  }

  async function handleSaveAiCache(): Promise<void> {
    if (!aiCacheDocument || aiCacheDocument.kind !== 'json') {
      setStatusMessage('当前没有 JSON 缓存可保存。');
      return;
    }

    try {
      setIsAiBusy(true);
      await saveAiCacheDocument(aiCacheDocument);
    } catch (error) {
      setStatusMessage(`保存 AI JSON 失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleTranslateCurrentWithAi(force = false): Promise<void> {
    await translateAiItemWithAi(aiParagraphIndex, force);
  }

  async function translateAiItemWithAi(targetIndex: number, force = false): Promise<void> {
    const document = ensureJsonDocumentForAi();
    if (!document) {
      return;
    }

    const index = Math.min(Math.max(0, targetIndex), document.items.length - 1);
    const item = document.items[index];
    if (!item) {
      setStatusMessage('当前没有可翻译的段落。');
      return;
    }

    try {
      setIsAiBusy(true);
      setAiParagraphIndex(index);
      let workingDocument = await ensureAiCacheSaved(document);
      if (!workingDocument) {
        return;
      }

      const workingItem = workingDocument.items[index] ?? item;
      if (!force && !shouldTranslateItem(workingItem)) {
        setStatusMessage('当前段已有缓存译文，未重复调用 API。');
        return;
      }

      setStatusMessage(`AI 正在翻译第 ${index + 1} 段...`);
      const result = await window.electronAPI.translateWithAi({
        section: workingItem.section,
        original: workingItem.original,
        translation: workingItem.translation,
        type: workingItem.type,
        sourceHash: workingItem.sourceHash,
        force
      });

      workingDocument = updateAiCacheItem(workingDocument, index, result) ?? workingDocument;
      setAiCacheDocument(workingDocument);
      setShowTranslation(true);
      await persistAiCache(workingDocument);
      setStatusMessage(result.skipped ? '当前段已跳过。' : `AI 已翻译第 ${index + 1} 段并保存缓存。`);
    } catch (error) {
      setStatusMessage(`AI 翻译当前段失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleTranslatePendingWithAi(): Promise<void> {
    const document = ensureJsonDocumentForAi();
    if (!document) {
      return;
    }

    try {
      setIsAiBusy(true);
      let workingDocument = await ensureAiCacheSaved(document);
      if (!workingDocument) {
        return;
      }

      let translatedCount = 0;
      for (let index = 0; index < workingDocument.items.length; index += 1) {
        const item = workingDocument.items[index];
        if (!shouldTranslateItem(item)) {
          continue;
        }

        setAiParagraphIndex(index);
        setStatusMessage(`AI 正在翻译第 ${index + 1} / ${workingDocument.items.length} 段...`);
        const result = await window.electronAPI.translateWithAi({
          section: item.section,
          original: item.original,
          translation: item.translation,
          type: item.type,
          sourceHash: item.sourceHash
        });

        workingDocument = updateAiCacheItem(workingDocument, index, result) ?? workingDocument;
        setAiCacheDocument(workingDocument);
        await persistAiCache(workingDocument);
        translatedCount += result.skipped ? 0 : 1;
      }

      setShowTranslation(true);
      setStatusMessage(`AI 批量翻译完成，本次新增 ${translatedCount} 段译文。`);
    } catch (error) {
      setStatusMessage(`AI 批量翻译失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleTranslateCurrentWithLocal(force = false): Promise<void> {
    await translateAiItemWithLocal(aiParagraphIndex, force);
  }

  async function translateAiItemWithLocal(targetIndex: number, force = false): Promise<void> {
    const document = ensureJsonDocumentForAi();
    if (!document) {
      return;
    }

    const index = Math.min(Math.max(0, targetIndex), document.items.length - 1);
    const item = document.items[index];
    if (!item) {
      setStatusMessage('当前没有可翻译的段落。');
      return;
    }

    try {
      setIsAiBusy(true);
      setAiParagraphIndex(index);
      let workingDocument = await ensureAiCacheSaved(document);
      if (!workingDocument) {
        return;
      }

      const workingItem = workingDocument.items[index] ?? item;
      if (!force && !shouldTranslateItem(workingItem)) {
        setStatusMessage('当前段已有缓存译文，本地翻译未重复执行。');
        return;
      }

      setStatusMessage(`本地 NLLB 正在翻译第 ${index + 1} 段...`);
      const result = await window.electronAPI.translateLocalBatch({
        texts: [workingItem.original],
        timeoutMs: 120_000
      });
      const translation = result.texts[0]?.trim() ?? '';
      if (!translation) {
        setStatusMessage('本地翻译返回空结果，已保留原缓存。');
        return;
      }

      workingDocument = updateAiCacheItem(workingDocument, index, {
        translation,
        translatedAt: new Date().toISOString(),
        provider: 'local',
        model: result.model ?? result.engine
      }) ?? workingDocument;
      setAiCacheDocument(workingDocument);
      setShowTranslation(true);
      await persistAiCache(workingDocument);
      setStatusMessage(`本地 ${result.engine} 已翻译第 ${index + 1} 段并保存缓存。`);
    } catch (error) {
      setStatusMessage(`本地翻译当前段失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleTranslatePendingWithLocal(): Promise<void> {
    const document = ensureJsonDocumentForAi();
    if (!document) {
      return;
    }

    try {
      setIsAiBusy(true);
      let workingDocument = await ensureAiCacheSaved(document);
      if (!workingDocument) {
        return;
      }

      const pendingEntries = workingDocument.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => shouldTranslateItem(item));
      let translatedCount = 0;
      const batchSize = 8;

      for (let offset = 0; offset < pendingEntries.length; offset += batchSize) {
        const batch = pendingEntries.slice(offset, offset + batchSize);
        setStatusMessage(`本地 NLLB 正在翻译 ${offset + 1}-${offset + batch.length} / ${pendingEntries.length} 段...`);
        const result = await window.electronAPI.translateLocalBatch({
          texts: batch.map(({ item }) => item.original),
          timeoutMs: 180_000
        });
        batch.forEach(({ index }, batchIndex) => {
          const translation = result.texts[batchIndex]?.trim();
          if (!translation) {
            return;
          }
          workingDocument = updateAiCacheItem(workingDocument, index, {
            translation,
            translatedAt: new Date().toISOString(),
            provider: 'local',
            model: result.model ?? result.engine
          }) ?? workingDocument;
          translatedCount += 1;
        });
        setAiCacheDocument(workingDocument);
        await persistAiCache(workingDocument);
      }

      setShowTranslation(true);
      setStatusMessage(`本地批量翻译完成，本次新增 ${translatedCount} 段译文。`);
    } catch (error) {
      setStatusMessage(`本地批量翻译失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleCopyCurrentPrompt(): Promise<void> {
    const prompt = buildCurrentJsonPrompt(getCurrentPromptItem());
    await navigator.clipboard.writeText(prompt);
    setStatusMessage('已复制当前段 JSON 提示词。');
  }

  async function handleCopyFullPrompt(): Promise<void> {
    const prompt = buildFullJsonPrompt(getPromptItemsForFullDocument());
    await navigator.clipboard.writeText(prompt);
    setStatusMessage('已复制全文 JSON 提示词。');
  }

  function handleApplyEdit(): void {
    if (applyCurrentEdit()) {
      setStatusMessage('当前译文已更新，请点击“保存翻译”写入本地文件。');
    }
  }

  function ensureJsonDocumentForAi(): TranslationDocument | null {
    if (aiCacheDocument?.kind === 'json') {
      return aiCacheDocument;
    }

    const clonedJsonDocument = cloneJsonDocumentForAi(translationDocument);
    if (clonedJsonDocument) {
      setAiCacheDocument(clonedJsonDocument);
      setAiParagraphIndex((index) => Math.min(index, Math.max(0, clonedJsonDocument.items.length - 1)));
      return clonedJsonDocument;
    }

    if (extractedPdfBlocks.length === 0) {
      setStatusMessage('AI 模式需要 JSON 翻译文件，或先从 PDF 文本层生成 JSON 缓存。');
      return null;
    }

    const document = buildCacheFromPdfBlocks(extractedPdfBlocks, pdf?.fileName, translationDocument);
    setShowTranslation(true);
    return document;
  }

  async function ensureAiCacheSaved(document: TranslationDocument): Promise<TranslationDocument | null> {
    if (document.sourcePath) {
      return document;
    }

    return saveAiCacheDocument(document);
  }

  async function saveAiCacheDocument(document: TranslationDocument): Promise<TranslationDocument | null> {
    const result = await window.electronAPI.saveTranslationCache({
      filePath: document.sourcePath,
      content: serializeTranslationDocument(document),
      defaultFileName: document.sourceName ?? getDefaultAiCacheFileName(pdf?.fileName)
    });

    if (!result) {
      setStatusMessage('已取消保存 AI JSON。');
      return null;
    }

    const savedDocument = applySavedAiCachePath(document, result);
    setAiCacheDocument(savedDocument);
    rememberAiCachePath(result);
    setStatusMessage(`AI JSON 已保存：${result.fileName}`);
    return savedDocument;
  }

  async function persistAiCache(document: TranslationDocument): Promise<void> {
    if (!document.sourcePath) {
      return;
    }

    const result = await window.electronAPI.saveTranslationCache({
      filePath: document.sourcePath,
      content: serializeTranslationDocument(document),
      defaultFileName: document.sourceName ?? getDefaultAiCacheFileName(pdf?.fileName)
    });

    if (result) {
      setAiCacheDocument(applySavedAiCachePath(document, result));
      rememberAiCachePath(result);
    }
  }

  function rememberAiCachePath(result: SaveTextResult): void {
    if (!activePaperId) {
      return;
    }

    setPaperLibrary((library) =>
      library.map((paper) =>
        paper.id === activePaperId
          ? updatePaperRecord(paper, {
              aiCachePath: result.filePath,
              aiCacheName: result.fileName
            })
          : paper
      )
    );
  }

  function handleNotesChange(nextNotes: string): void {
    setActiveNotes(nextNotes);
    if (!activePaperId) {
      return;
    }

    setPaperLibrary((library) =>
      library.map((paper) =>
        paper.id === activePaperId ? updatePaperRecord(paper, { notes: nextNotes }) : paper
      )
    );
  }

  async function handleFillPaperCellWithAi(
    paper: PaperRecord,
    field: PaperResearchColumnKey
  ): Promise<void> {
    const column = PAPER_RESEARCH_COLUMNS.find((entry) => entry.key === field);
    if (!column) {
      setStatusMessage('无法识别当前研究表格列。');
      return;
    }

    if (!aiSettings?.apiKeyConfigured) {
      setStatusMessage('请先在阅读器右侧 AI 设置中保存 API Key，再回到论文库使用 AI 填表。');
      return;
    }

    try {
      setIsAiBusy(true);
      setStatusMessage(`AI 正在填写“${column.label}”单元格...`);
      const project = await window.electronAPI.loadProject({
        translationPath: paper.translationPath,
        aiCachePath: paper.aiCachePath
      });
      const contextText = [
        project.aiCache?.content ?? '',
        project.translation?.content ?? '',
        paper.notes
      ]
        .filter(Boolean)
        .join('\n\n');
      const prompt = buildPaperCellPrompt({ paper, field, contextText });
      const cellValue = await window.electronAPI.completeWithAi(prompt);

      setPaperLibrary((library) =>
        library.map((item) =>
          item.id === paper.id ? updatePaperSheetCell(item, field, cleanAiCellText(cellValue)) : item
        )
      );
      setStatusMessage(`AI 已填写“${column.label}”单元格。`);
    } catch (error) {
      setStatusMessage(`AI 填写单元格失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleFillResearchCellsWithAi(
    request: FillResearchCellsRequest
  ): Promise<FillResearchCellResult[]> {
    if (!aiSettings?.apiKeyConfigured) {
      setStatusMessage('请先在阅读器右侧 AI 设置中保存 API Key，再使用研究表格 AI 填写。');
      return [];
    }

    try {
      setIsAiBusy(true);
      const cellLabel = request.cells.length === 1
        ? `${request.cells[0].cellAddress} / ${request.cells[0].columnHeader}`
        : `${request.cells.length} 个选中单元格`;
      setStatusMessage(`AI 正在填写 ${cellLabel}...`);
      const project = await window.electronAPI.loadProject({
        pdfPath: request.paper.pdfPath,
        translationPath: request.paper.translationPath,
        aiCachePath: request.paper.aiCachePath
      });
      const currentPdfExtractedText =
        pdf?.filePath === request.paper.pdfPath
          ? extractedPdfBlocks.map((block) => block.original).join('\n\n')
          : '';
      const fallbackContextText = [
        project.aiCache?.content ?? '',
        project.translation?.content ?? '',
        currentPdfExtractedText,
        request.paper.notes
      ]
        .filter(Boolean)
        .join('\n\n');
      const prompt = buildSheetCellsPrompt({
        paper: request.paper,
        cells: request.cells
      });
      const result = await window.electronAPI.fillSheetCellsWithAi({
        paperId: request.paper.id,
        pdfPath: request.paper.pdfPath,
        fallbackContextText,
        cellCount: request.cells.length,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt
      });
      const filledCells = parseSheetCellsAiResponse(result.text, request.cells).map((item) => ({
        ...item,
        value: cleanAiCellText(item.value)
      }));

      setStatusMessage(
        `AI 已填写 ${filledCells.filter((item) => item.value.trim()).length} 个单元格（${result.provider} / ${result.model} / ${result.mode}${result.cached ? ' / 已复用论文缓存' : ''}）。`
      );
      return filledCells;
    } catch (error) {
      setStatusMessage(`AI 填写单元格失败：${String(error)}`);
      return [];
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleAnalyzeLiteratureGap(
    request: AnalyzeLiteratureGapRequest
  ): Promise<AnalyzeLiteratureGapResult> {
    if (!aiSettings?.apiKeyConfigured) {
      setStatusMessage('请先在阅读器右侧 AI 设置中保存 API Key，再使用研究表格 AI 大观分析。');
      return { text: '', provider: '', model: '' };
    }

    try {
      setIsAiBusy(true);
      setStatusMessage(`AI 正在读取并综合分析 ${request.papers.length} 篇论文...`);
      const papersWithContext = await Promise.all(
        request.papers.map(async (item) => {
          const project = await window.electronAPI.loadProject({
            pdfPath: item.paper.pdfPath,
            translationPath: item.paper.translationPath,
            aiCachePath: item.paper.aiCachePath
          });
          const currentPdfExtractedText =
            pdf?.filePath === item.paper.pdfPath
              ? extractedPdfBlocks.map((block) => block.original).join('\n\n')
              : '';
          const fallbackContextText = [
            project.aiCache?.content ?? '',
            project.translation?.content ?? '',
            currentPdfExtractedText,
            item.paper.notes
          ]
            .filter(Boolean)
            .join('\n\n');

          return {
            ...item,
            fallbackContextText
          };
        })
      );
      const prompt = buildLiteratureGapPrompt({ papers: papersWithContext });
      const userPrompt = request.customPrompt?.trim()
        ? [
            request.customPrompt.trim(),
            '',
            '以下是应用自动附加的论文上下文和既有分析约束，请一起参考：',
            prompt.userPrompt
          ].join('\n')
        : prompt.userPrompt;
      const result = await window.electronAPI.analyzeLiteratureWithAi({
        papers: papersWithContext.map((item) => ({
          paperId: item.paper.id,
          pdfPath: item.paper.pdfPath,
          fallbackContextText: item.fallbackContextText ?? ''
        })),
        systemPrompt: prompt.systemPrompt,
        userPrompt
      });
      const text = parseLiteratureGapResponse(result.text);

      setStatusMessage(
        `AI 大观分析完成：${request.papers.length} 篇论文，${result.provider} / ${result.model} / ${result.mode}，复用上下文缓存 ${result.cachedContextCount} 篇。`
      );
      return {
        text,
        provider: result.provider,
        model: result.model,
        webSearchUsed: Boolean(result.webSearchUsed)
      };
    } catch (error) {
      setStatusMessage(`AI 大观分析失败：${String(error)}`);
      return { text: '', provider: '', model: '' };
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handlePaperTutorChat(request: GenericChatCompletionInput): Promise<string> {
    if (!aiSettings?.apiKeyConfigured) {
      const message = '请先在阅读器右侧 AI 设置中保存 API Key，再使用论文导师问答。';
      setStatusMessage(message);
      return message;
    }

    try {
      setIsAiBusy(true);
      setStatusMessage('论文导师正在根据选中论文和图表生成反馈...');
      const text = await window.electronAPI.completeWithAi(request);
      setStatusMessage('论文导师问答已返回。');
      return text;
    } catch (error) {
      const message = `论文导师问答失败：${String(error)}`;
      setStatusMessage(message);
      return message;
    } finally {
      setIsAiBusy(false);
    }
  }

  function applySavedAiCachePath(
    document: TranslationDocument,
    result: SaveTextResult
  ): TranslationDocument {
    return {
      ...document,
      sourcePath: result.filePath,
      sourceName: result.fileName
    };
  }

  function getCurrentPromptItem(): TranslationItem | null {
    if (currentItem?.original.trim()) {
      return currentItem;
    }

    return extractedPdfBlocks[currentParagraphIndex] ?? currentItem;
  }

  function getPromptItemsForFullDocument(): TranslationItem[] {
    if (translationDocument?.kind === 'json' && translationDocument.items.some((item) => item.original.trim())) {
      return translationDocument.items;
    }

    return extractedPdfBlocks;
  }

  function openWorkspace(): void {
    setHomeSection('hub');
    setView('home');
  }

  function openLibrary(): void {
    setHomeSection('library');
    setView('home');
  }

  function openReaderFromSidebar(): void {
    setReaderMode('manual');
    setIsPdfAiSettingsOpen(false);
    setView('reader');
  }

  function openAiFromSidebar(): void {
    openAiAssistant('analysis');
  }

  function openPaperTutorFromSidebar(): void {
    setView('paperTutor');
  }

  function openResearchSheetFromSidebar(): void {
    void handleOpenResearchSheet();
  }

  function openKnowledgeGraph(): void {
    setView('knowledgeGraph');
  }

  function openPresentationGenerator(): void {
    const draftMatchesActivePaper =
      !activePaperId ||
      presentationDraft?.sourcePapers.some((paper) => paper.paperId === activePaperId);
    if (presentationDraft && draftMatchesActivePaper) {
      setView('presentation');
      return;
    }
    if (presentationDraft && !draftMatchesActivePaper) {
      setPresentationDraft(null);
    }
    setView('presentation');
    void handleGeneratePresentationFromCurrentPdf();
  }

  function openArxivSearch(): void {
    setView('arxivSearch');
  }

  function openAiAssistant(focus: AiAssistantFocus = 'analysis'): void {
    setAiAssistantFocus(focus);
    setView('aiAssistant');
  }

  function openSettings(): void {
    setView('settings');
  }

  const handleOpenAiAssistantForSheet = useCallback(() => {
    setAiAssistantFocus('analysis');
    setView('aiAssistant');
  }, []);

  const handleOpenAiAssistantForSettings = useCallback(() => {
    setAiAssistantFocus('settings');
    setView('aiAssistant');
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale((value) => Math.min(2.4, Number((value + 0.1).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))));
  }, []);

  const handlePageChange = useCallback((nextPage: number): void => {
    if (pageCount === 0) {
      setCurrentPage(Math.max(1, nextPage));
      return;
    }

    setCurrentPage(Math.min(pageCount, Math.max(1, nextPage)));
  }, [pageCount, setCurrentPage]);

  const handlePreviousPage = useCallback(() => {
    handlePageChange(currentPage - 1);
  }, [currentPage, handlePageChange]);

  const handleNextPage = useCallback(() => {
    handlePageChange(currentPage + 1);
  }, [currentPage, handlePageChange]);

  const handleScaleChange = useCallback((nextScale: number) => {
    setScale(nextScale);
  }, []);

  function getSidebarActiveSection(): AppSidebarSection {
    if (view === 'researchSheet') {
      return 'researchSheet';
    }

    if (view === 'knowledgeGraph') {
      return 'knowledgeGraph';
    }

    if (view === 'presentation') {
      return 'presentation';
    }

    if (view === 'arxivSearch') {
      return 'arxiv';
    }

    if (view === 'aiAssistant') {
      return 'ai';
    }

    if (view === 'paperTutor') {
      return 'paperTutor';
    }

    if (view === 'settings') {
      return 'settings';
    }

    if (view === 'reader') {
      return 'reader';
    }

    return homeSection === 'library' ? 'library' : 'workspace';
  }

  const activeSidebarSection = useMemo(() => getSidebarActiveSection(), [homeSection, view]);

  const pdfSessionContextValue = useMemo(
    () => ({
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
      parallelTranslationPdf,
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
      onPreviousPage: handlePreviousPage,
      onNextPage: handleNextPage,
      onPageChange: handlePageChange
    }),
    [
      currentPage,
      displayedPdf,
      handleNextPage,
      handlePageChange,
      handlePreviousPage,
      handleZoomIn,
      handleZoomOut,
      pageCount,
      parallelTranslationPdf,
      pdf,
      pdfViewMode,
      pdfViewportState,
      scale,
      translatedMonoPdf,
      translatedPdf
    ]
  );

  const paperLibraryContextValue = useMemo(
    () => ({
      paperLibrary,
      setPaperLibrary,
      activePaperId,
      setActivePaperId,
      activePaper,
      researchWorkbook,
      setResearchWorkbook,
      researchSheetLinks,
      setResearchSheetLinks
    }),
    [activePaper, activePaperId, paperLibrary, researchSheetLinks, researchWorkbook, setPaperLibrary]
  );

  const aiTranslationContextValue = useMemo(
    () => ({
      translationDocument,
      setTranslationDocument,
      aiCacheDocument,
      setAiCacheDocument,
      currentParagraphIndex,
      setCurrentParagraphIndex,
      aiParagraphIndex,
      setAiParagraphIndex,
      currentItem
    }),
    [aiCacheDocument, aiParagraphIndex, currentItem, currentParagraphIndex, translationDocument]
  );

  const uiContextValue = useMemo(
    () => ({
      view,
      setView,
      homeSection,
      setHomeSection,
      activeSidebarSection,
      statusMessage,
      statusMessages,
      setStatusMessage,
      isReaderSidePanelCollapsed,
      setIsReaderSidePanelCollapsed,
      readerSidePanelRatio,
      handleReaderSidePanelResizeStart
    }),
    [
      activeSidebarSection,
      handleReaderSidePanelResizeStart,
      homeSection,
      isReaderSidePanelCollapsed,
      readerSidePanelRatio,
      statusMessage,
      statusMessages,
      view
    ]
  );

  function renderWithContexts(content: ReactNode) {
    return (
      <UiProvider value={uiContextValue}>
        <PaperLibraryProvider value={paperLibraryContextValue}>
          <PdfSessionProvider value={pdfSessionContextValue}>
            <AiTranslationProvider value={aiTranslationContextValue}>{content}</AiTranslationProvider>
          </PdfSessionProvider>
        </PaperLibraryProvider>
      </UiProvider>
    );
  }

  function renderSidebar() {
    return (
      <AppSidebar
        activeSection={activeSidebarSection}
        onOpenWorkspace={openWorkspace}
        onOpenLibrary={openLibrary}
        onOpenResearchSheet={openResearchSheetFromSidebar}
        onOpenKnowledgeGraph={openKnowledgeGraph}
        onOpenPresentation={openPresentationGenerator}
        onOpenArxiv={openArxivSearch}
        onOpenReader={openReaderFromSidebar}
        onOpenPaperTutor={openPaperTutorFromSidebar}
        onOpenAi={openAiFromSidebar}
        onOpenSettings={openSettings}
      />
    );
  }

  if (view === 'home') {
    return renderWithContexts(
      <div className="app-shell desktop-shell home-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <HomePage
            papers={paperLibrary}
            activeSection={homeSection}
            onSectionChange={setHomeSection}
            onNewProject={handleNewPdfTranslationProject}
            onOpenPaper={handleOpenPaper}
            onOpenResearchSheet={handleOpenResearchSheet}
            onOpenKnowledgeGraph={openKnowledgeGraph}
            onOpenPresentationGenerator={openPresentationGenerator}
            knowledgeGraphStats={knowledgeGraphSummary}
            onUpdatePaper={handleUpdatePaper}
            onRemovePaper={handleRemovePaper}
          />
          <ConnectedStatusBar />
        </div>
      </div>
    );
  }

  if (view === 'researchSheet') {
    return renderWithContexts(
      <div className="app-shell desktop-shell research-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <ErrorBoundary fallback={<main className="research-sheet-loading">研究表格加载失败，请返回后重试。</main>}>
            <Suspense fallback={<main className="research-sheet-loading">正在加载研究表格...</main>}>
              <ResearchSheetPage
                papers={paperLibrary}
                workbook={researchWorkbook}
                links={researchSheetLinks}
                focusPaperId={researchFocusPaperId}
                isAiBusy={isAiBusy}
                onBackHome={openWorkspace}
                onOpenPaper={handleOpenPaper}
                onWorkbookChange={setResearchWorkbook}
                onLinksChange={setResearchSheetLinks}
                onFillCellsWithAi={handleFillResearchCellsWithAi}
                onAnalyzeLiteratureGap={handleAnalyzeLiteratureGap}
                onOpenAiAssistant={handleOpenAiAssistantForSheet}
                onOpenKnowledgeGraph={openKnowledgeGraph}
              />
            </Suspense>
          </ErrorBoundary>
          <ConnectedStatusBar />
        </div>
      </div>
    );
  }

  if (view === 'aiAssistant') {
    return renderWithContexts(
      <div className="app-shell desktop-shell ai-assistant-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <ErrorBoundary fallback={<main className="ai-assistant-loading">AI 助手加载失败，请返回后重试。</main>}>
            <Suspense fallback={<main className="ai-assistant-loading">正在加载 AI 助手...</main>}>
              <AiAssistantPage
                papers={paperLibrary}
                workbook={researchWorkbook}
                links={researchSheetLinks}
                activePaperId={activePaperId}
                focus={aiAssistantFocus}
                aiSettings={aiSettings}
                aiBalance={aiBalance}
                aiForm={aiForm}
                modelOptions={modelOptions}
                isBusy={isAiBusy}
                onOpenResearchSheet={openResearchSheetFromSidebar}
                onOpenPaper={handleOpenPaper}
                onProviderChange={handleProviderChange}
                onAiFormChange={handleAiFormChange}
                onSaveSettings={handleSaveAiSettings}
                onTestConnection={handleTestAiConnection}
                onRefreshBalance={handleRefreshAiBalance}
                onRefreshModels={handleRefreshAiModels}
                onAnalyzeLiteratureGap={handleAnalyzeLiteratureGap}
              />
            </Suspense>
          </ErrorBoundary>
          <ConnectedStatusBar />
        </div>
      </div>
    );
  }

  if (view === 'paperTutor') {
    return renderWithContexts(
      <div className="app-shell desktop-shell paper-tutor-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <ErrorBoundary fallback={<main className="paper-tutor-loading">AI 问答加载失败，请返回后重试。</main>}>
            <Suspense fallback={<main className="paper-tutor-loading">正在加载 AI 问答...</main>}>
              <PaperTutorPage
                papers={paperLibrary}
                activePaperId={activePaperId}
                figures={pdfFigureAssets}
                pdfBlocks={extractedPdfBlocks}
                evidenceByPaperId={paperTutorEvidenceByPaperId}
                isBusy={isAiBusy}
                onBackHome={openWorkspace}
                onOpenReader={openReaderFromSidebar}
                onOpenPaper={handleOpenPaper}
                onPaperTutorChat={handlePaperTutorChat}
              />
            </Suspense>
          </ErrorBoundary>
          <ConnectedStatusBar />
        </div>
      </div>
    );
  }

  if (view === 'knowledgeGraph') {
    return renderWithContexts(
      <div className="app-shell desktop-shell knowledge-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <ErrorBoundary fallback={<main className="knowledge-graph-loading">知识图谱加载失败，请返回后重试。</main>}>
            <Suspense fallback={<main className="knowledge-graph-loading">正在加载知识图谱...</main>}>
              <KnowledgeGraphPage
                papers={paperLibrary}
                workbook={researchWorkbook}
                links={researchSheetLinks}
                onBackHome={openWorkspace}
                onOpenPaper={handleOpenPaper}
                onOpenResearchSheet={handleOpenResearchSheet}
              />
            </Suspense>
          </ErrorBoundary>
          <ConnectedStatusBar />
        </div>
      </div>
    );
  }

  if (view === 'presentation') {
    return renderWithContexts(
      <div className="app-shell desktop-shell presentation-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <ErrorBoundary fallback={<main className="presentation-loading">组会 PPT 生成器加载失败，请返回后重试。</main>}>
            <Suspense fallback={<main className="presentation-loading">正在加载组会 PPT 生成器...</main>}>
              <PresentationPage
                draft={presentationDraft}
                onBackHome={openWorkspace}
                onOpenReader={openReaderFromSidebar}
                onRegenerate={handleGeneratePresentationFromCurrentPdf}
                onExportMarkdown={handleExportPresentationMarkdown}
                onExportJson={handleExportPresentationJson}
                onExportPptx={handleExportPresentationPptx}
              />
            </Suspense>
          </ErrorBoundary>
          <ConnectedStatusBar />
        </div>
      </div>
    );
  }

  if (view === 'arxivSearch') {
    return renderWithContexts(
      <div className="app-shell desktop-shell arxiv-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <ErrorBoundary fallback={<main className="arxiv-loading">arXiv 检索加载失败，请返回后重试。</main>}>
            <Suspense fallback={<main className="arxiv-loading">正在加载 arXiv 检索...</main>}>
              <ArxivSearchPage
                onBackHome={openWorkspace}
                onDownloadedPaper={handleArxivPaperDownloaded}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  if (view === 'settings') {
    return renderWithContexts(
      <div className="app-shell desktop-shell settings-shell">
        {renderSidebar()}
        <div className={getAppMainClassName()}>
          <ErrorBoundary fallback={<main className="settings-loading">设置加载失败，请返回后重试。</main>}>
            <Suspense fallback={<main className="settings-loading">正在加载设置...</main>}>
              <SettingsPage
                onBackHome={openWorkspace}
                onOpenAiAssistant={handleOpenAiAssistantForSettings}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  return renderWithContexts(
    <div className="app-shell desktop-shell reader-shell">
      {renderSidebar()}
      <div className={getAppMainClassName('reader-main')}>
        <Toolbar
          onGoHome={openWorkspace}
          onNewProject={handleNewPdfTranslationProject}
          onOpenPdf={handleOpenPdf}
        />

        <main
          className={`split-layout${pdfViewMode === 'parallel' ? ' is-parallel-pdf' : ''}${
            isReaderSidePanelCollapsed ? ' is-reader-side-collapsed' : ''
          }`}
          data-extracted-pdf-block-count={extractedPdfBlocks.length}
          style={{ '--reader-side-panel-ratio': `${readerSidePanelRatio * 100}%` } as CSSProperties}
        >
        <section className={`pdf-pane${pdfViewMode === 'parallel' ? ' is-parallel' : ''}`}>
          {pdfViewMode === 'parallel' && pdf && parallelTranslationPdf ? (
            <div className="parallel-pdf-viewer" aria-label="左右双语 PDF 阅读">
              <PdfViewer
                pdfData={pdf.data}
                fileName={`English · ${pdf.fileName}`}
                currentPage={currentPage}
                scale={scale}
                highlightText=""
                viewportSyncId="source"
                viewportState={pdfViewportState}
                onViewportStateChange={setPdfViewportState}
                onScaleChange={handleScaleChange}
                onDocumentLoad={handleSourceDocumentLoad}
                onCurrentPageChange={handleSourceCurrentPageChange}
                onExtractedTextReady={handleSourceExtractedTextReady}
                onHighlightStatusChange={setStatusMessage}
                onStatusChange={setStatusMessage}
              />
              <PdfViewer
                pdfData={parallelTranslationPdf.data}
                fileName={`中文 · ${parallelTranslationPdf.fileName}`}
                currentPage={currentPage}
                scale={scale}
                highlightText=""
                viewportSyncId="translation"
                viewportState={pdfViewportState}
                onViewportStateChange={setPdfViewportState}
                onScaleChange={handleScaleChange}
                onDocumentLoad={handleParallelTranslationDocumentLoad}
                onCurrentPageChange={handleSourceCurrentPageChange}
                onExtractedTextReady={handleIgnoredExtractedTextReady}
                onHighlightStatusChange={setStatusMessage}
                onStatusChange={setStatusMessage}
              />
            </div>
          ) : (
            <PdfViewer
              pdfData={displayedPdf?.data ?? null}
              fileName={displayedPdf?.fileName}
              currentPage={currentPage}
              scale={scale}
              highlightText=""
              onScaleChange={handleScaleChange}
              onDocumentLoad={handleDisplayedDocumentLoad}
              onCurrentPageChange={handleDisplayedCurrentPageChange}
              onExtractedTextReady={handleDisplayedExtractedTextReady}
              onHighlightStatusChange={setStatusMessage}
              onStatusChange={setStatusMessage}
            />
          )}
        </section>

        <section className="translation-pane">
          {!isReaderSidePanelCollapsed ? (
            <div
              className="reader-layout-resize-handle"
              role="separator"
              aria-orientation="vertical"
              title="拖拽调整 PDF 侧边栏宽度，双击恢复默认"
              onPointerDown={handleReaderSidePanelResizeStart}
            />
          ) : null}
          <button
            type="button"
            className="reader-side-panel-toggle"
            aria-expanded={!isReaderSidePanelCollapsed}
            aria-controls="reader-side-panel"
            aria-label={isReaderSidePanelCollapsed ? '展开 PDF 侧边栏' : '收起 PDF 侧边栏'}
            title={isReaderSidePanelCollapsed ? '展开 PDF 侧边栏' : '收起 PDF 侧边栏'}
            onClick={() => setIsReaderSidePanelCollapsed((value) => !value)}
          >
            <img
              className="button-icon"
              src={isReaderSidePanelCollapsed ? backIcon : forwardIcon}
              alt=""
            />
            <span>{isReaderSidePanelCollapsed ? '展开侧栏' : '收起侧栏'}</span>
          </button>
          <div id="reader-side-panel" className="side-panel" hidden={isReaderSidePanelCollapsed}>
            <section
              className={`whole-pdf-panel${pdfFigureAssets.length > 0 ? ' has-figure-assets' : ''}`}
              aria-label="整体双语 PDF"
            >
              <div className="whole-pdf-header">
                <strong className="summary-title-with-icon">
                  <img className="panel-title-icon" src={translateIcon} alt="" />
                  <span>整体 PDF 阅读</span>
                </strong>
                <span>
                  {pdfViewMode === 'translated' && translatedPdf
                    ? `正在显示：${translatedPdf.fileName}`
                    : pdf
                      ? `正在显示：${pdf.fileName}`
                      : '尚未打开 PDF'}
                </span>
              </div>
              <div className="whole-pdf-actions">
                <div className="pdf-view-toggle" role="group" aria-label="PDF 显示模式">
                  <button
                    type="button"
                    className={pdfViewMode === 'source' ? 'active' : ''}
                    disabled={!pdf}
                    onClick={() => setPdfViewMode('source')}
                  >
                    原文 PDF
                  </button>
                  <button
                    type="button"
                    className={pdfViewMode === 'parallel' ? 'active' : ''}
                    disabled={!pdf || !parallelTranslationPdf}
                    onClick={() => setPdfViewMode('parallel')}
                  >
                    左右双语
                  </button>
                  <button
                    type="button"
                    className={pdfViewMode === 'translated' ? 'active' : ''}
                    disabled={!translatedPdf}
                    onClick={() => setPdfViewMode('translated')}
                  >
                    双语 PDF
                  </button>
                </div>
                <button
                  type="button"
                  className="primary-button button-with-icon"
                  disabled={!pdf || isPdfTranslationBusy}
                  onClick={() => handleGenerateBilingualPdf(false)}
                >
                  <img className="button-icon" src={translateIcon} alt="" />
                  <span>生成双语 PDF</span>
                </button>
                <button
                  type="button"
                  className="secondary-button button-with-icon"
                  disabled={!pdf || isPdfTranslationBusy}
                  onClick={() => handleGenerateBilingualPdf(true)}
                >
                  <img className="button-icon" src={refreshIcon} alt="" />
                  <span>重新生成</span>
                </button>
                <button type="button" className="secondary-button button-with-icon" disabled={!pdf || isPdfTranslationBusy} onClick={handleImportTranslatedPdf}>
                  <img className="button-icon" src={uploadIcon} alt="" />
                  <span>导入中文/双语 PDF</span>
                </button>
                <button type="button" className="secondary-button button-with-icon" disabled={!translatedPdf || isPdfTranslationBusy} onClick={handleExportTranslatedPdf}>
                  <img className="button-icon" src={downloadIcon} alt="" />
                  <span>导出双语 PDF</span>
                </button>
                <button type="button" className="secondary-button button-with-icon" disabled={!pdf || isPresentationGenerating} onClick={handleGeneratePresentationFromCurrentPdf}>
                  <img className="button-icon" src={translateIcon} alt="" />
                  <span>{isPresentationGenerating ? '正在生成 PPT...' : '生成组会 PPT'}</span>
                </button>
                <button
                  type="button"
                  className="secondary-button button-with-icon"
                  disabled={!pdf || isPdfFigureExtracting}
                  onClick={handleExtractPdfFigures}
                >
                  <img className="button-icon" src={searchIcon} alt="" />
                  <span>{isPdfFigureExtracting ? '正在提取...' : '提取 PDF 图表'}</span>
                </button>
                <button type="button" className="ghost-button button-with-icon" disabled={isPdfTranslationBusy} onClick={handleCheckPdfTranslationEngine}>
                  <img className="button-icon" src={searchIcon} alt="" />
                  <span>检查引擎</span>
                </button>
              </div>
              <PdfFigureAssetsPanel figures={pdfFigureAssets} />
              <p>
                {pdfTranslationStatus ||
                  pdfTranslationEngine?.message ||
                  '使用 PDFMathTranslate 生成整本文档的双语 PDF，完成后会直接在左侧显示。'}
              </p>
              {!pdfTranslationEngine?.available ? (
                <p className="engine-hint">
                  安装命令：<code>{pdfTranslationEngine?.installCommand ?? 'uv tool install pdf2zh'}</code>
                </p>
              ) : null}
              <p className="reference-strategy-hint">
                参考文献策略：{describeReferenceStrategy(appSettings.pdf.referenceTranslationStrategy)}
              </p>
            </section>
            <details
              className="pdf-ai-settings"
              open={isPdfAiSettingsOpen}
              onToggle={(event) =>
                setIsPdfAiSettingsOpen((event.currentTarget as HTMLDetailsElement).open)
              }
            >
              <summary>
                <span className="summary-title-with-icon">
                  <img className="panel-title-icon" src={settingsIcon} alt="" />
                  <span>PDF 翻译 API</span>
                </span>
                <small>
                  {aiSettings
                    ? `${aiSettings.provider} / ${aiSettings.model}，API Key ${aiSettings.apiKeyConfigured ? '已保存' : '未保存'}`
                    : '尚未读取设置'}
                </small>
              </summary>
              <div className="pdf-ai-settings-grid">
                <label>
                  Provider
                  <select
                    value={aiForm.provider}
                    onChange={(event) => handleProviderChange(event.target.value as AiProviderId)}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="kimi">Kimi</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                <label>
                  Base URL
                  <input
                    value={aiForm.baseURL}
                    onChange={(event) => handleAiFormChange({ baseURL: event.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label>
                  Model
                  {aiForm.provider === 'custom' ? (
                    <input
                      value={aiForm.model}
                      onChange={(event) => handleAiFormChange({ model: event.target.value })}
                      placeholder="model-name"
                    />
                  ) : (
                    <select
                      value={aiForm.model}
                      onChange={(event) => handleAiFormChange({ model: event.target.value })}
                    >
                      {modelOptions.map((model) => (
                        <option key={model.value} value={model.value}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    value={aiForm.apiKey}
                    onChange={(event) => handleAiFormChange({ apiKey: event.target.value })}
                    placeholder={aiSettings?.apiKeyConfigured ? '已保存，留空继续使用' : 'sk-...'}
                  />
                </label>
              </div>
              <details className="ai-advanced-options disclosure-card">
                <summary>
                  <span>API 高级设置</span>
                  <span className="disclosure-state">
                    <em className="when-closed">已收起</em>
                    <em className="when-open">已展开</em>
                  </span>
                  <span className="disclosure-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div className="pdf-ai-settings-grid">
                  <label>
                    思考模式
                    <select
                      value={aiForm.thinkingMode ?? 'auto'}
                      onChange={(event) => handleAiFormChange({ thinkingMode: event.target.value as AiThinkingMode })}
                    >
                      {AI_THINKING_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {aiForm.provider === 'openai' ? (
                    <label>
                      OpenAI 推理强度
                      <select
                        value={aiForm.reasoningEffort ?? 'auto'}
                        onChange={(event) =>
                          handleAiFormChange({ reasoningEffort: event.target.value as AiReasoningEffort })
                        }
                      >
                        {AI_REASONING_EFFORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="field-note">OpenAI 推理强度仅在 OpenAI Provider 下显示；当前 Provider 使用思考模式、Temperature 和 Top P。</p>
                  )}
                  <label>
                    Temperature
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={aiForm.temperature ?? ''}
                      onChange={(event) => handleAiFormChange({ temperature: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Top P
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={aiForm.topP ?? ''}
                      onChange={(event) => handleAiFormChange({ topP: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Max tokens
                    <input
                      type="number"
                      min="1"
                      step="256"
                      value={aiForm.maxTokens ?? ''}
                      onChange={(event) => handleAiFormChange({ maxTokens: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    超时 / 重试
                    <div className="inline-number-pair">
                      <input
                        aria-label="超时秒数"
                        type="number"
                        min="10"
                        step="10"
                        value={aiForm.timeoutSeconds ?? ''}
                        onChange={(event) =>
                          handleAiFormChange({ timeoutSeconds: readOptionalNumberInput(event.target.value) })
                        }
                      />
                      <input
                        aria-label="重试次数"
                        type="number"
                        min="0"
                        max="8"
                        value={aiForm.maxRetries ?? ''}
                        onChange={(event) =>
                          handleAiFormChange({ maxRetries: readOptionalNumberInput(event.target.value) })
                        }
                      />
                    </div>
                  </label>
                </div>
                <p className="subtle">{describeAiRuntimeOptions(aiForm)}</p>
              </details>
              <div className="pdf-ai-settings-actions">
                <button type="button" disabled={isAiBusy} onClick={handleSaveAiSettings}>
                  保存设置
                </button>
                <button type="button" disabled={isAiBusy} onClick={handleTestAiConnection}>
                  测试连接
                </button>
                <button type="button" disabled={isAiBusy} onClick={handleRefreshAiModels}>
                  刷新模型
                </button>
                <button type="button" disabled={isAiBusy} onClick={handleRefreshAiBalance}>
                  查询余额
                </button>
                <button type="button" className="secondary-button" onClick={handleOpenAiAssistantForSettings}>
                  前往 AI 助手配置
                </button>
              </div>
              {aiBalance ? <p className="pdf-ai-balance">{aiBalance.message}</p> : null}
            </details>
            <NotesPanel
              notes={activeNotes}
              paper={activePaper}
              pdfPage={currentPage}
              linkedRowIndex={activePaperResearchRowIndex}
              linkedRowValues={activePaperResearchRowValues}
              onChange={handleNotesChange}
              onOpenPaper={activePaper ? () => handleOpenPaper(activePaper) : undefined}
              onOpenResearchSheet={activePaper ? () => handleOpenResearchSheet(activePaper) : undefined}
            />
          </div>
        </section>
      </main>

        <ConnectedStatusBar />
      </div>
    </div>
  );
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  return Uint8Array.from(binaryString, (character) => character.charCodeAt(0));
}

function buildExportFileName(sourceName?: string): string {
  if (!sourceName) {
    return 'bilingual-translation.md';
  }

  return sourceName.replace(/\.[^.]+$/, '') + '-bilingual.md';
}

function buildPdfExportFileName(sourceName?: string): string {
  if (!sourceName) {
    return 'bilingual.pdf';
  }

  return sourceName.replace(/\.[^.]+$/, '') + '-bilingual.pdf';
}

function buildPresentationExportFileName(title: string, extension: 'json' | 'md' | 'pptx'): string {
  const safeTitle = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .replace(/[. ]+$/gu, '')
    .slice(0, 80);
  return `${safeTitle || 'seminar-presentation'}-slides.${extension}`;
}

async function withPresentationCropTimeout(
  fallbackDraft: PresentationDraft,
  cropPromise: Promise<PresentationDraft>,
  timeoutMs: number
): Promise<PresentationDraft> {
  return Promise.race([
    cropPromise,
    new Promise<PresentationDraft>((resolve) => {
      window.setTimeout(() => resolve(fallbackDraft), timeoutMs);
    })
  ]);
}

function cleanAiCellText(value: string): string {
  return cleanSheetCellAiValue(value);
}

function readOptionalNumberInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const numberValue = Number(trimmed);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
