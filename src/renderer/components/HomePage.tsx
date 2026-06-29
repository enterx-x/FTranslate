import { memo, useMemo, useState } from 'react';
import brandMark from '../assets/brand-mark.png';
import translateIcon from '../assets/icons/duotone/translate.svg';
import libraryLineIcon from '../assets/icons/duotone/library.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import graphIcon from '../assets/icons/duotone/analysis.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import backIcon from '../assets/icons/duotone/back.svg';
import deleteIcon from '../assets/icons/duotone/delete.svg';
import type { PaperRecord } from '../lib/papers';
import type { ProjectWorkspaceSnapshot } from '../lib/researchProjects';

interface HomePageProps {
  papers: PaperRecord[];
  activeSection: 'hub' | 'library';
  onSectionChange: (section: 'hub' | 'library') => void;
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onOpenResearchSheet: (paper?: PaperRecord) => void;
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

type KnowledgeGraphStats = HomePageProps['knowledgeGraphStats'];

type ResearchObjectStatus = 'Ready' | 'Cached' | 'Setup needed' | 'Evidence missing';
type ResearchPipelineStatus = 'Ready' | 'Draftable' | 'Needs paper' | 'Needs evidence' | 'Planned';

interface ResearchWorkspaceObjectCard {
  key: 'papers' | 'evidenceGraph' | 'notes' | 'bilingualAssets';
  label: string;
  value: string;
  detail: string;
  status: ResearchObjectStatus;
}

interface ResearchWorkspacePipelineStage {
  key: 'method' | 'code' | 'experiment' | 'runtime';
  label: string;
  status: ResearchPipelineStatus;
  detail: string;
}

interface ResearchWorkspaceRisk {
  key: 'project-space' | 'code-mapping' | 'runtime-center';
  label: string;
  detail: string;
  actionLabel: string;
}

interface ResearchWorkspaceNextAction {
  key: 'import-paper' | 'continue-reading' | 'open-research-sheet' | 'open-graph' | 'open-presentation' | 'open-library';
  label: string;
  detail: string;
  actionLabel: string;
}

export interface ResearchWorkspaceOverview {
  objectCards: ResearchWorkspaceObjectCard[];
  pipeline: ResearchWorkspacePipelineStage[];
  risks: ResearchWorkspaceRisk[];
  nextActions: ResearchWorkspaceNextAction[];
}

const editableFields: Array<{
  key: EditablePaperField;
  label: string;
  width: string;
}> = [
  { key: 'chineseTitle', label: '中文标题', width: '19%' },
  { key: 'englishTitle', label: '英文标题', width: '22%' },
  { key: 'journal', label: '期刊', width: '10%' },
  { key: 'authors', label: '作者', width: '17%' },
  { key: 'year', label: '年份', width: '7%' }
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

export function buildResearchWorkspaceOverview(
  papers: PaperRecord[],
  knowledgeGraphStats: KnowledgeGraphStats
): ResearchWorkspaceOverview {
  const { latestPaper, notedPaperCount, dualPdfCount } = buildHomePageMetrics(papers);
  const paperCount = papers.length;
  const graphNodeCount = Math.max(knowledgeGraphStats.nodeCount, 0);
  const graphEdgeCount = Math.max(knowledgeGraphStats.edgeCount, 0);
  const hasPapers = paperCount > 0;
  const hasEvidenceGraph = graphNodeCount > 0 || graphEdgeCount > 0;
  const hasNotes = notedPaperCount > 0;
  const hasBilingualAssets = dualPdfCount > 0;
  const latestPaperTitle = latestPaper
    ? latestPaper.chineseTitle || latestPaper.englishTitle || latestPaper.pdfName
    : '';

  return {
    objectCards: [
      {
        key: 'papers',
        label: '论文对象',
        value: String(paperCount),
        status: hasPapers ? 'Ready' : 'Setup needed',
        detail: hasPapers ? '论文库已形成可追踪对象' : '先导入论文建立本地研究对象'
      },
      {
        key: 'evidenceGraph',
        label: '证据图谱',
        value: String(graphNodeCount),
        status: hasEvidenceGraph ? 'Ready' : 'Evidence missing',
        detail: hasEvidenceGraph ? `${graphEdgeCount} 条证据关系可用` : '等待论文、表格或笔记生成关系'
      },
      {
        key: 'notes',
        label: '阅读笔记',
        value: String(notedPaperCount),
        status: hasNotes ? 'Ready' : 'Setup needed',
        detail: hasNotes ? '可作为方法卡和实验设计线索' : '尚未沉淀阅读判断'
      },
      {
        key: 'bilingualAssets',
        label: '双语资产',
        value: String(dualPdfCount),
        status: hasBilingualAssets ? 'Cached' : 'Setup needed',
        detail: hasBilingualAssets ? '已有整体双语 PDF 缓存' : '尚未绑定可复用双语 PDF'
      }
    ],
    pipeline: [
      {
        key: 'method',
        label: 'Paper-to-Method',
        status: hasPapers ? 'Ready' : 'Needs paper',
        detail: hasPapers ? '可从论文、笔记和表格抽取方法卡' : '需要至少一篇论文作为输入'
      },
      {
        key: 'code',
        label: 'Paper-to-Code',
        status: 'Planned',
        detail: '代码仓库导入和方法-实现映射仍待接入'
      },
      {
        key: 'experiment',
        label: '实验矩阵',
        status: hasNotes || hasEvidenceGraph ? 'Draftable' : 'Needs evidence',
        detail: hasNotes || hasEvidenceGraph ? '已有证据可转化为 baseline / ablation' : '需要方法证据后再设计实验'
      },
      {
        key: 'runtime',
        label: 'Runtime Center',
        status: 'Planned',
        detail: 'NLLB、pdf2zh、API provider 和任务队列将集中展示'
      }
    ],
    risks: [
      {
        key: 'project-space',
        label: '项目空间数据结构仍未落地',
        detail: '当前仍以论文库和研究表格承载研发对象，项目、实验和决策还没有统一实体。',
        actionLabel: '定义项目模型'
      },
      {
        key: 'code-mapping',
        label: 'Paper-to-Code 复现链路缺口',
        detail: '还不能导入本地代码仓库、识别入口脚本或把论文模块映射到文件。',
        actionLabel: '接入仓库分析'
      },
      {
        key: 'runtime-center',
        label: 'Runtime 状态分散',
        detail: '离线翻译、pdf2zh、API 和缓存状态还散落在多个页面，排错成本高。',
        actionLabel: '建设 Runtime Center'
      }
    ],
    nextActions: hasPapers
      ? [
          {
            key: 'continue-reading',
            label: '继续最近论文',
            detail: latestPaperTitle || '打开最近收录论文继续阅读和整理证据',
            actionLabel: '继续阅读'
          },
          {
            key: 'open-research-sheet',
            label: '补全方法字段',
            detail: '把 problem、method、baseline、metric 和 limitation 写入研究表格',
            actionLabel: '打开表格'
          },
          {
            key: hasEvidenceGraph ? 'open-graph' : 'open-library',
            label: hasEvidenceGraph ? '检查证据关系' : '整理论文库',
            detail: hasEvidenceGraph ? '查看论文、方法、作者和指标之间的关系' : '先补齐标题、作者、期刊和年份',
            actionLabel: hasEvidenceGraph ? '打开图谱' : '进入论文库'
          }
        ]
      : [
          {
            key: 'import-paper',
            label: '建立第一个研究对象',
            detail: '选择英文论文 PDF，形成论文库记录和后续证据链入口',
            actionLabel: '导入论文'
          },
          {
            key: 'open-research-sheet',
            label: '查看研究表格结构',
            detail: '确认后续方法卡和实验矩阵的字段边界',
            actionLabel: '打开表格'
          },
          {
            key: 'open-presentation',
            label: '准备组会输出',
            detail: '导入 PDF 后可基于正文和图表候选生成 PPT 草稿',
            actionLabel: 'PPT 生成'
          }
        ]
  };
}

export const HomePage = memo(function HomePage(props: HomePageProps) {
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [draftPaper, setDraftPaper] = useState<PaperRecord | null>(null);
  const { latestPaper, notedPaperCount, dualPdfCount } = useMemo(
    () => buildHomePageMetrics(props.papers),
    [props.papers]
  );
  const workspaceOverview = useMemo(
    () => buildResearchWorkspaceOverview(props.papers, props.knowledgeGraphStats),
    [props.knowledgeGraphStats, props.papers]
  );

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

  function runWorkspaceAction(actionKey: ResearchWorkspaceNextAction['key']): void {
    switch (actionKey) {
      case 'import-paper':
        props.onNewProject();
        return;
      case 'continue-reading':
        latestPaper ? props.onOpenPaper(latestPaper) : props.onNewProject();
        return;
      case 'open-research-sheet':
        props.onOpenResearchSheet(latestPaper);
        return;
      case 'open-graph':
        props.onOpenKnowledgeGraph();
        return;
      case 'open-presentation':
        props.onOpenPresentationGenerator();
        return;
      case 'open-library':
        props.onSectionChange('library');
        return;
      default:
        return;
    }
  }

  if (props.activeSection === 'hub') {
    return (
      <main className="home-page home-hub-page research-workbench-page">
        <header className="research-workbench-header">
          <div className="research-workbench-title">
            <img className="home-header-mark" src={brandMark} alt="" />
            <div>
              <span className="eyebrow">Local AI R&D Workspace</span>
              <h1>AI 科创项目空间</h1>
              <p>把论文、证据、实验计划和本地运行状态收敛到可追踪的研发闭环。</p>
            </div>
          </div>
          <div className="research-workbench-actions">
            <button type="button" className="primary-button button-with-icon" onClick={props.onNewProject}>
              <img className="button-icon" src={translateIcon} alt="" />
              <span>导入论文</span>
            </button>
            <button type="button" className="secondary-button button-with-icon" onClick={() => props.onOpenResearchSheet()}>
              <img className="button-icon" src={researchSheetIcon} alt="" />
              <span>实验矩阵</span>
            </button>
            <button type="button" className="secondary-button button-with-icon" onClick={props.onOpenKnowledgeGraph}>
              <img className="button-icon" src={graphIcon} alt="" />
              <span>证据图谱</span>
            </button>
          </div>
        </header>

        <section className="research-workbench-shell" aria-label="AI 科创研发工作台">
          <aside className="research-workbench-rail" aria-label="当前项目概览">
            <section className="research-panel research-current-project">
              <div className="research-panel-heading">
                <span className="eyebrow">Project Space</span>
                <h2>{props.projectWorkspaceSnapshot.activeProject.name}</h2>
                <small>{props.projectWorkspaceSnapshot.projectStatusText}</small>
              </div>
              <dl className="research-kpi-list">
                <div>
                  <dt>论文</dt>
                  <dd>{props.projectWorkspaceSnapshot.linkedPaperCount}</dd>
                </div>
                <div>
                  <dt>证据</dt>
                  <dd>{props.projectWorkspaceSnapshot.evidenceCount}</dd>
                </div>
                <div>
                  <dt>双语 PDF</dt>
                  <dd>{props.projectWorkspaceSnapshot.dualPdfCount}</dd>
                </div>
                <div>
                  <dt>项目</dt>
                  <dd>{props.projectWorkspaceSnapshot.projectCount}</dd>
                </div>
              </dl>
              <button type="button" className="secondary-button button-with-icon" onClick={() => props.onSectionChange('library')}>
                <img className="button-icon" src={libraryLineIcon} alt="" />
                <span>进入论文库</span>
              </button>
            </section>

            <section className="research-panel">
              <div className="research-panel-heading is-row">
                <div>
                  <span className="eyebrow">Recent Papers</span>
                  <h2>最近论文</h2>
                </div>
                <span className="research-mini-badge">{props.papers.length}</span>
              </div>
              <div className="research-recent-stack">
                {props.papers.slice(0, 5).map((paper) => (
                  <button
                    key={paper.id}
                    type="button"
                    className="research-recent-paper"
                    onClick={() => props.onOpenPaper(paper)}
                    title={getPaperTitle(paper)}
                  >
                    <span>{getPaperTitle(paper)}</span>
                    <small>
                      {paper.journal || paper.year || paper.pdfName}
                      {paper.lastOpenedAt ? ` · ${formatDateTime(paper.lastOpenedAt)}` : ''}
                    </small>
                  </button>
                ))}
                {props.papers.length === 0 ? (
                  <p className="research-empty-copy">暂无论文对象。</p>
                ) : null}
              </div>
            </section>
          </aside>

          <section className="research-workbench-main" aria-label="研发对象和工作流">
            <section className="research-panel research-object-panel">
              <div className="research-panel-heading is-row">
                <div>
                  <span className="eyebrow">Research Objects</span>
                  <h2>当前研发对象</h2>
                </div>
                <span className="research-mini-badge">Local only</span>
              </div>
              <div className="research-object-grid">
                {workspaceOverview.objectCards.map((card) => (
                  <article key={card.key} className={`research-object-card status-${toStatusClassName(card.status)}`}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                    <small>{card.detail}</small>
                    <em>{card.status}</em>
                  </article>
                ))}
              </div>
            </section>

            <section className="research-panel research-pipeline-panel">
              <div className="research-panel-heading is-row">
                <div>
                  <span className="eyebrow">R&D Loop</span>
                  <h2>论文到实验闭环</h2>
                </div>
                <button type="button" className="secondary-button button-with-icon" onClick={props.onOpenPresentationGenerator}>
                  <img className="button-icon" src={translateIcon} alt="" />
                  <span>组会输出</span>
                </button>
              </div>
              <ol className="research-pipeline-list">
                {workspaceOverview.pipeline.map((stage, index) => (
                  <li key={stage.key} className={`status-${toStatusClassName(stage.status)}`}>
                    <span className="research-pipeline-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{stage.label}</strong>
                      <small>{stage.detail}</small>
                    </div>
                    <em>{stage.status}</em>
                  </li>
                ))}
              </ol>
            </section>

            <section className="research-command-strip" aria-label="主要研发入口">
              <button type="button" onClick={() => props.onOpenResearchSheet()}>
                <img className="button-icon" src={researchSheetIcon} alt="" />
                <span>实验矩阵</span>
              </button>
              <button type="button" onClick={props.onOpenKnowledgeGraph}>
                <img className="button-icon" src={graphIcon} alt="" />
                <span>证据图谱</span>
              </button>
              <button type="button" onClick={props.onOpenPresentationGenerator}>
                <img className="button-icon" src={translateIcon} alt="" />
                <span>组会 PPT</span>
              </button>
              <button type="button" onClick={() => props.onSectionChange('library')}>
                <img className="button-icon" src={libraryLineIcon} alt="" />
                <span>论文库</span>
              </button>
            </section>
          </section>

          <aside className="research-workbench-detail" aria-label="决策和风险">
            <section className="research-panel research-next-actions">
              <div className="research-panel-heading">
                <span className="eyebrow">Next Actions</span>
                <h2>下一步</h2>
              </div>
              <div className="research-action-stack">
                {workspaceOverview.nextActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="research-next-action"
                    onClick={() => runWorkspaceAction(action.key)}
                  >
                    <span>
                      <strong>{action.label}</strong>
                      <small>{action.detail}</small>
                    </span>
                    <em>{action.actionLabel}</em>
                  </button>
                ))}
              </div>
            </section>

            <section className="research-panel research-risk-panel">
              <div className="research-panel-heading">
                <span className="eyebrow">Decision Queue</span>
                <h2>风险与缺口</h2>
              </div>
              <div className="research-risk-list">
                {workspaceOverview.risks.map((risk) => (
                  <article key={risk.key}>
                    <span>{risk.actionLabel}</span>
                    <strong>{risk.label}</strong>
                    <p>{risk.detail}</p>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="home-page paper-library-page">
      <header className="home-hero paper-library-hero">
        <div className="home-hero-brand">
          <img className="home-header-mark" src={brandMark} alt="" />
          <div>
            <span className="eyebrow">Paper Library</span>
            <h1>论文库</h1>
            <p>浏览论文主要信息；复杂笔记、创新点和对照分析放到独立研究表格里整理。</p>
          </div>
        </div>
        <div className="home-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onSectionChange('hub')}>
            <img className="button-icon" src={backIcon} alt="" />
            <span>返回主页</span>
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onOpenResearchSheet()}>
            <img className="button-icon" src={researchSheetIcon} alt="" />
            <span>研究表格</span>
          </button>
          <button type="button" className="primary-button button-with-icon" onClick={props.onNewProject}>
            <img className="button-icon" src={translateIcon} alt="" />
            <span>新建翻译项目</span>
          </button>
        </div>
      </header>

      {props.papers.length === 0 ? (
        <section className="home-empty">
          <img className="empty-state-icon" src={libraryLineIcon} alt="" />
          <h2>还没有论文记录</h2>
          <p>点击“新建翻译项目”选择 PDF 即可加入论文库；手动段落翻译文件可以之后再导入。</p>
        </section>
      ) : (
        <section className="paper-library-list-wrap">
          <div className="paper-grid-toolbar">
            <span>
              已收录 <strong>{props.papers.length}</strong> 篇论文
            </span>
            <span>PDF、翻译、双语 PDF、笔记和 AI 缓存状态会以标签形式展示。</span>
          </div>
          <div className="paper-library-list">
            {props.papers.map((paper) => {
              const isEditing = editingPaperId === paper.id && draftPaper;
              const visiblePaper = isEditing ? draftPaper : paper;
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
                          <button type="button" className="secondary-button" onClick={() => props.onOpenResearchSheet(paper)}>
                            表格定位
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

function getPaperTitle(paper: PaperRecord): string {
  return paper.chineseTitle || paper.englishTitle || paper.pdfName;
}

function toStatusClassName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}
