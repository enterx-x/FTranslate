import { describe, expect, it } from 'vitest';
import {
  EXPERIMENT_MATRICES_KEY,
  EXPERIMENT_MATRIX_COLUMNS,
  buildExperimentMatrixRowsFromMethodCard,
  buildExperimentMatrixWorkbookFromMethodCards,
  buildExperimentMatrixWorkbookFromRows,
  exportExperimentMatrixMarkdown,
  mergeGeneratedExperimentRows,
  parseExperimentMatrixStates,
  serializeExperimentMatrixStates,
  updateExperimentMatrixRow
} from './experimentMatrix';
import type { EvidenceSource, MethodCard, MethodCardField, MethodCardFieldKey } from './methodCards';

function evidence(id: string, locator: string): EvidenceSource {
  return {
    id,
    paperId: 'paper-safe-rl',
    type: 'pdf-text',
    page: Number(locator.match(/\d+/u)?.[0] ?? 1),
    section: 'Method',
    locator,
    text: `${locator} source text`,
    score: 8
  };
}

function field(key: MethodCardFieldKey, value: string, evidenceSourceIds: string[]): MethodCardField {
  return {
    key,
    label: key,
    value,
    confidence: value ? 0.8 : 0,
    evidenceSourceIds,
    reviewState: 'unconfirmed'
  };
}

function makeCard(overrides: Partial<MethodCard> = {}): MethodCard {
  const evidenceSources = [
    evidence('ev-baseline', 'p. 6 · Experiments'),
    evidence('ev-metrics', 'p. 7 · Results'),
    evidence('ev-method', 'p. 3 · Method'),
    evidence('ev-constraints', 'p. 4 · Method')
  ];

  return {
    id: 'method-card-safe-rl',
    projectId: 'local-ai-rd-workspace',
    paperId: 'paper-safe-rl',
    title: 'Safe RL for Robot Navigation',
    status: 'needs-review',
    evidenceSources,
    fields: [
      field('problem', 'Safe robot navigation in dynamic clutter.', ['ev-method']),
      field('modelArchitecture', 'Graph neural network policy with CBF safety filter.', ['ev-method']),
      field('trainingObjective', 'PPO objective with collision penalty.', ['ev-method']),
      field('constraints', 'CBF safety constraints reduce violation.', ['ev-constraints']),
      field('datasetOrEnvironment', 'Navigation tasks in dynamic clutter.', ['ev-baseline']),
      field('baseline', 'MPC and vanilla PPO baselines.', ['ev-baseline']),
      field('metrics', 'success rate, collision rate and path length.', ['ev-metrics']),
      field('claimedContribution', 'Improves safe navigation over baselines.', ['ev-method'])
    ],
    createdAt: '2026-06-30T08:00:00.000Z',
    updatedAt: '2026-06-30T08:00:00.000Z',
    version: 1,
    ...overrides
  };
}

