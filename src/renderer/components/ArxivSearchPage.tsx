import { useMemo, useState } from 'react';
import {
  type ArxivPaper,
  type ArxivSearchRequest,
  type ArxivSortBy,
  type ArxivSortOrder
} from '../lib/arxivClient';
import {
  type ArxivPaperMeta,
  buildArxivBibTeX,
  buildArxivExportMarkdown,
  buildArxivPaperInsight,
  formatArxivResultRange
} from '../lib/arxivUi';
import searchIcon from '../assets/icons/duotone/search.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import translateIcon from '../assets/icons/duotone/translate.svg';
import analysisIcon from '../assets/icons/duotone/analysis.svg';
import saveIcon from '../assets/icons/duotone/save.svg';
import type { PdfFilePayload } from '../types/electron';

interface ArxivSearchPageProps {
  onBackHome: () => void;
  onDownloadedPaper: (paper: ArxivPaper, payload: PdfFilePayload) => void;
}

type SearchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
export type LayoutMode = 'compact' | 'standard' | 'wide';
export type AbstractMode = 'en' | 'zh';

export interface ArxivResultDisplay {
  title: string;
  secondaryTitle: string;
  abstractText: string;
  abstractMode: AbstractMode;
}

export interface ArxivResultDensityConfig {
  className: string;
  summaryLines: number;
}

export interface ArxivQueuedPaper {
  stableId: string;
  title: string;
  titleZh?: string;
  summary: string;
  abstractZh?: string;
  authors: string[];
  publishedAt: string;
  updated: string;
  categories: string[];
  primaryCategory: string;
  abstractUrl: string;
  pdfUrl: string;
  addedAt: string;
}

const ARXIV_META_STORAGE_KEY = 'pdfTranslationReader:arxivPaperMeta';
const ARXIV_HISTORY_STORAGE_KEY = 'pdfTranslationReader:arxivSearchHistory';
const ARXIV_LAYOUT_STORAGE_KEY = 'pdfTranslationReader:arxivLayoutMode';
const ARXIV_PPT_QUEUE_STORAGE_KEY = 'pdfTranslationReader:arxivPptQueue';
const ARXIV_READING_QUEUE_STORAGE_KEY = 'pdfTranslationReader:arxivReadingQueue';
const OFFLINE_TRANSLATION_NOTICE_TITLE = '离线翻译未配置';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const CATEGORY_OPTIONS = [
  { value: '', label: '全部分类' },
  { value: 'cs.RO', label: 'cs.RO 机器人' },
  { value: 'cs.AI', label: 'cs.AI 人工智能' },
  { value: 'cs.LG', label: 'cs.LG 机器学习' },
  { value: 'cs.CV', label: 'cs.CV 视觉' },
  { value: 'eess.SY', label: 'eess.SY 系统与控制' }
];

const SORT_OPTIONS: Array<{ value: ArxivSortBy; label: string }> = [
  { value: 'relevance', label: '相关性' },
  { value: 'submittedDate', label: '提交时间' },
  { value: 'lastUpdatedDate', label: '更新时间' }
];

const SORT_ORDER_OPTIONS: Array<{ value: ArxivSortOrder; label: string }> = [
  { value: 'descending', label: '降序' },
  { value: 'ascending', label: '升序' }
];

const LAYOUT_OPTIONS: Array<{ value: LayoutMode; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽屏' }
];

export function getArxivResultDisplay(
  paper: ArxivPaper,
  meta: ArxivPaperMeta,
  requestedMode?: AbstractMode
): ArxivResultDisplay {
  const abstractMode: AbstractMode = requestedMode ?? (meta.abstractZh ? 'zh' : 'en');
  return {
    title: meta.titleZh || paper.title,
    secondaryTitle: meta.titleZh ? paper.title : '',
    abstractText: abstractMode === 'zh' && meta.abstractZh ? meta.abstractZh : paper.summary,
    abstractMode
  };
}

export function getArxivResultDensityConfig(layoutMode: LayoutMode): ArxivResultDensityConfig {
  if (layoutMode === 'compact') {
    return { className: 'arxiv-density-compact', summaryLines: 2 };
  }
  if (layoutMode === 'wide') {
    return { className: 'arxiv-density-wide', summaryLines: 4 };
  }
  return { className: 'arxiv-density-standard', summaryLines: 3 };
}

