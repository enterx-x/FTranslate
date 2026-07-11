import {
  EXPERIMENT_MATRICES_KEY,
  buildExperimentMatrixWorkbookFromRows,
  exportExperimentMatrixMarkdown,
  serializeExperimentMatrixStates,
  type ExperimentMatrixRow
} from './experimentMatrix';
import {
  buildExperimentRowsFromProjectMethodCards,
  summarizeMethodCardExperimentBridge,
  type MethodCardExperimentBridgeSummary
} from './experimentMatrixBridge';
import {
  METHOD_CARDS_KEY,
  buildMethodCardFromEvidence,
  serializeMethodCards,
  type MethodCard
} from './methodCards';
import { PAPER_LIBRARY_KEY, type PaperRecord } from './papers';
import type { ExtractedPdfBlock, ExtractedBlockType } from './pdfTextStructure';
import {
  RESEARCH_PROJECTS_KEY,
  buildDefaultResearchProject,
  serializeResearchProjects,
  type ResearchProject
} from './researchProjects';
import type { ResearchWorkbook } from './researchWorkbook';

export interface ResearchLoopDemoInput {
  projectId: string;
  projectName: string;
  paper: PaperRecord;
  blocks: ExtractedPdfBlock[];
  now: string;
}

export interface ResearchLoopDemoCheck {
  id: string;
  label: string;
  passed: boolean;
  actual: string | number | boolean;
}

export interface ResearchLoopDemoQualityGate {
  passed: boolean;
  checks: ResearchLoopDemoCheck[];
}

export interface ResearchLoopDemoResult {
  project: ResearchProject;
  paper: PaperRecord;
  methodCard: MethodCard;
  experimentRows: ExperimentMatrixRow[];
  experimentWorkbook: ResearchWorkbook;
  bridgeSummary: MethodCardExperimentBridgeSummary;
  matrixMarkdown: string;
  storageSnapshot: Record<string, string>;
  qualityGate: ResearchLoopDemoQualityGate;
  generatedAt: string;
}

export interface ResearchLoopDemoSummary {
  projectId: string;
  projectName: string;
  paperId: string;
  paperTitle: string;
  methodCardId: string;
  methodCardStatus: MethodCard['status'];
  groundedFieldCount: number;
  evidenceSourceCount: number;
  experimentRowCount: number;
  experimentGroups: string[];
  evidenceLocatorCount: number;
  qualityPassed: boolean;
  generatedAt: string;
}

export function createDefaultResearchLoopDemoInput(): ResearchLoopDemoInput {
  const now = '2026-07-01T00:00:00.000Z';
  const paper: PaperRecord = {
    id: 'demo-paper-safe-rl-navigation',
    pdfPath: 'demo://papers/safe-rl-navigation.pdf',
    pdfName: 'safe-rl-navigation.pdf',
    translationPath: '',
    translationName: '',
    translatedPdfPath: 'demo://papers/safe-rl-navigation-bilingual.pdf',
    translatedPdfName: 'safe-rl-navigation-bilingual.pdf',
    chineseTitle: '安全强化学习机器人导航 Demo',
    englishTitle: 'Safe RL Navigation Demo',
    journal: 'Demo Proceedings',
    authors: 'FTranslate Demo Team',
    year: '2026',
      notes: '复现风险：需要确认 CBF safety filter 的 QP 求解器、动态障碍密度和多 seed 评估协议。',
      lastOpenedAt: now,
      lastPage: 1,
      tags: ['Safe RL', 'CBF'],
      isPinned: false,
      importedAt: now,
      updatedAt: now
  };

  return {
    projectId: 'local-ai-rd-workspace',
    projectName: '本地 AI 科创研发项目',
    paper,
    blocks: [
      block({
        page: 1,
        section: 'Abstract',
        original:
          'We propose a safe reinforcement learning navigation method that addresses robot collision risk in dynamic clutter and improves safe navigation over PPO baselines.'
      }),
      block({
        page: 3,
        section: 'Method',
        original:
          'The policy takes lidar observations and robot state as input and outputs velocity commands through a graph neural network controller.'
      }),
      block({
        page: 4,
        section: 'Method',
        original:
          'Training optimizes a PPO objective with collision penalty, reward regularisation and CBF safety constraints to reduce constraint violation.'
      }),
      block({
        page: 5,
        section: 'Method',
        type: 'caption',
        original:
          'Figure 2: Overview of the graph neural network policy, CBF safety filter and velocity command output.'
      }),
      block({
        page: 6,
        section: 'Experiments',
        original:
          'We evaluate navigation tasks in dynamic clutter and compare against MPC and vanilla PPO baselines.'
      }),
      block({
        page: 7,
        section: 'Results',
        type: 'caption',
        original:
          'Table 1: Success rate, collision rate and path length compared with MPC and PPO baselines.'
      })
    ],
    now
  };
}

