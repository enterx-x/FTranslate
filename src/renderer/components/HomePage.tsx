import { memo, useState } from 'react';
import brandMark from '../assets/brand-mark.png';
import translateIcon from '../assets/icons/duotone/translate.svg';
import libraryLineIcon from '../assets/icons/duotone/library.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import backIcon from '../assets/icons/duotone/back.svg';
import deleteIcon from '../assets/icons/duotone/delete.svg';
import type { PaperRecord } from '../lib/papers';
import type { ProjectWorkspaceSnapshot } from '../lib/researchProjects';

interface HomePageProps {
  papers: PaperRecord[];
  /** Kept for compatibility with callers that still share the home/library state. */
  activeSection: 'hub' | 'library';
  onSectionChange: (section: 'hub' | 'library') => void;
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  /** Legacy research module callbacks remain accepted while the library stays focused. */
  onOpenResearchSheet: (paper?: PaperRecord) => void;
  onOpenExperimentMatrix: () => void;
  onOpenKnowledgeGraph: () => void;
  onOpenPresentationGenerator: () => void;
  knowledgeGraphStats: {
    paperCount: number;
    nodeCount: number;
    edgeCount: number;
  };
  projectWorkspaceSnapshot: ProjectWorkspaceSnapshot;
  onUpdatePaper: (paper: PaperRecord) => void;
  onRemovePaper: (paper: PaperRecord) => void;
}

type EditablePaperField =
  | 'chineseTitle'
  | 'englishTitle'
  | 'journal'
  | 'authors'
  | 'year';

export type HomePageVisibleAction = 'import' | 'open' | 'edit' | 'remove';

const homePageVisibleActions: readonly HomePageVisibleAction[] = [
  'import',
  'open',
  'edit',
  'remove'
];

export function getHomePageVisibleActions(): HomePageVisibleAction[] {
  return [...homePageVisibleActions];
}

const editableFields: Array<{
  key: EditablePaperField;
  label: string;
}> = [
  { key: 'chineseTitle', label: '中文标题' },
  { key: 'englishTitle', label: '英文标题' },
  { key: 'journal', label: '期刊' },
  { key: 'authors', label: '作者' },
  { key: 'year', label: '年份' }
];

export function buildHomePageMetrics(papers: PaperRecord[]): {
  latestPaper: PaperRecord | undefined;
  notedPaperCount: number;
  dualPdfCount: number;
} {
  return {
    latestPaper: [...papers].sort((left, right) => {
      const leftTime = left.lastOpenedAt ? new Date(left.lastOpenedAt).getTime() : 0;
      const rightTime = right.lastOpenedAt ? new Date(right.lastOpenedAt).getTime() : 0;
      return rightTime - leftTime;
    })[0],
    notedPaperCount: papers.filter((paper) => paper.notes?.trim()).length,
    dualPdfCount: papers.filter((paper) => paper.translatedPdfPath).length
  };
}

