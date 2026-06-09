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
  buildArxivPaperInsight
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
type LayoutMode = 'compact' | 'standard' | 'wide';
type AbstractMode = 'en' | 'zh';

const ARXIV_META_STORAGE_KEY = 'pdfTranslationReader:arxivPaperMeta';
const ARXIV_HISTORY_STORAGE_KEY = 'pdfTranslationReader:arxivSearchHistory';
const ARXIV_LAYOUT_STORAGE_KEY = 'pdfTranslationReader:arxivLayoutMode';
const ARXIV_PPT_QUEUE_STORAGE_KEY = 'pdfTranslationReader:arxivPptQueue';

const PAGE_SIZE_OPTIONS = [10, 12, 20, 30];

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

export function ArxivSearchPage(props: ArxivSearchPageProps) {
  const [query, setQuery] = useState('reinforcement learning robot navigation');
  const [category, setCategory] = useState('cs.RO');
  const [sortBy, setSortBy] = useState<ArxivSortBy>('relevance');
  const [sortOrder, setSortOrder] = useState<ArxivSortOrder>('descending');
  const [pageSize, setPageSize] = useState(12);
  const [start, setStart] = useState(0);
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [metaById, setMetaById] = useState<Record<string, ArxivPaperMeta>>(() => loadArxivMeta());
  const [history, setHistory] = useState<string[]>(() => loadStringList(ARXIV_HISTORY_STORAGE_KEY));
  const [pptQueue, setPptQueue] = useState<string[]>(() => loadStringList(ARXIV_PPT_QUEUE_STORAGE_KEY));
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => loadLayoutMode());
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [abstractModes, setAbstractModes] = useState<Record<string, AbstractMode>>({});
  const [yearFilter, setYearFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [translatedOnly, setTranslatedOnly] = useState(false);
  const [scoredOnly, setScoredOnly] = useState(false);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [message, setMessage] = useState(
    '点击“搜索”才会访问 arXiv；输入关键词不会自动请求，避免触发官方限流。'
  );
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const request = useMemo<ArxivSearchRequest>(
    () => ({
      searchQuery: query.trim(),
      category,
      start,
      maxResults: pageSize,
      sortBy,
      sortOrder
    }),
    [category, pageSize, query, sortBy, sortOrder, start]
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
        if (translatedOnly && !meta.abstractZh) {
          return false;
        }
        if (scoredOnly && !meta.insight) {
          return false;
        }
        return true;
      }),
    [favoriteOnly, metaById, papers, query, scoredOnly, tagFilter, translatedOnly, yearFilter]
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
      setMessage('正在通过 ArxivService 排队访问官方 Atom API...');
      const result = await window.electronAPI.searchArxiv(nextRequest);
      setStart(nextStart);
      setPapers(result.papers);
      setSelectedPaperId(result.papers[0]?.id ?? null);
      setHistory((previous) => saveStringList(ARXIV_HISTORY_STORAGE_KEY, [searchQuery, ...previous]));
      if (result.papers.length === 0) {
        setStatus('empty');
        setMessage('没有找到匹配论文。可以换一个关键词，或放宽分类条件。');
        return;
      }
      setStatus('success');
      if (result.cacheHit) {
        setMessage(`已命中 SQLite 缓存：${result.papers.length} 篇。未访问 arXiv。`);
      } else {
        setMessage(
          `检索完成：${result.papers.length} 篇。队列长度 ${result.queueSize}，距上次真实请求 ${formatGap(
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
    if (currentMeta.abstractZh) {
      setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
      setMessage('当前论文摘要已有中文缓存，已切换到中文摘要。');
      return;
    }

    try {
      setTranslatingId(paper.id);
      setMessage('正在调用当前 AI 设置翻译摘要。失败时会保留英文，不影响检索结果。');
      const translation = await window.electronAPI.completeWithAi({
        systemPrompt:
          '你是严谨的学术论文摘要翻译助手。请把英文 arXiv 摘要翻译为自然、准确的中文，保留 RL、PINN、CBF、MPC、VLM、World Model 等专业术语原文或常用译名，不添加解释。',
        userPrompt: `标题：${paper.title}\n\n摘要：${paper.summary}`
      });
      updateMeta(paper, {
        ...currentMeta,
        abstractZh: cleanAiText(translation),
        translatedAt: new Date().toISOString()
      });
      setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
      setMessage('摘要翻译已缓存到本机，下次不会重复调用 AI。');
    } catch (error) {
      setMessage(`摘要翻译失败，已保留英文：${formatError(error)}`);
    } finally {
      setTranslatingId(null);
    }
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

  const selectedMeta = selectedPaper ? getPaperMeta(selectedPaper, metaById) : {};
  const selectedInsight = selectedPaper
    ? selectedMeta.insight ?? buildArxivPaperInsight(selectedPaper, query)
    : null;
  const selectedAbstractMode = selectedPaper ? abstractModes[selectedPaper.id] ?? 'en' : 'en';

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
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleSearch(0);
                }
              }}
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

        <div className={`arxiv-message is-${status}`}>
          <span>{message}</span>
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
            <span>年份</span>
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
                disabled={isSearching || papers.length < pageSize}
                onClick={() => void handleSearch(start + pageSize)}
              >
                下一页
              </button>
            </div>
            <p className="inline-hint">当前 start={start}。翻页同样走 ArxivService 队列和 SQLite 缓存。</p>
          </div>
        </aside>

        <section className="content-card arxiv-results-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Results</span>
              <h2>论文列表</h2>
            </div>
            <span className="badge accent-badge">PPT 候选 {pptQueue.length}</span>
          </div>

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
            filteredPapers.map((paper) => {
              const meta = getPaperMeta(paper, metaById);
              const insight = meta.insight ?? buildArxivPaperInsight(paper, query);
              const isSelected = selectedPaper?.id === paper.id;
              const isQueued = pptQueue.includes(paper.stableId);
              const abstractMode = abstractModes[paper.id] ?? 'en';
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
                      {meta.favorite ? <span className="badge success-badge">已收藏</span> : null}
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

                  <h3>{paper.title}</h3>
                  <p className="arxiv-authors">{paper.authors.slice(0, 6).join(', ') || 'arXiv 未返回作者'}</p>

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
                    {abstractMode === 'zh' && meta.abstractZh ? meta.abstractZh : paper.summary}
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
                      disabled={translatingId === paper.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleTranslateAbstract(paper);
                      }}
                    >
                      <img className="button-icon" src={translateIcon} alt="" />
                      {translatingId === paper.id ? '翻译中' : '翻译摘要'}
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
                  </footer>
                </article>
              );
            })
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
                <h3>{selectedPaper.title}</h3>
                <p>{selectedPaper.authors.join(', ') || 'arXiv 未返回作者'}</p>
                <div className="arxiv-paper-meta">
                  <span className="badge">{formatDate(selectedPaper.publishedAt || selectedPaper.published)}</span>
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

function cleanAiText(value: string): string {
  return value.replace(/^```[a-z]*\s*/iu, '').replace(/```$/u, '').trim();
}

function formatGap(value: number): string {
  return value < 0 ? '首次请求' : `${Math.round(value)} ms`;
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
