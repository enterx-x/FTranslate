import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  AI_PROVIDER_PRESETS,
  AI_PROVIDER_MODEL_OPTIONS,
  AI_REASONING_EFFORT_OPTIONS,
  AI_THINKING_MODE_OPTIONS,
  describeAiRuntimeOptions,
  mergeAiModelOptions,
  shouldTranslateItem,
  withDefaultAiRuntimeOptions,
  type AiModelOption,
  type AiProviderId,
  type AiReasoningEffort,
  type AiThinkingMode
} from '../shared/aiTranslation';
import { formatPdfTranslationProgressMessage } from '../shared/pdfTranslation';
import type { AiAssistantFocus } from './components/AiAssistantPage';
import type { AiFormState } from './components/AiModePanel';
import { AppSidebar, type AppSidebarSection } from './components/AppSidebar';
import { HomePage } from './components/HomePage';
import { buildKnowledgeGraph } from './lib/knowledgeGraph';
import { APP_SETTINGS_KEY, describeReferenceStrategy, parseAppSettings } from './lib/appSettings';
import {
  buildPresentationDraft,
  serializePresentationMarkdown,
  type PresentationDraft
} from './lib/presentationOutline';
import { NotesPanel } from './components/NotesPanel';
import { PdfViewer } from './components/PdfViewer';
import type { PdfViewportState } from './lib/pdfViewportSync';
import { Toolbar } from './components/Toolbar';
import translateIcon from './assets/icons/duotone/translate.svg';
import uploadIcon from './assets/icons/duotone/upload.svg';
import downloadIcon from './assets/icons/duotone/download.svg';
import refreshIcon from './assets/icons/duotone/refresh.svg';
import searchIcon from './assets/icons/duotone/search.svg';
import settingsIcon from './assets/icons/duotone/settings.svg';
import {
  buildAiCacheDocument,
  cloneJsonDocumentForAi,
  getDefaultAiCacheFileName,
  updateAiCacheItem
} from './lib/aiMode';
import { buildPaperCellPrompt } from './lib/paperCellAi';
import {
  buildLiteratureGapPrompt,
  parseLiteratureGapResponse
} from './lib/literatureInsight';
import {
  RESEARCH_SHEET_LINKS_KEY,
  RESEARCH_WORKBOOK_KEY,
  ensurePaperRow,
  migrateLegacyPaperSheetCells,
  parseResearchSheetLinks,
  parseResearchWorkbook,
  serializeResearchSheetLinks,
  serializeResearchWorkbook,
  getResearchRowValues,
  type ResearchSheetLink,
  type ResearchWorkbook
} from './lib/researchWorkbook';
import { buildFreshPdfSessionState } from './lib/projectSession';
import { buildSheetCellsPrompt, parseSheetCellsAiResponse } from './lib/sheetCellAi';
import {
  exportBilingualMarkdown,
  parseTranslationFile,
  serializeTranslationDocument,
  updateTranslationAtIndex,
  type TranslationDocument,
  type TranslationItem
} from './lib/translation';
import type { ExtractedPdfBlock } from './lib/pdfTextStructure';
import {
  buildPaperRecord,
  PAPER_LIBRARY_KEY,
  PAPER_RESEARCH_COLUMNS,
  parsePaperLibrary,
  serializePaperLibrary,
  updatePaperRecord,
  updatePaperSheetCell,
  upsertPaperRecord,
  type PaperRecord,
  type PaperResearchColumnKey
} from './lib/papers';
import { buildCurrentJsonPrompt, buildFullJsonPrompt } from './lib/promptTemplates';
import type {
  AiSettingsView,
  AiBalanceResult,
  PdfFilePayload,
  PdfTranslationEngineResult,
  PdfTranslationProgress,
  PdfTranslationResult,
  SaveTextResult,
  TextFilePayload
} from './types/electron';
import type {
  AnalyzeLiteratureGapRequest,
  AnalyzeLiteratureGapResult,
  FillResearchCellResult,
  FillResearchCellsRequest
} from './components/ResearchSheetPage';

interface PdfState {
  filePath: string;
  fileName: string;
  data: Uint8Array;
}

interface RecentProject {
  pdfPath?: string;
  translationPath?: string;
  aiCachePath?: string;
}