export const HomePage = memo(function HomePage(props: HomePageProps) {
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [draftPaper, setDraftPaper] = useState<PaperRecord | null>(null);

  function startEdit(paper: PaperRecord): void {
    setEditingPaperId(paper.id);
    setDraftPaper({ ...paper });
  }

  function cancelEdit(): void {
    setEditingPaperId(null);
    setDraftPaper(null);
  }

  function saveEdit(): void {
    if (!draftPaper) {
      return;
    }

    props.onUpdatePaper(draftPaper);
    cancelEdit();
  }

  function updateDraft(field: EditablePaperField, value: string): void {
    setDraftPaper((paper) => (paper ? { ...paper, [field]: value } : paper));
  }

  function confirmRemovePaper(paper: PaperRecord): void {
    const title = paper.chineseTitle || paper.englishTitle || paper.pdfName;
    if (window.confirm(`确认从论文库移除“${title}”？本操作只移除本地记录，不会删除 PDF 文件。`)) {
      props.onRemovePaper(paper);
    }
  }

  return (
    <main className="home-page paper-library-page" data-home-surface="library">
      <header className="home-hero paper-library-hero">
        <div className="home-hero-brand">
          <img className="home-header-mark" src={brandMark} alt="" />
          <div>
            <span className="eyebrow">Paper Library</span>
            <h1>论文库</h1>
            <p>保存本地论文记录，继续阅读并管理标题、作者、来源和阅读进度。</p>
          </div>
        </div>
        <div className="home-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onSectionChange('hub')}>
            <img className="button-icon" src={backIcon} alt="" />
            <span>今日</span>
          </button>
          <button type="button" className="primary-button button-with-icon" onClick={props.onNewProject}>
            <img className="button-icon" src={translateIcon} alt="" />
            <span>导入论文</span>
          </button>
        </div>
      </header>

      {props.papers.length === 0 ? (
        <section className="home-empty" data-home-state="empty">
          <img className="empty-state-icon" src={libraryLineIcon} alt="" />
          <h2>还没有论文记录</h2>
          <p>导入一份 PDF 后，它会保存在本地论文库中，方便后续阅读和整理。</p>
          <button type="button" className="primary-button" onClick={props.onNewProject}>
            导入第一篇论文
          </button>
        </section>
      ) : (
        <section className="paper-library-list-wrap" data-home-state="ready">
          <div className="paper-grid-toolbar">
            <span>
              已收录 <strong>{props.papers.length}</strong> 篇论文
            </span>
            <span>PDF、翻译、双语 PDF、笔记和 AI 缓存状态会以标签形式展示。</span>
          </div>
          <div className="paper-library-list">
            {props.papers.map((paper) => {
              const isEditing = editingPaperId === paper.id && Boolean(draftPaper);
              const visiblePaper = isEditing && draftPaper ? draftPaper : paper;
              const primaryTitle = visiblePaper.chineseTitle || visiblePaper.englishTitle || visiblePaper.pdfName;
              const secondaryTitle =
                visiblePaper.chineseTitle && visiblePaper.englishTitle ? visiblePaper.englishTitle : visiblePaper.pdfName;

              return (
                <article key={paper.id} className={`paper-library-row${isEditing ? ' is-editing' : ''}`}>
                  <div className="paper-library-row-main">
                    {isEditing ? (
                      <div className="paper-library-edit-grid">
                        {editableFields.map((field) => (
                          <label key={field.key}>
                            <span>{field.label}</span>
                            <input
                              value={visiblePaper[field.key]}
                              onChange={(event) => updateDraft(field.key, event.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div className="paper-library-title-block">
                          <h2 title={primaryTitle}>{primaryTitle || '-'}</h2>
                          <p title={secondaryTitle}>{secondaryTitle || '-'}</p>
                        </div>
                        <div className="paper-library-meta-row">
                          <span>{visiblePaper.journal || '未知来源'}</span>
                          <span>{visiblePaper.year || '年份未知'}</span>
                          <span title={visiblePaper.authors}>{visiblePaper.authors || '作者未知'}</span>
                        </div>
                        <div className="paper-status-stack">
                          <span className="badge">PDF</span>
                          {paper.translationName ? <span className="badge">段落翻译</span> : null}
                          {paper.aiCacheName ? <span className="badge">AI 缓存</span> : null}
                          {paper.translatedPdfName ? <span className="badge">双语 PDF</span> : null}
                          {paper.notes.trim() ? <span className="badge">笔记</span> : null}
                        </div>
                        <div className="path-hint" title={paper.pdfName}>{paper.pdfName}</div>
                      </>
                    )}
                  </div>

                  <div className="paper-library-row-side">
                    <div className="paper-library-open-state">
                      <span>最近打开</span>
                      <strong>{formatDateTime(paper.lastOpenedAt)}</strong>
                      <small>第 {paper.lastPage || 1} 页</small>
                    </div>
                    <div className="paper-library-actions">
                      {isEditing ? (
                        <>
                          <button type="button" className="primary-button" onClick={saveEdit}>
                            保存
                          </button>
                          <button type="button" className="secondary-button" onClick={cancelEdit}>
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="button-with-icon" onClick={() => props.onOpenPaper(paper)}>
                            <img className="button-icon" src={pdfReaderIcon} alt="" />
                            <span>打开阅读</span>
                          </button>
                          {paper.notes.trim() ? (
                            <button type="button" className="secondary-button" onClick={() => props.onOpenPaper(paper)}>
                              查看笔记
                            </button>
                          ) : null}
                          <button type="button" className="secondary-button" onClick={() => startEdit(paper)}>
                            编辑信息
                          </button>
                          <button
                            type="button"
                            className="danger-button button-with-icon"
                            onClick={() => confirmRemovePaper(paper)}
                          >
                            <img className="button-icon" src={deleteIcon} alt="" />
                            <span>移除</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
});

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
