import { useEffect, useMemo, useRef, useState } from 'react';
import { PdfViewer } from '../components/PdfViewer';
import { extractPdfBlocksFromData } from '../lib/pdfOutlineExtraction';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import { translateAcademicText } from './mobileTranslation';
import type {
  MobilePaper,
  MobileTranslationEntry,
  MobileTranslationSession
} from './mobileTypes';

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
  const displayedPdf = mode === 'translated' && translatedPdfData ? translatedPdfData : pdfData;

  async function handleTranslateBlock(block: ExtractedPdfBlock): Promise<void> {
    if (!translationSession.apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    setTranslatingHash(block.sourceHash);
    setStatus(`正在翻译第 ${block.page} 页段落…`);
    try {
      const translation = await translateAcademicText(block.original, translationSession);
      await onSaveTranslation({
        sourceHash: block.sourceHash,
        page: block.page,
        original: block.original,
        translation,
        translatedAt: new Date().toISOString(),
        model: translationSession.model
      });
      setStatus('译文已写入对应英文段落下方，并缓存在本机。');
    } catch (error) {
      setStatus(`翻译失败：${formatError(error)}`);
    } finally {
      setTranslatingHash(null);
    }
  }

  async function handleTranslatePage(): Promise<void> {
    if (!translationSession.apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    const missing = currentBlocks.filter(
      (block) => !translationByHash.has(block.sourceHash) && block.original.length <= 6000
    );
    for (const block of missing) {
      await handleTranslateBlock(block);
    }
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
      setSelectionPopover({
        text,
        left: Math.max(12, Math.min(window.innerWidth - 292, rect?.left ?? 12)),
        top: Math.max(74, (rect?.bottom ?? 80) + 8)
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
            <span>{translatedCount} / {currentBlocks.length} 段已有译文</span>
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
                    {!cached ? (
                      <button type="button" disabled={Boolean(translatingHash)} onClick={() => void handleTranslateBlock(block)}>
                        {translatingHash === block.sourceHash ? '翻译中…' : '翻译此段'}
                      </button>
                    ) : null}
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
        <aside className="mobile-selection-popover" style={{ left: selectionPopover.left, top: selectionPopover.top }}>
          <button type="button" className="mobile-selection-close" onClick={() => setSelectionPopover(null)}>×</button>
          <strong>{selectionPopover.text}</strong>
          {selectionPopover.translation ? <p>{selectionPopover.translation}</p> : null}
          {selectionPopover.error ? <p className="is-error">{selectionPopover.error}</p> : null}
          {!selectionPopover.translation ? <button type="button" disabled={selectionPopover.loading} onClick={() => void translateSelection()}>{selectionPopover.loading ? '翻译中…' : '翻译选中文本'}</button> : null}
        </aside>
      ) : null}

      {settingsOpen ? (
        <TranslationSettingsDialog
          session={translationSession}
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

function TranslationSettingsDialog({
  session,
  onClose,
  onSave
}: {
  session: MobileTranslationSession;
  onClose: () => void;
  onSave: (session: MobileTranslationSession) => Promise<void>;
}) {
  const [form, setForm] = useState(session);
  return (
    <div className="mobile-dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="mobile-translation-dialog" role="dialog" aria-modal="true" aria-label="翻译设置" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-dialog-handle" />
        <header><strong>段落翻译设置</strong><button type="button" onClick={onClose}>关闭</button></header>
        <p>支持允许浏览器访问的 OpenAI 兼容接口。API Key 只保存在当前网页内存，刷新或关闭网页后不会写入设备。</p>
        <label>Base URL<input value={form.baseURL} onChange={(event) => setForm((value) => ({ ...value, baseURL: event.target.value }))} /></label>
        <label>Model<input value={form.model} onChange={(event) => setForm((value) => ({ ...value, model: event.target.value }))} /></label>
        <label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm((value) => ({ ...value, apiKey: event.target.value }))} placeholder="仅本次会话" /></label>
        <button type="button" className="mobile-dialog-primary" onClick={() => void onSave(form)}>保存并返回阅读</button>
      </section>
    </div>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
