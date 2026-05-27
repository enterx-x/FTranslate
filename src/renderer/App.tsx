import { useEffect, useMemo, useState } from 'react';
import { AI_PROVIDER_PRESETS, shouldTranslateItem, type AiProviderId } from '../shared/aiTranslation';
import { AiModePanel, type AiFormState } from './components/AiModePanel';
import { HomePage } from './components/HomePage';
import { PdfViewer } from './components/PdfViewer';
import { Toolbar } from './components/Toolbar';
import { TranslationPanel } from './components/TranslationPanel';
import { buildAiCacheDocument, getDefaultAiCacheFileName } from './lib/aiMode';
import { buildPdfHighlightQuery } from './lib/pdfTextHighlight';
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
  parsePaperLibrary,
  serializePaperLibrary,
  updatePaperRecord,
  upsertPaperRecord,
  type PaperRecord
} from './lib/papers';
import { buildCurrentJsonPrompt, buildFullJsonPrompt } from './lib/promptTemplates';
import type {
  AiSettingsView,
  AiTranslateResult,
  PdfFilePayload,
  SaveTextResult,
  TextFilePayload
} from './types/electron';

interface PdfState {
  filePath: string;
  fileName: string;
  data: Uint8Array;
}

interface RecentProject {
  pdfPath?: string;
  translationPath?: string;
}

type AppView = 'home' | 'reader';
type ReaderMode = 'manual' | 'ai';

const RECENT_PROJECT_KEY = 'pdfTranslationReader:lastProject';

