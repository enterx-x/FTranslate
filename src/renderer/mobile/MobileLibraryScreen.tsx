import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeMobilePaperTags, type MobilePaper } from './mobileTypes';

interface MobileLibraryScreenProps {
  papers: MobilePaper[];
  activePaperId: string | null;
  busy: boolean;
  onImportPdf: (file: File) => Promise<void>;
  onOpenPaper: (paper: MobilePaper) => Promise<void>;
  onRemovePaper: (paper: MobilePaper) => Promise<void>;
  onUpdatePaper: (
    paperId: string,
    updates: Pick<MobilePaper, 'customTitle' | 'tags'>
  ) => Promise<void>;
}

export function MobileLibraryScreen({
  papers,
  activePaperId,
  busy,
  onImportPdf,
  onOpenPaper,
  onRemovePaper,
  onUpdatePaper
}: MobileLibraryScreenProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [editingPaper, setEditingPaper] = useState<MobilePaper | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [editorError, setEditorError] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);
  const visiblePapers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...papers].sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
    if (!needle) {
      return sorted;
    }
    return sorted.filter((paper) =>
      [paper.customTitle, paper.title, paper.titleZh, paper.authors.join(' '), paper.year, paper.arxivId, paper.tags.join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [papers, query]);
  const continuePaper = visiblePapers.find((paper) => paper.id === activePaperId) ?? visiblePapers[0];
  const bilingualCount = papers.filter((paper) => paper.translatedPdf).length;

  useEffect(() => {
    if (editingPaper && !papers.some((paper) => paper.id === editingPaper.id)) {
      setEditingPaper(null);
    }
  }, [editingPaper, papers]);

  function openEditor(paper: MobilePaper): void {
    setEditingPaper(paper);
    setTitleDraft(displayPaperTitle(paper));
    setTagsDraft(paper.tags.join('，'));
    setEditorError('');
  }

  async function saveEditor(): Promise<void> {
    if (!editingPaper) return;
    const title = titleDraft.trim();
    if (!title) {
      setEditorError('论文名称不能为空。');
      return;
    }
    const sourceDisplayTitle = editingPaper.titleZh || editingPaper.title;
    const tags = normalizeMobilePaperTags(tagsDraft.split(/[,，;；\n]+/gu));
    setEditorBusy(true);
    setEditorError('');
    try {
      await onUpdatePaper(editingPaper.id, {
        customTitle: title === sourceDisplayTitle ? undefined : title,
        tags
      });
      setEditingPaper(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setEditorBusy(false);
    }
  }

  return (
    <section className="mobile-screen mobile-library-screen" aria-label="本地论文库">
      <header className="mobile-screen-header">
        <div>
          <strong>论文库</strong>
          <span>仅保存在当前浏览器</span>
        </div>
        <button type="button" className="mobile-square-button" disabled={busy} onClick={() => inputRef.current?.click()} aria-label="导入 PDF">
          ＋
        </button>
        <input
          ref={inputRef}
          className="mobile-hidden-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = '';
            if (file) {
              void onImportPdf(file);
            }
          }}
        />
      </header>

      <div className="mobile-screen-scroll">
        <div className="mobile-library-summary">
          <strong>{papers.length}</strong>
          <span>{bilingualCount} 篇绑定双语 PDF</span>
        </div>

        {continuePaper ? (
          <button type="button" className="mobile-continue-paper" onClick={() => void onOpenPaper(continuePaper)}>
            <span>继续阅读 · 第 {continuePaper.lastPage}{continuePaper.pageCount ? ` / ${continuePaper.pageCount}` : ''} 页</span>
            <strong>{displayPaperTitle(continuePaper)}</strong>
            <i style={{ '--mobile-reading-progress': `${Math.min(100, Math.max(4, (continuePaper.lastPage / Math.max(continuePaper.pageCount ?? continuePaper.lastPage, 1)) * 100))}%` } as React.CSSProperties} />
          </button>
        ) : (
          <div className="mobile-library-empty">
            <strong>先放入第一篇论文</strong>
            <p>从“文件”导入 PDF，或前往 arXiv 检索并保存到当前 Safari。</p>
            <button type="button" onClick={() => inputRef.current?.click()}>导入本地 PDF</button>
          </div>
        )}

        {papers.length > 0 ? (
          <label className="mobile-library-filter">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者或 arXiv ID" />
          </label>
        ) : null}

        <div className="mobile-section-heading">
          <strong>最近论文</strong>
          <span>{visiblePapers.length} 篇</span>
        </div>

        <div className="mobile-paper-list">
          {visiblePapers.map((paper) => (
            <article key={paper.id} className="mobile-paper-row">
              <button type="button" className="mobile-paper-main" onClick={() => void onOpenPaper(paper)}>
                <span className="mobile-paper-mark">{paper.translatedPdf ? '中英' : 'PDF'}</span>
                <span className="mobile-paper-copy">
                  <strong>{displayPaperTitle(paper)}</strong>
                  {displayPaperTitle(paper) !== paper.title ? <em>{paper.title}</em> : null}
                  {paper.tags.length ? (
                    <span className="mobile-paper-tags">
                      {paper.tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}
                      {paper.tags.length > 3 ? <i>+{paper.tags.length - 3}</i> : null}
                    </span>
                  ) : null}
                  <small className={`mobile-paper-ocr is-${paper.localOcrStatus ?? 'pending'}`}>
                    {formatPaperOcrStatus(paper)}
                  </small>
                  <small>{formatPaperMeta(paper)}</small>
                </span>
                <span className="mobile-paper-chevron" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="mobile-paper-manage"
                aria-label={`管理 ${displayPaperTitle(paper)}`}
                onClick={() => openEditor(paper)}
              >
                管理
              </button>
            </article>
          ))}
        </div>
      </div>

      {editingPaper ? (
        <div className="mobile-dialog-backdrop" role="presentation" onClick={() => !editorBusy && setEditingPaper(null)}>
          <section className="mobile-translation-dialog mobile-paper-editor-dialog" role="dialog" aria-modal="true" aria-label="管理论文" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-dialog-handle" />
            <header>
              <strong>管理论文</strong>
              <button type="button" disabled={editorBusy} onClick={() => setEditingPaper(null)}>关闭</button>
            </header>
            <p>名称和标签只保存在当前浏览器，不会修改原始 PDF。</p>
            <label>
              显示名称
              <input maxLength={120} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
            </label>
            <label>
              标签
              <input value={tagsDraft} onChange={(event) => setTagsDraft(event.target.value)} placeholder="例如：强化学习，CBF，待读" />
            </label>
            <small className="mobile-paper-editor-hint">用逗号分隔，最多保存 12 个标签。</small>
            {editorError ? <p className="mobile-dialog-error" role="alert">{editorError}</p> : null}
            <div className="mobile-paper-editor-actions">
              <button
                type="button"
                className="mobile-paper-editor-delete"
                disabled={editorBusy}
                onClick={() => void onRemovePaper(editingPaper)}
              >
                删除论文
              </button>
              <button type="button" className="mobile-dialog-primary" disabled={editorBusy} onClick={() => void saveEditor()}>
                {editorBusy ? '保存中…' : '保存修改'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function displayPaperTitle(paper: MobilePaper): string {
  return paper.customTitle || paper.titleZh || paper.title;
}

function formatPaperMeta(paper: MobilePaper): string {
  const authors = paper.authors.slice(0, 2).join(', ');
  return [authors, paper.year, paper.pageCount ? `${paper.pageCount} 页` : '', paper.arxivId ? `arXiv:${paper.arxivId}` : '本地导入']
    .filter(Boolean)
    .join(' · ');
}

function formatPaperOcrStatus(paper: MobilePaper): string {
  if (paper.localOcrStatus === 'completed') {
    return `OCR 已完成${paper.pageCount ? ` · ${paper.pageCount} 页` : ''} · 可手动全文翻译`;
  }
  if (paper.localOcrStatus === 'failed') {
    return 'OCR 失败 · 打开论文后可从断点继续';
  }
  if (paper.localOcrStatus === 'running') {
    return `正在本机 OCR · ${paper.visionOcrLastPage ?? 0}${paper.pageCount ? ` / ${paper.pageCount}` : ''} 页`;
  }
  return '等待本机全文 OCR · 不会自动翻译';
}