export function ArxivSearchPage(props: ArxivSearchPageProps) {
  const [query, setQuery] = useState('reinforcement learning robot navigation');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<ArxivSortBy>('relevance');
  const [sortOrder, setSortOrder] = useState<ArxivSortOrder>('descending');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [start, setStart] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [metaById, setMetaById] = useState<Record<string, ArxivPaperMeta>>(() => loadArxivMeta());
  const [history, setHistory] = useState<string[]>(() => loadStringList(ARXIV_HISTORY_STORAGE_KEY));
  const [pptQueue, setPptQueue] = useState<string[]>(() => loadStringList(ARXIV_PPT_QUEUE_STORAGE_KEY));
  const [readingQueue, setReadingQueue] = useState<ArxivQueuedPaper[]>(() => loadArxivReadingQueue());
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => loadLayoutMode());
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [abstractModes, setAbstractModes] = useState<Record<string, AbstractMode>>({});
  const [yearFilter, setYearFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [queuedOnly, setQueuedOnly] = useState(false);
  const [translatedOnly, setTranslatedOnly] = useState(false);
  const [scoredOnly, setScoredOnly] = useState(false);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [message, setMessage] = useState(
    '点击“搜索”才会访问 arXiv；输入关键词不会自动请求，避免触发官方限流。'
  );
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [backgroundTranslatingIds, setBackgroundTranslatingIds] = useState<Record<string, boolean>>({});
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [showOfflineTranslationHelp, setShowOfflineTranslationHelp] = useState(false);

  const request = useMemo<ArxivSearchRequest>(
    () => ({
      searchQuery: query.trim(),
      category,
      start,
      maxResults: pageSize,
      sortBy,
      sortOrder,
      yearFrom,
      yearTo
    }),
    [category, pageSize, query, sortBy, sortOrder, start, yearFrom, yearTo]
  );

  const availableYears = useMemo(() => {
    const years = Array.from(
      new Set(papers.map((paper) => getYear(paper.publishedAt || paper.published)).filter(Boolean))
    );
    return years.sort((a, b) => Number(b) - Number(a));
  }, [papers]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    papers.forEach((paper) => {
      const meta = getPaperMeta(paper, metaById);
      const insight = meta.insight ?? buildArxivPaperInsight(paper, query);
      insight.tags.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags);
  }, [metaById, papers, query]);

  const filteredPapers = useMemo(
    () =>
      papers.filter((paper) => {
        const meta = getPaperMeta(paper, metaById);
        const insight = meta.insight ?? buildArxivPaperInsight(paper, query);
        const isQueuedForReading = readingQueue.some((item) => item.stableId === paper.stableId);
        const year = getYear(paper.publishedAt || paper.published);
        if (yearFilter !== 'all' && year !== yearFilter) {
          return false;
        }
        if (tagFilter !== 'all' && !insight.tags.includes(tagFilter)) {
          return false;
        }
        if (favoriteOnly && !meta.favorite) {
          return false;
        }
        if (queuedOnly && !isQueuedForReading) {
          return false;
        }
        if (translatedOnly && !meta.abstractZh) {
          return false;
        }
        if (scoredOnly && !meta.insight) {
          return false;
        }
        return true;
      }),
    [favoriteOnly, metaById, papers, query, queuedOnly, readingQueue, scoredOnly, tagFilter, translatedOnly, yearFilter]
  );

  const selectedPaper = useMemo(
    () => filteredPapers.find((paper) => paper.id === selectedPaperId) ?? filteredPapers[0] ?? null,
    [filteredPapers, selectedPaperId]
  );

  async function handleSearch(nextStart = 0): Promise<void> {
    const searchQuery = query.trim();
    if (!searchQuery) {
      setMessage('请输入关键词后再搜索。');
      setStatus('error');
      return;
    }

    const nextRequest: ArxivSearchRequest = {
      ...request,
      searchQuery,
      start: nextStart
    };

    try {
      setIsSearching(true);
      setStatus('loading');
      setMessage('正在通过 ArxivService 排队访问官方 Atom API；关键词会匹配标题和摘要。');
      const result = await window.electronAPI.searchArxiv(nextRequest);
      setStart(nextStart);
      setPapers(result.papers);
      setTotalResults(result.totalResults ?? result.papers.length);
      setSelectedPaperId(result.papers[0]?.id ?? null);
      setHistory((previous) => saveStringList(ARXIV_HISTORY_STORAGE_KEY, [searchQuery, ...previous]));
      if (result.papers.length === 0) {
        setStatus('empty');
        setMessage('没有找到匹配论文。可以换一个关键词，或放宽分类条件。');
        return;
      }
      setStatus('success');
      const rangeText = formatArxivResultRange(nextStart, result.papers.length, result.totalResults ?? result.papers.length);
      void queueOfflineTranslations(result.papers);
      if (result.cacheHit) {
        setMessage(`已命中 SQLite 缓存：${rangeText}。未访问 arXiv。`);
      } else {
        setMessage(
          `检索完成：${rangeText}。关键词已匹配标题/摘要，队列长度 ${result.queueSize}，距上次真实请求 ${formatGap(
            result.lastRequestGapMs
          )}。`
        );
      }
    } catch (error) {
      setStatus('error');
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

  async function handleTranslateAbstract(paper: ArxivPaper): Promise<void> {
    const currentMeta = getPaperMeta(paper, metaById);
    if (currentMeta.abstractZh && currentMeta.titleZh) {
      setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
      setMessage('当前论文标题和摘要已有中文缓存，已切换到中文摘要。');
      return;
    }

    try {
      setTranslatingId(paper.id);
      setMessage('正在使用本地 Argos 翻译标题和摘要，并写入 SQLite 缓存；此操作不会调用 AI API。');
      const result = await translatePaperMetadata(paper);
      if (result?.status === 'completed' || result?.status === 'cached') {
        setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
        setMessage(result.message);
      } else if (result?.status === 'unavailable') {
        setStatus('error');
        setShowOfflineTranslationHelp(true);
      }
    } catch (error) {
      setMessage(`标题/摘要本地翻译失败，已保留英文：${formatError(error)}`);
    } finally {
      setTranslatingId(null);
    }
  }

  async function queueOfflineTranslations(nextPapers: ArxivPaper[]): Promise<void> {
    const missing = nextPapers.filter((paper) => {
      const meta = getPaperMeta(paper, metaById);
      return !meta.titleZh || !meta.abstractZh;
    });
    if (missing.length === 0) {
      return;
    }

    for (const paper of missing) {
      setBackgroundTranslatingIds((previous) => ({ ...previous, [paper.id]: true }));
      try {
        const result = await translatePaperMetadata(paper, true);
        if (result?.status === 'unavailable') {
          setStatus('error');
          setShowOfflineTranslationHelp(true);
          setMessage(result.message);
          break;
        }
      } finally {
        setBackgroundTranslatingIds((previous) => {
          const next = { ...previous };
          delete next[paper.id];
          return next;
        });
      }
    }
  }

  async function translatePaperMetadata(paper: ArxivPaper, silent = false) {
    const result = await window.electronAPI.translateArxivTitleAbstract({
      stableId: paper.stableId,
      title: paper.title,
      summary: paper.summary,
      targetLanguage: 'zh'
    });
    if (result.status === 'completed' || result.status === 'cached') {
      patchMeta(paper, {
        titleZh: result.titleZh,
        abstractZh: result.abstractZh,
        translatedAt: result.translatedAt ?? new Date().toISOString()
      });
      if (!silent) {
        setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
      }
      return result;
    }
    if (!silent) {
      setMessage(result.message);
    }
    return result;
  }

  function handleScorePaper(paper: ArxivPaper): void {
    const insight = buildArxivPaperInsight(paper, query);
    updateMeta(paper, {
      ...getPaperMeta(paper, metaById),
      insight,
      scoredAt: new Date().toISOString()
    });
    setMessage(`已完成本地启发式评分：${insight.totalScore}/100，优先级 ${translatePriority(insight.readingPriority)}。`);
  }

  function handleToggleFavorite(paper: ArxivPaper): void {
    const currentMeta = getPaperMeta(paper, metaById);
    updateMeta(paper, {
      ...currentMeta,
      favorite: !currentMeta.favorite
    });
  }

  function handleToggleReadingQueue(paper: ArxivPaper): void {
    const currentMeta = getPaperMeta(paper, metaById);
    const isQueued = readingQueue.some((item) => item.stableId === paper.stableId);
    if (isQueued) {
      const { queuedAt: _queuedAt, ...nextMeta } = currentMeta;
      updateMeta(paper, nextMeta);
      setReadingQueue((previous) => saveArxivReadingQueue(previous.filter((item) => item.stableId !== paper.stableId)));
      setMessage(`已从备选论文库移出：${paper.stableId}。`);
      return;
    }

    const addedAt = new Date().toISOString();
    updateMeta(paper, {
      ...currentMeta,
      queuedAt: addedAt
    });
    setReadingQueue((previous) =>
      saveArxivReadingQueue(upsertArxivQueuedPaper(previous, buildArxivQueuedPaper(paper, currentMeta, addedAt)))
    );
    setMessage(`已加入备选论文库：${paper.stableId}。下载 PDF 后可正式进入本地论文库。`);
  }

  function handleTogglePptQueue(paper: ArxivPaper): void {
    setPptQueue((previous) => {
      const next = previous.includes(paper.stableId)
        ? previous.filter((id) => id !== paper.stableId)
        : [...previous, paper.stableId];
      saveRawStringList(ARXIV_PPT_QUEUE_STORAGE_KEY, next);
      return next;
    });
    setMessage('已更新 arXiv 论文 PPT 候选队列。实际生成 PPT 仍只读取已下载或用户选择的本地 PDF。');
  }

  async function handleExportMarkdown(paper: ArxivPaper): Promise<void> {
    try {
      setExportingId(paper.id);
      const meta = getPaperMeta(paper, metaById);
      const result = await window.electronAPI.saveTextFile({
        content: buildArxivExportMarkdown(paper, meta),
        defaultFileName: `${paper.stableId}-${sanitizeFileStem(paper.title)}.md`,
        extension: 'md'
      });
      setMessage(result ? `已导出 Markdown：${result.fileName}` : '已取消 Markdown 导出。');
    } catch (error) {
      setMessage(`导出 Markdown 失败：${formatError(error)}`);
    } finally {
      setExportingId(null);
    }
  }

  async function handleCopy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`已复制${label}。`);
    } catch (error) {
      setMessage(`复制失败：${formatError(error)}`);
    }
  }

  function updateMeta(paper: ArxivPaper, nextMeta: ArxivPaperMeta): void {
    setMetaById((previous) => {
      const next = { ...previous, [paper.stableId]: nextMeta };
      saveArxivMeta(next);
      return next;
    });
  }

  function patchMeta(paper: ArxivPaper, patch: Partial<ArxivPaperMeta>): void {
    setMetaById((previous) => {
      const nextMeta = { ...(previous[paper.stableId] ?? {}), ...patch };
      const next = { ...previous, [paper.stableId]: nextMeta };
      saveArxivMeta(next);
      return next;
    });
  }

  const selectedMeta = selectedPaper ? getPaperMeta(selectedPaper, metaById) : {};
  const selectedInsight = selectedPaper
    ? selectedMeta.insight ?? buildArxivPaperInsight(selectedPaper, query)
    : null;
  const selectedAbstractMode = selectedPaper
    ? abstractModes[selectedPaper.id] ?? (selectedMeta.abstractZh ? 'zh' : 'en')
    : 'en';
  const resultDensity = getArxivResultDensityConfig(layoutMode);
  const isOfflineTranslationNotice = message.includes(OFFLINE_TRANSLATION_NOTICE_TITLE);

  return (
    <main className="arxiv-page page-workspace">
      <header className="page-header compact-page-header arxiv-page-header">
        <div>
          <span className="eyebrow">Official arXiv API</span>
          <h1>arXiv 检索</h1>
          <p>检索、筛选、翻译摘要、评分和加入 PPT 候选队列。PPT 生成仍只读取本地 PDF。</p>
        </div>
        <button type="button" className="secondary-button" onClick={props.onBackHome}>
          返回工作台
        </button>
      </header>

      <section className="content-card arxiv-search-card">
        <div className="arxiv-query-row">
          <label className="arxiv-query-input">
            <span>关键词</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="标题/摘要关键词，例如 reinforcement learning robot navigation"
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
          <label>
            <span>顺序</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as ArxivSortOrder)}>
              {SORT_ORDER_OPTIONS.map((option) => (
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
            onClick={() => void handleSearch(0)}
          >
            <img className="button-icon" src={searchIcon} alt="" />
            <span>{isSearching ? '搜索中' : '搜索'}</span>
          </button>
        </div>

        <div className="arxiv-query-options">
          <label>
            <span>起始年份</span>
            <input
              value={yearFrom}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => setYearFrom(normalizeYearInput(event.target.value))}
              placeholder="不限"
            />
          </label>
          <label>
            <span>结束年份</span>
            <input
              value={yearTo}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => setYearTo(normalizeYearInput(event.target.value))}
              placeholder={String(new Date().getFullYear())}
            />
          </label>
          <label>
            <span>每页返回</span>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <p className="arxiv-query-hints">
            搜索会同时匹配 title 和 abstract；年份范围会写入 arXiv API 的 submittedDate。为避免再次触发限流，
            不做自动无限抓取，可把每页设为 200 后用“下一页”继续浏览全部结果。
          </p>
        </div>

        <div className={`arxiv-message is-${status}`}>
          <span>{message}</span>
          {isOfflineTranslationNotice ? (
            <div className="arxiv-history">
              <button
                type="button"
                className="pill-button"
                onClick={() => setShowOfflineTranslationHelp((value) => !value)}
              >
                查看安装说明
              </button>
              <button
                type="button"
                className="pill-button"
                disabled={!selectedPaper || translatingId === selectedPaper.id}
                onClick={() => selectedPaper && void handleTranslateAbstract(selectedPaper)}
              >
                稍后重试
              </button>
            </div>
          ) : null}
          {isOfflineTranslationNotice && showOfflineTranslationHelp ? (
            <div className="inline-hint">
              Windows 推荐先创建独立 Python 环境，再安装 Argos Translate CLI 和 en→zh 模型。README 中的
              “arXiv 离线翻译配置”有完整命令；安装完成后重启应用或重新打开终端，确认
              <code>argos-translate</code> 可以在 PATH 中运行。
            </div>
          ) : null}
          {history.length > 0 ? (
            <div className="arxiv-history">
              {history.slice(0, 5).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="pill-button"
                  onClick={() => {
                    setQuery(item);
                    setMessage(`已填入历史关键词：${item}。点击搜索后才会请求 arXiv。`);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className={`arxiv-workbench arxiv-layout-${layoutMode}`}>
        <aside className="content-card arxiv-filter-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Filters</span>
              <h2>筛选与视图</h2>
            </div>
            <span className="badge">{filteredPapers.length}/{papers.length}</span>
          </div>

          <label>
            <span>页内年份</span>
            <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
              <option value="all">全部年份</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>标签</span>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="all">全部标签</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>

          <div className="arxiv-checkbox-stack">
            <label>
              <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
              <span>只看收藏</span>
            </label>
            <label>
              <input type="checkbox" checked={queuedOnly} onChange={(event) => setQueuedOnly(event.target.checked)} />
              <span>只看备选论文</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={translatedOnly}
                onChange={(event) => setTranslatedOnly(event.target.checked)}
              />
              <span>只看已翻译摘要</span>
            </label>
            <label>
              <input type="checkbox" checked={scoredOnly} onChange={(event) => setScoredOnly(event.target.checked)} />
              <span>只看已评分</span>
            </label>
          </div>

          <div className="arxiv-layout-switch">
            {LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={layoutMode === option.value ? 'segmented-active' : ''}
                onClick={() => {
                  setLayoutMode(option.value);
                  window.localStorage.setItem(ARXIV_LAYOUT_STORAGE_KEY, option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="arxiv-pagination-card">
            <span className="eyebrow">Pagination</span>
            <label>
              <span>每页</span>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <div className="arxiv-pagination-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={isSearching || start <= 0}
                onClick={() => void handleSearch(Math.max(0, start - pageSize))}
              >
                上一页
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={isSearching || start + papers.length >= totalResults}
                onClick={() => void handleSearch(start + pageSize)}
              >
                下一页
              </button>
            </div>
            <p className="inline-hint">
              {papers.length > 0
                ? `当前显示 ${formatArxivResultRange(
                    start,
                    papers.length,
                    totalResults
                  )}。可继续翻页查看全部结果；翻页同样走 ArxivService 队列和 SQLite 缓存。`
                : '可把每页设为 200 后继续翻页查看更多结果；翻页同样走 ArxivService 队列和 SQLite 缓存。'}
            </p>
          </div>
        </aside>

        <section className={`content-card arxiv-results-panel ${resultDensity.className}`}>
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Results</span>
              <h2>论文列表</h2>
            </div>
            <div className="arxiv-count-badges">
              <span className="badge accent-badge">PPT 候选 {pptQueue.length}</span>
              <span className="badge success-badge">备选论文 {readingQueue.length}</span>
            </div>
          </div>

          {readingQueue.length > 0 ? (
            <div className="arxiv-reading-queue-mini">
              <div>
                <strong>备选论文库</strong>
                <span>{readingQueue.length} 篇待下载或复核</span>
              </div>
              <div className="arxiv-reading-queue-items">
                {readingQueue.slice(0, 4).map((item) => (
                  <button
                    key={item.stableId}
                    type="button"
                    className="pill-button"
                    title={item.title}
                    onClick={() => {
                      setQuery(item.title);
                      setMessage(`已填入备选论文标题：${item.title}。点击搜索可重新定位该论文。`);
                    }}
                  >
                    {item.titleZh || item.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {papers.length === 0 ? (
            <article className="empty-state arxiv-empty-card">
              <h3>{status === 'loading' ? '正在检索' : '暂无检索结果'}</h3>
              <p>输入关键词后点击“搜索”。下载完成的 PDF 会进入本地论文库，再用于阅读、翻译或生成组会 PPT。</p>
            </article>
          ) : filteredPapers.length === 0 ? (
            <article className="empty-state arxiv-empty-card">
              <h3>当前筛选下没有结果</h3>
              <p>可以关闭收藏/翻译/评分筛选，或改用更宽的年份和标签条件。</p>
            </article>
          ) : (
            <div className="arxiv-results-list">
              {filteredPapers.map((paper) => {
              const meta = getPaperMeta(paper, metaById);
              const insight = meta.insight ?? buildArxivPaperInsight(paper, query);
              const isSelected = selectedPaper?.id === paper.id;
              const isQueued = pptQueue.includes(paper.stableId);
              const isQueuedForReading =
                Boolean(meta.queuedAt) || readingQueue.some((item) => item.stableId === paper.stableId);
              const abstractMode = abstractModes[paper.id] ?? (meta.abstractZh ? 'zh' : 'en');
              const display = getArxivResultDisplay(paper, meta, abstractMode);
              const isTranslatingMetadata = translatingId === paper.id || backgroundTranslatingIds[paper.id];
              return (
                <article
                  key={paper.id}
                  className={`arxiv-paper-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedPaperId(paper.id)}
                >
                  <div className="arxiv-paper-card-top">
                    <div className="arxiv-paper-meta">
                      <span className={`priority-pill priority-${insight.readingPriority}`}>
                        {translatePriority(insight.readingPriority)}
                      </span>
                      <span className="badge accent-badge">{insight.totalScore}/100</span>
                      <span className="badge">{paper.stableId}</span>
                      <span className="badge">{paper.primaryCategory || paper.categories[0] || 'arXiv'}</span>
                      {meta.abstractZh ? <span className="badge success-badge">中文摘要</span> : null}
                      {isTranslatingMetadata ? <span className="badge accent-badge">本地翻译中</span> : null}
                      {meta.favorite ? <span className="badge success-badge">已收藏</span> : null}
                      {isQueuedForReading ? <span className="badge success-badge">备选库</span> : null}
                    </div>
                    <button
                      type="button"
                      className="icon-button arxiv-favorite-button"
                      title={meta.favorite ? '取消收藏' : '收藏'}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleFavorite(paper);
                      }}
                    >
                      {meta.favorite ? '★' : '☆'}
                    </button>
                  </div>

                  <h3>{display.title}</h3>
                  {display.secondaryTitle ? <p className="arxiv-title-en">{display.secondaryTitle}</p> : null}
                  <p className="arxiv-authors">{paper.authors.slice(0, 6).join(', ') || 'arXiv 未返回作者'}</p>
                  <div className="arxiv-date-row">
                    <span>发布 {formatDate(paper.publishedAt || paper.published)}</span>
                    <span>更新 {formatDate(paper.updated)}</span>
                  </div>

                  <div className="arxiv-score-strip">
                    <div>
                      <span>相关性</span>
                      <strong>{insight.relevance}</strong>
                    </div>
                    <div>
                      <span>新颖性</span>
                      <strong>{insight.novelty}</strong>
                    </div>
                    <div>
                      <span>实验</span>
                      <strong>{insight.experimentQuality}</strong>
                    </div>
                  </div>

                  <div className="arxiv-tag-row">
                    {insight.tags.slice(0, 5).map((tag) => (
                      <span key={tag} className="pill-tag">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <p className="arxiv-summary">
                    {display.abstractText}
                  </p>

                  <footer className="arxiv-card-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setAbstractModes((previous) => ({
                          ...previous,
                          [paper.id]: abstractMode === 'zh' ? 'en' : 'zh'
                        }));
                      }}
                      disabled={!meta.abstractZh}
                    >
                      {abstractMode === 'zh' ? '看英文' : '看中文'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isTranslatingMetadata}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleTranslateAbstract(paper);
                      }}
                    >
                      <img className="button-icon" src={translateIcon} alt="" />
                      {isTranslatingMetadata ? '本地翻译中' : '本地翻译标题/摘要'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleScorePaper(paper);
                      }}
                    >
                      <img className="button-icon" src={analysisIcon} alt="" />
                      评分
                    </button>
                    <button
                      type="button"
                      className={isQueued ? 'primary-button' : 'secondary-button'}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleTogglePptQueue(paper);
                      }}
                    >
                      {isQueued ? '已入 PPT' : '加入 PPT'}
                    </button>
                    <button
                      type="button"
                      className={isQueuedForReading ? 'primary-button' : 'secondary-button'}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleReadingQueue(paper);
                      }}
                    >
                      {isQueuedForReading ? '已备选' : '加入备选'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={downloadingId === paper.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownload(paper);
                      }}
                    >
                      {downloadingId === paper.id ? '下载中' : '下载入库'}
                    </button>
                  </footer>
                </article>
              );
            })}
            </div>
          )}
        </section>

        <aside className="content-card arxiv-detail-panel">
          {selectedPaper && selectedInsight ? (
            <>
              <div className="panel-title-row">
                <div>
                  <span className="eyebrow">Paper Detail</span>
                  <h2>论文详情</h2>
                </div>
                <span className={`priority-pill priority-${selectedInsight.readingPriority}`}>
                  {translatePriority(selectedInsight.readingPriority)}
                </span>
              </div>

              <section className="arxiv-detail-section">
                <h3>{selectedMeta.titleZh || selectedPaper.title}</h3>
                {selectedMeta.titleZh ? <p className="arxiv-title-en">{selectedPaper.title}</p> : null}
                <p>{selectedPaper.authors.join(', ') || 'arXiv 未返回作者'}</p>
                <div className="arxiv-paper-meta">
                  <span className="badge">发布 {formatDate(selectedPaper.publishedAt || selectedPaper.published)}</span>
                  <span className="badge">更新 {formatDate(selectedPaper.updated)}</span>
                  {selectedPaper.categories.slice(0, 4).map((item) => (
                    <span key={item} className="badge">
                      {item}
                    </span>
                  ))}
                </div>
              </section>

              <section className="arxiv-detail-section">
                <div className="arxiv-detail-header">
                  <h3>摘要</h3>
                  <div className="arxiv-layout-switch mini">
                    <button
                      type="button"
                      className={selectedAbstractMode === 'en' ? 'segmented-active' : ''}
                      onClick={() => setAbstractModes((previous) => ({ ...previous, [selectedPaper.id]: 'en' }))}
                    >
                      英文
                    </button>
                    <button
                      type="button"
                      className={selectedAbstractMode === 'zh' ? 'segmented-active' : ''}
                      disabled={!selectedMeta.abstractZh}
                      onClick={() => setAbstractModes((previous) => ({ ...previous, [selectedPaper.id]: 'zh' }))}
                    >
                      中文
                    </button>
                  </div>
                </div>
                <div className="arxiv-detail-abstract">
                  {selectedAbstractMode === 'zh' && selectedMeta.abstractZh
                    ? selectedMeta.abstractZh
                    : selectedPaper.summary}
                </div>
              </section>

              <section className="arxiv-detail-section">
                <div className="arxiv-detail-header">
                  <h3>AI/本地评分</h3>
                  <strong>{selectedInsight.totalScore}/100</strong>
                </div>
                <p>{selectedInsight.reasonZh}</p>
                <div className="arxiv-topic-grid">
                  {Object.entries(selectedInsight.topicMatch).map(([key, value]) => (
                    <div key={key}>
                      <span>{translateTopicKey(key)}</span>
                      <strong>{value}/10</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="arxiv-detail-section">
                <h3>操作</h3>
                <div className="arxiv-detail-actions">
                  <button
                    type="button"
                    className="primary-button button-with-icon"
                    disabled={downloadingId === selectedPaper.id}
                    onClick={() => void handleDownload(selectedPaper)}
                  >
                    <img className="button-icon" src={downloadIcon} alt="" />
                    {downloadingId === selectedPaper.id ? '下载中' : '下载 PDF 入库'}
                  </button>
                  <a className="secondary-button" href={selectedPaper.abstractUrl} target="_blank" rel="noreferrer">
                    打开 arXiv
                  </a>
                  <a className="secondary-button" href={selectedPaper.pdfUrl} target="_blank" rel="noreferrer">
                    打开 PDF
                  </a>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={exportingId === selectedPaper.id}
                    onClick={() => void handleExportMarkdown(selectedPaper)}
                  >
                    <img className="button-icon" src={saveIcon} alt="" />
                    导出 Markdown
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleCopy(buildArxivBibTeX(selectedPaper), 'BibTeX')}
                  >
                    复制 BibTeX
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      void handleCopy(buildArxivExportMarkdown(selectedPaper, selectedMeta), 'Markdown 摘要')
                    }
                  >
                    复制 Markdown
                  </button>
                  <button
                    type="button"
                    className={pptQueue.includes(selectedPaper.stableId) ? 'primary-button' : 'secondary-button'}
                    onClick={() => handleTogglePptQueue(selectedPaper)}
                  >
                    {pptQueue.includes(selectedPaper.stableId) ? '移出 PPT 候选' : '加入 PPT 候选'}
                  </button>
                  <button
                    type="button"
                    className={selectedMeta.queuedAt ? 'primary-button' : 'secondary-button'}
                    onClick={() => handleToggleReadingQueue(selectedPaper)}
                  >
                    {selectedMeta.queuedAt ? '移出备选论文库' : '加入备选论文库'}
                  </button>
                </div>
              </section>
            </>
          ) : (
            <article className="empty-state">
              <h2>选择一篇论文</h2>
              <p>右侧会显示摘要、中文缓存、评分、BibTeX 和导出入口。</p>
            </article>
          )}
        </aside>
      </section>
    </main>
  );
}

function loadArxivMeta(): Record<string, ArxivPaperMeta> {
  try {
    const raw = window.localStorage.getItem(ARXIV_META_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ArxivPaperMeta>) : {};
  } catch {
    return {};
  }
}

function saveArxivMeta(next: Record<string, ArxivPaperMeta>): void {
  window.localStorage.setItem(ARXIV_META_STORAGE_KEY, JSON.stringify(next));
}

export function buildArxivQueuedPaper(
  paper: ArxivPaper,
  meta: ArxivPaperMeta = {},
  addedAt = new Date().toISOString()
): ArxivQueuedPaper {
  return {
    stableId: paper.stableId,
    title: paper.title,
    titleZh: meta.titleZh,
    summary: paper.summary,
    abstractZh: meta.abstractZh,
    authors: paper.authors,
    publishedAt: paper.publishedAt || paper.published,
    updated: paper.updated,
    categories: paper.categories,
    primaryCategory: paper.primaryCategory,
    abstractUrl: paper.abstractUrl,
    pdfUrl: paper.pdfUrl,
    addedAt
  };
}

export function upsertArxivQueuedPaper(queue: ArxivQueuedPaper[], paper: ArxivQueuedPaper): ArxivQueuedPaper[] {
  return [paper, ...queue.filter((item) => item.stableId !== paper.stableId)].slice(0, 300);
}

function loadArxivReadingQueue(): ArxivQueuedPaper[] {
  try {
    const raw = window.localStorage.getItem(ARXIV_READING_QUEUE_STORAGE_KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is ArxivQueuedPaper => {
        const candidate = item as Partial<ArxivQueuedPaper>;
        return typeof candidate.stableId === 'string' && typeof candidate.title === 'string';
      })
      .slice(0, 300);
  } catch {
    return [];
  }
}

function saveArxivReadingQueue(queue: ArxivQueuedPaper[]): ArxivQueuedPaper[] {
  const next = queue.slice(0, 300);
  window.localStorage.setItem(ARXIV_READING_QUEUE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function loadStringList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveStringList(key: string, values: string[]): string[] {
  const next = Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).slice(0, 8);
  window.localStorage.setItem(key, JSON.stringify(next));
  return next;
}

function saveRawStringList(key: string, values: string[]): void {
  window.localStorage.setItem(key, JSON.stringify(Array.from(new Set(values))));
}

function loadLayoutMode(): LayoutMode {
  const value = window.localStorage.getItem(ARXIV_LAYOUT_STORAGE_KEY);
  return value === 'compact' || value === 'wide' ? value : 'standard';
}

function getPaperMeta(paper: ArxivPaper, metaById: Record<string, ArxivPaperMeta>): ArxivPaperMeta {
  return metaById[paper.stableId] ?? {};
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '_').replace(/\s+/gu, '-').slice(0, 72) || 'arxiv-paper';
}

function formatGap(value: number): string {
  return value < 0 ? '首次请求' : `${Math.round(value)} ms`;
}

function normalizeYearInput(value: string): string {
  return value.replace(/\D/gu, '').slice(0, 4);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string): string {
  return value ? value.slice(0, 10) : 'N/A';
}

function getYear(value: string): string {
  return value.match(/\b(19|20)\d{2}\b/u)?.[0] ?? '';
}

function translatePriority(value: string): string {
  if (value === 'high') {
    return '高优先级';
  }
  if (value === 'medium') {
    return '中优先级';
  }
  return '低优先级';
}

function translateTopicKey(value: string): string {
  const labels: Record<string, string> = {
    rl: 'RL',
    pinn: 'PINN',
    path_planning: '路径规划',
    robotics: '机器人',
    embodied_ai: '具身智能',
    world_model: 'World Model'
  };
  return labels[value] ?? value;
}
