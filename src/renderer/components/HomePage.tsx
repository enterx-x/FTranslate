import { memo, useMemo } from 'react';
import brandMark from '../assets/brand-mark.png';
import translateIcon from '../assets/icons/duotone/translate.svg';
import libraryLineIcon from '../assets/icons/duotone/library.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import graphIcon from '../assets/icons/duotone/analysis.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import type { PaperRecord } from '../lib/papers';
import type { ProjectWorkspaceSnapshot, ResearchProject } from '../lib/researchProjects';
import { PaperLibraryPage } from './PaperLibraryPage';

interface HomePageProps {
  papers: PaperRecord[];
  activeSection: 'hub' | 'library';
  onSectionChange: (section: 'hub' | 'library') => void;
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
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
  researchProjects?: ResearchProject[];
  onResearchProjectsChange?: (projects: ResearchProject[]) => void;
  onUpdatePapers?: (papers: PaperRecord[]) => void;
  onRemovePapers?: (paperIds: string[]) => void;
}

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
  key:
    | 'import-paper'
    | 'continue-reading'
    | 'open-research-sheet'
    | 'open-experiment-matrix'
    | 'open-graph'
    | 'open-presentation'
    | 'open-library';
  label: string;
  detail: string;
  actionLabel: string;
}

interface ResearchWorkflowCard {
  key: string;
  label: string;
  detail: string;
  metricLabel: string;
  metricValue: string;
  status: ResearchObjectStatus | ResearchPipelineStatus;
  actionKey: ResearchWorkspaceNextAction['key'];
  actionLabel: string;
}

interface ResearchWorkflowColumn {
  key: ResearchWorkspacePipelineStage['key'];
  title: string;
  subtitle: string;
  icon: string;
  stage: ResearchWorkspacePipelineStage;
  cards: ResearchWorkflowCard[];
}

