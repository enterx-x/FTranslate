import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  type ArxivPaper,
  type ArxivQueryMode,
  type ArxivSearchRequest,
  type ArxivSortBy,
  type ArxivSortOrder,
  type ArxivTitleAbstractTranslationResult,
  type ArxivTranslationBatchRequest,
  type ArxivTranslationPriority,
  isMojibakeTranslationText
} from '../lib/arxivClient';
import {
  type ArxivPaperMeta,
  buildArxivBibTeX,
  buildArxivExportMarkdown,
  buildArxivMatchReasons,
  buildArxivPaperInsight,
  buildArxivTopicCards,
  formatArxivApiDate,
  formatArxivResultRange,
  getArxivApiDateTooltip,
  getArxivRankingScopeLabel,
  getArxivTranslationQualityLabel,
  getArxivWaitStateLabel
} from '../lib/arxivUi';
import searchIcon from '../assets/icons/duotone/search.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import translateIcon from '../assets/icons/duotone/translate.svg';
import analysisIcon from '../assets/icons/duotone/analysis.svg';
import saveIcon from '../assets/icons/duotone/save.svg';
import type { LocalTranslationStatus, PdfFilePayload } from '../types/electron';
import { repairAcademicTranslation } from '../../shared/academicTranslationQuality';
import { clampPanelRatio, getRightPanelRatioFromPointer } from '../lib/responsiveLayout';
import { createArxivSearchSessionController, tryBeginArxivSearchSession } from '../lib/arxivSearchSession';
import { MathText } from './MathText';

interface ArxivSearchPageProps {
  onBackHome: () => void;
  onDownloadedPaper: (paper: ArxivPaper, payload: PdfFilePayload) => void;
}

type SearchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
export type ResultColumnMode = 'one' | 'two' | 'three';
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

type ArxivCardTag = {
  key: string;
  label: string;
  kind: 'match' | 'tag';
};

const ARXIV_META_STORAGE_KEY = 'pdfTranslationReader:arxivPaperMeta';
const ARXIV_HISTORY_STORAGE_KEY = 'pdfTranslationReader:arxivSearchHistory';
const ARXIV_LAYOUT_STORAGE_KEY = 'pdfTranslationReader:arxivResultColumnMode';
const ARXIV_OLD_LAYOUT_STORAGE_KEY = 'pdfTranslationReader:arxivLayoutMode';
const ARXIV_PPT_QUEUE_STORAGE_KEY = 'pdfTranslationReader:arxivPptQueue';
const ARXIV_READING_QUEUE_STORAGE_KEY = 'pdfTranslationReader:arxivReadingQueue';
const ARXIV_DETAIL_PANEL_RATIO_KEY = 'pdfTranslationReader:arxivDetailPanelRatio';
const ARXIV_DETAIL_PANEL_COLLAPSED_KEY = 'pdfTranslationReader:arxivDetailPanelCollapsed';
const DEFAULT_ARXIV_DETAIL_PANEL_RATIO = 0.28;
const OFFLINE_TRANSLATION_NOTICE_TITLE = '离线翻译未配置';
export const DEFAULT_ARXIV_SEARCH_QUERY = '';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const OFFLINE_TRANSLATION_BATCH_SIZE = 4;
const OFFLINE_TRANSLATION_BATCH_CONCURRENCY = 1;
const ARXIV_PREVIEW_TRANSLATION_LIMIT = 6;

const CATEGORY_OPTIONS = [
  { value: '', label: '全部分类' },
  { value: 'cs.RO', label: 'cs.RO 机器人' },
  { value: 'cs.AI', label: 'cs.AI 人工智能' },
  { value: 'cs.LG', label: 'cs.LG 机器学习' },
  { value: 'cs.CV', label: 'cs.CV 视觉' },
  { value: 'eess.SY', label: 'eess.SY 系统与控制' }
];

const SORT_OPTIONS: Array<{ value: ArxivSortBy; label: string }> = [
  { value: 'comprehensive', label: '本页相关排序' },
  { value: 'relevance', label: '相关性' },
  { value: 'submittedDate', label: '提交时间' },
  { value: 'lastUpdatedDate', label: '更新时间' }
];

const QUERY_MODE_OPTIONS: Array<{ value: ArxivQueryMode; label: string }> = [
  { value: 'strict', label: '严格' },
  { value: 'balanced', label: '均衡' },
  { value: 'explore', label: '探索' }
];

export const ARXIV_CARD_PRIMARY_ACTIONS = ['查看摘要', '翻译', '加入阅读队列'] as const;

const SORT_ORDER_OPTIONS: Array<{ value: ArxivSortOrder; label: string }> = [
  { value: 'descending', label: '降序' },
  { value: 'ascending', label: '升序' }
];

const RESULT_COLUMN_OPTIONS: Array<{ value: ResultColumnMode; label: string; title: string }> = [
  { value: 'one', label: '单列', title: '单列：适合认真阅读摘要和长标题' },
  { value: 'two', label: '双列', title: '双列：阅读效率和信息密度折中' },
  { value: 'three', label: '三列', title: '三列：快速筛选大量论文' }
];

export function getArxivResultDisplay(
  paper: ArxivPaper,
  meta: ArxivPaperMeta,
  requestedMode?: AbstractMode
): ArxivResultDisplay {
  const titleZh =
    meta.titleZh && !hasDisplayMojibakeText(meta.titleZh)
      ? repairAcademicTranslation(paper.title, meta.titleZh, { mode: 'title' })
      : undefined;
  const abstractZh =
    meta.abstractZh && !hasDisplayMojibakeText(meta.abstractZh)
      ? repairAcademicTranslation(paper.summary, meta.abstractZh, { mode: 'abstract' })
      : undefined;
  const abstractMode: AbstractMode = requestedMode ?? (abstractZh ? 'zh' : 'en');
  return {
    title: titleZh || paper.title,
    secondaryTitle: titleZh ? paper.title : '',
    abstractText: abstractMode === 'zh' && abstractZh ? abstractZh : paper.summary,
    abstractMode
  };
}