export default function App() {
  const [view, setView] = useState<AppView>('home');
  const [readerMode, setReaderMode] = useState<ReaderMode>('manual');
  const [paperLibrary, setPaperLibrary] = useState<PaperRecord[]>(() =>
    parsePaperLibrary(localStorage.getItem(PAPER_LIBRARY_KEY))
  );
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [translationDocument, setTranslationDocument] = useState<TranslationDocument | null>(null);
  const [extractedPdfBlocks, setExtractedPdfBlocks] = useState<ExtractedPdfBlock[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [aiSettings, setAiSettings] = useState<AiSettingsView | null>(null);
  const [aiForm, setAiForm] = useState<AiFormState>({
    provider: AI_PROVIDER_PRESETS.deepseek.provider,
    baseURL: AI_PROVIDER_PRESETS.deepseek.baseURL,
    model: AI_PROVIDER_PRESETS.deepseek.model,
    apiKey: ''
  });
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('请在论文库中新建或打开一个翻译项目。');

  const currentItem = translationDocument?.items[currentParagraphIndex] ?? null;

  useEffect(() => {
    window.electronAPI
      .loadAiSettings()
      .then((settings) => {
        setAiSettings(settings);
        setAiForm({
          provider: settings.provider,
          baseURL: settings.baseURL,
          model: settings.model,
          apiKey: ''
        });
      })
      .catch((error) => {
        setStatusMessage(`读取 AI 设置失败：${String(error)}`);
      });
  }, []);

  const recentProject = useMemo<RecentProject>(() => {
    return {
      pdfPath: pdf?.filePath,
      translationPath: translationDocument?.sourcePath
    };
  }, [pdf?.filePath, translationDocument?.sourcePath]);

  useEffect(() => {
    localStorage.setItem(PAPER_LIBRARY_KEY, serializePaperLibrary(paperLibrary));
  }, [paperLibrary]);

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

  function applyPdfPayload(payload: PdfFilePayload, initialPage = 1): PdfState {
    const nextPdf = {
      filePath: payload.filePath,
      fileName: payload.fileName,
      data: base64ToUint8Array(payload.base64)
    };

    setPdf(nextPdf);
    setExtractedPdfBlocks([]);
    setCurrentPage(initialPage);
    setPageCount(0);
    return nextPdf;
  }

  function applyTranslationPayload(payload: TextFilePayload): TranslationDocument {
    const document = parseTranslationFile(payload.content, payload.fileName, payload.filePath);
    setTranslationDocument(document);
    setCurrentParagraphIndex(0);
    setShowTranslation(document.kind === 'markdown');
    setIsEditing(false);
    setEditingText('');
    return document;
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
        translationPath: paper.translationPath
      });

      if (!result.pdf || !result.translation) {
        setStatusMessage(
          result.errors.length > 0
            ? result.errors.join('；')
            : '无法打开论文记录，请检查 PDF 或翻译文件是否仍在原路径。'
        );
        return;
      }

      applyPdfPayload(result.pdf, paper.lastPage);
      applyTranslationPayload(result.translation);
      const updated = updatePaperRecord(paper, {
        lastOpenedAt: new Date().toISOString()
      });
      setPaperLibrary((library) =>
        library.map((item) => (item.id === paper.id ? updated : item))
      );
      setActivePaperId(paper.id);
      setView('reader');
      setStatusMessage(`已打开论文：${paper.chineseTitle || paper.englishTitle}`);
    } catch (error) {
      setStatusMessage(`打开论文记录失败：${String(error)}`);
    }
  }

  async function handleOpenPdf(): Promise<void> {
    try {
      const payload = await window.electronAPI.openPdf();
      if (!payload) {
        return;
      }

      applyPdfPayload(payload);
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

  async function handleNewProject(): Promise<void> {
    const pdfPayload = await window.electronAPI.openPdf();
    if (!pdfPayload) {
      return;
    }

    const translationPayload = await window.electronAPI.openTranslation();
    if (!translationPayload) {
      return;
    }

    try {
      applyPdfPayload(pdfPayload);
      const document = applyTranslationPayload(translationPayload);
      const record = buildPaperRecord({
        pdfPath: pdfPayload.filePath,
        pdfName: pdfPayload.fileName,
        translationPath: translationPayload.filePath,
        translationName: translationPayload.fileName,
        document
      });
      const storedRecord = rememberPaper(record);

      setView('reader');
      setStatusMessage(`新建翻译项目完成：${storedRecord.chineseTitle || storedRecord.englishTitle}`);
    } catch (error) {
      setStatusMessage(`新建翻译项目失败：${String(error)}`);
    }
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
    if (provider === 'custom') {
      setAiForm((value) => ({ ...value, provider }));
      return;
    }

    const preset = AI_PROVIDER_PRESETS[provider];
    setAiForm((value) => ({
      ...value,
      provider,
      baseURL: preset.baseURL,
      model: preset.model
    }));
  }

  function handleAiFormChange(patch: Partial<AiFormState>): void {
    setAiForm((value) => ({ ...value, ...patch }));
  }

  async function handleSaveAiSettings(): Promise<void> {
    try {
      setIsAiBusy(true);
      const settings = await window.electronAPI.saveAiSettings(aiForm);
      setAiSettings(settings);
      setAiForm({
        provider: settings.provider,
        baseURL: settings.baseURL,
        model: settings.model,
        apiKey: ''
      });
      setStatusMessage('AI 设置已保存。');
    } catch (error) {
      setStatusMessage(`保存 AI 设置失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  function handleBuildAiCacheDocument(): void {
    if (extractedPdfBlocks.length === 0) {
      setStatusMessage('还没有可用的 PDF 文本提取结果，请先等待 PDF 渲染完成。');
      return;
    }

    const document = buildAiCacheDocument(extractedPdfBlocks, pdf?.fileName, translationDocument);
    setTranslationDocument(document);
    setCurrentParagraphIndex(0);
    setShowTranslation(true);
    setReaderMode('ai');
    setStatusMessage(`已生成 AI JSON 缓存草稿：${document.items.length} 段。`);
  }

  async function handleSaveAiCache(): Promise<void> {
    if (!translationDocument || translationDocument.kind !== 'json') {
      setStatusMessage('当前没有 JSON 缓存可保存。');
      return;
    }

    try {
      setIsAiBusy(true);
      await saveAiCacheDocument(translationDocument);
    } catch (error) {
      setStatusMessage(`保存 AI JSON 失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }

  async function handleTranslateCurrentWithAi(force = false): Promise<void> {
    const document = ensureJsonDocumentForAi();
    if (!document) {
      return;
    }

    const index = Math.min(currentParagraphIndex, document.items.length - 1);
    const item = document.items[index];
    if (!item) {
      setStatusMessage('当前没有可翻译的段落。');
      return;
    }

    try {
      setIsAiBusy(true);
      let workingDocument = await ensureAiCacheSaved(document);
      if (!workingDocument) {
        return;
      }

      if (!force && !shouldTranslateItem(item)) {
        setStatusMessage('当前段已有缓存译文，未重复调用 API。');
        return;
      }

      setStatusMessage(`AI 正在翻译第 ${index + 1} 段...`);
      const result = await window.electronAPI.translateWithAi({
        section: item.section,
        original: item.original,
        translation: item.translation,
        type: item.type,
        sourceHash: item.sourceHash,
        force
      });

      workingDocument = applyAiResultToDocument(workingDocument, index, result);
      setTranslationDocument(workingDocument);
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

        setCurrentParagraphIndex(index);
        setStatusMessage(`AI 正在翻译第 ${index + 1} / ${workingDocument.items.length} 段...`);
        const result = await window.electronAPI.translateWithAi({
          section: item.section,
          original: item.original,
          translation: item.translation,
          type: item.type,
          sourceHash: item.sourceHash
        });

        workingDocument = applyAiResultToDocument(workingDocument, index, result);
        setTranslationDocument(workingDocument);
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
    if (translationDocument?.kind === 'json') {
      return translationDocument;
    }

    if (extractedPdfBlocks.length === 0) {
      setStatusMessage('AI 模式需要 JSON 翻译文件，或先从 PDF 文本层生成 JSON 缓存。');
      return null;
    }

    const document = buildAiCacheDocument(extractedPdfBlocks, pdf?.fileName, translationDocument);
    setTranslationDocument(document);
    setCurrentParagraphIndex(0);
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

    const savedDocument = applySavedTranslationPath(document, result);
    setTranslationDocument(savedDocument);
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
      setTranslationDocument(applySavedTranslationPath(document, result));
    }
  }

  function applySavedTranslationPath(
    document: TranslationDocument,
    result: SaveTextResult
  ): TranslationDocument {
    const savedDocument = {
      ...document,
      sourcePath: result.filePath,
      sourceName: result.fileName
    };

    if (activePaperId) {
      setPaperLibrary((library) =>
        library.map((paper) =>
          paper.id === activePaperId
            ? updatePaperRecord(paper, {
                translationPath: result.filePath,
                translationName: result.fileName,
                lastOpenedAt: new Date().toISOString()
              })
            : paper
        )
      );
    }

    return savedDocument;
  }

  function applyAiResultToDocument(
    document: TranslationDocument,
    index: number,
    result: AiTranslateResult
  ): TranslationDocument {
    return {
      ...document,
      items: document.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              translation: result.translation,
              translatedAt: result.translatedAt,
              provider: result.provider,
              model: result.model
            }
          : item
      )
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

  if (view === 'home') {
    return (
      <div className="app-shell home-shell">
        <HomePage
          papers={paperLibrary}
          onNewProject={handleNewProject}
          onOpenPaper={handleOpenPaper}
          onUpdatePaper={(paper) =>
            setPaperLibrary((library) => library.map((item) => (item.id === paper.id ? paper : item)))
          }
          onRemovePaper={(paper) =>
            setPaperLibrary((library) => library.filter((item) => item.id !== paper.id))
          }
        />
        <footer className="status-bar">{statusMessage}</footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toolbar
        currentPage={currentPage}
        pageCount={pageCount}
        scale={scale}
        onGoHome={() => setView('home')}
        onNewProject={handleNewProject}
        onOpenPdf={handleOpenPdf}
        onOpenTranslation={handleOpenTranslation}
        onSaveTranslation={handleSaveTranslation}
        onExportBilingualMarkdown={handleExportBilingualMarkdown}
        onZoomIn={() => setScale((value) => Math.min(2.4, Number((value + 0.1).toFixed(2))))}
        onZoomOut={() => setScale((value) => Math.max(0.6, Number((value - 0.1).toFixed(2))))}
        onPreviousPage={() => handlePageChange(currentPage - 1)}
        onNextPage={() => handlePageChange(currentPage + 1)}
        onPageChange={handlePageChange}
      />

      <main className="split-layout">
        <section className="pdf-pane">
          <PdfViewer
            pdfData={pdf?.data ?? null}
            fileName={pdf?.fileName}
            currentPage={currentPage}
            scale={scale}
            highlightText={
              readerMode === 'manual' && translationDocument?.kind === 'json'
                ? buildPdfHighlightQuery(currentItem?.original ?? '')
                : ''
            }
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
        </section>

        <section className="translation-pane">
          <div className="side-panel">
            <div className="mode-tabs">
              <button
                type="button"
                className={readerMode === 'manual' ? 'mode-tab active' : 'mode-tab'}
                onClick={() => setReaderMode('manual')}
              >
                手动模式
              </button>
              <button
                type="button"
                className={readerMode === 'ai' ? 'mode-tab active' : 'mode-tab'}
                onClick={() => setReaderMode('ai')}
              >
                AI 模式
              </button>
            </div>
            {readerMode === 'manual' ? (
              <TranslationPanel
                document={translationDocument}
                currentIndex={currentParagraphIndex}
                showTranslation={showTranslation}
                isEditing={isEditing}
                editingText={editingText}
                onEditingTextChange={setEditingText}
                onPrevious={handlePreviousParagraph}
                onShowTranslation={handleShowTranslation}
                onNext={handleNextParagraph}
                onStartEdit={handleStartEdit}
                onApplyEdit={handleApplyEdit}
                onCancelEdit={() => {
                  setIsEditing(false);
                  setEditingText('');
                }}
                onCopyCurrentPrompt={handleCopyCurrentPrompt}
                onCopyFullPrompt={handleCopyFullPrompt}
              />
            ) : (
              <AiModePanel
                document={translationDocument}
                extractedBlocks={extractedPdfBlocks}
                currentIndex={currentParagraphIndex}
                aiSettings={aiSettings}
                aiForm={aiForm}
                isBusy={isAiBusy}
                onProviderChange={handleProviderChange}
                onAiFormChange={handleAiFormChange}
                onSaveSettings={handleSaveAiSettings}
                onBuildCache={handleBuildAiCacheDocument}
                onSaveCache={handleSaveAiCache}
                onTranslateCurrent={handleTranslateCurrentWithAi}
                onTranslatePending={handleTranslatePendingWithAi}
                onSelectItem={(index) => {
                  setCurrentParagraphIndex(index);
                  setShowTranslation(true);
                  setIsEditing(false);
                }}
              />
            )}
          </div>
        </section>
      </main>

      <footer className="status-bar">{statusMessage}</footer>
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
