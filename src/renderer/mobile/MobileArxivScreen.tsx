import { useState } from 'react';
import type { ArxivPaper, ArxivSearchRequest } from '../../shared/arxiv';
import { searchMobileArxiv } from './mobileArxiv';
import { MobileTranslationSettingsDialog } from './MobileTranslationSettingsDialog';
import { translateAcademicText } from './mobileTranslation';
import type { MobileTranslationSession } from './mobileTypes';

export interface MobileArxivTranslation {
  titleZh?: string;
  abstractZh?: string;
}

interface MobileArxivScreenProps {
  savingPaperId: string | null;
  translationSession: MobileTranslationSession;
  onSavePaper: (paper: ArxivPaper, translation?: MobileArxivTranslation) => Promise<void>;
  onCancelSave: () => void;
  onTranslationSessionChange: (session: MobileTranslationSession) => Promise<void>;
}

const DEFAULT_REQUEST: ArxivSearchRequest = {
  searchQuery: '',
  category: '',
  start: 0,
  maxResults: 20,
  sortBy: 'comprehensive',
  sortOrder: 'descending'
};

export function MobileArxivScreen({
  savingPaperId,
  translationSession,
  onSavePaper,
  onCancelSave,
  onTranslationSessionChange
}: MobileArxivScreenProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<ArxivSearchRequest['sortBy']>('comprehensive');
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'empty' | 'error'>('idle');
  const [message, setMessage] = useState('支持中文研究词，会自动展开为英文 arXiv 检索表达式。');
  const [paperTranslations, setPaperTranslations] = useState<Record<string, MobileArxivTranslation>>({});
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingTranslation, setPendingTranslation] = useState<{ paper: ArxivPaper; field: 'title' | 'abstract' } | null>(null);

  async function handleSearch(forceRefresh = false) {
    if (!query.trim()) {
      setStatus('error');
      setMessage('请输入论文主题、方法名或作者。');
      return;
    }
    setPapers([]);
    setPaperTranslations({});
    setTranslationErrors({});
    setStatus('loading');
    setMessage('正在检索 arXiv…');
    try {
      const result = await searchMobileArxiv({
        ...DEFAULT_REQUEST,
        searchQuery: query,
        category,
        sortBy,
        forceRefresh
      });
      setPapers(result.papers);
      setStatus(result.papers.length ? 'success' : 'empty');
      setMessage(result.warning || `${result.cacheHit ? '本机缓存' : '实时检索'} · 返回 ${result.papers.length} / ${result.totalResults} 篇`);
    } catch (error) {
      setPapers([]);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTranslate(paper: ArxivPaper, field: 'title' | 'abstract'): Promise<void> {
    if (!translationSession.apiKey.trim()) {
      setPendingTranslation({ paper, field });
      setSettingsOpen(true);
      return;
    }
    await translatePaperField(paper, field, translationSession);
  }

  async function translatePaperField(
    paper: ArxivPaper,
    field: 'title' | 'abstract',
    session: MobileTranslationSession
  ): Promise<void> {
    const requestId = `${paper.stableId}:${field}`;
    setTranslating(requestId);
    setTranslationErrors((current) => ({ ...current, [paper.stableId]: '' }));
    try {
      const translation = await translateAcademicText(field === 'title' ? paper.title : paper.summary, session);
      const target = field === 'title' ? 'titleZh' : 'abstractZh';
      setPaperTranslations((current) => ({
        ...current,
        [paper.stableId]: {
          ...current[paper.stableId],
          [target]: translation
        }
      }));
    } catch (error) {
      setTranslationErrors((current) => ({
        ...current,
        [paper.stableId]: `翻译失败：${formatError(error)}`
      }));
    } finally {
      setTranslating((current) => current === requestId ? '' : current);
    }
  }

  return (
    <section className="mobile-screen mobile-arxiv-screen" aria-label="arXiv 检索">
      <header className="mobile-screen-header">
        <div>
          <strong>arXiv 检索</strong>
          <span>找到后直接存入本地论文库</span>
        </div>
        <div className="mobile-screen-header-actions">
          <button type="button" className="mobile-square-button" onClick={() => setSettingsOpen(true)} aria-label="翻译设置">译</button>
          <button type="button" className="mobile-square-button" disabled={status === 'loading'} onClick={() => void handleSearch(true)} aria-label="强制刷新">↺</button>
        </div>
      </header>

      <div className="mobile-screen-scroll">
        <form
          className="mobile-arxiv-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSearch();
          }}
        >
          <input disabled={status === 'loading'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：安全强化学习 CBF" />
          <button type="submit" disabled={status === 'loading'}>{status === 'loading' ? '检索中' : '检索'}</button>
        </form>

        <div className="mobile-arxiv-filters">
          <label>
            <span>排序</span>
            <select disabled={status === 'loading'} value={sortBy} onChange={(event) => setSortBy(event.target.value as ArxivSearchRequest['sortBy'])}>
              <option value="comprehensive">综合</option>
              <option value="submittedDate">最新提交</option>
              <option value="lastUpdatedDate">最近更新</option>
              <option value="relevance">相关度</option>
            </select>
          </label>
          <label>
            <span>分类</span>
            <select disabled={status === 'loading'} value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">全部</option>
              <option value="cs.RO">cs.RO 机器人</option>
              <option value="cs.LG">cs.LG 机器学习</option>
              <option value="cs.AI">cs.AI 人工智能</option>
              <option value="eess.SY">eess.SY 系统控制</option>
            </select>
          </label>
        </div>

        <p className={`mobile-arxiv-status is-${status}`}>{message}</p>

        {status === 'idle' ? (
          <div className="mobile-search-suggestions">
            <strong>从研究问题开始</strong>
            {['safe reinforcement learning', 'physics-informed neural network', 'robot navigation CBF', 'model predictive control'].map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => setQuery(suggestion)}>{suggestion}</button>
            ))}
          </div>
        ) : null}

        <div className="mobile-arxiv-results">
          {papers.map((paper) => (
            <article key={paper.id} className="mobile-arxiv-result">
              <div className="mobile-arxiv-result-meta">
                <span>{paper.primaryCategory || paper.categories[0] || 'arXiv'}</span>
                <time>{formatDate(paper.published)}</time>
              </div>
              <h2>{paper.title}</h2>
              {paperTranslations[paper.stableId]?.titleZh ? <h3 className="mobile-arxiv-title-zh">{paperTranslations[paper.stableId].titleZh}</h3> : null}
              <p className="mobile-arxiv-summary-original">{paper.summary}</p>
              {paperTranslations[paper.stableId]?.abstractZh ? <p className="mobile-arxiv-summary-zh">{paperTranslations[paper.stableId].abstractZh}</p> : null}
              <div className="mobile-arxiv-translation-actions">
                <button
                  type="button"
                  className="mobile-arxiv-translate-title"
                  disabled={Boolean(translating)}
                  onClick={() => void handleTranslate(paper, 'title')}
                >
                  {translating === `${paper.stableId}:title` ? '标题翻译中…' : paperTranslations[paper.stableId]?.titleZh ? '重译标题' : '译标题'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(translating) || !paper.summary.trim()}
                  onClick={() => void handleTranslate(paper, 'abstract')}
                >
                  {translating === `${paper.stableId}:abstract` ? '摘要翻译中…' : paperTranslations[paper.stableId]?.abstractZh ? '重译摘要' : '译摘要'}
                </button>
              </div>
              {translationErrors[paper.stableId] ? <p className="mobile-arxiv-translation-error" role="alert">{translationErrors[paper.stableId]}</p> : null}
              <small>{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ` 等 ${paper.authors.length} 位作者` : ''}</small>
              <div className="mobile-arxiv-result-actions">
                {savingPaperId === paper.stableId ? (
                  <button type="button" className="is-cancel" onClick={onCancelSave}>取消下载</button>
                ) : (
                  <button type="button" disabled={Boolean(savingPaperId)} onClick={() => void onSavePaper(paper, paperTranslations[paper.stableId])}>存入论文库</button>
                )}
                <a href={paper.abstractUrl} target="_blank" rel="noreferrer">查看摘要</a>
              </div>
            </article>
          ))}
        </div>
      </div>

      {settingsOpen ? (
        <MobileTranslationSettingsDialog
          session={translationSession}
          title="标题与摘要翻译设置"
          submitLabel={pendingTranslation ? '保存并开始翻译' : '保存设置'}
          onClose={() => {
            setSettingsOpen(false);
            setPendingTranslation(null);
          }}
          onSave={async (next) => {
            await onTranslationSessionChange(next);
            setSettingsOpen(false);
            const pending = pendingTranslation;
            setPendingTranslation(null);
            if (pending) {
              await translatePaperField(pending.paper, pending.field, next);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString('zh-CN');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
