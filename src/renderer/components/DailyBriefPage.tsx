import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction
} from 'react';
import type { ArxivPaper } from '../../shared/arxiv';
import type {
  DailyBrief,
  DailyBriefFeedback,
  DailyBriefItem,
  DailyBriefPreferences,
  DailyBriefSnapshot
} from '../../shared/dailyBrief';
import {
  DAILY_BRIEF_DEFAULT_PREFERENCES,
  DAILY_BRIEF_MAX_HISTORY,
  DAILY_BRIEF_MAX_PAPERS,
  DAILY_BRIEF_MIN_PAPERS,
  canonicalizeArxivStableId,
  validateDailyBriefPreferences,
  normalizeDailyBriefPreferences as normalizeSharedDailyBriefPreferences
} from '../../shared/dailyBrief';
import styles from './DailyBriefPage.module.css';

export interface DailyBriefPageProps {
  snapshot: DailyBriefSnapshot | null;
  error: string;
  busy: boolean;
  onSavePreferences: (preferences: DailyBriefPreferences) => Promise<void>;
  onRun: () => Promise<void>;
  onFeedback: (feedback: DailyBriefFeedback) => Promise<void>;
  onRemoveFeedback: (paperId: string) => Promise<void>;
  onOpenPaper: (paper: ArxivPaper) => Promise<void>;
  onOpenLibrary: () => void;
  onOpenSearch: () => void;
}

export const DEFAULT_DAILY_BRIEF_PREFERENCES = DAILY_BRIEF_DEFAULT_PREFERENCES;

type FeedbackKind = DailyBriefFeedback['kind'];
type ActionKind = 'save' | 'run' | 'open' | 'feedback' | null;
export type DailyBriefStatusTone = 'loading' | 'running' | 'error' | 'ready' | 'disabled' | 'empty';

export interface DailyBriefStatus {
  tone: DailyBriefStatusTone;
  label: string;
  detail: string;
}

const FEEDBACK_LABELS: Record<FeedbackKind, string> = {
  interested: '想读',
  saved: '稍后看',
  dismissed: '暂不相关'
};

const FEEDBACK_HINTS: Record<FeedbackKind, string> = {
  interested: '标记为想读，方便回看',
  saved: '保留在反馈区，稍后打开阅读',
  dismissed: '这篇论文之后不再推送'
};

export const normalizeDailyBriefPreferences = normalizeSharedDailyBriefPreferences;

function getBriefSortTime(brief: DailyBrief): number {
  const createdAt = Date.parse(brief.createdAt);
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }
  const date = Date.parse(brief.date);
  return Number.isFinite(date) ? date : 0;
}

export function sortDailyBriefsByNewest(briefs: DailyBrief[]): DailyBrief[] {
  return [...briefs].sort((left, right) => getBriefSortTime(right) - getBriefSortTime(left));
}

export function getLatestDailyBrief(briefs: DailyBrief[]): DailyBrief | null {
  return sortDailyBriefsByNewest(briefs)[0] ?? null;
}

function getLocalDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function isDailyBriefForToday(brief: DailyBrief, now = new Date()): boolean {
  const briefDate = brief.date.trim().match(/^\d{4}-\d{2}-\d{2}/u)?.[0];
  return Boolean(briefDate) && briefDate === getLocalDateKey(now);
}

export function getDailyBriefPaperId(paper: ArxivPaper): string {
  const candidate = canonicalizeArxivStableId(paper.stableId || paper.id);
  return candidate || paper.stableId.trim() || paper.id.trim();
}

export function getDailyBriefFeedbackPaperId(paperId: string): string {
  return canonicalizeArxivStableId(paperId) || paperId.trim();
}

export function buildDailyBriefFeedback(paper: ArxivPaper, kind: FeedbackKind): DailyBriefFeedback {
  return {
    paperId: getDailyBriefPaperId(paper),
    kind,
    title: paper.title,
    topics: Array.from(new Set([paper.primaryCategory, ...paper.categories].filter(Boolean))).slice(0, 8)
  };
}

export function formatDailyBriefDate(value: string): string {
  const dateOnly = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/u);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.trim() || '日期未知';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  }).format(parsed);
}

export function formatDailyBriefDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.trim() || '时间未知';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed);
}

export function formatDailyBriefScore(value: number): string {
  if (!Number.isFinite(value)) {
    return '匹配分 —/100';
  }
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return `匹配分 ${normalized}/100`;
}

