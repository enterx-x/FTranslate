import { useMemo, useRef, useState } from 'react';
import type { MobilePaper } from './mobileTypes';

interface MobileLibraryScreenProps {
  papers: MobilePaper[];
  activePaperId: string | null;
  busy: boolean;
  onImportPdf: (file: File) => Promise<void>;
  onOpenPaper: (paper: MobilePaper) => Promise<void>;
  onRemovePaper: (paper: MobilePaper) => Promise<void>;
}

export function MobileLibraryScreen({
  papers,
  activePaperId,
  busy,
  onImportPdf,
  onOpenPaper,
  onRemovePaper
}: MobileLibraryScreenProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const visiblePapers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...papers].sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
    if (!needle) {
      return sorted;
    }
    return sorted.filter((paper) =>
      [paper.title, paper.titleZh, paper.authors.join(' '), paper.year, paper.arxivId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [papers, query]);
  const continuePaper = visiblePapers.find((paper) => paper.id === activePaperId) ?? visiblePapers[0];
  const chinesePdfCount = papers.filter((paper) => paper.translatedPdf).length;

  return (
    <section className="mobile-screen mobile-library-screen" aria-label="本地论文库">
      <header className="mobile-screen-header">
        <div>
          <strong>论文库</strong>
          <span>仅保存在这台设备</span>
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
          <span>{chinesePdfCount} 篇绑定中文 PDF</span>
        </div>

        {continuePaper ? (
          <button type="button" className="mobile-continue-paper" onClick={() => void onOpenPaper(continuePaper)}>
            <span>继续阅读 · 第 {continuePaper.lastPage}{continuePaper.pageCount ? ` / ${continuePaper.pageCount}` : ''} 页</span>
            <strong>{continuePaper.titleZh || continuePaper.title}</strong>
            <i style={{ '--mobile-reading-progress': `${Math.min(100, Math.max(4, (continuePaper.lastPage / Math.max(continuePaper.pageCount ?? continuePaper.lastPage, 1)) * 100))}%` } as React.CSSProperties} />
          </button>
        ) : (
          <div className="mobile-library-empty">
            <strong>先放入第一篇论文</strong>
            <p>从“文件”导入 PDF，或前往 arXiv 检索并下载到本机。</p>
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
                  <strong>{paper.titleZh || paper.title}</strong>
                  {paper.titleZh ? <em>{paper.title}</em> : null}
                  <small>{formatPaperMeta(paper)}</small>
                </span>
                <span className="mobile-paper-chevron" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="mobile-paper-remove"
                aria-label={`移除 ${paper.title}`}
                onClick={() => void onRemovePaper(paper)}
              >
                移除
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatPaperMeta(paper: MobilePaper): string {
  const authors = paper.authors.slice(0, 2).join(', ');
  return [authors, paper.year, paper.pageCount ? `${paper.pageCount} 页` : '', paper.arxivId ? `arXiv:${paper.arxivId}` : '本地导入']
    .filter(Boolean)
    .join(' · ');
}
