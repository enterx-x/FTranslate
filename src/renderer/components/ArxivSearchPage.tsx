import { useMemo, useState } from 'react';
import { type ArxivPaper, type ArxivSearchRequest, type ArxivSortBy } from '../lib/arxivClient';
import searchIcon from '../assets/icons/duotone/search.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import type { PdfFilePayload } from '../types/electron';

interface ArxivSearchPageProps {
  onBackHome: () => void;
  onDownloadedPaper: (paper: ArxivPaper, payload: PdfFilePayload) => void;
}

const CATEGORY_OPTIONS = [
  { value: '', label: '全部分类' },
  { value: 'cs.RO', label: 'cs.RO 机器人' },
  { value: 'cs.AI', label: 'cs.AI 人工智能' },
  { value: 'cs.LG', label: 'cs.LG 机器学习' },
  { value: 'eess.SY', label: 'eess.SY 系统与控制' }
];

const SORT_OPTIONS: Array<{ value: ArxivSortBy; label: string }> = [
  { value: 'relevance', label: '相关性' },
  { value: 'submittedDate', label: '提交时间' },
  { value: 'lastUpdatedDate', label: '更新时间' }
];

export function ArxivSearchPage(props: ArxivSearchPageProps) {
  const [query, setQuery] = useState('reinforcement learning robot navigation');
  const [category, setCategory] = useState('cs.RO');
  const [sortBy, setSortBy] = useState<ArxivSortBy>('relevance');
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [message, setMessage] = useState(
    'arXiv 检索只在点击“搜索”时触发；结果由主进程 ArxivService 串行请求并写入 SQLite 缓存。'
  );
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const request = useMemo<ArxivSearchRequest>(
    () => ({
      searchQuery: query.trim(),
      category,
      start: 0,
      maxResults: 12,
      sortBy,
      sortOrder: 'descending'
    }),
    [category, query, sortBy]
  );

  async function handleSearch(): Promise<void> {
    if (!request.searchQuery) {
      setMessage('请输入关键词后再搜索。');
      return;
    }

    try {
      setIsSearching(true);
      setMessage('正在排队调用 arXiv 官方 Atom API...');
      const result = await window.electronAPI.searchArxiv(request);
      setPapers(result.papers);
      if (result.cacheHit) {
        setMessage(`已使用 SQLite 缓存结果：${result.papers.length} 篇。`);
      } else {
        setMessage(
          result.papers.length > 0
            ? `检索完成：${result.papers.length} 篇。队列长度 ${result.queueSize}，距上次真实请求 ${formatGap(result.lastRequestGapMs)}。`
            : '没有找到匹配论文。'
        );
      }
    } catch (error) {
      setMessage(`arXiv 检索失败：${formatError(error)}`);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDownload(paper: ArxivPaper): Promise<void> {
    try {
      setDownloadingId(paper.id);
      setMessage(`正在排队下载 ${paper.stableId} PDF...`);
      const payload = await window.electronAPI.downloadArxivPdf({
        pdfUrl: paper.pdfUrl,
        defaultFileName: `${paper.stableId}-${sanitizeFileStem(paper.title)}.pdf`
      });
      if (!payload) {
        setMessage('已取消 arXiv PDF 下载。');
        return;
      }
      props.onDownloadedPaper(paper, payload);
      setMessage(`已下载并加入论文库：${payload.fileName}`);
    } catch (error) {
      setMessage(`下载 arXiv PDF 失败：${formatError(error)}`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <main className="arxiv-page page-workspace">
      <header className="page-header compact-page-header">
        <div>
          <span className="eyebrow">Official arXiv API</span>
          <h1>arXiv 检索</h1>
          <p>只负责搜索、单篇下载并加入本地论文库；PPT 生成只读取用户已选择的本地 PDF。</p>
        </div>
        <button type="button" className="secondary-button" onClick={props.onBackHome}>
          返回工作台
        </button>
      </header>

      <section className="content-card arxiv-search-card">
        <div className="toolbar-group arxiv-search-bar">
          <label>
            <span>关键词</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="safe RL robot navigation"
            />
          </label>
          <label>
            <span>分类</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>排序</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as ArxivSortBy)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button button-with-icon"
            disabled={isSearching}
            onClick={handleSearch}
          >
            <img className="button-icon" src={searchIcon} alt="" />
            <span>{isSearching ? '搜索中' : '搜索'}</span>
          </button>
        </div>
        <p className="inline-hint">{message}</p>
      </section>

      <section className="arxiv-results-grid">
        {papers.length === 0 ? (
          <article className="empty-state content-card">
            <h2>暂无检索结果</h2>
            <p>输入关键词后点击“搜索”。下载完成的 PDF 会进入本地论文库，之后可手动打开阅读或生成组会 PPT。</p>
          </article>
        ) : (
          papers.map((paper) => (
            <article key={paper.id} className="content-card arxiv-paper-card">
              <div className="arxiv-paper-meta">
                <span className="badge accent-badge">{paper.stableId}</span>
                {paper.categories.slice(0, 3).map((item) => (
                  <span key={item} className="badge">
                    {item}
                  </span>
                ))}
              </div>
              <h2>{paper.title}</h2>
              <p className="arxiv-authors">{paper.authors.join(', ') || 'arXiv 未返回作者'}</p>
              <p className="arxiv-summary">{paper.summary}</p>
              <footer className="arxiv-card-actions">
                <a className="secondary-button" href={paper.abstractUrl} target="_blank" rel="noreferrer">
                  arXiv 页面
                </a>
                <button
                  type="button"
                  className="primary-button button-with-icon"
                  disabled={downloadingId === paper.id}
                  onClick={() => void handleDownload(paper)}
                >
                  <img className="button-icon" src={downloadIcon} alt="" />
                  <span>{downloadingId === paper.id ? '下载中' : '下载并入库'}</span>
                </button>
              </footer>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '_').replace(/\s+/gu, '-').slice(0, 72) || 'arxiv-paper';
}

function formatGap(value: number): string {
  return value < 0 ? '首次请求' : `${Math.round(value)} ms`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
