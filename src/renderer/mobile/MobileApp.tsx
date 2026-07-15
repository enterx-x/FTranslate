import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import type { ArxivPaper } from '../../shared/arxiv';
import { MobileArxivScreen, type MobileArxivTranslation } from './MobileArxivScreen';
import { MobileBottomNav, type MobileView } from './MobileBottomNav';
import { MobileLibraryScreen } from './MobileLibraryScreen';
import { MobileReaderScreen } from './MobileReaderScreen';
import {
  downloadPdfFile,
  loadMobileLibrary,
  loadPaperTranslations,
  loadTranslationPreferences,
  readPdfBytes,
  removeStoredPdfFile,
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
  isMobilePaperSourceEquivalent,
  mergeTranslationEntry,
  updateMobilePaper,
  upsertMobilePaper,
  type MobilePaper,
  type MobileTranslationEntry,
  type MobileTranslationSession
} from './mobileTypes';
import './mobile.css';

function MobileApp() {
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
  const downloadAbortRef = useRef<AbortController | null>(null);

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
      const existing = libraryRef.current.find((paper) => paper.id === paperId);
      const storedPdf = await savePdfFile({ paperId, file, kind: 'source' });
      const paper = createImportedMobilePaper({ id: paperId, fileName: file.name, storedPdf });
      const nextLibrary = await commitLibrary((current) => upsertMobilePaper(current, paper));
      const cleanupWarning = await clearReplacedSourceData(existing, paper);
      await handleOpenPaper(nextLibrary.find((item) => item.id === paperId) ?? paper);
      if (cleanupWarning) {
        setNotice(cleanupWarning);
      }
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
      if (cleanupWarning) {
        setNotice(cleanupWarning);
      }
    } catch (error) {
      setNotice(`保存 arXiv 论文失败：${formatError(error)}`);
    } finally {
      if (downloadAbortRef.current === abortController) {
        downloadAbortRef.current = null;
      }
      setSavingPaperId(null);
    }
  }

  async function handleImportTranslatedPdf(file: File): Promise<void> {
    if (!activePaper) {
      return;
    }
    setBusy(true);
    try {
      const previousTranslatedPdf = activePaper.translatedPdf;
      const translatedPdf = await savePdfFile({ paperId: activePaper.id, file, kind: 'translated' });
      const nextLibrary = await commitLibrary((current) => updateMobilePaper(current, activePaper.id, { translatedPdf }));
      setTranslatedPdfData(await readPdfBytes(translatedPdf));
      setNotice(`已绑定双语 PDF：${file.name}`);
      const updated = nextLibrary.find((paper) => paper.id === activePaper.id);
      if (updated) {
        setActivePaperId(updated.id);
      }
      if (previousTranslatedPdf && previousTranslatedPdf.path !== translatedPdf.path) {
        await removeStoredPdfFile(previousTranslatedPdf);
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
      await commitLibrary((current) => current.filter((item) => item.id !== paper.id));
      if (activePaperId === paper.id) {
        setActivePaperId(null);
        setPdfData(null);
        setTranslatedPdfData(null);
        setTranslations([]);
      }
      try {
        await removeStoredPaper(paper.id);
        setNotice('论文已从当前浏览器移除。');
      } catch (cleanupError) {
        setNotice(`论文已移除，但部分本地文件未能清理：${formatError(cleanupError)}`);
      }
    } catch (error) {
      setNotice(`移除论文失败：${formatError(error)}`);
    } finally {
      setBusy(false);
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
    if (!session.baseURL.trim() || !session.model.trim()) {
      throw new Error('Base URL 和 Model 不能为空。');
    }
    setTranslationSession(session);
    await saveTranslationPreferences({ baseURL: session.baseURL, model: session.model });
  }

  async function clearReplacedSourceData(existing: MobilePaper | undefined, incoming: MobilePaper): Promise<string> {
    if (!existing || isMobilePaperSourceEquivalent(existing, incoming)) {
      return '';
    }
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