export interface ResearchWorkspaceOverview {
  objectCards: ResearchWorkspaceObjectCard[];
  pipeline: ResearchWorkspacePipelineStage[];
  risks: ResearchWorkspaceRisk[];
  nextActions: ResearchWorkspaceNextAction[];
}

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
  const { latestPaper, notedPaperCount, dualPdfCount } = useMemo(
    () => buildHomePageMetrics(props.papers),
    [props.papers]
  );
  const workspaceOverview = useMemo(
    () => buildResearchWorkspaceOverview(props.papers, props.knowledgeGraphStats),
    [props.knowledgeGraphStats, props.papers]
  );
  const papersObject = workspaceOverview.objectCards.find((card) => card.key === 'papers')!;
  const evidenceObject = workspaceOverview.objectCards.find((card) => card.key === 'evidenceGraph')!;
  const notesObject = workspaceOverview.objectCards.find((card) => card.key === 'notes')!;
  const bilingualObject = workspaceOverview.objectCards.find((card) => card.key === 'bilingualAssets')!;
  const methodStage = workspaceOverview.pipeline.find((stage) => stage.key === 'method')!;
  const codeStage = workspaceOverview.pipeline.find((stage) => stage.key === 'code')!;
  const experimentStage = workspaceOverview.pipeline.find((stage) => stage.key === 'experiment')!;
  const runtimeStage = workspaceOverview.pipeline.find((stage) => stage.key === 'runtime')!;
  const workflowColumns: ResearchWorkflowColumn[] = [
    {
      key: 'method',
      title: 'Paper-to-Method',
      subtitle: '论文证据编译',
      icon: libraryLineIcon,
      stage: methodStage,
      cards: [
        {
          key: 'method-card',
          label: '方法卡字段',
          detail: methodStage.detail,
          metricLabel: papersObject.label,
          metricValue: papersObject.value,
          status: methodStage.status,
          actionKey: props.papers.length > 0 ? 'open-research-sheet' : 'import-paper',
          actionLabel: props.papers.length > 0 ? '整理字段' : '导入论文'
        }
      ]
    },
    {
      key: 'code',
      title: 'Paper-to-Code',
      subtitle: '复现路径映射',
      icon: pdfReaderIcon,
      stage: codeStage,
      cards: [
        {
          key: 'code-mapping',
          label: '复现映射入口',
          detail: codeStage.detail,
          metricLabel: '仓库状态',
          metricValue: '待接入',
          status: codeStage.status,
          actionKey: 'open-library',
          actionLabel: '整理论文'
        }
      ]
    },
    {
      key: 'experiment',
      title: 'Experiment Matrix',
      subtitle: 'baseline / ablation',
      icon: researchSheetIcon,
      stage: experimentStage,
      cards: [
        {
          key: 'experiment-design',
          label: '实验矩阵草案',
          detail: experimentStage.detail,
          metricLabel: notesObject.label,
          metricValue: String(notedPaperCount),
          status: experimentStage.status,
          actionKey: 'open-experiment-matrix',
          actionLabel: '设计实验'
        }
      ]
    },
    {
      key: 'runtime',
      title: 'Runtime Center',
      subtitle: '本地能力状态',
      icon: translateIcon,
      stage: runtimeStage,
      cards: [
        {
          key: 'runtime-assets',
          label: '本地运行资产',
          detail: runtimeStage.detail,
          metricLabel: bilingualObject.label,
          metricValue: String(dualPdfCount),
          status: runtimeStage.status,
          actionKey: props.papers.length > 0 ? 'continue-reading' : 'import-paper',
          actionLabel: props.papers.length > 0 ? '检查资产' : '导入论文'
        }
      ]
    }
  ];
  const inspectorFocus = workflowColumns[0];

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
      case 'open-experiment-matrix':
        props.onOpenExperimentMatrix();
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
      <main className="home-page home-hub-page research-workbench-page research-os-home">
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
                {props.papers.slice(0, 3).map((paper) => (
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

          <section className="research-workbench-main" aria-label="研发流程看板">
            <section className="research-panel research-workflow-board" aria-label="研发流程看板">
              <div className="research-workflow-board-header">
                <div>
                  <span className="eyebrow">Workflow Board</span>
                  <h2>论文到实验研发看板</h2>
                </div>
                <div className="research-workflow-board-meta" aria-label="本地研发对象概览">
                  <span>{papersObject.value} 论文</span>
                  <span>{evidenceObject.value} 证据节点</span>
                  <span>{bilingualObject.value} 双语资产</span>
                  <em>Local only</em>
                </div>
              </div>

              <div className="research-workflow-grid">
                {workflowColumns.map((column, index) => (
                  <section key={column.key} className={`research-workflow-column status-${toStatusClassName(column.stage.status)}`}>
                    <div className="research-workflow-column-head">
                      <span className="research-workflow-step">{String(index + 1).padStart(2, '0')}</span>
                      <img className="button-icon" src={column.icon} alt="" />
                      <span>
                        <strong>{column.title}</strong>
                        <small>{column.subtitle}</small>
                      </span>
                      <em>{column.stage.status}</em>
                    </div>
                    {column.cards.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        className={`research-workflow-card status-${toStatusClassName(card.status)}`}
                        onClick={() => runWorkspaceAction(card.actionKey)}
                      >
                        <span className="research-workflow-card-top">
                          <span className="research-workflow-card-kicker">{card.metricLabel}</span>
                          <span className={`research-workflow-card-state status-${toStatusClassName(card.status)}`}>
                            {card.status}
                          </span>
                        </span>
                        <strong>{card.label}</strong>
                        <p>{card.detail}</p>
                        <span className="research-workflow-card-foot">
                          <b>{card.metricValue}</b>
                          <em>{card.actionLabel}</em>
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
              </div>
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

          <aside className="research-workbench-detail research-workflow-inspector" aria-label="当前焦点和决策">
            <section className="research-panel research-inspector-shell">
              <section className="research-inspector-section research-inspector-focus">
                <div className="research-panel-heading">
                  <span className="eyebrow">Current Focus</span>
                  <h2>{inspectorFocus.title}</h2>
                </div>
                <div className="research-inspector-body">
                  <span className={`research-inspector-status status-${toStatusClassName(inspectorFocus.stage.status)}`}>
                    {inspectorFocus.stage.status}
                  </span>
                  <p>{inspectorFocus.stage.detail}</p>
                  <dl className="research-inspector-metrics">
                    <div>
                      <dt>{papersObject.label}</dt>
                      <dd>{papersObject.value}</dd>
                    </div>
                    <div>
                      <dt>{evidenceObject.label}</dt>
                      <dd>{evidenceObject.value}</dd>
                    </div>
                    <div>
                      <dt>{notesObject.label}</dt>
                      <dd>{notesObject.value}</dd>
                    </div>
                  </dl>
                  <button type="button" className="secondary-button button-with-icon" onClick={() => runWorkspaceAction(inspectorFocus.cards[0].actionKey)}>
                    <img className="button-icon" src={inspectorFocus.icon} alt="" />
                    <span>{inspectorFocus.cards[0].actionLabel}</span>
                  </button>
                </div>
              </section>

              <section className="research-inspector-section research-next-actions">
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

              <section className="research-inspector-section research-risk-panel">
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
            </section>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <PaperLibraryPage
      papers={props.papers}
      projects={props.researchProjects ?? []}
      onBackHome={() => props.onSectionChange('hub')}
      onNewProject={props.onNewProject}
      onOpenPaper={props.onOpenPaper}
      onOpenResearchSheet={props.onOpenResearchSheet}
      onUpdatePapers={props.onUpdatePapers ?? ((papers) => papers.forEach(props.onUpdatePaper))}
      onRemovePapers={
        props.onRemovePapers ??
        ((paperIds) =>
          props.papers
            .filter((paper) => paperIds.includes(paper.id))
            .forEach(props.onRemovePaper))
      }
      onProjectsChange={props.onResearchProjectsChange ?? (() => undefined)}
    />
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