export function getDailyBriefStatus(snapshot: DailyBriefSnapshot | null, busy = false): DailyBriefStatus {
  if (!snapshot) {
    return {
      tone: 'loading',
      label: '正在读取本地状态',
      detail: '正在加载偏好与历史简报。'
    };
  }
  if (snapshot.running) {
    return {
      tone: 'running',
      label: '正在生成简报',
      detail: '正在检索并整理 arXiv 摘要，上一份结果仍可查看。'
    };
  }
  const latest = getLatestDailyBrief(snapshot.briefs);
  if (snapshot.lastError) {
    return {
      tone: 'error',
      label: '上次运行失败',
      detail: snapshot.lastAttemptAt
        ? `${snapshot.lastError} · ${formatDailyBriefDateTime(snapshot.lastAttemptAt)}${latest ? ' · 已保留最近一份结果' : ''}`
        : `${snapshot.lastError}${latest ? ' · 已保留最近一份结果' : ''}`
    };
  }
  if (latest) {
    if (!isDailyBriefForToday(latest)) {
      return {
        tone: snapshot.preferences.enabled ? 'empty' : 'disabled',
        label: '今日尚未生成',
        detail: `最近一份是 ${formatDailyBriefDate(latest.date || latest.createdAt)}。${
          snapshot.preferences.enabled
            ? `计划每天 ${snapshot.preferences.time}（本地时间）运行。`
            : '自动生成已关闭，可以手动运行。'
        }`
      };
    }
    if (latest.items.length === 0) {
      return {
        tone: 'empty',
        label: '今日无匹配',
        detail: '本次检索没有找到符合兴趣与排除词的论文，可以调整偏好后再运行。'
      };
    }
    return {
      tone: 'ready',
      label: latest.warning ? '已生成 · 有提示' : '简报已就绪',
      detail: latest.warning
        ? latest.warning
        : `最近更新 ${formatDailyBriefDateTime(latest.createdAt || latest.date)}`
    };
  }
  if (!snapshot.preferences.interests.trim()) {
    return {
      tone: 'empty',
      label: '尚未配置兴趣',
      detail: busy ? '正在保存设置。' : '填写至少一个研究兴趣并保存，再生成第一份简报。'
    };
  }
  if (!snapshot.preferences.enabled) {
    return {
      tone: 'disabled',
      label: '自动生成已关闭',
      detail: busy ? '正在保存设置。' : '可以手动运行；开启后按本地时间自动补跑。'
    };
  }
  return {
    tone: 'empty',
    label: '等待首次运行',
    detail: `已启用 · 每天 ${snapshot.preferences.time}（本地时间）`
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function updatePreference(
  setPreferences: Dispatch<SetStateAction<DailyBriefPreferences>>,
  setDirty: Dispatch<SetStateAction<boolean>>,
  setActionError: Dispatch<SetStateAction<string>>,
  update: (current: DailyBriefPreferences) => DailyBriefPreferences
): void {
  setPreferences((current) => update(current));
  setDirty(true);
  setActionError('');
}

export function DailyBriefPage(props: DailyBriefPageProps) {
  const pageTitleId = useId();
  const interestsId = useId();
  const excludeTermsId = useId();
  const timeId = useId();
  const maxPapersId = useId();
  const [preferences, setPreferences] = useState<DailyBriefPreferences>(() =>
    normalizeDailyBriefPreferences(props.snapshot?.preferences)
  );
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const [action, setAction] = useState<ActionKind>(null);
  const [actionPaperId, setActionPaperId] = useState('');
  const [actionError, setActionError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    if (!preferencesDirty) {
      setPreferences(normalizeDailyBriefPreferences(props.snapshot?.preferences));
    }
  }, [preferencesDirty, props.snapshot?.preferences]);

  const sortedBriefs = useMemo(
    () => sortDailyBriefsByNewest(props.snapshot?.briefs ?? []),
    [props.snapshot?.briefs]
  );
  const latestBrief = sortedBriefs[0] ?? null;
  const historyBriefs = sortedBriefs.slice(1, DAILY_BRIEF_MAX_HISTORY + 1);
  const feedbackByPaperId = useMemo(
    () => new Map(
      (props.snapshot?.feedback ?? []).map((feedback) => [getDailyBriefFeedbackPaperId(feedback.paperId), feedback])
    ),
    [props.snapshot?.feedback]
  );
  const papersById = useMemo(() => {
    const papers = new Map<string, ArxivPaper>();
    for (const brief of props.snapshot?.briefs ?? []) {
      for (const item of brief.items) {
        const paperId = getDailyBriefPaperId(item.paper);
        papers.set(paperId, item.paper);
        if (item.paper.id) {
          papers.set(getDailyBriefFeedbackPaperId(item.paper.id), item.paper);
        }
      }
    }
    return papers;
  }, [props.snapshot?.briefs]);
  const latestIsToday = latestBrief ? isDailyBriefForToday(latestBrief) : false;
  const isSnapshotRunning = Boolean(props.snapshot?.running);
  const isBusy = props.busy || action !== null || isSnapshotRunning;
  const status = getDailyBriefStatus(props.snapshot, isBusy);
  const visibleError = actionError || props.error.trim();
  const runBlockedByForm = preferencesDirty || !preferences.interests.trim();
  const runDisabled = isBusy || !props.snapshot || runBlockedByForm;
  const saveDisabled = isBusy || (!preferencesDirty && Boolean(props.snapshot));

  async function persistPreferences(): Promise<boolean> {
    if (isSnapshotRunning) {
      setActionError('简报正在生成，请稍后再保存。');
      return false;
    }
    const validationErrors = validateDailyBriefPreferences(preferences);
    if (validationErrors.length) {
      setActionError(validationErrors.join(' '));
      return false;
    }
    setAction('save');
    setActionError('');
    try {
      await props.onSavePreferences(normalizeDailyBriefPreferences(preferences));
      setPreferencesDirty(false);
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      return true;
    } catch (error) {
      setActionError(`保存每日简报设置失败：${getErrorMessage(error)}`);
      return false;
    } finally {
      setAction(null);
    }
  }

  async function handleSave(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    await persistPreferences();
  }

  async function handleRun(): Promise<void> {
    setActionError('');
    if (!props.snapshot) {
      return;
    }
    if (!preferences.interests.trim()) {
      setActionError('请先填写至少一个研究兴趣并保存。');
      return;
    }
    if (preferencesDirty) {
      setActionError('请先保存偏好，再运行每日简报。');
      return;
    }
    setAction('run');
    try {
      await props.onRun();
    } catch (error) {
      setActionError(`生成每日简报失败：${getErrorMessage(error)}`);
    } finally {
      setAction(null);
    }
  }

  async function handleOpenPaper(paper: ArxivPaper): Promise<void> {
    const paperId = getDailyBriefPaperId(paper);
    setAction('open');
    setActionPaperId(paperId);
    setActionError('');
    try {
      await props.onOpenPaper(paper);
    } catch (error) {
      setActionError(`打开论文失败：${getErrorMessage(error)}`);
    } finally {
      setAction(null);
      setActionPaperId('');
    }
  }

  async function handleFeedback(paper: ArxivPaper, kind: FeedbackKind): Promise<void> {
    const paperId = getDailyBriefPaperId(paper);
    const existing = feedbackByPaperId.get(paperId);
    setAction('feedback');
    setActionPaperId(paperId);
    setActionError('');
    try {
      if (existing?.kind === kind) {
        await props.onRemoveFeedback(paperId);
      } else {
        await props.onFeedback(buildDailyBriefFeedback(paper, kind));
      }
    } catch (error) {
      setActionError(`保存反馈失败：${getErrorMessage(error)}`);
    } finally {
      setAction(null);
      setActionPaperId('');
    }
  }

  async function handleRemoveFeedback(paperId: string): Promise<void> {
    const canonicalPaperId = getDailyBriefFeedbackPaperId(paperId);
    setAction('feedback');
    setActionPaperId(canonicalPaperId);
    setActionError('');
    try {
      await props.onRemoveFeedback(canonicalPaperId);
    } catch (error) {
      setActionError(`撤销反馈失败：${getErrorMessage(error)}`);
    } finally {
      setAction(null);
      setActionPaperId('');
    }
  }

  function handleTextPreferenceChange(
    field: 'interests' | 'excludeTerms',
    event: ChangeEvent<HTMLTextAreaElement>
  ): void {
    const value = event.target.value;
    updatePreference(setPreferences, setPreferencesDirty, setActionError, (current) => ({
      ...current,
      [field]: value
    }));
  }

  function renderBriefItem(item: DailyBriefItem, index: number, briefId: string) {
    const paper = item.paper;
    const paperId = getDailyBriefPaperId(paper);
    const feedback = feedbackByPaperId.get(paperId);
    const categories = Array.from(new Set([paper.primaryCategory, ...paper.categories].filter(Boolean)));
    const title = paper.title.trim() || '未命名论文';
    const authors = paper.authors.length > 0 ? paper.authors.join('、') : '作者信息未提供';
    const titleId = `${briefId}-paper-${index}`;

    return (
      <article className={styles.briefItem} key={`${briefId}-${paperId}-${index}`} aria-labelledby={titleId}>
        <div className={styles.briefItemHeader}>
          <span className={styles.itemIndex}>{String(index + 1).padStart(2, '0')}</span>
          <div className={styles.itemMeta}>
            <span>{paper.primaryCategory || 'arXiv'}</span>
            <span>{formatDailyBriefDate(paper.publishedAt || paper.published)}</span>
            <span>{authors}</span>
          </div>
          <span className={styles.scoreBadge}>{formatDailyBriefScore(item.score)}</span>
        </div>

        <h3 className={styles.paperTitle} id={titleId}>
          <button
            type="button"
            className={styles.titleButton}
            onClick={() => void handleOpenPaper(paper)}
            disabled={isBusy}
            aria-label={`打开论文：${title}`}
          >
            {title}
          </button>
        </h3>

        <div className={styles.topicRow} aria-label="论文分类">
          {categories.slice(0, 5).map((category) => (
            <span className={styles.topicTag} key={category}>
              {category}
            </span>
          ))}
        </div>

        <div className={styles.evidenceLine}>
          <span className={styles.evidenceBadge}>依据公开摘要</span>
        </div>

        <div className={styles.briefCopy}>
          <section>
            <h4>摘要</h4>
            <p>{item.summary.trim() || paper.summary.trim() || '摘要暂无可显示内容。'}</p>
          </section>
          <section>
            <h4>为什么推荐</h4>
            <p>{item.reason.trim() || '本次结果未提供匹配理由。'}</p>
          </section>
          <section>
            <h4>阅读提示</h4>
            <p>{item.readingHint.trim() || '打开论文后，先核对方法、数据和实验设置。'}</p>
          </section>
        </div>

        <div className={styles.itemFooter}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => void handleOpenPaper(paper)}
            disabled={isBusy}
          >
            {action === 'open' && actionPaperId === paperId ? '正在打开…' : '阅读 / 下载 PDF'}
          </button>
          <div className={styles.feedbackActions} aria-label={`反馈：${title}`}>
            {(Object.keys(FEEDBACK_LABELS) as FeedbackKind[]).map((kind) => {
              const isSelected = feedback?.kind === kind;
              const isFeedbackBusy = action === 'feedback' && actionPaperId === paperId;
              return (
                <button
                  type="button"
                  className={`${styles.feedbackButton} ${isSelected ? styles.feedbackButtonActive : ''}`}
                  key={kind}
                  aria-pressed={isSelected}
                  title={FEEDBACK_HINTS[kind]}
                  onClick={() => void handleFeedback(paper, kind)}
                  disabled={isBusy}
                >
                  {isFeedbackBusy && isSelected ? '保存中…' : FEEDBACK_LABELS[kind]}
                </button>
              );
            })}
          </div>
          {feedback ? (
            <span className={styles.feedbackState}>
              已标记“{FEEDBACK_LABELS[feedback.kind]}” · 再点一次可撤销
            </span>
          ) : null}
        </div>
      </article>
    );
  }

  const statusClass = {
    loading: styles.statusLoading,
    running: styles.statusRunning,
    error: styles.statusError,
    ready: styles.statusReady,
    disabled: styles.statusDisabled,
    empty: styles.statusEmpty
  }[status.tone];

  return (
    <main className={styles.page} aria-labelledby={pageTitleId}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>DAILY RESEARCH</p>
            <h1 id={pageTitleId}>今日研究简报</h1>
            <p>
              <span className={styles.headerDate}>{formatDailyBriefDate(getLocalDateKey(new Date()))}</span>
              <span>把新论文收敛成一份今天能读、能回看的 arXiv 清单。</span>
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={`${styles.statusPill} ${statusClass}`}>{status.label}</span>
            <button type="button" className={styles.secondaryButton} onClick={props.onOpenLibrary} disabled={isBusy}>
              打开论文库
            </button>
            <button type="button" className={styles.secondaryButton} onClick={props.onOpenSearch} disabled={isBusy}>
              前往 arXiv 检索
            </button>
            <button type="button" className={styles.primaryButton} onClick={() => void handleRun()} disabled={runDisabled}>
              {action === 'run'
                ? '正在运行…'
                : preferencesDirty
                  ? '先保存后运行'
                  : !preferences.interests.trim()
                    ? '先填写兴趣'
                    : '运行一次'}
            </button>
          </div>
        </header>

        <div
          className={`${styles.statusLine} ${statusClass}`}
          role={status.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span className={styles.statusDot} aria-hidden="true" />
          <div>
            <strong>{status.label}</strong>
            <span>{status.detail}</span>
          </div>
        </div>

        {visibleError ? (
          <div className={styles.errorBanner} role="alert">
            <strong>需要处理</strong>
            <span>{visibleError}</span>
          </div>
        ) : null}

        <div className={styles.contentGrid}>
          <div className={styles.mainColumn}>
            <section className={styles.resultsPanel} aria-labelledby={`${pageTitleId}-results`}>
              <header className={styles.panelHeader}>
                <div>
                  <p className={styles.sectionKicker}>{latestIsToday || !latestBrief ? 'TODAY' : 'LATEST'}</p>
                  <h2 id={`${pageTitleId}-results`}>{latestIsToday || !latestBrief ? '今日推荐' : '最近一份简报'}</h2>
                </div>
                <div className={styles.panelHeaderMeta}>
                  {latestBrief ? <span>{latestBrief.items.length} 篇</span> : <span>尚未生成</span>}
                  {latestBrief ? <span>{latestBrief.mode === 'ai' ? 'AI 重排' : '规则筛选'}</span> : null}
                </div>
              </header>

              {!props.snapshot ? (
                <div className={styles.loadingState} aria-label="正在读取每日简报">
                  <span className={styles.loadingBar} />
                  <span className={styles.loadingBarShort} />
                  <span className={styles.loadingBar} />
                  <p>正在读取本地历史，不会预填示例论文。</p>
                </div>
              ) : latestBrief?.items.length ? (
                <div className={styles.briefList}>
                  <div className={styles.briefIntro}>
                    <span>
                      {latestIsToday ? '今天' : `今天尚未生成 · ${formatDailyBriefDate(latestBrief.date || latestBrief.createdAt)}`}
                    </span>
                    <span>推荐内容只使用 arXiv 公开摘要</span>
                  </div>
                  {!latestIsToday ? (
                    <p className={styles.warningLine}>下面保留最近一份结果供回看；今天的简报尚未生成。</p>
                  ) : null}
                  {latestBrief.warning ? <p className={styles.warningLine}>{latestBrief.warning}</p> : null}
                  {latestBrief.items.map((item, index) => renderBriefItem(item, index, latestBrief.id))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <span className={styles.emptyMarker}>01</span>
                  <div>
                    <h3>
                      {latestBrief?.items.length === 0 && latestIsToday ? '今天没有匹配的论文' : '还没有今天的推荐'}
                    </h3>
                    <p>
                      {latestBrief?.items.length === 0 && latestIsToday
                        ? '本次检索没有找到符合兴趣与排除词的结果，可以调整偏好后再运行。'
                        : props.snapshot.preferences.enabled
                        ? '偏好已保存。点击“运行一次”生成第一份简报，或等待本地时间到达。'
                        : '先保存你的兴趣、排除词和本地时间，再按需运行。自动生成默认关闭。'}
                    </p>
                    <div className={styles.emptyActions}>
                      <button type="button" className={styles.primaryButton} onClick={() => void handleSave()} disabled={saveDisabled}>
                        {action === 'save' ? '正在保存…' : '保存偏好'}
                      </button>
                      <button type="button" className={styles.secondaryButton} onClick={() => void handleRun()} disabled={runDisabled}>
                        {preferencesDirty
                          ? '先保存后运行'
                          : !preferences.interests.trim()
                            ? '先填写兴趣'
                            : '运行一次'}
                      </button>
                      <button type="button" className={styles.linkButton} onClick={props.onOpenSearch} disabled={isBusy}>
                        先去检索论文
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className={styles.historyPanel} aria-labelledby={`${pageTitleId}-history`}>
              <header className={styles.panelHeader}>
                <div>
                  <p className={styles.sectionKicker}>ARCHIVE</p>
                  <h2 id={`${pageTitleId}-history`}>历史简报</h2>
                </div>
                <span className={styles.panelHeaderHint}>保留在本地</span>
              </header>
              {historyBriefs.length > 0 ? (
                <div className={styles.historyList}>
                  {historyBriefs.map((brief) => (
                    <details className={styles.historyRow} key={brief.id}>
                      <summary>
                        <span className={styles.historyDate}>{formatDailyBriefDate(brief.date || brief.createdAt)}</span>
                        <span>{brief.items.length} 篇</span>
                        <span>{brief.mode === 'ai' ? 'AI 重排' : '规则筛选'}</span>
                        {brief.warning ? <span className={styles.historyWarning}>有提示</span> : null}
                      </summary>
                      <div className={styles.historyDetails}>
                        {brief.items.length > 0 ? (
                          brief.items.map((item, index) => (
                            <div className={styles.historyItem} key={`${brief.id}-${getDailyBriefPaperId(item.paper)}-${index}`}>
                              <strong>{item.paper.title || '未命名论文'}</strong>
                              <span>{item.reason || '本次结果未提供匹配理由。'}</span>
                              <button
                                type="button"
                                className={styles.historyOpenButton}
                                onClick={() => void handleOpenPaper(item.paper)}
                                disabled={isBusy}
                              >
                                {action === 'open' && actionPaperId === getDailyBriefPaperId(item.paper)
                                  ? '正在打开…'
                                  : '打开论文'}
                              </button>
                            </div>
                          ))
                        ) : (
                          <p>本次没有匹配到论文。</p>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className={styles.panelEmpty}>生成第一份简报后，历史记录会按日期保留在这里。</p>
              )}
            </section>

            <section className={styles.feedbackPanel} aria-labelledby={`${pageTitleId}-feedback`}>
              <header className={styles.panelHeader}>
                <div>
                  <p className={styles.sectionKicker}>YOUR SIGNAL</p>
                  <h2 id={`${pageTitleId}-feedback`}>你的反馈</h2>
                </div>
                <span className={styles.panelHeaderHint}>可随时撤销</span>
              </header>
              {props.snapshot?.feedback.length ? (
                <div className={styles.feedbackList}>
                  {[...props.snapshot.feedback].reverse().map((feedback) => (
                    <div className={styles.feedbackRow} key={feedback.paperId}>
                      <div className={styles.feedbackRowCopy}>
                        <strong>{feedback.title || '未命名论文'}</strong>
                        <span>
                          {FEEDBACK_LABELS[feedback.kind]}
                          {feedback.topics.length > 0 ? ` · ${feedback.topics.slice(0, 3).join(' · ')}` : ''}
                        </span>
                        {!papersById.has(getDailyBriefFeedbackPaperId(feedback.paperId)) ? (
                          <span className={styles.feedbackUnavailable}>对应简报已移出本地历史，仅保留反馈标题</span>
                        ) : null}
                      </div>
                      <div className={styles.feedbackRowActions}>
                        {papersById.get(getDailyBriefFeedbackPaperId(feedback.paperId)) ? (
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() =>
                              void handleOpenPaper(papersById.get(getDailyBriefFeedbackPaperId(feedback.paperId)) as ArxivPaper)
                            }
                            disabled={isBusy}
                          >
                            {action === 'open' && actionPaperId === getDailyBriefFeedbackPaperId(feedback.paperId)
                              ? '正在打开…'
                              : '打开论文'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.tertiaryButton}
                            onClick={props.onOpenSearch}
                            disabled={isBusy}
                          >
                            去检索中查找
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.tertiaryButton}
                          onClick={() => void handleRemoveFeedback(feedback.paperId)}
                          disabled={isBusy}
                        >
                          {action === 'feedback' && actionPaperId === getDailyBriefFeedbackPaperId(feedback.paperId)
                            ? '撤销中…'
                            : '撤销'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.panelEmpty}>在推荐论文上选择“想读”“稍后看”或“暂不相关”，反馈会出现在这里。</p>
              )}
            </section>
          </div>

          <aside className={styles.settingsColumn}>
            <section className={styles.settingsPanel} aria-labelledby={`${pageTitleId}-settings`}>
              <header className={styles.settingsHeader}>
                <p className={styles.sectionKicker}>PREFERENCES</p>
                <h2 id={`${pageTitleId}-settings`}>简报偏好</h2>
                <p>先保存一次，之后可以手动运行，也可以交给本地调度。</p>
              </header>
              <form className={styles.preferencesForm} onSubmit={(event) => void handleSave(event)}>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={preferences.enabled}
                    onChange={(event) =>
                      updatePreference(setPreferences, setPreferencesDirty, setActionError, (current) => ({
                        ...current,
                        enabled: event.target.checked
                      }))
                    }
                    disabled={isBusy}
                  />
                  <span>
                    <strong>启用每日自动生成</strong>
                    <small>默认关闭；只有你勾选后才会启用。</small>
                  </span>
                </label>

                <div className={styles.disclosureNote}>
                  <strong>调度说明</strong>
                  <span>需要保持 FTranslate 运行；错过的时间会在下次启动时补跑。</span>
                </div>

                <label className={styles.fieldLabel} htmlFor={timeId}>
                  <span>每日运行时间 <small>本地时间</small></span>
                  <input
                    id={timeId}
                    type="time"
                    value={preferences.time}
                    onChange={(event) =>
                      updatePreference(setPreferences, setPreferencesDirty, setActionError, (current) => ({
                        ...current,
                        time: event.target.value
                      }))
                    }
                    disabled={isBusy}
                  />
                </label>

                <label className={styles.fieldLabel} htmlFor={interestsId}>
                  <span>我想关注</span>
                  <textarea
                    id={interestsId}
                    value={preferences.interests}
                    onChange={(event) => handleTextPreferenceChange('interests', event)}
                    placeholder="例如：humanoid robot、tactile sensing、safe RL"
                    rows={4}
                    disabled={isBusy}
                  />
                  <small>用逗号或换行分隔主题，也可以直接写英文关键词。</small>
                </label>

                <label className={styles.fieldLabel} htmlFor={excludeTermsId}>
                  <span>排除这些词</span>
                  <textarea
                    id={excludeTermsId}
                    value={preferences.excludeTerms}
                    onChange={(event) => handleTextPreferenceChange('excludeTerms', event)}
                    placeholder="例如：survey、medical imaging"
                    rows={3}
                    disabled={isBusy}
                  />
                  <small>命中排除词的标题或摘要会被过滤。</small>
                </label>

                <label className={styles.fieldLabel} htmlFor={maxPapersId}>
                  <span>每天最多推荐</span>
                  <input
                    id={maxPapersId}
                    type="number"
                    min={DAILY_BRIEF_MIN_PAPERS}
                    max={DAILY_BRIEF_MAX_PAPERS}
                    step={1}
                    value={Number.isFinite(preferences.maxPapers) ? preferences.maxPapers : ''}
                    onChange={(event) =>
                      updatePreference(setPreferences, setPreferencesDirty, setActionError, (current) => ({
                        ...current,
                        maxPapers: event.target.valueAsNumber
                      }))
                    }
                    disabled={isBusy}
                  />
                  <small>可填写 {DAILY_BRIEF_MIN_PAPERS}–{DAILY_BRIEF_MAX_PAPERS} 篇。</small>
                </label>

                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={preferences.useAi}
                    onChange={(event) =>
                      updatePreference(setPreferences, setPreferencesDirty, setActionError, (current) => ({
                        ...current,
                        useAi: event.target.checked
                      }))
                    }
                    disabled={isBusy}
                  />
                  <span>
                    <strong>使用 AI 辅助重排</strong>
                    <small>可选；使用已保存的模型服务，只发送研究兴趣、排除词和公开摘要/元数据，不发送本地 PDF 或笔记。</small>
                  </span>
                </label>

                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryButton} disabled={saveDisabled}>
                    {action === 'save' ? '正在保存…' : preferencesDirty ? '保存偏好' : '已保存'}
                  </button>
                  {preferencesDirty ? (
                    <span className={styles.unsavedHint}>有未保存修改，保存后才能运行。</span>
                  ) : null}
                  {savedAt ? <span className={styles.savedHint}>本地保存于 {savedAt}</span> : null}
                </div>
              </form>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
