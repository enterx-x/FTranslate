import { describe, expect, it } from 'vitest';
import {
  EXPERIMENT_MATRIX_COLUMNS,
  buildExperimentMatrixRowsFromMethodCard,
  buildExperimentMatrixWorkbookFromMethodCards
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
});
