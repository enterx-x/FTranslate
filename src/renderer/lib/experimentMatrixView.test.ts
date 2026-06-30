import { describe, expect, it } from 'vitest';
import {
  filterExperimentMatrixRows,
  selectExperimentMatrixRow,
  summarizeExperimentMatrixRows
} from './experimentMatrixView';
import type { ExperimentMatrixRow } from './experimentMatrix';

function row(overrides: Partial<ExperimentMatrixRow>): ExperimentMatrixRow {
  return {
    id: 'matrix-row',
    projectId: 'project-a',
    paperId: 'paper-a',
    methodCardId: 'method-card-a',
    group: 'baseline',
    paper: 'Safe RL Navigation',
    hypothesis: '复现 PPO baseline',
    baseline: 'PPO',
    proposed: '',
    ablation: '',
    controlledVariables: 'dynamic obstacles',
    seeds: '1, 2, 3',
    metrics: 'success rate, collision rate',
    expectedResult: 'baseline upper bound',
    status: 'planned',
    evidenceSourceIds: ['ev-1'],
    evidenceLocators: ['p. 7 Results'],
    ...overrides
  };
}

describe('experiment matrix view helpers', () => {
  const rows = [
    row({ id: 'baseline', group: 'baseline', status: 'planned' }),
    row({
      id: 'proposed',
      group: 'proposed',
      status: 'running',
      paper: 'Physics Informed MPC',
      hypothesis: '验证 PINN residual 是否提升 sample efficiency',
      proposed: 'PINN guided actor critic',
      evidenceLocators: ['p. 4 Method', 'fig. 2']
    }),
    row({
      id: 'ablation',
      group: 'ablation',
      status: 'blocked',
      ablation: 'without CBF safety layer',
      evidenceSourceIds: [],
      evidenceLocators: []
    })
  ];

  it('summarizes status, group and evidence coverage for a dense header', () => {
    expect(summarizeExperimentMatrixRows(rows)).toEqual({
      total: 3,
      byGroup: {
        baseline: 1,
        proposed: 1,
        ablation: 1
      },
      byStatus: {
        planned: 1,
        running: 1,
        blocked: 1,
        done: 0
      },
      evidenceCovered: 2,
      evidenceCoveragePercent: 67
    });
  });

  it('filters rows by group, status and traceable text', () => {
    expect(
      filterExperimentMatrixRows(rows, {
        group: 'proposed',
        status: 'running',
        query: 'pinn'
      }).map((item) => item.id)
    ).toEqual(['proposed']);

    expect(
      filterExperimentMatrixRows(rows, {
        group: 'all',
        status: 'all',
        query: 'fig. 2'
      }).map((item) => item.id)
    ).toEqual(['proposed']);
  });

  it('falls back to the first visible row when the selected row is missing', () => {
    expect(selectExperimentMatrixRow(rows, 'proposed')?.id).toBe('proposed');
    expect(selectExperimentMatrixRow(rows, 'missing')?.id).toBe('baseline');
    expect(selectExperimentMatrixRow([], 'missing')).toBeNull();
  });
});
