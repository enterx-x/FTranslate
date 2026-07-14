import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArxivPaper } from '../../shared/arxiv';
import { MobileArxivScreen } from './MobileArxivScreen';
import { MobileBottomNav, type MobileView } from './MobileBottomNav';
import { MobileLibraryScreen } from './MobileLibraryScreen';
import { MobileReaderScreen } from './MobileReaderScreen';
import {
  downloadPdfFile,
  loadMobileLibrary,
  loadPaperTranslations,
  loadTranslationPreferences,
  readPdfBytes,
  removeStoredPaper,
  saveMobileLibrary,
  savePaperTranslations,
  savePdfFile,
  saveTranslationPreferences
} from './mobileStorage';
import {
  createArxivMobilePaper,
  createImportedMobilePaper,
  createLocalPaperId,
  mergeTranslationEntry,
  updateMobilePaper,
  upsertMobilePaper,
  type MobilePaper,
  type MobileTranslationEntry,
  type MobileTranslationSession
} from './mobileTypes';
import './mobile.css';

export default function MobileApp() {
  const [view, setView] = useState<MobileView>('library');
  const [library, setLibrary] = useState<MobilePaper[]>([]);
  const libraryRef = useRef<MobilePaper[]>([]);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [translatedPdfData, setTranslatedPdfData] = useState<Uint8Array | null>(null);
  const [translations, setTranslations] = useState<MobileTranslationEntry[]>([]);
  const [translationSession, setTranslationSession] = useState<MobileTranslationSession>({
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: ''
  });
  const [busy, setBusy] = useState(false);
  const [savingPaperId, setSavingPaperId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const activePaper = useMemo(
    () => (activePaperId ? library.find((paper) => paper.id === activePaperId) ?? null : null),
    [activePaperId, library]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadMobileLibrary(), loadTranslationPreferences()])
      .then(([storedLibrary, preferences]) => {
        if (!cancelled) {
          setLibrary(storedLibrary);
          libraryRef.current = storedLibrary;
          setTranslationSession((session) => ({ ...session, ...preferences }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice(`读取当前设备资料失败：${formatError(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commitLibrary = useCallback(async (updater: (current: MobilePaper[]) => MobilePaper[]) => {
    const nextLibrary = updater(libraryRef.current);
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    await saveMobileLibrary(nextLibrary);
    return nextLibrary;
  }, []);

  const handleOpenPaper = useCallback(async (paper: MobilePaper) => {
    setBusy(true);
    setNotice(`正在打开 ${paper.title}…`);
    try {
      const [sourceBytes, translatedBytes, cachedTranslations] = await Promise.all([
        readPdfBytes(paper.sourcePdf),
        paper.translatedPdf ? readPdfBytes(paper.translatedPdf) : Promise.resolve(null),
        loadPaperTranslations(paper.id)
      ]);
      setPdfData(sourceBytes);
      setTranslatedPdfData(translatedBytes);
      setTranslations(cachedTranslations);
      setActivePaperId(paper.id);
      await commitLibrary((current) => updateMobilePaper(current, paper.id, { lastOpenedAt: new Date().toISOString() }));
      setView('reader');
      setNotice('');
    } catch (error) {
      setNotice(`打开 PDF 失败：${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [commitLibrary]);

  async function handleImportPdf(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setNotice('只能导入 PDF 文件。');
      return;
    }
    setBusy(true);
    try {
      const paperId = createLocalPaperId(file.name, file.size, file.lastModified);
      const storedPdf = await savePdfFile({ paperId, file, kind: 'source' });
      const paper = createImportedMobilePaper({ id: paperId, fileName: file.name, storedPdf });
      const nextLibrary = await commitLibrary((current) => upsertMobilePaper(current, paper));
      await handleOpenPaper(nextLibrary.find((item) => item.id === paperId) ?? paper);
    } catch (error) {
      setNotice(`导入 PDF 失败：${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveArxivPaper(paper: ArxivPaper): Promise<void> {
    setSavingPaperId(paper.stableId);
    setNotice(`正在下载 arXiv:${paper.stableId}…`);
    try {
      const paperId = `arxiv-${paper.stableId.replace(/[^a-z0-9._-]+/giu, '-')}`;
      const storedPdf = await downloadPdfFile({
        paperId,
        url: paper.pdfUrl,
        fileName: `${paper.stableId}-${paper.title.slice(0, 72)}.pdf`
      });
      const mobilePaper = createArxivMobilePaper({ paper, storedPdf });
      const nextLibrary = await commitLibrary((current) => upsertMobilePaper(current, mobilePaper));
      await handleOpenPaper(nextLibrary.find((item) => item.id === mobilePaper.id) ?? mobilePaper);
    } catch (error) {
      setNotice(`保存 arXiv 论文失败：${formatError(error)}`);
    } finally {
      setSavingPaperId(null);
    }
  }

  async function handleImportTranslatedPdf(file: File): Promise<void> {
    if (!activePaper) {
      return;
    }
    setBusy(true);
    try {
      const translatedPdf = await savePdfFile({ paperId: activePaper.id, file, kind: 'translated' });
      const nextLibrary = await commitLibrary((current) => updateMobilePaper(current, activePaper.id, { translatedPdf }));
      setTranslatedPdfData(await readPdfBytes(translatedPdf));
      setNotice(`已绑定双语 PDF：${file.name}`);
      const updated = nextLibrary.find((paper) => paper.id === activePaper.id);
      if (updated) {
        setActivePaperId(updated.id);
      }
    } catch (error) {
      setNotice(`导入双语 PDF 失败：${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePaper(paper: MobilePaper): Promise<void> {
    if (!window.confirm(`从本机论文库移除“${paper.title}”？这会删除当前浏览器中的 PDF 和翻译缓存。`)) {
      return;
    }
    setBusy(true);
    try {
      await removeStoredPaper(paper.id);
      await commitLibrary((current) => current.filter((item) => item.id !== paper.id));
      if (activePaperId === paper.id) {
        setActivePaperId(null);
        setPdfData(null);
        setTranslatedPdfData(null);
        setTranslations([]);
      }
    } catch (error) {
      setNotice(`移除论文失败：${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTranslation(entry: MobileTranslationEntry): Promise<void> {
    if (!activePaper) {
      return;
    }
    const next = mergeTranslationEntry(translations, entry);
    setTranslations(next);
    await savePaperTranslations(activePaper.id, next);
  }

  const handleProgressChange = useCallback((page: number, pageCount: number) => {
    if (!activePaperId) {
      return;
    }
    setLibrary((current) => {
      const next = updateMobilePaper(current, activePaperId, { lastPage: page, pageCount });
      libraryRef.current = next;
      void saveMobileLibrary(next);
      return next;
    });
  }, [activePaperId]);

  async function handleTranslationSessionChange(session: MobileTranslationSession): Promise<void> {
    setTranslationSession(session);
    await saveTranslationPreferences({ baseURL: session.baseURL, model: session.model });
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
          />
        ) : null}
        {view === 'search' ? <MobileArxivScreen savingPaperId={savingPaperId} onSavePaper={handleSaveArxivPaper} /> : null}
        {view === 'reader' && activePaper && pdfData ? (
          <MobileReaderScreen
            paper={activePaper}
            pdfData={pdfData}
            translatedPdfData={translatedPdfData}
            translations={translations}
            translationSession={translationSession}
            onBack={() => setView('library')}
            onImportTranslatedPdf={handleImportTranslatedPdf}
            onProgressChange={handleProgressChange}
            onSaveTranslation={handleSaveTranslation}
            onTranslationSessionChange={handleTranslationSessionChange}
          />
        ) : null}
      </main>

      {view !== 'reader' ? (
        <MobileBottomNav view={view} readerEnabled={Boolean(activePaper && pdfData)} onChange={setView} />
      ) : null}

      {notice ? <div className="mobile-global-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')}>×</button></div> : null}
    </div>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
