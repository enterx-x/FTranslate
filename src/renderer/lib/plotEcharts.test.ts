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
});
