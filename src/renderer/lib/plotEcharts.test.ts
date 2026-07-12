import { describe, expect, it } from 'vitest';
import { createDefaultScientificPlotSpec, type PlotDataTable } from '../../shared/scientificPlot';
import { compileScientificEchartsOption } from './plotEcharts';
import { createLabPlotTheme, getPlotThemePreset, PLOT_THEME_PRESETS } from './plotThemes';

const table: PlotDataTable = {
  id: 'chart-data',
  source: { kind: 'generated', name: 'fixture' },
  columns: [
    { id: 'algorithm', label: 'algorithm', type: 'category' },
    { id: 'steps', label: 'steps', type: 'integer' },
    { id: 'score', label: 'score', type: 'number' },
    { id: 'low', label: 'low', type: 'number' },
    { id: 'high', label: 'high', type: 'number' }
  ],
  rows: [
    ['PPO', 50, 0.5, 0.45, 0.55], ['PPO', 100, 0.7, 0.65, 0.75],
    ['SAC', 50, 0.4, 0.36, 0.44], ['SAC', 100, 0.6, 0.55, 0.65]
  ],
  createdAt: '2026-07-12T00:00:00.000Z'
};

describe('plot themes', () => {
  it('provides editable copies of all publication starting presets', () => {
    expect(Object.keys(PLOT_THEME_PRESETS)).toEqual([
      'general', 'natureScience', 'ieee', 'elsevier', 'chineseThesis'
    ]);
    const nature = getPlotThemePreset('natureScience');
    nature.palette[0] = '#000000';
    expect(getPlotThemePreset('natureScience').palette[0]).not.toBe('#000000');
    expect(createLabPlotTheme('导航实验室', nature).presetId).toBe('lab');
  });
});

describe('ECharts scientific compiler', () => {
  it('compiles grouped lines and real confidence intervals', () => {
    const spec = createDefaultScientificPlotSpec('line');
    spec.encodings = { x: 'steps', y: 'score', color: 'algorithm', errorLower: 'low', errorUpper: 'high' };
    const compiled = compileScientificEchartsOption(spec, table);
    const series = compiled.option.series as Array<{ type: string; name?: string }>;

    expect(series.filter((item) => item.type === 'line')).toHaveLength(2);
    expect(series.filter((item) => item.type === 'custom')).toHaveLength(2);
    expect(series.filter((item) => item.type === 'custom').every((item) => item.name === undefined)).toBe(true);
    expect(compiled.requiresGl).toBe(false);
  });

  it('uses real ECharts GL series for selected 3D rendering', () => {
    const spec = createDefaultScientificPlotSpec('surface');
    spec.chart.type = 'surface3d';
    spec.encodings = { x: 'steps', y: 'score', value: 'high' };
    const compiled = compileScientificEchartsOption(spec, table);

    expect((compiled.option.series as Array<{ type: string }>)[0].type).toBe('surface');
    expect(compiled.requiresGl).toBe(true);
  });

  it('applies editable axis range, scale, position, ticks, labels and grid styles', () => {
    const spec = createDefaultScientificPlotSpec('axes');
    spec.encodings = { x: 'steps', y: 'score' };
    spec.axes = [
      { id: 'x', label: '训练步数', min: 40, max: 120, tickInterval: 20, labelRotation: 30, position: 'secondary', numberFormat: 'fixed', decimalPlaces: 0, suffix: 'k', showGrid: false },
      { id: 'y', label: '成功率', scale: 'log', logBase: 2, tickCount: 6, minorTicks: true, showMinorGrid: true, gridColor: '#ccd6df', gridWidth: 1.2 }
    ];
    const compiled = compileScientificEchartsOption(spec, table);
    const xAxis = compiled.option.xAxis as Record<string, unknown>;
    const yAxis = compiled.option.yAxis as Record<string, unknown>;
    expect(xAxis).toMatchObject({ name: '训练步数', min: 40, max: 120, interval: 20, position: 'top', scale: true });
    expect(xAxis.axisLabel).toMatchObject({ rotate: 30 });
    expect((xAxis.axisLabel as { formatter: (value: number) => string }).formatter(50)).toBe('50k');
    expect(xAxis.splitLine).toMatchObject({ show: false });
    expect(yAxis).toMatchObject({ type: 'log', logBase: 2, splitNumber: 6 });
    expect(yAxis.minorTick).toMatchObject({ show: true });
    expect(yAxis.minorSplitLine).toMatchObject({ show: true });
  });

  it('compiles flow and distribution families without substituting a line chart', () => {
    const flowSpec = createDefaultScientificPlotSpec('flow');
    flowSpec.chart.type = 'alluvial';
    flowSpec.encodings = { source: 'algorithm', target: 'steps', value: 'score' };
    const violinSpec = createDefaultScientificPlotSpec('violin');
    violinSpec.chart.type = 'violin';
    violinSpec.encodings = { x: 'algorithm', y: 'score' };

    expect((compileScientificEchartsOption(flowSpec, table).option.series as Array<{ type: string }>)[0].type).toBe('sankey');
    expect((compileScientificEchartsOption(violinSpec, table).option.series as Array<{ type: string }>).map((item) => item.type)).toEqual(['custom', 'boxplot']);
  });

  it('rejects incomplete mappings instead of drawing a misleading chart', () => {
    const spec = createDefaultScientificPlotSpec('invalid');
    expect(() => compileScientificEchartsOption(spec, table)).toThrow(/缺少 x/);
  });

  it('does not force a year axis to start at zero for headerless GDP-style data', () => {
    const gdp: PlotDataTable = {
      id: 'gdp', source: { kind: 'generated', name: 'GDP' }, createdAt: table.createdAt,
      columns: [{ id: '列_A', label: '列 A', type: 'integer' }, { id: '列_B', label: '列 B', type: 'number' }],
      rows: [[1985, 577.38], [1986, 671.25], [1987, 758.04]]
    };
    const spec = createDefaultScientificPlotSpec('gdp');
    spec.encodings = { x: '列_A', y: '列_B' };
    const compiled = compileScientificEchartsOption(spec, gdp);
    expect(compiled.option.xAxis).toMatchObject({ type: 'value', scale: true });
    expect((compiled.option.series as Array<{ data: number[][] }>)[0].data[0]).toEqual([1985, 577.38]);
  });
});
