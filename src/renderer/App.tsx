import { useEffect, useMemo, useState } from 'react';
import { HomePage } from './components/HomePage';
import { PdfViewer } from './components/PdfViewer';
import { Toolbar } from './components/Toolbar';
import { TranslationPanel } from './components/TranslationPanel';
import {
  exportBilingualMarkdown,
  parseTranslationFile,
  serializeTranslationDocument,
  updateTranslationAtIndex,
  type TranslationDocument
} from './lib/translation';
import {
  buildPaperRecord,
  PAPER_LIBRARY_KEY,
  parsePaperLibrary,
  serializePaperLibrary,
  updatePaperRecord,
  upsertPaperRecord,
  type PaperRecord
} from './lib/papers';
import type { PdfFilePayload, TextFilePayload } from './types/electron';

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

const RECENT_PROJECT_KEY = 'pdfTranslationReader:lastProject';

export default function App() {
  const [view, setView] = useState<AppView>('home');
  const [paperLibrary, setPaperLibrary] = useState<PaperRecord[]>(() =>
    parsePaperLibrary(localStorage.getItem(PAPER_LIBRARY_KEY))
  );
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [translationDocument, setTranslationDocument] = useState<TranslationDocument | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [statusMessage, setStatusMessage] = useState('请在论文库中新建或打开一个翻译项目。');

  const currentItem = translationDocument?.items[currentParagraphIndex] ?? null;

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
            onDocumentLoad={(nextPageCount) => {
              setPageCount(nextPageCount);
              setCurrentPage((page) => Math.min(Math.max(1, page), nextPageCount));
            }}
            onCurrentPageChange={(page) => {
              setCurrentPage((current) => (current === page ? current : page));
            }}
            onStatusChange={setStatusMessage}
          />
        </section>

        <section className="translation-pane">
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
          />
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
