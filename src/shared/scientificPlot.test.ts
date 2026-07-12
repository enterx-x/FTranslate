import { describe, expect, it } from 'vitest';
import {
  PLOT_DATA_LIMITS,
  SCIENTIFIC_CHART_TYPES,
  assertPlotDataTable,
  createDefaultScientificPlotSpec,
  getRendererCapability,
  normalizeScientificPlotSpec
} from './scientificPlot';

describe('scientific plot contract', () => {
  it('creates a versioned language-independent default spec', () => {
    const spec = createDefaultScientificPlotSpec('plot-1');

    expect(spec.id).toBe('plot-1');
    expect(spec.schemaVersion).toBe('1.0');
    expect(spec.renderer.language).toBe('javascript');
    expect(spec.chart.type).toBe('line');
    expect(spec.encodings).toEqual({});
    expect(spec.transforms).toEqual([]);
    expect(spec.analysis).toEqual([]);
  });

  it('migrates an early line spec without discarding mappings', () => {
    const spec = normalizeScientificPlotSpec({
      schemaVersion: '1',
      id: 'legacy',
      chart: { type: 'line' },
      encodings: { x: 'steps', y: 'success_rate', color: 'algorithm' },
      renderer: { language: 'r' }
    });

    expect(spec.schemaVersion).toBe('1.0');
    expect(spec.renderer.language).toBe('r');
    expect(spec.encodings).toEqual({ x: 'steps', y: 'success_rate', color: 'algorithm' });
  });

  it('rejects unknown chart types instead of silently substituting one', () => {
    expect(() =>
      normalizeScientificPlotSpec({ chart: { type: 'magic-plot' } })
    ).toThrow(/chart type/i);
  });

  it('defines every confirmed scientific chart family', () => {
    expect(SCIENTIFIC_CHART_TYPES).toEqual(
      expect.arrayContaining([
        'line',
        'scatter',
        'bar',
        'histogram',
        'box',
        'violin',
        'raincloud',
        'heatmap',
        'clusteredHeatmap',
        'contour',
        'scatter3d',
        'surface3d',
        'sankey',
        'alluvial',
        'survival',
        'forest',
        'volcano'
      ])
    );
  });

  it('reports explicit renderer capability reasons', () => {
    expect(getRendererCapability('matlab', 'surface3d')).toMatchObject({ supported: true });
    expect(getRendererCapability('javascript', 'clusteredHeatmap')).toMatchObject({
      supported: true
    });
    expect(getRendererCapability('matlab', 'alluvial')).toMatchObject({
      supported: false
    });
    expect(getRendererCapability('matlab', 'alluvial').reason).toMatch(/not available/i);
  });
});

describe('plot data table validation', () => {
  it('accepts a rectangular table with stable column ids', () => {
    expect(
      assertPlotDataTable({
        id: 'data-1',
        source: { kind: 'paste', name: 'clipboard' },
        columns: [
          { id: 'algorithm', label: 'algorithm', type: 'category' },
          { id: 'score', label: 'score', type: 'number' }
        ],
        rows: [['PPO', 0.8]],
        createdAt: '2026-07-12T00:00:00.000Z'
      })
    ).toBe(true);
  });

  it('rejects rows that do not match the declared columns', () => {
    expect(() =>
      assertPlotDataTable({
        id: 'bad',
        source: { kind: 'paste', name: 'clipboard' },
        columns: [],
        rows: [[1]],
        createdAt: '2026-07-12T00:00:00.000Z'
      })
    ).toThrow(/column/i);
  });

  it('enforces column and row limits before processing cell contents', () => {
    const tooManyColumns = Array.from({ length: PLOT_DATA_LIMITS.maxColumns + 1 }, (_, index) => ({
      id: `c-${index}`,
      label: `C ${index}`,
      type: 'number' as const
    }));
    const tooManyRows = new Array(PLOT_DATA_LIMITS.maxRows + 1);

    expect(() =>
      assertPlotDataTable({
        id: 'wide',
        source: { kind: 'paste', name: 'clipboard' },
        columns: tooManyColumns,
        rows: [],
        createdAt: '2026-07-12T00:00:00.000Z'
      })
    ).toThrow(/250/);
    expect(() =>
      assertPlotDataTable({
        id: 'long',
        source: { kind: 'paste', name: 'clipboard' },
        columns: [{ id: 'x', label: 'x', type: 'number' }],
        rows: tooManyRows,
        createdAt: '2026-07-12T00:00:00.000Z'
      })
    ).toThrow(/1000000/);
  });
});
