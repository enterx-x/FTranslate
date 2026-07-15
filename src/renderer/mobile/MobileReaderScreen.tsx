import { useEffect, useMemo, useRef, useState } from 'react';
import { PdfViewer } from '../components/PdfViewer';
import { extractPdfBlocksFromData } from '../lib/pdfOutlineExtraction';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import { MobileTranslationSettingsDialog } from './MobileTranslationSettingsDialog';
import { translateAcademicText } from './mobileTranslation';
import type {
  MobilePaper,
  MobileTranslationEntry,
  MobileTranslationSession
} from './mobileTypes';
import { isTranslationEntryCurrent } from './mobileTypes';

type MobileReaderMode = 'bilingual' | 'pdf' | 'translated';

interface MobileReaderScreenProps {
  paper: MobilePaper;
  pdfData: Uint8Array;
  translatedPdfData: Uint8Array | null;
  translations: MobileTranslationEntry[];
  translationSession: MobileTranslationSession;
  onBack: () => void;
  onImportTranslatedPdf: (file: File) => Promise<void>;
  onProgressChange: (page: number, pageCount: number) => void;
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
  translatedPdfData,
  translations,
  translationSession,
  onBack,
  onImportTranslatedPdf,
  onProgressChange,
  onSaveTranslation,
  onTranslationSessionChange
}: MobileReaderScreenProps) {
  const translatedInputRef = useRef<HTMLInputElement | null>(null);
  const bilingualPageRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<MobileReaderMode>('bilingual');
  const [currentPage, setCurrentPage] = useState(Math.max(1, paper.lastPage));
  const [pageCount, setPageCount] = useState(Math.max(0, paper.pageCount ?? 0));
  const [scale, setScale] = useState(1);
  const [blocks, setBlocks] = useState<ExtractedPdfBlock[]>([]);
  const [extracting, setExtracting] = useState(true);
  const [status, setStatus] = useState('正在解析 PDF 段落…');
  const [translatingHash, setTranslatingHash] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setExtracting(true);
    setStatus('正在解析 PDF 段落…');
    void extractPdfBlocksFromData(pdfData, () => cancelled)
      .then((nextBlocks) => {
        if (!cancelled) {
          setBlocks(nextBlocks);
          setPageCount((count) => Math.max(count, ...nextBlocks.map((block) => block.page), 1));
          setExtracting(false);
          setStatus(nextBlocks.length ? `已识别 ${nextBlocks.length} 个论文段落` : '没有识别到可重排段落，可切换到原始 PDF 阅读。');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setExtracting(false);
          setStatus(`段落解析失败：${formatError(error)}`);
          setMode('pdf');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdfData]);

  useEffect(() => {
    onProgressChange(currentPage, pageCount);
  }, [currentPage, onProgressChange, pageCount]);

  const translationByHash = useMemo(
    () => new Map(translations.map((entry) => [entry.sourceHash, entry])),
    [translations]
  );
  const currentBlocks = useMemo(
    () => blocks.filter((block) => block.page === currentPage && block.original.trim()),
    [blocks, currentPage]
  );
  const translatedCount = currentBlocks.filter((block) => translationByHash.has(block.sourceHash)).length;
  const staleTranslationCount = currentBlocks.filter((block) => {
    const cached = translationByHash.get(block.sourceHash);
    return Boolean(cached && !isTranslationEntryCurrent(cached, translationSession));
  }).length;
  const displayedPdf = mode === 'translated' && translatedPdfData ? translatedPdfData : pdfData;

  async function handleTranslateBlock(block: ExtractedPdfBlock, updateStatus = true): Promise<boolean> {
    if (!translationSession.apiKey.trim()) {
      setSettingsOpen(true);
      return false;
    }
    setTranslatingHash(block.sourceHash);
    if (updateStatus) {
      setStatus(`正在翻译第 ${block.page} 页段落…`);
    }
    try {
      const translation = await translateAcademicText(block.original, translationSession);
      await onSaveTranslation({
        sourceHash: block.sourceHash,
        page: block.page,
        original: block.original,
        translation,
        translatedAt: new Date().toISOString(),
        model: translationSession.model,
        baseURL: translationSession.baseURL.trim().replace(/\/+$/u, '')
      });
      if (updateStatus) {
        setStatus('译文已写入对应英文段落下方，并缓存在本机。');
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

  async function handleTranslatePage(): Promise<void> {
    if (!translationSession.apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    const targets = currentBlocks.filter((block) => {
      const cached = translationByHash.get(block.sourceHash);
      return !cached || !isTranslationEntryCurrent(cached, translationSession);
    });
    if (targets.length === 0) {
      setStatus('本页译文均由当前翻译配置生成，无需更新。');
      return;
    }
    let succeeded = 0;
    for (const block of targets) {
      if (await handleTranslateBlock(block, false)) {
        succeeded += 1;
      }
    }
    const failed = targets.length - succeeded;
    setStatus(failed > 0
      ? `本页翻译完成：成功 ${succeeded} 段，失败 ${failed} 段；可单独重试失败段落。`
      : `本页 ${succeeded} 个段落已使用当前配置翻译并缓存。`);
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

  async function translateSelection(): Promise<void> {
    if (!selectionPopover) {
      return;
    }
    if (!translationSession.apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    setSelectionPopover({ ...selectionPopover, loading: true, error: undefined });
    try {
      const translation = await translateAcademicText(selectionPopover.text, translationSession);
      setSelectionPopover({ ...selectionPopover, translation, loading: false });
    } catch (error) {
      setSelectionPopover({ ...selectionPopover, loading: false, error: formatError(error) });
    }
  }

  return (
    <section className="mobile-screen mobile-reader-screen" aria-label="PDF 阅读与翻译">
      <header className="mobile-reader-header">
        <button type="button" className="mobile-reader-back" onClick={onBack} aria-label="返回论文库">‹</button>
        <div>
          <strong>{paper.titleZh || paper.title}</strong>
          <span>第 {currentPage}{pageCount ? ` / ${pageCount}` : ''} 页</span>
        </div>
        <button type="button" className="mobile-reader-more" onClick={() => setSettingsOpen(true)} aria-label="翻译设置">•••</button>
      </header>

      <div className="mobile-reader-mode-bar" role="group" aria-label="阅读模式">
        <button type="button" className={mode === 'bilingual' ? 'active' : ''} onClick={() => setMode('bilingual')}>段落双语</button>
        <button type="button" className={mode === 'pdf' ? 'active' : ''} onClick={() => setMode('pdf')}>原始 PDF</button>
        <button type="button" className={mode === 'translated' ? 'active' : ''} disabled={!translatedPdfData} onClick={() => setMode('translated')}>双语 PDF</button>
      </div>

      {mode === 'bilingual' ? (
        <div className="mobile-bilingual-reader">
          <div className="mobile-bilingual-toolbar">
            <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>上一页</button>
            <span>{translatedCount} / {currentBlocks.length} 段已有译文{staleTranslationCount ? ` · ${staleTranslationCount} 段待更新` : ''}</span>
            <button type="button" disabled={currentBlocks.length === 0 || Boolean(translatingHash)} onClick={() => void handleTranslatePage()}>翻译本页</button>
          </div>
          <div
            ref={bilingualPageRef}
            className="mobile-bilingual-page"
            onPointerUp={captureSelection}
            onTouchEnd={captureSelection}
          >
            {extracting ? <div className="mobile-reader-loading">正在识别当前论文的段落结构…</div> : null}
            {!extracting && currentBlocks.length === 0 ? (
              <div className="mobile-reader-loading">本页没有识别到正文段落。可切换到“原始 PDF”，或翻到其他页面。</div>
            ) : null}
            {currentBlocks.map((block) => {
              const cached = translationByHash.get(block.sourceHash);
              return (
                <article key={block.id} className={`mobile-bilingual-block is-${block.type}`}>
                  <div className="mobile-block-original">
                    {block.type === 'heading' ? <h2>{block.original}</h2> : <p>{block.original}</p>}
                    <button type="button" disabled={Boolean(translatingHash)} onClick={() => void handleTranslateBlock(block)}>
                      {translatingHash === block.sourceHash
                        ? '翻译中…'
                        : cached
                          ? isTranslationEntryCurrent(cached, translationSession) ? '重新翻译' : '用当前配置重译'
                          : '翻译此段'}
                    </button>
                  </div>
                  {cached ? (
                    <div className="mobile-block-translation">
                      <span>中文</span>
                      <p>{cached.translation}</p>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <div className="mobile-bilingual-pagination">
            <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>上一页</button>
            <span>{currentPage} / {pageCount || '?'}</span>
            <button type="button" disabled={Boolean(pageCount) && currentPage >= pageCount} onClick={() => setCurrentPage((page) => Math.min(pageCount || page + 1, page + 1))}>下一页</button>
          </div>
        </div>
      ) : (
        <div className="mobile-pdf-reader">
          <div className="mobile-pdf-toolbar">
            <button type="button" onClick={() => setScale((value) => Math.max(0.65, value - 0.1))}>－</button>
            <span>{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => setScale((value) => Math.min(2.4, value + 0.1))}>＋</button>
            {mode === 'translated' ? <em>已导入双语 PDF</em> : null}
          </div>
          <PdfViewer
            pdfData={displayedPdf}
            fileName={mode === 'translated' ? paper.translatedPdf?.fileName : paper.sourcePdf.fileName}
            currentPage={currentPage}
            scale={scale}
            onScaleChange={setScale}
            onDocumentLoad={(count) => setPageCount(count)}
            onCurrentPageChange={setCurrentPage}
            onStatusChange={setStatus}
          />
        </div>
      )}

      <footer className="mobile-reader-status"><span>{status}</span><button type="button" onClick={() => translatedInputRef.current?.click()}>导入双语 PDF</button></footer>
      <input
        ref={translatedInputRef}
        className="mobile-hidden-input"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) {
            void onImportTranslatedPdf(file);
          }
        }}
      />

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
          title="段落翻译设置"
          submitLabel="保存并返回阅读"
          onClose={() => setSettingsOpen(false)}
          onSave={async (next) => {
            await onTranslationSessionChange(next);
            setSettingsOpen(false);
            setStatus('翻译设置已更新；API Key 仅保留在本次运行会话。');
          }}
        />
      ) : null}
    </section>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