export function buildResearchLoopDemo(input: ResearchLoopDemoInput): ResearchLoopDemoResult {
  const project = {
    ...buildDefaultResearchProject([input.paper], Date.parse(input.now)),
    id: input.projectId,
    name: input.projectName,
    experimentIds: [`demo-experiment-matrix-${input.paper.id}`],
    updatedAt: input.now
  };
  const methodCard = buildMethodCardFromEvidence({
    projectId: input.projectId,
    paper: input.paper,
    blocks: input.blocks,
    now: input.now
  });
  const experimentRows = buildExperimentRowsFromProjectMethodCards([methodCard], input.projectId);
  const experimentWorkbook = buildExperimentMatrixWorkbookFromRows(experimentRows);
  const bridgeSummary = summarizeMethodCardExperimentBridge([methodCard], input.projectId);
  const matrixMarkdown = exportExperimentMatrixMarkdown(experimentRows);
  const storageSnapshot = buildStorageSnapshot({
    input,
    project,
    methodCard,
    experimentRows
  });
  const qualityGate = evaluateResearchLoopDemo({
    methodCard,
    experimentRows,
    bridgeSummary,
    matrixMarkdown,
    storageSnapshot
  });

  return {
    project,
    paper: input.paper,
    methodCard,
    experimentRows,
    experimentWorkbook,
    bridgeSummary,
    matrixMarkdown,
    storageSnapshot,
    qualityGate,
    generatedAt: input.now
  };
}

export function buildResearchLoopDemoSummary(result: ResearchLoopDemoResult): ResearchLoopDemoSummary {
  const groundedFieldCount = result.methodCard.fields.filter(
    (field) => field.value.trim() && field.evidenceSourceIds.length > 0
  ).length;

  return {
    projectId: result.project.id,
    projectName: result.project.name,
    paperId: result.paper.id,
    paperTitle: result.paper.englishTitle || result.paper.chineseTitle || result.paper.pdfName,
    methodCardId: result.methodCard.id,
    methodCardStatus: result.methodCard.status,
    groundedFieldCount,
    evidenceSourceCount: result.methodCard.evidenceSources.length,
    experimentRowCount: result.experimentRows.length,
    experimentGroups: result.experimentRows.map((row) => row.group),
    evidenceLocatorCount: result.bridgeSummary.evidenceLocatorCount,
    qualityPassed: result.qualityGate.passed,
    generatedAt: result.generatedAt
  };
}

export function buildResearchLoopDemoArtifacts(result: ResearchLoopDemoResult): Record<string, string> {
  return {
    'README.md': buildRunbookMarkdown(result),
    'research-loop-summary.json': `${JSON.stringify(buildResearchLoopDemoSummary(result), null, 2)}\n`,
    'method-card.json': `${JSON.stringify(result.methodCard, null, 2)}\n`,
    'experiment-matrix.md': `${result.matrixMarkdown}\n`,
    'local-storage-seed.json': `${JSON.stringify(result.storageSnapshot, null, 2)}\n`
  };
}

function buildStorageSnapshot(input: {
  input: ResearchLoopDemoInput;
  project: ResearchProject;
  methodCard: MethodCard;
  experimentRows: ExperimentMatrixRow[];
}): Record<string, string> {
  return {
    [PAPER_LIBRARY_KEY]: JSON.stringify([input.input.paper], null, 2),
    [RESEARCH_PROJECTS_KEY]: serializeResearchProjects([input.project]),
    [METHOD_CARDS_KEY]: serializeMethodCards([input.methodCard]),
    [EXPERIMENT_MATRICES_KEY]: serializeExperimentMatrixStates([
      {
        projectId: input.input.projectId,
        rows: input.experimentRows,
        selectedRowId: input.experimentRows[0]?.id ?? null,
        updatedAt: input.input.now,
        version: 1
      }
    ])
  };
}

