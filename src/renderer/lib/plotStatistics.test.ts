import { describe, expect, it } from 'vitest';
import type { AnalysisSpec, PlotDataTable } from '../../shared/scientificPlot';
import {
  adjustPValues,
  runPlotAnalysis,
  runPlotAnalyses
} from './plotStatistics';

const table: PlotDataTable = {
  id: 'stats-data',
  source: { kind: 'generated', name: 'reference fixture' },
  columns: [
    { id: 'group', label: 'group', type: 'category' },
    { id: 'subject', label: 'subject', type: 'category' },
    { id: 'value', label: 'value', type: 'number' }
  ],
  rows: [
    ['A', 's1', 1], ['A', 's2', 2], ['A', 's3', 3], ['A', 's4', 4], ['A', 's5', 5],
    ['B', 's1', 2], ['B', 's2', 4], ['B', 's3', 6], ['B', 's4', 8], ['B', 's5', 10],
    ['C', 's1', 8], ['C', 's2', 9], ['C', 's3', 10], ['C', 's4', 11], ['C', 's5', 12]
  ],
  createdAt: '2026-07-12T00:00:00.000Z'
};

function spec(type: AnalysisSpec['type'], extra: Partial<AnalysisSpec> = {}): AnalysisSpec {
  return {
    id: `analysis-${type}`,
    type,
    enabled: true,
    valueField: 'value',
    groupField: 'group',
    groups: ['A', 'B'],
    tail: 'two-sided',
    confidenceLevel: 0.95,
    alpha: 0.05,
    correction: 'none',
    effectSize: 'cohenD',
    ...extra
  };
}

describe('plot statistics', () => {
  it('computes traceable descriptive statistics with a confidence interval', async () => {
    const result = await runPlotAnalysis(table, spec('descriptive', { groups: ['A'] }), {
      now: '2026-07-12T01:00:00.000Z'
    });

    expect(result.status).toBe('ok');
    expect(result.summary?.mean).toBeCloseTo(3, 10);
    expect(result.summary?.standardDeviation).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(result.confidenceInterval?.lower).toBeLessThan(3);
    expect(result.confidenceInterval?.upper).toBeGreaterThan(3);
    expect(result.provenance).toMatchObject({ engine: 'javascript', generatedAt: '2026-07-12T01:00:00.000Z' });
  });

  it('computes Welch t and paired t without inventing missing pairs', async () => {
    const independent = await runPlotAnalysis(table, spec('independentT'));
    const paired = await runPlotAnalysis(table, spec('pairedT', { subjectField: 'subject' }));
    const invalid = await runPlotAnalysis(table, spec('pairedT', { subjectField: undefined }));

    expect(independent.status).toBe('ok');
    expect(independent.pValue).toBeCloseTo(0.1075311949, 8);
    expect(independent.effectSize?.type).toBe('cohenD');
    expect(paired.status).toBe('ok');
    expect(paired.sampleSizes).toEqual({ pairs: 5 });
    expect(invalid.status).toBe('invalid');
    expect(invalid.pValue).toBeUndefined();
  });

  it('computes ANOVA and non-parametric tests from explicit groups', async () => {
    const results = await runPlotAnalyses(table, [
      spec('oneWayAnova', { groups: ['A', 'B', 'C'], effectSize: 'etaSquared' }),
      spec('mannWhitney'),
      spec('wilcoxonSignedRank', { subjectField: 'subject' }),
      spec('kruskalWallis', { groups: ['A', 'B', 'C'] }),
      spec('friedman', { groups: ['A', 'B', 'C'], subjectField: 'subject' })
    ]);

    expect(results.every((result) => result.status === 'ok')).toBe(true);
    expect(results[0].statistic).toBeGreaterThan(0);
    expect(results[0].effectSize?.value).toBeGreaterThan(0);
    expect(results.slice(1).every((result) => typeof result.pValue === 'number')).toBe(true);
  });

  it('applies stable multiple-comparison corrections', () => {
    expect(adjustPValues([0.01, 0.04, 0.03], 'bonferroni')).toEqual([0.03, 0.12, 0.09]);
    expect(adjustPValues([0.01, 0.04, 0.03], 'holm')).toEqual([0.03, 0.06, 0.06]);
    expect(adjustPValues([0.01, 0.04, 0.03], 'benjaminiHochberg')).toEqual([0.03, 0.04, 0.04]);
  });
});
