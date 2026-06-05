import { useMemo, useState } from 'react';
import {
  ARXIV_RATE_LIMIT_COOLDOWN_MS,
  buildArxivApiUrl,
  buildArxivCacheKey,
  buildArxivHttpErrorMessage,
  buildArxivRateLimitMessage,
  isArxivRateLimitStatus,
  parseArxivAtomFeed,
  type ArxivPaper,
  type ArxivSearchRequest,
  type ArxivSortBy
} from '../lib/arxivClient';
import searchIcon from '../assets/icons/duotone/search.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import type { PdfFilePayload } from '../types/electron';

interface ArxivSearchPageProps {
  onBackHome: () => void;
  onDownloadedPaper: (paper: ArxivPaper, payload: PdfFilePayload) => void;
}

const ARXIV_CACHE_KEY = 'pdfTranslationReader:arxivSearchCache:v1';
const ARXIV_RATE_LIMIT_KEY = 'pdfTranslationReader:arxivRateLimitUntil:v1';
const ARXIV_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedArxivSearch {
  createdAt: number;
  papers: ArxivPaper[];
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
    'arXiv 检索独立于 PPT：先下载 PDF 加入本地论文库，再手动进入阅读或 PPT 生成。'
  );
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [rateLimitUntil, setRateLimitUntil] = useState(readRateLimitUntil);

  const request = useMemo<ArxivSearchRequest>(
    () => ({
      query,
      category,
      maxResults: 12,
      sortBy,
      sortOrder: 'descending'
    }),
    [category, query, sortBy]
  );

  const isRateLimited = Date.now() < rateLimitUntil;

  async function handleSearch(): Promise<void> {
    if (!query.trim()) {
      setMessage('请输入关键词后再检索。');
      return;
    }

    const cacheKey = buildArxivCacheKey(request);
    const cached = readCachedSearch(cacheKey);
    if (cached) {
      setPapers(cached);
      setMessage(`已使用本地缓存结果：${cached.length} 篇。`);
      return;
    }

    const now = Date.now();
    if (now < rateLimitUntil) {
      const stale = readCachedSearch(cacheKey, true);
      if (stale) {
        setPapers(stale);
        setMessage(`${buildArxivRateLimitMessage(rateLimitUntil, now)} 已显示上次缓存的 ${stale.length} 篇结果。`);
        return;
      }
      setMessage(buildArxivRateLimitMessage(rateLimitUntil, now));
      return;
    }

    try {
      setIsSearching(true);
      setMessage('正在调用 arXiv 官方 Atom API 检索...');
      const response = await fetch(buildArxivApiUrl(request));
      if (!response.ok) {
        if (isArxivRateLimitStatus(response.status)) {
          const retryAt = Date.now() + ARXIV_RATE_LIMIT_COOLDOWN_MS;
          writeRateLimitUntil(retryAt);
          setRateLimitUntil(retryAt);
          const stale = readCachedSearch(cacheKey, true);
          if (stale) {
            setPapers(stale);
            setMessage(`${buildArxivRateLimitMessage(retryAt)} 已显示上次缓存的 ${stale.length} 篇结果。`);
            return;
          }
          setMessage(buildArxivRateLimitMessage(retryAt));
          return;
        }
        throw new Error(buildArxivHttpErrorMessage(response.status, response.statusText));
      }

      const xml = await response.text();
      const nextPapers = parseArxivAtomFeed(xml);
      setPapers(nextPapers);
      writeCachedSearch(cacheKey, nextPapers);
      setMessage(nextPapers.length > 0 ? `检索完成：${nextPapers.length} 篇。` : '没有找到匹配论文。');
    } catch (error) {
      setMessage(`arXiv 检索失败：${String(error)}`);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDownload(paper: ArxivPaper): Promise<void> {
    try {
      setDownloadingId(paper.id);
      setMessage(`正在下载 ${paper.id} PDF...`);
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
      setMessage(`下载 arXiv PDF 失败：${String(error)}`);
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
          <p>只负责搜索、下载和加入本地论文库；PPT 生成仍然只读取本地 PDF。</p>
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
            <span>{isSearching ? '检索中' : isRateLimited ? '稍后再试' : '检索'}</span>
          </button>
        </div>
        <p className="inline-hint">{message}</p>
      </section>

      <section className="arxiv-results-grid">
        {papers.length === 0 ? (
          <article className="empty-state content-card">
            <h2>暂无检索结果</h2>
            <p>
              输入关键词后点击“检索”。下载完成的 PDF 会进入本地论文库，之后可手动打开阅读或生成组会 PPT。
            </p>
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

function readCachedSearch(key: string, allowStale = false): ArxivPaper[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARXIV_CACHE_KEY) ?? '{}') as Record<string, CachedArxivSearch>;
    const entry = parsed[key];
    if (!entry) {
      return null;
    }
    if (!allowStale && Date.now() - entry.createdAt > ARXIV_CACHE_TTL_MS) {
      return null;
    }
    return entry.papers;
  } catch {
    return null;
  }
}

function writeCachedSearch(key: string, papers: ArxivPaper[]): void {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARXIV_CACHE_KEY) ?? '{}') as Record<string, CachedArxivSearch>;
    parsed[key] = { createdAt: Date.now(), papers };
    localStorage.setItem(ARXIV_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // 缓存只用于减少重复请求，失败不影响检索结果。
  }
}

function readRateLimitUntil(): number {
  const value = Number(localStorage.getItem(ARXIV_RATE_LIMIT_KEY) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function writeRateLimitUntil(value: number): void {
  localStorage.setItem(ARXIV_RATE_LIMIT_KEY, String(value));
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '_').replace(/\s+/gu, '-').slice(0, 72) || 'arxiv-paper';
}