export function getArxivCardPreviewText(value: string): string {
  return value
    .replace(/\$\$([^$]+)\$\$/gu, '$1')
    .replace(/\$([^$]+)\$/gu, '$1')
    .replace(/\\\((.*?)\\\)/gu, '$1')
    .replace(/\\\[(.*?)\\\]/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function buildLatestArxivSearchRequest(
  baseRequest: ArxivSearchRequest,
  searchQuery: string,
  nextStart = 0
): ArxivSearchRequest {
  return {
    ...baseRequest,
    searchQuery: searchQuery.trim(),
    start: nextStart,
    sortBy: 'submittedDate',
    sortOrder: 'descending',
    forceRefresh: Boolean(baseRequest.forceRefresh)
  };
}

export function buildArxivSearchRequestForUi(
  baseRequest: ArxivSearchRequest,
  searchQuery: string,
  nextStart = 0,
  options: { forceRefresh?: boolean; latest?: boolean; maxResults?: number } = {}
): ArxivSearchRequest {
  const request = {
    ...baseRequest,
    maxResults: options.maxResults ?? baseRequest.maxResults,
    forceRefresh: Boolean(options.forceRefresh)
  };
  if (options.latest) {
    return buildLatestArxivSearchRequest(request, searchQuery, nextStart);
  }
  return {
    ...request,
    searchQuery: searchQuery.trim(),
    start: nextStart,
    forceRefresh: Boolean(options.forceRefresh)
  };
}

export function getArxivResultDensityConfig(columnMode: ResultColumnMode): ArxivResultDensityConfig {
  if (columnMode === 'three') {
    return { className: 'arxiv-density-compact', summaryLines: 2 };
  }
  if (columnMode === 'one') {
    return { className: 'arxiv-density-wide', summaryLines: 4 };
  }
  return { className: 'arxiv-density-standard', summaryLines: 3 };
}

export function normalizeArxivResultColumnMode(value: string | null): ResultColumnMode {
  if (value === 'one' || value === 'two' || value === 'three') {
    return value;
  }
  if (value === 'compact') {
    return 'three';
  }
  if (value === 'standard') {
    return 'two';
  }
  if (value === 'wide') {
    return 'one';
  }
  return 'three';
}

function buildVisibleArxivCardTags(
  matchReasons: string[],
  tags: string[],
  limit = 4
): { visible: ArxivCardTag[]; hiddenCount: number } {
  const allTags: ArxivCardTag[] = [];
  const seen = new Set<string>();

  for (const reason of matchReasons) {
    const normalized = reason.trim();
    const key = `match:${normalized.toLowerCase()}`;
    if (normalized && !seen.has(key)) {
      seen.add(key);
      allTags.push({ key, label: normalized, kind: 'match' });
    }
  }

  for (const tag of tags) {
    const normalized = tag.trim();
    const key = `tag:${normalized.toLowerCase()}`;
    if (normalized && !seen.has(key)) {
      seen.add(key);
      allTags.push({ key, label: normalized, kind: 'tag' });
    }
  }

  const visible = allTags.slice(0, limit);
  return { visible, hiddenCount: Math.max(0, allTags.length - visible.length) };
}

export function buildArxivTranslationBatches<T>(items: T[], batchSize = OFFLINE_TRANSLATION_BATCH_SIZE): T[][] {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += safeBatchSize) {
    batches.push(items.slice(offset, offset + safeBatchSize));
  }
  return batches;
}

export async function runArxivTranslationBatches<T>(
  batches: T[][],
  worker: (batch: T[], index: number) => Promise<void>,
  concurrency = OFFLINE_TRANSLATION_BATCH_CONCURRENCY
): Promise<void> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(safeConcurrency, batches.length) }, async () => {
    while (nextIndex < batches.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(batches[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
}

export function resolveSelectedArxivPaper(
  papers: ArxivPaper[],
  selectedPaperId: string | null
): ArxivPaper | null {
  if (selectedPaperId === null) {
    return null;
  }
  return papers.find((paper) => paper.id === selectedPaperId) ?? papers[0] ?? null;
}

export function buildArxivReadingQueuePreview(queue: ArxivQueuedPaper[], limit: number) {
  const visibleCount = Math.max(0, Math.floor(limit));
  const visible = queue.slice(0, visibleCount);
  const hidden = queue.slice(visibleCount);
  return {
    visible,
    hidden,
    hiddenCount: hidden.length
  };
}

export function buildAvailableArxivTags(
  papers: ArxivPaper[],
  metaById: Record<string, ArxivPaperMeta>
): string[] {
  const tags = new Set<string>();
  papers.forEach((paper) => {
    const meta = getPaperMeta(paper, metaById);
    // Topic tags describe the paper itself, so keep legacy/persisted tags available
    // even when no query snapshot exists yet. Query-sensitive scoring is resolved below.
    const insight = meta.insight ?? buildArxivPaperInsight(paper, '');
    insight.tags.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags);
}

export function hasUsableArxivChineseMetadata(meta: ArxivPaperMeta): boolean {
  return Boolean(
    meta.titleZh &&
      meta.abstractZh &&
      !hasDisplayMojibakeText(meta.titleZh) &&
      !hasDisplayMojibakeText(meta.abstractZh)
  );
}

export function shouldQueueArxivMetadataTranslation(meta: ArxivPaperMeta): boolean {
  return !hasUsableArxivChineseMetadata(meta);
}

export function buildArxivPreviewTranslationBatches(
  papers: ArxivPaper[],
  shouldTranslate: (paper: ArxivPaper, index: number) => boolean = () => true
): ArxivPaper[][] {
  const preview = papers.slice(0, ARXIV_PREVIEW_TRANSLATION_LIMIT).filter(shouldTranslate);
  // Keep preview work interruptible: foreground clicks can overtake pending single-paper jobs
  // instead of waiting for an opaque six-paper batch to finish.
  return preview.map((paper) => [paper]);
}

export function canStartArxivManualTranslation(
  isSearching: boolean,
  currentSessionId: number | null
): currentSessionId is number {
  return !isSearching && currentSessionId !== null;
}

export function getArxivTranslationActionState(
  isSearching: boolean,
  isForegroundTranslating: boolean,
  isBackgroundTranslating: boolean
): { disabled: boolean; label: string; title: string } {
  return {
    disabled: isSearching || isForegroundTranslating,
    label: isForegroundTranslating ? '翻译中' : isBackgroundTranslating ? '优先翻译' : '翻译',
    title: isBackgroundTranslating
      ? '点击后提升为前台优先翻译'
      : '使用本地离线引擎翻译标题和摘要'
  };
}

export interface ArxivExecutedQuerySnapshotSource {
  originalQuery: string;
  effectiveQuery: string;
  queryMode: ArxivQueryMode;
}

export function resolveArxivExecutedQuerySnapshot(
  metadata: ArxivExecutedQuerySnapshotSource | null
): { query: string; mode: ArxivQueryMode } {
  return metadata
    ? { query: metadata.effectiveQuery, mode: metadata.queryMode }
    : { query: '', mode: 'balanced' };
}

export function resolveArxivPaperInsightForExecutedQuery(
  paper: ArxivPaper,
  meta: ArxivPaperMeta,
  executedQuery: string,
  executedQueryMode: ArxivQueryMode
) {
  if (
    meta.insight &&
    meta.insightQuery === executedQuery &&
    meta.insightQueryMode === executedQueryMode
  ) {
    return meta.insight;
  }
  return buildArxivPaperInsight(paper, executedQuery, executedQueryMode);
}

export interface ArxivTranslationQueueState {
  kind: 'preview' | 'page';
  completed: number;
  total: number;
}

export function advanceArxivTranslationQueue(
  queue: ArxivTranslationQueueState,
  completedCount: number
): ArxivTranslationQueueState | null {
  const completed = Math.min(queue.total, queue.completed + Math.max(0, completedCount));
  return completed >= queue.total ? null : { ...queue, completed };
}

export function buildArxivTranslationBatchRequest(
  papers: ArxivPaper[],
  priority: ArxivTranslationPriority,
  sessionId: number
): ArxivTranslationBatchRequest {
  return {
    papers: papers.map((paper) => ({
      stableId: paper.stableId,
      title: paper.title,
      summary: paper.summary,
      targetLanguage: 'zh'
    })),
    priority,
    sessionId
  };
}

export function buildArxivTranslationMetaPatch(
  result: ArxivTitleAbstractTranslationResult,
  resultSessionId: number,
  currentSessionId: number | null
): Partial<ArxivPaperMeta> | null {
  if (
    resultSessionId !== currentSessionId
  ) {
    return null;
  }
  const translationState: Partial<ArxivPaperMeta> = {
    translationStatus: result.status,
    translationMessage: result.message,
    translationEngine: result.engine,
    qualityStatus: result.qualityStatus,
    translationElapsedMs: result.elapsedMs
  };
  if (result.status !== 'completed' && result.status !== 'cached') {
    return translationState;
  }
  return {
    ...translationState,
    titleZh: result.titleZh,
    abstractZh: result.abstractZh,
    translatedAt: result.translatedAt ?? new Date().toISOString()
  };
}

export interface ArxivTranslationUiApplication {
  patch: Partial<ArxivPaperMeta>;
  shouldShowChinese: boolean;
  message: string;
}

export function buildArxivTranslationUiApplication(
  result: ArxivTitleAbstractTranslationResult,
  resultSessionId: number,
  currentSessionId: number | null
): ArxivTranslationUiApplication | null {
  const patch = buildArxivTranslationMetaPatch(result, resultSessionId, currentSessionId);
  if (!patch) {
    return null;
  }
  return {
    patch,
    shouldShowChinese: result.status === 'completed' || result.status === 'cached',
    message: result.message
  };
}

export function ArxivSearchPage(props: ArxivSearchPageProps) {
  const [query, setQuery] = useState(DEFAULT_ARXIV_SEARCH_QUERY);
  const [queryMode, setQueryMode] = useState<ArxivQueryMode>('balanced');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<ArxivSortBy>('comprehensive');
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
  const [isReadingQueueOpen, setIsReadingQueueOpen] = useState(false);
  const [columnMode, setColumnMode] = useState<ResultColumnMode>(() => loadResultColumnMode());
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [pageJump, setPageJump] = useState('1');
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [isDetailPanelCollapsed, setIsDetailPanelCollapsed] = useState(
    () => window.localStorage.getItem(ARXIV_DETAIL_PANEL_COLLAPSED_KEY) === '1'
  );
  const [detailPanelRatio, setDetailPanelRatio] = useState(() =>
    clampPanelRatio(
      Number(window.localStorage.getItem(ARXIV_DETAIL_PANEL_RATIO_KEY)),
      0.22,
      0.42,
      DEFAULT_ARXIV_DETAIL_PANEL_RATIO
    )
  );
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
  const [searchSessionController] = useState(createArxivSearchSessionController);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [backgroundTranslatingIds, setBackgroundTranslatingIds] = useState<Record<string, boolean>>({});
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [showOfflineTranslationHelp, setShowOfflineTranslationHelp] = useState(false);
  const [localTranslationStatus, setLocalTranslationStatus] = useState<LocalTranslationStatus | null>(null);
  const [searchMetadata, setSearchMetadata] = useState<{
    cacheHit: boolean;
    cacheStale: boolean;
    originalQuery: string;
    effectiveQuery: string;
    queryMode: ArxivQueryMode;
    sortBy: ArxivSortBy;
    queueSize: number;
    lastRequestGapMs: number;
    cooldownRemainingMs?: number;
  } | null>(null);
  const [executedRequest, setExecutedRequest] = useState<ArxivSearchRequest | null>(null);
  const [translationQueue, setTranslationQueue] = useState<ArxivTranslationQueueState | null>(null);

  useEffect(() => {
    const activePageSize = executedRequest?.maxResults ?? pageSize;
    setPageJump(String(Math.floor(start / Math.max(1, activePageSize)) + 1));
  }, [executedRequest?.maxResults, pageSize, start]);

  useEffect(() => {
    let disposed = false;
    window.electronAPI
      .getLocalTranslationStatus()
      .then((result) => {
        if (!disposed) {
          setLocalTranslationStatus(result);
          if (result.preferredEngine !== 'argos-only' && result.nllb.configured && !result.nllb.available) {
            setLocalTranslationStatus({
              ...result,
              nllb: {
                ...result.nllb,
                runtimeState: 'warming',
                message: '正在预热 NLLB worker。'
              }
            });
            void window.electronAPI
              .warmUpLocalTranslation()
              .then((status) => {
                if (!disposed) {
                  setLocalTranslationStatus(status);
                }
              })
              .catch(() => undefined);
          }
        }
      })
      .catch(() => {
        if (!disposed) {
          setLocalTranslationStatus(null);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const request = useMemo<ArxivSearchRequest>(
    () => ({
      searchQuery: query.trim(),
      queryMode,
      category,
      start,
      maxResults: pageSize,
      sortBy,
      sortOrder,
      yearFrom,
      yearTo
    }),
    [category, pageSize, query, queryMode, sortBy, sortOrder, start, yearFrom, yearTo]
  );

  const availableYears = useMemo(() => {
    const years = Array.from(
      new Set(papers.map((paper) => getYear(paper.publishedAt || paper.published)).filter(Boolean))
    );
    return years.sort((a, b) => Number(b) - Number(a));
  }, [papers]);

  const executedQuerySnapshot = useMemo(
    () => resolveArxivExecutedQuerySnapshot(searchMetadata),
    [searchMetadata]
  );
  const executedQuery = executedQuerySnapshot.query;
  const executedQueryMode = executedQuerySnapshot.mode;

  const availableTags = useMemo(
    () => buildAvailableArxivTags(papers, metaById),
    [metaById, papers]
  );

  const filteredPapers = useMemo(
    () =>
      papers.filter((paper) => {
        const meta = getPaperMeta(paper, metaById);
        const insight = resolveArxivPaperInsightForExecutedQuery(
          paper,
          meta,
          executedQuery,
          executedQueryMode
        );
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
    [executedQuery, executedQueryMode, favoriteOnly, metaById, papers, queuedOnly, readingQueue, scoredOnly, tagFilter, translatedOnly, yearFilter]
  );

  const selectedPaper = useMemo(
    () => resolveSelectedArxivPaper(filteredPapers, selectedPaperId),
    [filteredPapers, selectedPaperId]
  );

  async function handleSearch(
    nextStart = 0,
    options: {
      forceRefresh?: boolean;
      resetFilters?: boolean;
      latest?: boolean;
      maxResults?: number;
      useExecutedRequest?: boolean;
    } = {}
  ): Promise<void> {
    const executedBaseRequest = options.useExecutedRequest ? executedRequest : null;
    const searchQuery = executedBaseRequest?.searchQuery ?? query.trim();
    const searchSessionId = tryBeginArxivSearchSession(
      searchSessionController,
      Boolean(searchQuery) || Boolean(options.latest) || Boolean(executedBaseRequest)
    );
    if (searchSessionId === null) {
      setMessage('请输入关键词后再搜索。');
      setStatus('error');
      return;
    }
    const effectiveSearchQuery = searchQuery || '*';
    const nextRequest = executedBaseRequest
      ? { ...executedBaseRequest, start: nextStart, forceRefresh: false }
      : buildArxivSearchRequestForUi(request, effectiveSearchQuery, nextStart, options);

    try {
      setIsSearching(true);
      setTranslationQueue(null);
      setTranslatingId(null);
      setBackgroundTranslatingIds({});
      setStatus('loading');
      if (options.resetFilters) {
        setYearFilter('all');
        setTagFilter('all');
        setFavoriteOnly(false);
        setQueuedOnly(false);
        setTranslatedOnly(false);
        setScoredOnly(false);
        setAbstractModes({});
      }
      if (nextStart === 0) {
        setPageJump('1');
      }
      setMessage(
        options.latest
          ? '正在按提交时间降序刷新最新论文。'
          : options.forceRefresh
          ? '正在刷新 arXiv 官方结果，关键词会同时匹配标题和摘要。'
          : '正在检索论文，关键词会同时匹配标题和摘要。'
      );
      // Activate the new session before the network request so empty/cache-only results
      // also cancel queued automatic translations from the previous search.
      await window.electronAPI.translateArxivTitleAbstractBatch(
        buildArxivTranslationBatchRequest([], 'preview', searchSessionId)
      ).catch(() => []);
      if (!searchSessionController.isCurrent(searchSessionId)) {
        return;
      }
      const result = await window.electronAPI.searchArxiv(nextRequest);
      if (!searchSessionController.isCurrent(searchSessionId)) {
        return;
      }
      setStart(nextStart);
      setExecutedRequest({ ...nextRequest, forceRefresh: false });
      setPapers(result.papers);
      setTotalResults(result.totalResults ?? result.papers.length);
      setSelectedPaperId(result.papers[0]?.id ?? null);
      setSearchMetadata({
        cacheHit: result.cacheHit,
        cacheStale: Boolean(result.cacheStale),
        originalQuery: result.originalSearchQuery ?? searchQuery,
        effectiveQuery:
          result.effectiveSearchQuery ?? result.normalizedSearchQuery ?? nextRequest.searchQuery,
        queryMode: result.queryMode ?? nextRequest.queryMode ?? 'balanced',
        sortBy: nextRequest.sortBy,
        queueSize: result.queueSize,
        lastRequestGapMs: result.lastRequestGapMs,
        cooldownRemainingMs: result.cooldownRemainingMs
      });
      if (searchQuery) {
        setHistory((previous) => saveStringList(ARXIV_HISTORY_STORAGE_KEY, [searchQuery, ...previous]));
      }
      if (result.papers.length === 0) {
        setStatus('empty');
        setMessage(result.warning ?? '没有找到匹配论文。可以换一个关键词，或放宽分类条件。');
        return;
      }
      setStatus('success');
      const rangeText = formatArxivResultRange(nextStart, result.papers.length, result.totalResults ?? result.papers.length);
      const queryNotice = result.queryNotice ? `${result.queryNotice}。` : '';
      void queuePreviewTranslations(result.papers, searchSessionId);
      if (result.warning) {
        setMessage(`${queryNotice}${result.warning} 当前显示：${rangeText}。`);
      } else if (result.cacheHit) {
        setMessage(
          result.cacheStale
            ? `${queryNotice}已显示本地过期缓存：${rangeText}。为避免触发限流，最新论文会优先复用缓存。`
            : `${queryNotice}已显示本地缓存：${rangeText}。为避免触发限流，最新论文会优先复用缓存。`
        );
      } else {
        const sortText =
          nextRequest.sortBy === 'submittedDate'
            ? '提交时间降序'
            : nextRequest.sortBy === 'lastUpdatedDate'
              ? '更新时间'
              : nextRequest.sortBy === 'relevance'
              ? '相关性'
                : '本页相关排序';
        setMessage(`${queryNotice}共找到 ${formatInteger(result.totalResults ?? result.papers.length)} 篇，当前显示 ${rangeText}，已按${sortText}展示。`);
      }
    } catch (error) {
      if (!searchSessionController.isCurrent(searchSessionId)) {
        return;
      }
      setStatus('error');
      setMessage(`arXiv 检索失败：${formatError(error)}`);
    } finally {
      if (searchSessionController.isCurrent(searchSessionId)) {
        setIsSearching(false);
      }
    }
  }

  function handleJumpToPage(): void {
    if (isSearching) {
      return;
    }
    const page = Number(pageJump);
    if (!Number.isFinite(page)) {
      setPageJump(String(currentPage));
      return;
    }
    const nextPage = Math.min(Math.max(1, Math.floor(page)), totalPages);
    setPageJump(String(nextPage));
    const activePageSize = executedRequest?.maxResults ?? pageSize;
    void handleSearch((nextPage - 1) * activePageSize, { useExecutedRequest: true });
  }

  function handlePageSizeChange(nextPageSize: number): void {
    const safePageSize = PAGE_SIZE_OPTIONS.includes(nextPageSize) ? nextPageSize : 50;
    setPageSize(safePageSize);
    if (papers.length > 0) {
      setMessage(`每页数量已改为 ${safePageSize}。下次搜索时应用；当前结果仍按原页大小翻页，避免混用两套条件。`);
    }
  }

  function toggleDetailPanelCollapsed(): void {
    setIsDetailPanelCollapsed((value) => {
      const nextValue = !value;
      window.localStorage.setItem(ARXIV_DETAIL_PANEL_COLLAPSED_KEY, nextValue ? '1' : '0');
      return nextValue;
    });
  }

  function handleDetailPanelResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const container = event.currentTarget.closest('.arxiv-workbench');
    if (!(container instanceof HTMLElement)) {
      return;
    }

    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add('is-resizing-layout');
    const rect = container.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const nextRatio = getRightPanelRatioFromPointer(
        {
          clientX: moveEvent.clientX,
          left: rect.left,
          width: rect.width
        },
        0.22,
        0.42,
        DEFAULT_ARXIV_DETAIL_PANEL_RATIO
      );
      setDetailPanelRatio(nextRatio);
      window.localStorage.setItem(ARXIV_DETAIL_PANEL_RATIO_KEY, String(nextRatio));
    };
    const stop = () => {
      document.body.classList.remove('is-resizing-layout');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
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

  async function handleOpenExternalUrl(url: string): Promise<void> {
    try {
      await window.electronAPI.openExternalUrl(url);
    } catch (error) {
      setMessage(`打开外部链接失败：${formatError(error)}`);
    }
  }

  async function handleTranslateAbstract(paper: ArxivPaper): Promise<void> {
    const translationSessionId = searchSessionController.current();
    if (!canStartArxivManualTranslation(isSearching, translationSessionId)) {
      setMessage(isSearching ? '搜索进行中，完成后再翻译当前论文。' : '请先完成一次搜索，再翻译论文。');
      return;
    }
    const currentMeta = getPaperMeta(paper, metaById);
    if (hasUsableArxivChineseMetadata(currentMeta)) {
      setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
      setMessage('当前论文标题和摘要已有中文缓存，已切换到中文摘要。');
      return;
    }

    try {
      setTranslatingId(paper.id);
      setMessage('正在使用本地离线引擎翻译标题和摘要，并写入 SQLite 缓存；优先 NLLB，失败回退 Argos，不会调用 AI API。');
      const result = await translatePaperMetadata(paper, false, translationSessionId);
      if (!searchSessionController.isCurrent(translationSessionId)) {
        return;
      }
      if (result?.status === 'completed' || result?.status === 'cached') {
        setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
        setMessage(result.message);
      } else if (result?.status === 'unavailable') {
        setStatus('error');
        setShowOfflineTranslationHelp(true);
      } else if (!result) {
        setStatus('error');
        setMessage('本地翻译未返回结果，请重新检测翻译环境后重试。');
      }
    } catch (error) {
      setMessage(`标题/摘要本地翻译失败，已保留英文：${formatError(error)}`);
    } finally {
      if (searchSessionController.isCurrent(translationSessionId)) {
        setTranslatingId(null);
      }
    }
  }

  async function queuePreviewTranslations(
    nextPapers: ArxivPaper[],
    translationSessionId: number
  ): Promise<void> {
    const batches = buildArxivPreviewTranslationBatches(nextPapers, (paper) => {
      const meta = getPaperMeta(paper, metaById);
      return shouldQueueArxivMetadataTranslation(meta);
    });
    await queueTranslationBatches(batches, 'preview', translationSessionId, 'preview');
  }

  async function handleTranslatePage(): Promise<void> {
    const translationSessionId = searchSessionController.current();
    if (!canStartArxivManualTranslation(isSearching, translationSessionId)) {
      setMessage(isSearching ? '搜索进行中，完成后再翻译当前页。' : '请先完成一次搜索，再翻译当前页。');
      return;
    }
    const missing = papers.filter((paper) =>
      shouldQueueArxivMetadataTranslation(getPaperMeta(paper, metaById)) &&
      !backgroundTranslatingIds[paper.id]
    );
    if (missing.length === 0) {
      setMessage('当前页标题和摘要已有可用中文缓存。');
      return;
    }
    const batches = buildArxivTranslationBatches(missing, OFFLINE_TRANSLATION_BATCH_SIZE);
    setMessage(`已将当前页 ${missing.length} 篇待翻译论文加入用户翻译队列。`);
    await queueTranslationBatches(batches, 'foreground', translationSessionId, 'page');
  }

  async function queueTranslationBatches(
    batches: ArxivPaper[][],
    priority: ArxivTranslationPriority,
    translationSessionId: number,
    kind: 'preview' | 'page'
  ): Promise<void> {
    if (batches.length === 0 || !searchSessionController.isCurrent(translationSessionId)) {
      return;
    }
    const total = batches.reduce((count, batch) => count + batch.length, 0);
    setTranslationQueue({ kind, completed: 0, total });
    await runArxivTranslationBatches(batches, async (batch) => {
      if (!searchSessionController.isCurrent(translationSessionId)) {
        return;
      }
      setBackgroundTranslatingIds((previous) => ({
        ...previous,
        ...Object.fromEntries(batch.map((paper) => [paper.id, true]))
      }));
      try {
        const results = await window.electronAPI.translateArxivTitleAbstractBatch(
          buildArxivTranslationBatchRequest(batch, priority, translationSessionId)
        );
        if (!searchSessionController.isCurrent(translationSessionId)) {
          return;
        }
        let unavailableMessage = '';
        let failedMessage = '';
        results.forEach((result, index) => {
          const paper = batch[index];
          if (!paper || applyTranslationResult(paper, result, translationSessionId, true)) {
            return;
          }
          if (result.status === 'unavailable') {
            unavailableMessage = result.message;
          } else {
            failedMessage = result.message;
          }
        });
        if (unavailableMessage) {
          setStatus('error');
          setShowOfflineTranslationHelp(true);
          setMessage(unavailableMessage);
          return;
        }
        if (failedMessage) {
          setMessage(failedMessage);
        }
      } catch (error) {
        if (searchSessionController.isCurrent(translationSessionId)) {
          setMessage(`后台离线翻译失败，已保留英文：${formatError(error)}`);
        }
      } finally {
        if (!searchSessionController.isCurrent(translationSessionId)) {
          return;
        }
        setTranslationQueue((previous) =>
          previous?.kind === kind ? advanceArxivTranslationQueue(previous, batch.length) : previous
        );
        setBackgroundTranslatingIds((previous) => {
          const next = { ...previous };
          batch.forEach((paper) => {
            delete next[paper.id];
          });
          return next;
        });
      }
    }, kind === 'preview' ? 1 : OFFLINE_TRANSLATION_BATCH_CONCURRENCY);
  }

  function applyTranslationResult(
    paper: ArxivPaper,
    result: ArxivTitleAbstractTranslationResult,
    translationSessionId: number,
    silent = false
  ): boolean {
    const application = buildArxivTranslationUiApplication(
      result,
      translationSessionId,
      searchSessionController.current()
    );
    if (!application) {
      return false;
    }
    patchMeta(paper, application.patch);
    if (application.shouldShowChinese) {
      if (!silent) {
        setAbstractModes((previous) => ({ ...previous, [paper.id]: 'zh' }));
      }
      return true;
    }
    if (!silent) {
      setMessage(application.message);
    }
    return false;
  }

  async function translatePaperMetadata(
    paper: ArxivPaper,
    silent: boolean,
    translationSessionId: number
  ) {
    const [result] = await window.electronAPI.translateArxivTitleAbstractBatch(
      buildArxivTranslationBatchRequest([paper], 'foreground', translationSessionId)
    );
    if (!result) {
      return undefined;
    }
    if (applyTranslationResult(paper, result, translationSessionId, silent)) {
      return result;
    }
    return result;
  }

  function handleScorePaper(paper: ArxivPaper): void {
    const insight = buildArxivPaperInsight(paper, executedQuery, executedQueryMode);
    updateMeta(paper, {
      ...getPaperMeta(paper, metaById),
      insight,
      insightQuery: executedQuery,
      insightQueryMode: executedQueryMode,
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
    ? resolveArxivPaperInsightForExecutedQuery(
        selectedPaper,
        selectedMeta,
        executedQuery,
        executedQueryMode
      )
    : null;
  const selectedTopicCards = selectedInsight
    ? buildArxivTopicCards(selectedInsight, executedQuery, executedQueryMode)
    : [];
  const selectedAbstractMode = selectedPaper
    ? abstractModes[selectedPaper.id] ?? (hasUsableArxivChineseMetadata(selectedMeta) ? 'zh' : 'en')
    : 'en';
  const selectedDisplay = selectedPaper ? getArxivResultDisplay(selectedPaper, selectedMeta, selectedAbstractMode) : null;
  const resultDensity = getArxivResultDensityConfig(columnMode);
  const resultPanelStyle = { '--arxiv-summary-lines': resultDensity.summaryLines } as CSSProperties;
  const workbenchStyle = { '--arxiv-detail-panel-ratio': `${detailPanelRatio * 100}%` } as CSSProperties;
  const readingQueueStyle =
    papers.length === 0
      ? ({ minHeight: 58 + Math.min(readingQueue.length, 4) * 56 } as CSSProperties)
      : undefined;
  const selectedIsTranslating = selectedPaper ? translatingId === selectedPaper.id : false;
  const selectedIsBackgroundTranslating = selectedPaper
    ? Boolean(backgroundTranslatingIds[selectedPaper.id])
    : false;
  const selectedIsInPpt = selectedPaper ? pptQueue.includes(selectedPaper.stableId) : false;
  const selectedIsQueuedForReading = selectedPaper
    ? Boolean(selectedMeta.queuedAt) || readingQueue.some((item) => item.stableId === selectedPaper.stableId)
    : false;
  const selectedTagItems =
    selectedPaper && selectedInsight
      ? buildVisibleArxivCardTags(
          buildArxivMatchReasons(selectedPaper, executedQuery, executedQueryMode),
          selectedInsight.tags,
          8
        )
      : { visible: [], hiddenCount: 0 };
  const shouldShowReadingQueueList = papers.length === 0 || isReadingQueueOpen;
  const isOfflineTranslationNotice = message.includes(OFFLINE_TRANSLATION_NOTICE_TITLE);
  const activePageSize = executedRequest?.maxResults ?? pageSize;
  const currentPage = Math.floor(start / Math.max(1, activePageSize)) + 1;
  const totalPages = Math.max(1, Math.ceil(totalResults / Math.max(1, activePageSize)));
  const resultRangeText =
    papers.length > 0 ? formatArxivResultRange(start, papers.length, totalResults || papers.length) : '暂无结果';

  return (
    <main
      className={`arxiv-page page-workspace${isSearching ? ' is-searching' : ''}${
        isDetailPanelCollapsed ? ' is-detail-collapsed' : ''
      }`}
    >
      <header className="page-header compact-page-header arxiv-page-header">
        <div>
          <span className="eyebrow">Official arXiv API</span>
          <h1>arXiv 检索</h1>
          <p>检索、筛选、翻译摘要、评分并加入 PPT 候选列表。</p>
        </div>
        <div className="arxiv-header-actions">
          <span className="arxiv-api-status">
            <span aria-hidden="true" />
            API 状态
          </span>
          <button type="button" className="secondary-button" onClick={props.onBackHome}>
            返回工作台
          </button>
        </div>
      </header>

      <section className="content-card arxiv-search-card">
        <div className="arxiv-search-primary-row">
          <label className="arxiv-query-input">
            <span>关键词</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="标题/摘要关键词，例如 reinforcement learning robot navigation"
            />
          </label>
          <button
            type="button"
            className="primary-button button-with-icon"
            data-search-session-guard="true"
            disabled={isSearching}
            onClick={() => void handleSearch(0, { resetFilters: true })}
          >
            <img className="button-icon" src={searchIcon} alt="" />
            <span>{isSearching ? '搜索中' : '搜索'}</span>
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isSearching}
            title="跳过本地 SQLite 缓存，真实访问 arXiv 官方 API。arXiv 仍可能因发布批次和时区延迟暂时没有当天论文。"
            onClick={() => {
              setSortBy('submittedDate');
              setSortOrder('descending');
              void handleSearch(0, { forceRefresh: true, resetFilters: true, latest: true });
            }}
          >
            最新论文
          </button>
        </div>

        <div className="arxiv-query-row">
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
            <span>查询模式</span>
            <select value={queryMode} onChange={(event) => setQueryMode(event.target.value as ArxivQueryMode)}>
              {QUERY_MODE_OPTIONS.map((option) => (
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
            className="secondary-button arxiv-advanced-toggle"
            aria-expanded={showAdvancedFilters}
            aria-controls="arxiv-advanced-filters"
            onClick={() => setShowAdvancedFilters((value) => !value)}
          >
            高级筛选
          </button>
          <button
            type="button"
            className="ghost-button arxiv-clear-filters"
            onClick={() => {
              setYearFrom('');
              setYearTo('');
              setCategory('');
              setQueryMode('balanced');
              setSortBy('comprehensive');
              setSortOrder('descending');
              setPageSize(50);
              setYearFilter('all');
              setTagFilter('all');
              setFavoriteOnly(false);
              setQueuedOnly(false);
              setTranslatedOnly(false);
              setScoredOnly(false);
            }}
          >
            清空筛选
          </button>
        </div>

        <div id="arxiv-advanced-filters" className={`arxiv-query-options ${showAdvancedFilters ? 'is-open' : ''}`}>
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
            <select value={pageSize} onChange={(event) => handlePageSizeChange(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
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
          <div className="arxiv-top-checkbox-filters" aria-label="页内筛选">
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
          <p className="arxiv-query-hints">
            搜索会同时匹配 title 和 abstract；年份范围会写入 arXiv API 的 submittedDate。为避免再次触发限流，
            不做自动无限抓取，可把每页设为 200 后用“下一页”继续浏览全部结果。列表日期显示官方 API 的 UTC 提交/更新日期，
            arXiv 网站 new/recent 公告日可能晚一天。
          </p>
        </div>

        <div className={`arxiv-message is-${status}`}>
          <span>{message}</span>
          <div className="arxiv-status-badges">
            <span className="badge">{describeLocalTranslationStatus(localTranslationStatus)}</span>
            <span className="badge">title / abstract</span>
          </div>
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
                disabled={isSearching || !selectedPaper || translatingId === selectedPaper.id}
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
        <div className="arxiv-runtime-status" aria-label="arXiv 当前检索与翻译状态">
          <span className="badge">
            {searchMetadata
              ? searchMetadata.cacheHit
                ? searchMetadata.cacheStale
                  ? '过期缓存'
                  : '本地缓存'
                : 'arXiv 新请求'
              : '等待搜索'}
          </span>
          <span className="badge">模式：{translateArxivQueryMode(searchMetadata?.queryMode ?? queryMode)}</span>
          <span className="badge">排序：{getArxivRankingScopeLabel(searchMetadata?.sortBy ?? sortBy)}</span>
          <span
            className="badge"
            title={
              searchMetadata
                ? `最近请求间隔 ${searchMetadata.lastRequestGapMs} ms；队列 ${searchMetadata.queueSize}`
                : '尚未发起 arXiv 请求'
            }
          >
            {getArxivWaitStateLabel(searchMetadata, isSearching)}
          </span>
          <span className="badge arxiv-runtime-query" title={searchMetadata?.effectiveQuery || '尚无已执行查询'}>
            规范化：{searchMetadata?.effectiveQuery || '—'}
          </span>
          {searchMetadata?.originalQuery && searchMetadata.originalQuery !== searchMetadata.effectiveQuery ? (
            <span className="badge arxiv-runtime-query" title={searchMetadata.originalQuery}>
              原始：{searchMetadata.originalQuery}
            </span>
          ) : null}
          <span className="badge">
            翻译：{translationQueue
              ? `${translationQueue.kind === 'preview' ? '预览' : '本页'} ${translationQueue.completed}/${translationQueue.total}`
              : '空闲'} · {describeLocalTranslationStatus(localTranslationStatus)}
          </span>
          <span className="badge" title={selectedMeta.translationMessage || '尚无当前论文的质量门禁结果'}>
            {getArxivTranslationQualityLabel(selectedMeta)}
          </span>
        </div>
      </section>

      <section
        className={`arxiv-workbench arxiv-columns-${columnMode}${
          isDetailPanelCollapsed ? ' is-detail-collapsed' : ''
        }`}
        style={workbenchStyle}
      >
        <section
          className={`content-card arxiv-results-panel ${resultDensity.className}`}
          style={resultPanelStyle}
          aria-busy={isSearching}
        >
          <div className="panel-title-row arxiv-results-toolbar">
            <div>
              <span className="eyebrow">Results</span>
              <h2>论文列表</h2>
              <p className="arxiv-result-summary">
                {papers.length > 0
                  ? `共找到 ${formatInteger(totalResults || papers.length)} 篇，当前显示 ${resultRangeText}。`
                  : '搜索后会在这里显示论文卡片。'}
              </p>
            </div>
            <div className="arxiv-results-controls">
              <button
                type="button"
                className="secondary-button arxiv-translate-page-button"
                data-search-session-guard="true"
                disabled={
                  papers.length === 0 ||
                  isSearching ||
                  Boolean(translationQueue && translationQueue.completed < translationQueue.total)
                }
                onClick={() => void handleTranslatePage()}
              >
                {translationQueue?.kind === 'page'
                  ? `翻译本页 ${translationQueue.completed}/${translationQueue.total}`
                  : '翻译本页'}
              </button>
              <div className="arxiv-view-switch" aria-label="论文卡片列数">
                {RESULT_COLUMN_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.title}
                    className={columnMode === option.value ? 'segmented-active' : ''}
                    onClick={() => {
                      setColumnMode(option.value);
                      window.localStorage.setItem(ARXIV_LAYOUT_STORAGE_KEY, option.value);
                      window.localStorage.removeItem(ARXIV_OLD_LAYOUT_STORAGE_KEY);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="arxiv-page-size-control">
                <span>每页</span>
                <select value={pageSize} onChange={(event) => handlePageSizeChange(Number(event.target.value))}>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div className="arxiv-count-badges">
                <span className="badge accent-badge">PPT 候选 {pptQueue.length}</span>
                <button
                  type="button"
                  className="badge success-badge arxiv-reading-queue-trigger"
                  aria-expanded={isReadingQueueOpen}
                  disabled={readingQueue.length === 0}
                  onClick={() => setIsReadingQueueOpen((value) => !value)}
                >
                  备选 {readingQueue.length}
                </button>
              </div>
            </div>
          </div>

          {readingQueue.length > 0 && shouldShowReadingQueueList ? (
            <div
              className={`arxiv-reading-queue-mini${papers.length === 0 ? ' is-empty-results' : ''}${
                shouldShowReadingQueueList ? ' is-open' : ''
              }`}
              role={papers.length === 0 ? 'region' : 'dialog'}
              aria-label="备选论文库"
              style={readingQueueStyle}
            >
              <button
                type="button"
                className="arxiv-reading-queue-head"
                aria-expanded={shouldShowReadingQueueList}
                onClick={() => setIsReadingQueueOpen((value) => !value)}
              >
                <span>
                  <strong>备选论文库</strong>
                  <em>{readingQueue.length} 篇</em>
                </span>
                <span className="arxiv-reading-queue-toggle">
                  <span className="when-closed">展开列表</span>
                  <span className="when-open">收起列表</span>
                </span>
              </button>
              {shouldShowReadingQueueList ? (
                <div className="arxiv-reading-queue-list" aria-label="备选论文快捷定位">
                  {readingQueue.map((item) => (
                    <button
                      key={item.stableId}
                      type="button"
                      className="arxiv-reading-queue-paper"
                      aria-label={`填入备选论文：${item.title}`}
                      onClick={() => {
                        setQuery(item.title);
                        setIsReadingQueueOpen(false);
                        setMessage(`已填入备选论文标题：${item.title}。点击搜索可重新定位该论文。`);
                      }}
                    >
                      <span>{item.titleZh || item.title}</span>
                      {item.titleZh && item.titleZh !== item.title ? <small>{item.title}</small> : null}
                    </button>
                  ))}
                </div>
              ) : null}
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
              {filteredPapers.map((paper, index) => {
              const meta = getPaperMeta(paper, metaById);
              const insight = resolveArxivPaperInsightForExecutedQuery(
                paper,
                meta,
                executedQuery,
                executedQueryMode
              );
              const isSelected = selectedPaper?.id === paper.id;
              const isQueuedForReading =
                Boolean(meta.queuedAt) || readingQueue.some((item) => item.stableId === paper.stableId);
              const abstractMode = abstractModes[paper.id] ?? (hasUsableArxivChineseMetadata(meta) ? 'zh' : 'en');
              const display = getArxivResultDisplay(paper, meta, abstractMode);
              const matchReasons = buildArxivMatchReasons(
                paper,
                executedQuery,
                executedQueryMode
              );
              const isForegroundTranslating = translatingId === paper.id;
              const isBackgroundTranslating = Boolean(backgroundTranslatingIds[paper.id]);
              const isTranslatingMetadata = isForegroundTranslating || isBackgroundTranslating;
              const translationAction = getArxivTranslationActionState(
                isSearching,
                isForegroundTranslating,
                isBackgroundTranslating
              );
              const tagItems = buildVisibleArxivCardTags(matchReasons, insight.tags);
              return (
                <article
                  key={paper.id}
                  className={`arxiv-paper-card ${isSelected ? 'is-selected' : ''}${
                    isTranslatingMetadata ? ' is-translating' : ''
                  }`}
                  style={{ '--arxiv-card-delay': `${Math.min(index, 18) * 18}ms` } as CSSProperties}
                  onClick={() => setSelectedPaperId(paper.id)}
                >
                  <div className="arxiv-paper-card-top">
                    <div className="arxiv-card-priority-row">
                      <span className={`priority-pill priority-${insight.readingPriority}`}>
                        {translatePriority(insight.readingPriority)}
                      </span>
                      <span className="badge accent-badge">{insight.totalScore}/100</span>
                    </div>
                    <div className="arxiv-card-icon-actions">
                      {isForegroundTranslating ? <span className="badge accent-badge">翻译中</span> : null}
                      {!isForegroundTranslating && isBackgroundTranslating ? (
                        <span className="badge">后台翻译中</span>
                      ) : null}
                      {hasUsableArxivChineseMetadata(meta) ? <span className="badge success-badge">中文摘要</span> : null}
                      {isQueuedForReading ? <span className="badge success-badge">备选</span> : null}
                    </div>
                  </div>

                  <h3>{display.title}</h3>
                  {display.secondaryTitle ? <p className="arxiv-title-en">{display.secondaryTitle}</p> : null}
                  <p className="arxiv-authors">{paper.authors.slice(0, 6).join(', ') || 'arXiv 未返回作者'}</p>
                  <div className="arxiv-date-row">
                    <span title={getArxivApiDateTooltip('submitted', paper.publishedAt || paper.published)}>
                      提交 {formatArxivApiDate(paper.publishedAt || paper.published)}
                    </span>
                    <span title={getArxivApiDateTooltip('updated', paper.updated)}>
                      最新版本 {formatArxivApiDate(paper.updated)}
                    </span>
                    <span>{paper.primaryCategory || paper.categories[0] || 'arXiv'}</span>
                  </div>

                  <p className="arxiv-summary">{getArxivCardPreviewText(display.abstractText)}</p>

                  <div className="arxiv-tag-row">
                    {tagItems.visible.map((tag) => (
                      <span key={tag.key} className={tag.kind === 'match' ? 'pill-tag accent-pill-tag' : 'pill-tag'}>
                        {tag.label}
                      </span>
                    ))}
                    {tagItems.hiddenCount > 0 ? <span className="pill-tag">+{tagItems.hiddenCount}</span> : null}
                  </div>

                  <footer className="arxiv-card-actions arxiv-card-actions--primary">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPaperId(paper.id);
                        setIsDetailPanelCollapsed(false);
                      }}
                    >
                      {ARXIV_CARD_PRIMARY_ACTIONS[0]}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      data-search-session-guard="true"
                      disabled={translationAction.disabled}
                      title={translationAction.title}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleTranslateAbstract(paper);
                      }}
                    >
                      <img className="button-icon" src={translateIcon} alt="" />
                      {translationAction.label}
                    </button>
                    <button
                      type="button"
                      className={isQueuedForReading ? 'primary-button' : 'secondary-button'}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleReadingQueue(paper);
                      }}
                    >
                      {isQueuedForReading ? '移出阅读队列' : ARXIV_CARD_PRIMARY_ACTIONS[2]}
                    </button>
                  </footer>
                </article>
              );
            })}
            </div>
          )}
          {papers.length > 0 ? (
            <footer className="arxiv-results-pagination">
              <button
                type="button"
                className="secondary-button"
                disabled={isSearching || start === 0}
                onClick={() => void handleSearch(Math.max(0, start - activePageSize), { useExecutedRequest: true })}
              >
                上一页
              </button>
              <div className="arxiv-page-indicator">
                <span className="arxiv-page-chip">{currentPage}</span>
                <span>/ {formatInteger(totalPages)} 页</span>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={isSearching || start + activePageSize >= totalResults}
                onClick={() => void handleSearch(start + activePageSize, { useExecutedRequest: true })}
              >
                下一页
              </button>
              <label className="arxiv-page-jump">
                <span>跳至</span>
                <input
                  value={pageJump}
                  inputMode="numeric"
                  data-search-session-guard="true"
                  disabled={isSearching}
                  onChange={(event) => setPageJump(event.target.value.replace(/\D/gu, '').slice(0, 5))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !isSearching) {
                      handleJumpToPage();
                    }
                  }}
                />
                <span>页</span>
              </label>
              <button type="button" className="secondary-button" disabled={isSearching} onClick={handleJumpToPage}>
                跳转
              </button>
            </footer>
          ) : null}
        </section>

        <aside
          id="arxiv-detail-panel"
          className={`content-card arxiv-detail-panel${isDetailPanelCollapsed ? ' is-collapsed' : ''}`}
        >
          <button
            type="button"
            className="arxiv-detail-panel-toggle"
            aria-expanded={!isDetailPanelCollapsed}
            aria-controls="arxiv-detail-panel-body"
            title={isDetailPanelCollapsed ? '展开论文详情' : '收起论文详情，扩大结果区'}
            onClick={toggleDetailPanelCollapsed}
          >
            <span>{isDetailPanelCollapsed ? '展开详情' : '收起详情'}</span>
          </button>
          {!isDetailPanelCollapsed ? (
            <>
              <div
                className="arxiv-detail-resize-handle"
                role="separator"
                aria-orientation="vertical"
                title="拖拽调整论文详情宽度，双击恢复默认"
                onPointerDown={handleDetailPanelResizeStart}
                onDoubleClick={() => {
                  setDetailPanelRatio(DEFAULT_ARXIV_DETAIL_PANEL_RATIO);
                  window.localStorage.setItem(ARXIV_DETAIL_PANEL_RATIO_KEY, String(DEFAULT_ARXIV_DETAIL_PANEL_RATIO));
                }}
              />
              <div id="arxiv-detail-panel-body" className="arxiv-detail-panel-body">
                {selectedPaper && selectedInsight ? (
                  <>
                    <div className="panel-title-row">
                      <div>
                        <span className="eyebrow">Paper Detail</span>
                        <h2>论文详情</h2>
                      </div>
                <button
                  type="button"
                  className="icon-button arxiv-detail-close"
                  title="取消当前选择"
                  onClick={() => setSelectedPaperId(null)}
                >
                  ×
                </button>
              </div>

              <section className="arxiv-detail-section">
                <div className="arxiv-detail-score-row">
                  <span className={`priority-pill priority-${selectedInsight.readingPriority}`}>
                    {translatePriority(selectedInsight.readingPriority)}
                  </span>
                  <span className="badge accent-badge">{selectedInsight.totalScore}/100</span>
                </div>
                <h3>{selectedDisplay?.title || selectedPaper.title}</h3>
                {selectedDisplay?.secondaryTitle ? <p className="arxiv-title-en">{selectedDisplay.secondaryTitle}</p> : null}
                <p className="arxiv-authors">{selectedPaper.authors.join(', ') || 'arXiv 未返回作者'}</p>
                <div className="arxiv-paper-meta">
                  <span
                    className="badge"
                    title={getArxivApiDateTooltip('submitted', selectedPaper.publishedAt || selectedPaper.published)}
                  >
                    提交 {formatArxivApiDate(selectedPaper.publishedAt || selectedPaper.published)}
                  </span>
                  <span className="badge" title={getArxivApiDateTooltip('updated', selectedPaper.updated)}>
                    最新版本 {formatArxivApiDate(selectedPaper.updated)}
                  </span>
                  {selectedPaper.categories.slice(0, 4).map((item) => (
                    <span key={item} className="badge">
                      {item}
                    </span>
                  ))}
                </div>
              </section>

              <section className="arxiv-detail-section">
                <div className="arxiv-detail-header">
                  <h3>{selectedDisplay?.abstractMode === 'zh' ? '摘要（本地翻译）' : '摘要'}</h3>
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
                  <MathText
                    text={
                      selectedDisplay?.abstractMode === 'zh'
                        ? selectedDisplay.abstractText
                        : selectedPaper.summary
                    }
                  />
                </div>
              </section>

              <section className="arxiv-detail-section">
                <h3>标签</h3>
                <div className="arxiv-tag-row">
                  {selectedTagItems.visible.map((tag) => (
                    <span key={tag.key} className={tag.kind === 'match' ? 'pill-tag accent-pill-tag' : 'pill-tag'}>
                      {tag.label}
                    </span>
                  ))}
                  {selectedTagItems.hiddenCount > 0 ? (
                    <span className="pill-tag">+{selectedTagItems.hiddenCount}</span>
                  ) : null}
                </div>
              </section>

              <section className="arxiv-detail-section">
                <div className="arxiv-detail-header">
                  <h3>AI/本地评分</h3>
                  <strong>{selectedInsight.totalScore}/100</strong>
                </div>
                <p>{selectedInsight.reasonZh}</p>
                <div className="arxiv-topic-grid">
                  {selectedTopicCards.length > 0 ? (
                    selectedTopicCards.map((card) => (
                      <div key={card.key}>
                        <span>{card.label}</span>
                        <strong>{card.value}/10</strong>
                      </div>
                    ))
                  ) : (
                    <div>
                      <span>主题命中</span>
                      <strong>暂无强主题命中</strong>
                    </div>
                  )}
                </div>
              </section>

              <section className="arxiv-detail-section">
                <h3>操作</h3>
                <div className="arxiv-detail-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => handleTogglePptQueue(selectedPaper)}
                  >
                    {selectedIsInPpt ? '移出 PPT 候选' : '加入 PPT 候选'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleToggleReadingQueue(selectedPaper)}
                  >
                    {selectedIsQueuedForReading ? '移出备选列表' : '加入备选列表'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button button-with-icon"
                    disabled={downloadingId === selectedPaper.id}
                    onClick={() => void handleDownload(selectedPaper)}
                  >
                    <img className="button-icon" src={downloadIcon} alt="" />
                    {downloadingId === selectedPaper.id ? '下载中' : '下载并阅读'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleOpenExternalUrl(selectedPaper.abstractUrl)}
                  >
                    打开 arXiv
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
                    onClick={() => handleToggleFavorite(selectedPaper)}
                  >
                    {selectedMeta.favorite ? '取消收藏' : '收藏论文'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button button-with-icon"
                    onClick={() => handleScorePaper(selectedPaper)}
                  >
                    <img className="button-icon" src={analysisIcon} alt="" />
                    更新本地评分
                  </button>
                </div>
                <div className="arxiv-detail-secondary-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleOpenExternalUrl(selectedPaper.pdfUrl)}
                  >
                    打开 PDF
                  </button>
                  <button
                    type="button"
                    className="secondary-button button-with-icon"
                    disabled={isSearching || selectedIsTranslating}
                    title={selectedIsBackgroundTranslating ? '点击后提升为前台优先翻译' : undefined}
                    onClick={() => void handleTranslateAbstract(selectedPaper)}
                  >
                    <img className="button-icon" src={translateIcon} alt="" />
                    {selectedIsTranslating
                      ? '本地翻译中'
                      : selectedIsBackgroundTranslating
                        ? '提升为前台翻译'
                        : '本地翻译标题/摘要'}
                  </button>
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
                    onClick={() =>
                      void handleCopy(buildArxivExportMarkdown(selectedPaper, selectedMeta), 'Markdown 摘要')
                    }
                  >
                    复制 Markdown
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
              </div>
            </>
          ) : null}
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

function loadResultColumnMode(): ResultColumnMode {
  return normalizeArxivResultColumnMode(
    window.localStorage.getItem(ARXIV_LAYOUT_STORAGE_KEY) ?? window.localStorage.getItem(ARXIV_OLD_LAYOUT_STORAGE_KEY)
  );
}

function getPaperMeta(paper: ArxivPaper, metaById: Record<string, ArxivPaperMeta>): ArxivPaperMeta {
  const meta = metaById[paper.stableId] ?? {};
  return {
    ...meta,
    titleZh: hasDisplayMojibakeText(meta.titleZh) ? undefined : meta.titleZh,
    abstractZh: hasDisplayMojibakeText(meta.abstractZh) ? undefined : meta.abstractZh
  };
}

function hasDisplayMojibakeText(value?: string): boolean {
  return isMojibakeTranslationText(value);
}

export function describeLocalTranslationStatus(status: LocalTranslationStatus | null): string {
  if (!status) {
    return '本地翻译状态未知';
  }
  if (status.preferredEngine === 'argos-only') {
    return 'Argos only';
  }
  if (!status.nllb.configured) {
    return 'NLLB 未配置 · Argos fallback';
  }
  if (status.nllb.runtimeState === 'warming') {
    return 'NLLB 预热中';
  }
  if (status.nllb.runtimeState === 'cpu_fallback') {
    return 'NLLB CPU 回退';
  }
  if (status.nllb.runtimeState === 'ready' && status.nllb.available) {
    return `NLLB 可用 · ${formatLocalTranslationDevice(status)}`;
  }
  if (status.nllb.runtimeState === 'failed') {
    return 'NLLB 不可用 · Argos fallback';
  }
  return 'NLLB 已配置 · 未检查';
}

function formatLocalTranslationDevice(status: LocalTranslationStatus): string {
  if (status.nllb.runtimeDevice !== 'unknown') {
    return status.nllb.runtimeDevice.toUpperCase();
  }
  return status.nllb.device === 'auto' ? '设备未确认' : status.nllb.device.toUpperCase();
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '_').replace(/\s+/gu, '-').slice(0, 72) || 'arxiv-paper';
}

function normalizeYearInput(value: string): string {
  return value.replace(/\D/gu, '').slice(0, 4);
}

function translateArxivQueryMode(mode: ArxivQueryMode): string {
  return mode === 'strict' ? '严格' : mode === 'explore' ? '探索' : '均衡';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatInteger(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString('zh-CN');
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