describe('experiment matrix', () => {
  it('turns a method card into baseline, proposed and ablation experiment rows', () => {
    const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());

    expect(rows.map((row) => row.group)).toEqual(['baseline', 'proposed', 'ablation']);
    expect(rows[0]).toMatchObject({
      paperId: 'paper-safe-rl',
      methodCardId: 'method-card-safe-rl',
      group: 'baseline',
      baseline: 'MPC and vanilla PPO baselines.',
      metrics: 'success rate, collision rate and path length.',
      status: 'planned'
    });
    expect(rows[1].proposed).toContain('Graph neural network policy');
    expect(rows[1].controlledVariables).toContain('Navigation tasks');
    expect(rows[2].ablation).toContain('without CBF safety constraints');
    expect(rows[2].evidenceLocators).toEqual(expect.arrayContaining(['p. 4 · Method', 'p. 7 · Results']));
  });

  it('builds a separate workbook-shaped matrix without overwriting the freeform research sheet', () => {
    const workbook = buildExperimentMatrixWorkbookFromMethodCards([makeCard()]);

    expect(workbook).toMatchObject({
      id: 'experiment-matrix-workbook',
      sheetName: '实验矩阵',
      freeze: { ySplit: 1, xSplit: 0 }
    });
    expect(workbook.columns.map((column) => column.key)).toEqual(
      EXPERIMENT_MATRIX_COLUMNS.map((column) => column.key)
    );
    expect(workbook.rows[0].cells.map((cell) => cell.value)).toEqual(
      EXPERIMENT_MATRIX_COLUMNS.map((column) => column.label)
    );
    expect(workbook.rows).toHaveLength(4);
    expect(workbook.rows[1].cells[1].value).toBe('baseline');
    expect(workbook.rows[2].cells[1].value).toBe('proposed');
    expect(workbook.rows[3].cells[1].value).toBe('ablation');
  });

  it('does not invent experiments when a method card has no grounded fields', () => {
    const emptyCard = makeCard({
      status: 'draft',
      evidenceSources: [],
      fields: [
        field('baseline', '', []),
        field('metrics', '', []),
        field('modelArchitecture', '', []),
        field('constraints', '', [])
      ]
    });

    expect(buildExperimentMatrixRowsFromMethodCard(emptyCard)).toEqual([]);
    expect(buildExperimentMatrixWorkbookFromMethodCards([emptyCard]).rows).toHaveLength(1);
  });

  it('parses project-scoped experiment matrix states and ignores invalid records', () => {
    const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
    const rawValue = JSON.stringify([
      {
        projectId: 'local-ai-rd-workspace',
        rows,
        selectedRowId: rows[1].id,
        updatedAt: '2026-06-30T10:00:00.000Z',
        version: 2
      },
      { projectId: '', rows: 'bad' }
    ]);

    expect(EXPERIMENT_MATRICES_KEY).toBe('pdfTranslationReader:experimentMatrices');
    expect(parseExperimentMatrixStates(rawValue)).toEqual([
      {
        projectId: 'local-ai-rd-workspace',
        rows,
        selectedRowId: rows[1].id,
        updatedAt: '2026-06-30T10:00:00.000Z',
        version: 2
      }
    ]);
  });

  it('serializes experiment matrix states with stable formatting', () => {
    const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
    const states = [
      {
        projectId: 'local-ai-rd-workspace',
        rows,
        selectedRowId: rows[0].id,
        updatedAt: '2026-06-30T10:00:00.000Z',
        version: 1
      }
    ];

    expect(serializeExperimentMatrixStates(states)).toBe(JSON.stringify(states, null, 2));
  });

  it('merges generated rows without overwriting user-edited rows', () => {
    const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
    const edited = {
      ...rows[1],
      hypothesis: 'user edited hypothesis',
      status: 'running' as const
    };

    const merged = mergeGeneratedExperimentRows([edited], rows);

    expect(merged.find((row) => row.id === edited.id)).toMatchObject({
      hypothesis: 'user edited hypothesis',
      status: 'running'
    });
    expect(merged.map((row) => row.group)).toEqual(['baseline', 'proposed', 'ablation']);
  });

  it('patches one experiment matrix row while preserving immutable identifiers', () => {
    const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
    const nextRows = updateExperimentMatrixRow(rows, rows[0].id, {
      status: 'blocked',
      metrics: 'manual metric'
    });

    expect(nextRows[0]).toMatchObject({
      id: rows[0].id,
      projectId: rows[0].projectId,
      paperId: rows[0].paperId,
      status: 'blocked',
      metrics: 'manual metric'
    });
  });

  it('exports experiment matrix rows to evidence-preserving markdown', () => {
    const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
    const markdown = exportExperimentMatrixMarkdown(rows);

    expect(markdown).toContain('# 实验矩阵');
    expect(markdown).toContain(
      '| 论文 | 实验组 | 假设 | Baseline | Proposed Method | Ablation | 控制变量 | Seeds | 指标 | 预期结果 | 状态 | 证据 |'
    );
    expect(markdown).toContain('Safe RL for Robot Navigation');
    expect(markdown).toContain('p. 7 · Results');
  });

  it('builds an experiment matrix workbook from edited rows', () => {
    const rows = updateExperimentMatrixRow(buildExperimentMatrixRowsFromMethodCard(makeCard()), 'missing', {});
    const workbook = buildExperimentMatrixWorkbookFromRows(rows);

    expect(workbook.sheetName).toBe('实验矩阵');
    expect(workbook.rows).toHaveLength(rows.length + 1);
    expect(workbook.rows[1].id).toBe(rows[0].id);
  });
});
