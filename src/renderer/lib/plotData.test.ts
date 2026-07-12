import { describe, expect, it } from 'vitest';
import type { PlotTransformStep } from '../../shared/scientificPlot';
import type { ResearchWorkbook } from './researchWorkbook';
import {
  applyPlotTransforms,
  auditPlotData,
  hashPlotDataTable,
  parseDelimitedPlotData,
  parsePastedPlotData,
  plotDataFromResearchWorkbook
} from './plotData';

const fixedOptions = {
  id: 'data-1',
  sourceName: 'success_rate.csv',
  createdAt: '2026-07-12T00:00:00.000Z'
};

describe('plot data import', () => {
  it('parses quoted CSV fields and infers category/number columns', () => {
    const table = parseDelimitedPlotData(
      'algorithm,score\n"CBF, RL",0.91\nPPO,0.82',
      fixedOptions
    );

    expect(table.columns.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'algorithm', type: 'category' },
      { id: 'score', type: 'number' }
    ]);
    expect(table.rows[0]).toEqual(['CBF, RL', 0.91]);
  });

  it('handles UTF-8 BOM, TSV, duplicate headers, booleans and missing values', () => {
    const table = parseDelimitedPlotData(
      '\uFEFFseed\tscore\tscore\tvalid\n1\t0.8\t\ttrue\n2\t0.9\t0.91\tfalse',
      { ...fixedOptions, sourceName: 'result.tsv', delimiter: '\t' }
    );

    expect(table.columns.map((column) => column.id)).toEqual(['seed', 'score', 'score_2', 'valid']);
    expect(table.columns.map((column) => column.type)).toEqual([
      'integer',
      'number',
      'number',
      'boolean'
    ]);
    expect(table.rows[0]).toEqual([1, 0.8, null, true]);
    expect(auditPlotData(table)).toMatchObject({ missingCellCount: 1, duplicateRowCount: 0 });
  });

  it('accepts table text pasted from Excel', () => {
    const table = parsePastedPlotData('method\treturn\nPPO\t12.5\nSAC\t14.2', {
      id: 'pasted',
      createdAt: fixedOptions.createdAt
    });

    expect(table.source).toMatchObject({ kind: 'paste', name: '剪贴板数据' });
    expect(table.rows).toEqual([
      ['PPO', 12.5],
      ['SAC', 14.2]
    ]);
  });

  it('converts a whole ResearchWorkbook and a selected range', () => {
    const workbook: ResearchWorkbook = {
      id: 'book-1',
      sheetName: 'Results',
      freeze: { xSplit: 0, ySplit: 1 },
      columns: [
        { key: 'algorithm', label: 'algorithm', width: 120 },
        { key: 'steps', label: 'steps', width: 120 },
        { key: 'score', label: 'score', width: 120 }
      ],
      rows: [
        { id: 'header', cells: [{ value: 'algorithm' }, { value: 'steps' }, { value: 'score' }] },
        { id: 'r1', cells: [{ value: 'PPO' }, { value: '50000' }, { value: '0.8' }] },
        { id: 'r2', cells: [{ value: 'SAC' }, { value: '50000' }, { value: '0.7' }] }
      ]
    };

    const whole = plotDataFromResearchWorkbook(workbook, undefined, {
      id: 'whole',
      createdAt: fixedOptions.createdAt
    });
    const selection = plotDataFromResearchWorkbook(
      workbook,
      { startRow: 1, endRow: 2, startColumn: 0, endColumn: 1, a1Notation: 'A2:B3' },
      { id: 'selection', createdAt: fixedOptions.createdAt }
    );

    expect(whole.rows).toHaveLength(2);
    expect(whole.columns.map((column) => column.id)).toEqual(['algorithm', 'steps', 'score']);
    expect(selection.columns.map((column) => column.id)).toEqual(['algorithm', 'steps']);
    expect(selection.rows).toEqual([
      ['PPO', 50000],
      ['SAC', 50000]
    ]);
    expect(selection.source.range).toBe('A2:B3');
  });
});

describe('plot data transformations', () => {
  const source = parseDelimitedPlotData(
    'algorithm,seed,score_50k,score_100k\nPPO,1,0.5,0.7\nPPO,2,0.7,0.9\nSAC,1,0.4,0.6',
    fixedOptions
  );

  it('applies wide-to-long, filtering, derivation and grouped mean in order', () => {
    const steps: PlotTransformStep[] = [
      {
        id: 'long',
        type: 'wideToLong',
        enabled: true,
        label: '宽表转长表',
        params: {
          idFields: ['algorithm', 'seed'],
          valueFields: ['score_50k', 'score_100k'],
          variableField: 'step',
          valueField: 'score'
        }
      },
      {
        id: 'filter',
        type: 'filter',
        enabled: true,
        label: '只保留 PPO',
        params: { field: 'algorithm', operator: 'equals', value: 'PPO' }
      },
      {
        id: 'percent',
        type: 'derive',
        enabled: true,
        label: '转换百分比',
        params: { outputField: 'score_percent', operation: 'multiply', field: 'score', value: 100 }
      },
      {
        id: 'mean',
        type: 'groupAggregate',
        enabled: true,
        label: '按步数求均值',
        params: { groupBy: ['algorithm', 'step'], valueField: 'score_percent', operation: 'mean', outputField: 'mean' }
      }
    ];

    const result = applyPlotTransforms(source, steps);

    expect(result.table.columns.map((column) => column.id)).toEqual(['algorithm', 'step', 'mean']);
    expect(result.table.rows).toEqual([
      ['PPO', 'score_50k', 60],
      ['PPO', 'score_100k', 80]
    ]);
    expect(result.records.map((record) => record.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
  });

  it('does not mutate the imported raw snapshot', () => {
    const before = JSON.stringify(source);
    applyPlotTransforms(source, [
      {
        id: 'sort',
        type: 'sort',
        enabled: true,
        label: '排序',
        params: { field: 'score_50k', direction: 'descending' }
      }
    ]);

    expect(JSON.stringify(source)).toBe(before);
  });

  it('produces stable content hashes and detects duplicate rows', async () => {
    const duplicate = parseDelimitedPlotData('x,y\n1,A\n1,A', fixedOptions);

    expect(auditPlotData(duplicate).duplicateRowCount).toBe(1);
    expect(await hashPlotDataTable(duplicate)).toBe(await hashPlotDataTable(duplicate));
  });
});