function evaluateResearchLoopDemo(input: {
  methodCard: MethodCard;
  experimentRows: ExperimentMatrixRow[];
  bridgeSummary: MethodCardExperimentBridgeSummary;
  matrixMarkdown: string;
  storageSnapshot: Record<string, string>;
}): ResearchLoopDemoQualityGate {
  const groundedFieldCount = input.methodCard.fields.filter(
    (field) => field.value.trim() && field.evidenceSourceIds.length > 0
  ).length;
  const groups = input.experimentRows.map((row) => row.group);
  const checks: ResearchLoopDemoCheck[] = [
    check('method-card-status', '方法卡进入待复核状态', input.methodCard.status === 'needs-review', input.methodCard.status),
    check('grounded-fields', '至少 6 个方法字段有证据', groundedFieldCount >= 6, groundedFieldCount),
    check('evidence-source-count', '至少 4 条证据来源', input.methodCard.evidenceSources.length >= 4, input.methodCard.evidenceSources.length),
    check('experiment-row-count', '生成 baseline / proposed / ablation 三行实验', input.experimentRows.length === 3, input.experimentRows.length),
    check('experiment-groups', '实验组顺序稳定', groups.join(',') === 'baseline,proposed,ablation', groups.join(',')),
    check(
      'evidence-locators',
      '每行实验都保留证据定位',
      input.experimentRows.every((row) => row.evidenceLocators.length > 0),
      input.experimentRows.map((row) => row.evidenceLocators.length).join(',')
    ),
    check('bridge-summary', '桥接摘要与实验行一致', input.bridgeSummary.generatedRowCount === input.experimentRows.length, input.bridgeSummary.generatedRowCount),
    check('markdown-export', 'Markdown 矩阵包含表头', input.matrixMarkdown.includes('| 论文 | 实验组 |'), input.matrixMarkdown.length),
    check('storage-snapshot', '输出 localStorage 兼容 seed', hasStorageKeys(input.storageSnapshot), Object.keys(input.storageSnapshot).length)
  ];

  return {
    passed: checks.every((item) => item.passed),
    checks
  };
}

function buildRunbookMarkdown(result: ResearchLoopDemoResult): string {
  const summary = buildResearchLoopDemoSummary(result);
  return [
    '# FTranslate Headless Research Loop Demo',
    '',
    'Run this demo from the repository root:',
    '',
    '```bash',
    'npm run demo:research-loop',
    '```',
    '',
    '## What It Demonstrates',
    '',
    '- Paper evidence blocks become a source-grounded Method Card.',
    '- The Method Card becomes baseline / proposed / ablation experiment rows.',
    '- The demo emits Markdown and localStorage-compatible seed data without opening Electron UI.',
    '',
    '## Summary',
    '',
    `- Project: ${summary.projectName} (${summary.projectId})`,
    `- Paper: ${summary.paperTitle} (${summary.paperId})`,
    `- Method card: ${summary.methodCardId} (${summary.methodCardStatus})`,
    `- Evidence sources: ${summary.evidenceSourceCount}`,
    `- Grounded fields: ${summary.groundedFieldCount}`,
    `- Experiment rows: ${summary.experimentRowCount} (${summary.experimentGroups.join(', ')})`,
    `- Quality gate: ${summary.qualityPassed ? 'passed' : 'failed'}`,
    '',
    '## Quality Gate',
    '',
    ...result.qualityGate.checks.map(
      (item) => `- ${item.passed ? '[x]' : '[ ]'} ${item.label}: ${String(item.actual)}`
    ),
    ''
  ].join('\n');
}

function check(
  id: string,
  label: string,
  passed: boolean,
  actual: string | number | boolean
): ResearchLoopDemoCheck {
  return {
    id,
    label,
    passed,
    actual
  };
}

function hasStorageKeys(snapshot: Record<string, string>): boolean {
  return [PAPER_LIBRARY_KEY, RESEARCH_PROJECTS_KEY, METHOD_CARDS_KEY, EXPERIMENT_MATRICES_KEY].every((key) =>
    Boolean(snapshot[key])
  );
}

function block(input: {
  page: number;
  section: string;
  original: string;
  type?: ExtractedBlockType;
}): ExtractedPdfBlock {
  const type = input.type ?? 'paragraph';
  return {
    id: `demo-block-${input.page}-${type}-${input.section.toLowerCase().replace(/[^a-z0-9]+/giu, '-')}`,
    type,
    page: input.page,
    section: input.section,
    original: input.original,
    translation: '',
    sourceHash: `${input.page}-${type}-${input.original.length}`
  };
}