type AppView = 'home' | 'reader' | 'researchSheet' | 'aiAssistant' | 'knowledgeGraph' | 'presentation' | 'settings';
type ReaderMode = 'manual' | 'ai';
type PdfViewMode = 'source' | 'parallel' | 'translated';
type BuiltInProviderId = Exclude<AiProviderId, 'custom'>;

const RECENT_PROJECT_KEY = 'pdfTranslationReader:lastProject';
const ResearchSheetPage = lazy(async () => {
  const module = await import('./components/ResearchSheetPage');
  return { default: module.ResearchSheetPage };
});
const AiAssistantPage = lazy(async () => {
  const module = await import('./components/AiAssistantPage');
  return { default: module.AiAssistantPage };
});
const KnowledgeGraphPage = lazy(async () => {
  const module = await import('./components/KnowledgeGraphPage');
  return { default: module.KnowledgeGraphPage };
});
const PresentationPage = lazy(async () => {
  const module = await import('./components/PresentationPage');
  return { default: module.PresentationPage };
});
const SettingsPage = lazy(async () => {
  const module = await import('./components/SettingsPage');
  return { default: module.SettingsPage };
});

export default function App() {
  const [view, setView] = useState<AppView>('home');
  const [homeSection, setHomeSection] = useState<'hub' | 'library'>('hub');
  const [aiAssistantFocus, setAiAssistantFocus] = useState<AiAssistantFocus>('analysis');
  const [readerMode, setReaderMode] = useState<ReaderMode>('manual');
  const [paperLibrary, setPaperLibrary] = useState<PaperRecord[]>(() =>
    parsePaperLibrary(localStorage.getItem(PAPER_LIBRARY_KEY))
  );
  const [researchWorkbook, setResearchWorkbook] = useState<ResearchWorkbook>(() =>
    parseResearchWorkbook(localStorage.getItem(RESEARCH_WORKBOOK_KEY))
  );
  const [researchSheetLinks, setResearchSheetLinks] = useState<ResearchSheetLink[]>(() =>
    parseResearchSheetLinks(localStorage.getItem(RESEARCH_SHEET_LINKS_KEY))
  );
  const [researchFocusPaperId, setResearchFocusPaperId] = useState<string | null>(null);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [translatedPdf, setTranslatedPdf] = useState<PdfState | null>(null);
  const [translatedMonoPdf, setTranslatedMonoPdf] = useState<PdfState | null>(null);
  const [presentationDraft, setPresentationDraft] = useState<PresentationDraft | null>(null);
  const [pdfViewMode, setPdfViewMode] = useState<PdfViewMode>('source');
  const [pdfViewportState, setPdfViewportState] = useState<PdfViewportState | null>(null);
  const [translationDocument, setTranslationDocument] = useState<TranslationDocument | null>(null);
  const [aiCacheDocument, setAiCacheDocument] = useState<TranslationDocument | null>(null);
  const [extractedPdfBlocks, setExtractedPdfBlocks] = useState<ExtractedPdfBlock[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  const [aiParagraphIndex, setAiParagraphIndex] = useState(0);
  const [activeNotes, setActiveNotes] = useState('');
  const [isPdfAiSettingsOpen, setIsPdfAiSettingsOpen] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [aiSettings, setAiSettings] = useState<AiSettingsView | null>(null);
  const [aiBalance, setAiBalance] = useState<AiBalanceResult | null>(null);
  const [runtimeModelOptions, setRuntimeModelOptions] = useState<
    Partial<Record<BuiltInProviderId, AiModelOption[]>>
  >({});
  const [aiForm, setAiForm] = useState<AiFormState>(() => ({
    ...withDefaultAiRuntimeOptions(AI_PROVIDER_PRESETS.deepseek),
    apiKey: ''
  }));
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [isPdfTranslationBusy, setIsPdfTranslationBusy] = useState(false);
  const [pdfTranslationEngine, setPdfTranslationEngine] =
    useState<PdfTranslationEngineResult | null>(null);
  const [pdfTranslationStatus, setPdfTranslationStatus] = useState('');
  const [statusMessage, setStatusMessage] = useState('请在论文库中新建或打开一个翻译项目。');

  const currentItem = translationDocument?.items[currentParagraphIndex] ?? null;
  const displayedPdf = pdfViewMode === 'translated' && translatedPdf ? translatedPdf : pdf;
  const parallelTranslationPdf = translatedMonoPdf ?? translatedPdf;
  const activePaper = activePaperId
    ? paperLibrary.find((paper) => paper.id === activePaperId) ?? null
    : null;
  const activePaperResearchLink = activePaperId
    ? researchSheetLinks.find((link) => link.paperId === activePaperId)
    : undefined;
  const activePaperResearchRowIndex = activePaperResearchLink
    ? researchWorkbook.rows.findIndex((row) => row.id === activePaperResearchLink.rowId)
    : -1;
  const activePaperResearchRowValues =
    activePaperResearchRowIndex > 0
      ? getResearchRowValues(researchWorkbook, activePaperResearchRowIndex)
      : null;
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
  const appSettings = useMemo(
    () => parseAppSettings(localStorage.getItem(APP_SETTINGS_KEY)),
    [view]
  );

  useEffect(() => {
    window.electronAPI
      .loadAiSettings()
      .then((settings) => {
        setAiSettings(settings);
        setAiForm({
          ...withDefaultAiRuntimeOptions(settings),
          apiKey: ''
        });
        setAiBalance(null);
      })
      .catch((error) => {
        setStatusMessage(`读取 AI 设置失败：${String(error)}`);
      });
  }, []);

  useEffect(() => {
    window.electronAPI
      .checkPdfTranslationEngine()
      .then((engine) => {
        setPdfTranslationEngine(engine);
        setPdfTranslationStatus(engine.message);
      })
      .catch((error) => {
        setPdfTranslationStatus(`PDF 翻译引擎检查失败：${String(error)}`);
      });
  }, []);

  useEffect(() => {
    return window.electronAPI.onPdfTranslationProgress((progress: PdfTranslationProgress) => {
      setPdfTranslationStatus(formatPdfTranslationProgressMessage(progress.message));
      if (progress.status === 'running') {
        setIsPdfTranslationBusy(true);
      }
      if (progress.status === 'completed' || progress.status === 'failed') {
        setIsPdfTranslationBusy(false);
      }
    });
  }, []);

  const recentProject = useMemo<RecentProject>(() => {
    return {
      pdfPath: pdf?.filePath,
      translationPath: translationDocument?.sourcePath,
      aiCachePath: aiCacheDocument?.sourcePath
    };
  }, [aiCacheDocument?.sourcePath, pdf?.filePath, translationDocument?.sourcePath]);

  useEffect(() => {
    localStorage.setItem(PAPER_LIBRARY_KEY, serializePaperLibrary(paperLibrary));
  }, [paperLibrary]);

  useEffect(() => {
    localStorage.setItem(RESEARCH_WORKBOOK_KEY, serializeResearchWorkbook(researchWorkbook));
  }, [researchWorkbook]);

  useEffect(() => {
    localStorage.setItem(RESEARCH_SHEET_LINKS_KEY, serializeResearchSheetLinks(researchSheetLinks));
  }, [researchSheetLinks]);

  useEffect(() => {
    const legacyPapers = readLegacyPapersWithSheetCells(
      localStorage.getItem(PAPER_LIBRARY_KEY),
      paperLibrary
    );

    if (legacyPapers.length === 0) {
      return;
    }

    const migrated = migrateLegacyPaperSheetCells(
      researchWorkbook,
      researchSheetLinks,
      legacyPapers
    );
    setResearchWorkbook(migrated.workbook);
    setResearchSheetLinks(migrated.links);
  // 旧版 sheetCells 只需要在启动后尝试迁移一次，之后独立工作簿负责保存。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!recentProject.pdfPath && !recentProject.translationPath) {
      return;
    }

    localStorage.setItem(RECENT_PROJECT_KEY, JSON.stringify(recentProject));
  }, [recentProject]);

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
    setAiCacheDocument(null);
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
    setPageCount(0);
    return nextPdf;
  }

  function applyTranslationPayload(payload: TextFilePayload): TranslationDocument {
    const document = parseTranslationFile(payload.content, payload.fileName, payload.filePath);
    setTranslationDocument(document);
    setAiCacheDocument(cloneJsonDocumentForAi(document));
    setCurrentParagraphIndex(0);
    setAiParagraphIndex(0);
    setShowTranslation(document.kind === 'markdown');
    setIsEditing(false);
    setEditingText('');
    return document;
  }

  function applyAiCachePayload(payload: TextFilePayload): TranslationDocument | null {
    const document = parseTranslationFile(payload.content, payload.fileName, payload.filePath);
    const aiDocument = cloneJsonDocumentForAi(document);
    if (!aiDocument) {
      return null;
    }

    setAiCacheDocument(aiDocument);
    setAiParagraphIndex(0);
    return aiDocument;
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

      applyPdfPayload(result.pdf, paper.lastPage, { keepTranslatedPdf: Boolean(result.translatedPdf) });
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
          setStatusMessage('AI 缓存不是 JSON 翻译数组，已只打开手动翻译文件。');
        }
      }
      if (result.translatedPdf) {
        applyTranslatedPdfPayload(result.translatedPdf, result.translatedMonoPdf);
      }
      const updated = updatePaperRecord(paper, {
        lastOpenedAt: new Date().toISOString()
      });
      setPaperLibrary((library) =>
        library.map((item) => (item.id === paper.id ? updated : item))
      );
      setActivePaperId(paper.id);
      setActiveNotes(paper.notes ?? '');
      setView('reader');
      setStatusMessage(
        result.translatedPdf
          ? `已打开论文并切换到双语 PDF：${paper.chineseTitle || paper.englishTitle}`
          : result.aiCache
            ? `已打开论文并自动导入 AI 缓存：${paper.chineseTitle || paper.englishTitle}`
            : `已打开论文：${paper.chineseTitle || paper.englishTitle}`
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
      const engine = await window.electronAPI.checkPdfTranslationEngine();
      setPdfTranslationEngine(engine);
      setPdfTranslationStatus(engine.message);
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

      applyTranslatedPdfPayload(result.pdf, result.monoPdf);
      rememberTranslatedPdfResult(paper.id, result);
      setStatusMessage(result.message);
      setPdfTranslationStatus(result.message);
    } catch (error) {
      const message = `生成双语 PDF 失败：${String(error)}`;
      setStatusMessage(message);
      setPdfTranslationStatus(message);
    } finally {
      setIsPdfTranslationBusy(false);
    }
  }

  async function handleImportTranslatedPdf(): Promise<void> {
    try {
      const payload = await window.electronAPI.openTranslatedPdf();
      if (!payload) {
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

  function handleGeneratePresentationFromCurrentPdf(): void {
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

    const draft = buildPresentationDraft({
      papers: [paper],
      blocks: extractedPdfBlocks,
      targetSlideCount: 12
    });
    setPresentationDraft(draft);
    setView('presentation');
    setStatusMessage(
      extractedPdfBlocks.length > 0
        ? `已生成 ${draft.slides.length} 页组会 PPT 草稿。`
        : 'PDF 文本尚未提取完成，已生成基础 PPT 草稿并保留缺失提示。'
    );
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

  function ensureActivePaperForCurrentPdf(): PaperRecord | null {
    if (!pdf) {
      return null;
    }

    const existing = activePaperId
      ? paperLibrary.find((paper) => paper.id === activePaperId && paper.pdfPath === pdf.filePath)
      : paperLibrary.find((paper) => paper.pdfPath === pdf.filePath);

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

  function handleProviderChange(provider: AiProviderId): void {
    setAiBalance(null);
    if (provider === 'custom') {
      setAiForm((value) => ({ ...value, provider }));
      return;
    }

    const preset = AI_PROVIDER_PRESETS[provider];
    setAiForm((value) => ({
      ...value,
      ...withDefaultAiRuntimeOptions({
        provider,
        baseURL: preset.baseURL,
        model: preset.model
      })
    }));
  }

  function handleAiFormChange(patch: Partial<AiFormState>): void {
    if (
      patch.provider ||
      patch.baseURL ||
      patch.model ||
      patch.apiKey ||
      patch.thinkingMode ||
      patch.reasoningEffort ||
      patch.temperature !== undefined ||
      patch.topP !== undefined ||
      patch.maxTokens !== undefined
    ) {
      setAiBalance(null);
    }
    setAiForm((value) => {
      const next = { ...value, ...patch };
      if (patch.provider || patch.model || patch.thinkingMode) {
        const nextDefaults = withDefaultAiRuntimeOptions({
          ...next,
          temperature: undefined,
          topP: undefined
        });
        return {
          ...next,
          ...nextDefaults,
          apiKey: next.apiKey
        };
      }
      return next;
    });
  }

  async function handleSaveAiSettings(): Promise<void> {
    try {
      setIsAiBusy(true);
      const settings = await window.electronAPI.saveAiSettings(aiForm);
      setAiSettings(settings);
      setAiBalance(null);
      setAiForm({
        ...withDefaultAiRuntimeOptions(settings),
        apiKey: ''
      });
      setStatusMessage('AI 设置已保存。');
    } catch (error) {
      setStatusMessage(`保存 AI 设置失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleTestAiConnection(): Promise<void> {
    try {
      setIsAiBusy(true);
      setStatusMessage('正在测试 AI 连接...');
      const result = await window.electronAPI.testAiConnection();
      setStatusMessage(result.ok ? `AI 连接成功：${result.message}` : `AI 连接失败：${result.message}`);
    } catch (error) {
      setStatusMessage(`AI 连接测试失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleRefreshAiBalance(): Promise<void> {
    try {
      setIsAiBusy(true);
      setStatusMessage('正在查询 API 余额...');
      const balance = await window.electronAPI.getAiBalance();
      setAiBalance(balance);
      setStatusMessage(balance.supported ? `API 余额：${balance.message}` : balance.message);
    } catch (error) {
      setStatusMessage(`API 余额查询失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleRefreshAiModels(): Promise<void> {
    try {
      setIsAiBusy(true);
      setStatusMessage('正在刷新当前 Provider 的模型列表...');
      const result = await window.electronAPI.getAiModels();
      if (result.supported && result.provider !== 'custom') {
        const provider = result.provider as BuiltInProviderId;
        setRuntimeModelOptions((value) => ({
          ...value,
          [provider]: mergeAiModelOptions(
            AI_PROVIDER_MODEL_OPTIONS[provider],
            result.options,
            aiForm.model
          )
        }));
      }
      setStatusMessage(result.message);
    } catch (error) {
      setStatusMessage(`模型列表刷新失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  function handleBuildAiCacheDocument(): void {
    if (extractedPdfBlocks.length === 0) {
      setStatusMessage('还没有可用的 PDF 文本提取结果，请先等待 PDF 渲染完成。');
      return;
    }

    const document = buildAiCacheDocument(extractedPdfBlocks, pdf?.fileName, aiCacheDocument ?? translationDocument);
    setAiCacheDocument(document);
    setAiParagraphIndex(0);
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

  function handlePreviousParagraph(): void {
    setCurrentParagraphIndex((value) => Math.max(0, value - 1));
    resetParagraphDisplay();
  }

  function handleNextParagraph(): void {
    if (!translationDocument) {
      return;
    }

    setCurrentParagraphIndex((value) => Math.min(translationDocument.items.length - 1, value + 1));
    resetParagraphDisplay();
  }

  function handleShowTranslation(): void {
    setShowTranslation(true);
  }

  function handleStartEdit(): void {
    if (!currentItem) {
      return;
    }

    setEditingText(currentItem.translation);
    setIsEditing(true);
    setShowTranslation(true);
  }

  function handleApplyEdit(): void {
    if (!translationDocument) {
      return;
    }

    setTranslationDocument(updateTranslationAtIndex(translationDocument, currentParagraphIndex, editingText));
    setIsEditing(false);
    setShowTranslation(true);
    setStatusMessage('当前译文已更新，请点击“保存翻译”写入本地文件。');
  }

  function resetParagraphDisplay(): void {
    setIsEditing(false);
    setEditingText('');
    setShowTranslation(translationDocument?.kind === 'markdown');
  }

  function handlePageChange(nextPage: number): void {
    if (pageCount === 0) {
      setCurrentPage(Math.max(1, nextPage));
      return;
    }

    setCurrentPage(Math.min(pageCount, Math.max(1, nextPage)));
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

    const document = buildAiCacheDocument(extractedPdfBlocks, pdf?.fileName, translationDocument);
    setAiCacheDocument(document);
    setAiParagraphIndex(0);
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

  function openResearchSheetFromSidebar(): void {
    void handleOpenResearchSheet();
  }

  function openKnowledgeGraph(): void {
    setView('knowledgeGraph');
  }

  function openPresentationGenerator(): void {
    if (presentationDraft) {
      setView('presentation');
      return;
    }
    handleGeneratePresentationFromCurrentPdf();
  }

  function openAiAssistant(focus: AiAssistantFocus = 'analysis'): void {
    setAiAssistantFocus(focus);
    setView('aiAssistant');
  }

  function openSettings(): void {
    setView('settings');
  }

  function getCurrentModelOptions(): AiModelOption[] {
    return aiForm.provider === 'custom'
      ? []
      : runtimeModelOptions[aiForm.provider] ?? AI_PROVIDER_MODEL_OPTIONS[aiForm.provider];
  }

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

    if (view === 'aiAssistant') {
      return 'ai';
    }

    if (view === 'settings') {
      return 'settings';
    }

    if (view === 'reader') {
      return 'reader';
    }

    return homeSection === 'library' ? 'library' : 'workspace';
  }

  function renderSidebar() {
    return (
      <AppSidebar
        activeSection={getSidebarActiveSection()}
        onOpenWorkspace={openWorkspace}
        onOpenLibrary={openLibrary}
        onOpenResearchSheet={openResearchSheetFromSidebar}
        onOpenKnowledgeGraph={openKnowledgeGraph}
        onOpenPresentation={openPresentationGenerator}
        onOpenReader={openReaderFromSidebar}
        onOpenAi={openAiFromSidebar}
        onOpenSettings={openSettings}
      />
    );
  }

  if (view === 'home') {
    return (
      <div className="app-shell desktop-shell home-shell">
        {renderSidebar()}
        <div className="app-main">
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
            onUpdatePaper={(paper) =>
              setPaperLibrary((library) => library.map((item) => (item.id === paper.id ? paper : item)))
            }
            onRemovePaper={(paper) =>
              setPaperLibrary((library) => library.filter((item) => item.id !== paper.id))
            }
          />
          <footer className="status-bar">{statusMessage}</footer>
        </div>
      </div>
    );
  }

  if (view === 'researchSheet') {
    return (
      <div className="app-shell desktop-shell research-shell">
        {renderSidebar()}
        <div className="app-main">
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
              onOpenAiAssistant={() => openAiAssistant('analysis')}
              onOpenKnowledgeGraph={openKnowledgeGraph}
            />
          </Suspense>
          <footer className="status-bar">{statusMessage}</footer>
        </div>
      </div>
    );
  }

  if (view === 'aiAssistant') {
    return (
      <div className="app-shell desktop-shell ai-assistant-shell">
        {renderSidebar()}
        <div className="app-main">
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
              modelOptions={getCurrentModelOptions()}
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
          <footer className="status-bar">{statusMessage}</footer>
        </div>
      </div>
    );
  }

  if (view === 'knowledgeGraph') {
    return (
      <div className="app-shell desktop-shell knowledge-shell">
        {renderSidebar()}
        <div className="app-main">
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
          <footer className="status-bar">{statusMessage}</footer>
        </div>
      </div>
    );
  }

  if (view === 'presentation') {
    return (
      <div className="app-shell desktop-shell presentation-shell">
        {renderSidebar()}
        <div className="app-main">
          <Suspense fallback={<main className="presentation-loading">正在加载组会 PPT 生成器...</main>}>
            <PresentationPage
              draft={presentationDraft}
              onBackHome={openWorkspace}
              onOpenReader={openReaderFromSidebar}
              onRegenerate={handleGeneratePresentationFromCurrentPdf}
              onExportMarkdown={handleExportPresentationMarkdown}
              onExportJson={handleExportPresentationJson}
            />
          </Suspense>
          <footer className="status-bar">{statusMessage}</footer>
        </div>
      </div>
    );
  }

  if (view === 'settings') {
    return (
      <div className="app-shell desktop-shell settings-shell">
        {renderSidebar()}
        <div className="app-main">
          <Suspense fallback={<main className="settings-loading">正在加载设置...</main>}>
            <SettingsPage
              onBackHome={openWorkspace}
              onOpenAiAssistant={() => openAiAssistant('settings')}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell desktop-shell reader-shell">
      {renderSidebar()}
      <div className="app-main reader-main">
        <Toolbar
          currentPage={currentPage}
          pageCount={pageCount}
          scale={scale}
          onGoHome={openWorkspace}
          onNewProject={handleNewPdfTranslationProject}
          onOpenPdf={handleOpenPdf}
          onZoomIn={() => setScale((value) => Math.min(2.4, Number((value + 0.1).toFixed(2))))}
          onZoomOut={() => setScale((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}
          onPreviousPage={() => handlePageChange(currentPage - 1)}
          onNextPage={() => handlePageChange(currentPage + 1)}
          onPageChange={handlePageChange}
        />

        <main className={`split-layout${pdfViewMode === 'parallel' ? ' is-parallel-pdf' : ''}`}>
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
                onScaleChange={(nextScale) => setScale(nextScale)}
                onDocumentLoad={(nextPageCount) => {
                  setPageCount(nextPageCount);
                  setCurrentPage((page) => Math.min(Math.max(1, page), nextPageCount));
                }}
                onCurrentPageChange={(page) => {
                  setCurrentPage((current) => (current === page ? current : page));
                }}
                onExtractedTextReady={setExtractedPdfBlocks}
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
                onScaleChange={(nextScale) => setScale(nextScale)}
                onDocumentLoad={(nextPageCount) => {
                  setPageCount((count) => Math.max(count, nextPageCount));
                }}
                onCurrentPageChange={(page) => {
                  setCurrentPage((current) => (current === page ? current : page));
                }}
                onExtractedTextReady={() => undefined}
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
              onScaleChange={(nextScale) => setScale(nextScale)}
              onDocumentLoad={(nextPageCount) => {
                setPageCount(nextPageCount);
                setCurrentPage((page) => Math.min(Math.max(1, page), nextPageCount));
              }}
              onCurrentPageChange={(page) => {
                setCurrentPage((current) => (current === page ? current : page));
              }}
              onExtractedTextReady={(blocks) => {
                if (pdfViewMode === 'source') {
                  setExtractedPdfBlocks(blocks);
                }
              }}
              onHighlightStatusChange={setStatusMessage}
              onStatusChange={setStatusMessage}
            />
          )}
        </section>

        <section className="translation-pane">
          <div className="side-panel">
            <section className="whole-pdf-panel" aria-label="整体双语 PDF">
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
                <button type="button" className="secondary-button button-with-icon" disabled={isPdfTranslationBusy} onClick={handleImportTranslatedPdf}>
                  <img className="button-icon" src={uploadIcon} alt="" />
                  <span>导入中文/双语 PDF</span>
                </button>
                <button type="button" className="secondary-button button-with-icon" disabled={!translatedPdf || isPdfTranslationBusy} onClick={handleExportTranslatedPdf}>
                  <img className="button-icon" src={downloadIcon} alt="" />
                  <span>导出双语 PDF</span>
                </button>
                <button type="button" className="secondary-button button-with-icon" disabled={!pdf} onClick={handleGeneratePresentationFromCurrentPdf}>
                  <img className="button-icon" src={translateIcon} alt="" />
                  <span>生成组会 PPT</span>
                </button>
                <button type="button" className="ghost-button button-with-icon" disabled={isPdfTranslationBusy} onClick={handleCheckPdfTranslationEngine}>
                  <img className="button-icon" src={searchIcon} alt="" />
                  <span>检查引擎</span>
                </button>
              </div>
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
                      {(runtimeModelOptions[aiForm.provider] ?? AI_PROVIDER_MODEL_OPTIONS[aiForm.provider]).map((model) => (
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
                <button type="button" className="secondary-button" onClick={() => openAiAssistant('settings')}>
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

        <footer className="status-bar">{statusMessage}</footer>
      </div>
    </div>
  );
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
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

function buildPresentationExportFileName(title: string, extension: 'json' | 'md'): string {
  const safeTitle = title
    .replace(/[\\/:*?"<>|]+/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80);
  return `${safeTitle || 'seminar-presentation'}-slides.${extension}`;
}

function readLegacyPapersWithSheetCells(
  rawValue: string | null,
  papers: PaperRecord[]
): Array<PaperRecord & { sheetCells?: Record<string, string> }> {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const legacyPapers: Array<PaperRecord & { sheetCells?: Record<string, string> }> = [];

    parsed.forEach((entry) => {
      if (!isObjectRecord(entry) || !isObjectRecord(entry.sheetCells)) {
        return;
      }

      const paper = papers.find((item) => item.id === entry.id);
      if (!paper) {
        return;
      }

      legacyPapers.push({
        ...paper,
        sheetCells: Object.fromEntries(
          Object.entries(entry.sheetCells)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, String(value)])
        )
      });
    });

    return legacyPapers;
  } catch {
    return [];
  }
}

function cleanAiCellText(value: string): string {
  return value
    .replace(/^```(?:markdown|text)?\s*/iu, '')
    .replace(/```$/u, '')
    .trim();
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
