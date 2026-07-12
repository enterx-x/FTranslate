import type { EChartsCoreOption } from 'echarts/core';
import type {
  PlotCell,
  PlotColumn,
  PlotDataTable,
  ScientificChartType,
  ScientificPlotSpec
} from '../../shared/scientificPlot';
import { assertPlotDataTable, getRendererCapability } from '../../shared/scientificPlot';
import type { TraceableAnalysisResult } from './plotStatistics';

export interface EchartsCompilation {
  option: EChartsCoreOption;
  warnings: string[];
  dataPointCount: number;
  requiresGl: boolean;
}

interface CompileContext {
  spec: ScientificPlotSpec;
  table: PlotDataTable;
  rows: PlotCell[][];
  analyses: TraceableAnalysisResult[];
  warnings: string[];
}

export function compileScientificEchartsOption(
  spec: ScientificPlotSpec,
  table: PlotDataTable,
  analyses: TraceableAnalysisResult[] = []
): EchartsCompilation {
  assertPlotDataTable(table);
  const capability = getRendererCapability('javascript', spec.chart.type);
  if (!capability.supported) throw new Error(capability.reason);
  if (spec.encodings.facetRow || spec.encodings.facetColumn) {
    return compileFacets(spec, table, analyses);
  }

  const context: CompileContext = { spec, table, rows: table.rows, analyses, warnings: [] };
  const chart = compileChart(context);
  const option = {
    ...baseOption(spec),
    ...chart,
    graphic: buildAnalysisGraphics(spec, analyses)
  } as EChartsCoreOption;
  return {
    option,
    warnings: context.warnings,
    dataPointCount: table.rows.length,
    requiresGl: spec.chart.type === 'scatter3d' || spec.chart.type === 'surface3d'
  };
}

function compileChart(context: CompileContext): Record<string, unknown> {
  const type = context.spec.chart.type;
  if (['line', 'scatter', 'bar', 'area'].includes(type)) return compileCartesian(context, type);
  if (type === 'histogram') return compileHistogram(context);
  if (type === 'density') return compileDensity(context);
  if (type === 'ecdf') return compileEcdf(context);
  if (['box', 'violin', 'raincloud', 'beeswarm'].includes(type)) return compileDistribution(context, type);
  if (['heatmap', 'contour', 'density2d'].includes(type)) return compileHeatmap(context, type);
  if (['correlation', 'clusteredHeatmap'].includes(type)) return compileCorrelation(context, type === 'clusteredHeatmap');
  if (type === 'scatter3d' || type === 'surface3d') return compile3d(context, type);
  if (type === 'sankey' || type === 'alluvial') return compileFlow(context);
  if (type === 'survival') return compileSurvival(context);
  if (type === 'forest') return compileForest(context);
  if (type === 'volcano') return compileVolcano(context);
  if (type === 'radar') return compileRadar(context);
  throw new Error(`ECharts 编译器尚不支持图形：${type}`);
}

function compileCartesian(context: CompileContext, type: ScientificChartType): Record<string, unknown> {
  const xField = requireEncoding(context.spec, 'x');
  const yField = requireEncoding(context.spec, 'y');
  const xIndex = columnIndex(context.table, xField);
  const yIndex = columnIndex(context.table, yField);
  const groupField = context.spec.encodings.color ?? context.spec.encodings.group;
  const groupIndex = groupField ? columnIndex(context.table, groupField) : -1;
  const groups = groupRows(context.rows, groupIndex);
  const xColumn = context.table.columns[xIndex];
  const requestedCategory = context.spec.axes.find((axis) => axis.id === 'x')?.scale === 'category';
  const isCategory = requestedCategory || !isNumericColumn(xColumn);
  const categories = isCategory ? uniqueCells(context.rows.map((row) => row[xIndex])) : [];
  const series = [...groups.entries()].map(([name, rows], seriesIndex) => {
    const data = isCategory
      ? categories.map((category) => {
          const row = rows.find((item) => stableCell(item[xIndex]) === stableCell(category));
          return row ? numericOrNull(row[yIndex]) : null;
        })
      : rows.map((row) => [numericOrNull(row[xIndex]), numericOrNull(row[yIndex])]);
    return {
      name,
      type: type === 'area' ? 'line' : type,
      data,
      smooth: context.spec.chart.smooth,
      symbolSize: context.spec.theme.markerSize,
      showSymbol: context.spec.chart.showPoints,
      stack: context.spec.chart.stacked ? 'total' : undefined,
      areaStyle: type === 'area' ? { opacity: 0.2 } : undefined,
      lineStyle: { width: context.spec.theme.lineWidth },
      itemStyle: { color: paletteColor(context.spec, seriesIndex) }
    };
  });
  appendErrorIntervals(context, series, groups, xIndex);
  if (type === 'bar' && context.spec.chart.orientation === 'horizontal' && isCategory) {
    return {
      xAxis: axisOption(context.spec, 'x', 'value'),
      yAxis: axisOption(context.spec, 'y', 'category', categories),
      series
    };
  }
  return {
    xAxis: axisOption(context.spec, 'x', isCategory ? 'category' : 'value', categories),
    yAxis: axisOption(context.spec, 'y', 'value'),
    series
  };
}

function appendErrorIntervals(
  context: CompileContext,
  series: Array<Record<string, unknown>>,
  groups: Map<string, PlotCell[][]>,
  xIndex: number
): void {
  const lowerField = context.spec.encodings.errorLower;
  const upperField = context.spec.encodings.errorUpper;
  if (!lowerField || !upperField) return;
  const lowerIndex = columnIndex(context.table, lowerField);
  const upperIndex = columnIndex(context.table, upperField);
  [...groups.entries()].forEach(([, rows], seriesIndex) => {
    series.push({
      type: 'custom',
      silent: true,
      data: rows.map((row) => [row[xIndex], numericOrNull(row[lowerIndex]), numericOrNull(row[upperIndex])]),
      itemStyle: { color: paletteColor(context.spec, seriesIndex), opacity: 0.14 },
      renderItem: renderErrorInterval
    });
  });
}

function compileHistogram(context: CompileContext): Record<string, unknown> {
  const field = requireEncoding(context.spec, context.spec.encodings.x ? 'x' : 'y');
  const index = columnIndex(context.table, field);
  const groupField = context.spec.encodings.color ?? context.spec.encodings.group;
  const groupIndex = groupField ? columnIndex(context.table, groupField) : -1;
  const groups = groupRows(context.rows, groupIndex);
  const allValues = context.rows.map((row) => Number(row[index])).filter(Number.isFinite);
  const binCount = Math.max(5, Math.min(60, Math.ceil(Math.sqrt(allValues.length))));
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const width = max === min ? 1 : (max - min) / binCount;
  const centers = Array.from({ length: binCount }, (_, bin) => min + width * (bin + 0.5));
  const series = [...groups.entries()].map(([name, rows], seriesIndex) => {
    const counts = new Array(binCount).fill(0);
    rows.forEach((row) => {
      const value = Number(row[index]);
      if (!Number.isFinite(value)) return;
      counts[Math.min(binCount - 1, Math.max(0, Math.floor((value - min) / width)))] += 1;
    });
    return { name, type: 'bar', data: counts, itemStyle: { color: paletteColor(context.spec, seriesIndex), opacity: 0.74 } };
  });
  return { xAxis: axisOption(context.spec, 'x', 'category', centers.map(formatNumber)), yAxis: axisOption(context.spec, 'y', 'value'), series };
}

function compileDensity(context: CompileContext): Record<string, unknown> {
  const field = requireEncoding(context.spec, context.spec.encodings.x ? 'x' : 'y');
  const index = columnIndex(context.table, field);
  const groupIndex = context.spec.encodings.color ? columnIndex(context.table, context.spec.encodings.color) : -1;
  const groups = groupRows(context.rows, groupIndex);
  const series = [...groups.entries()].map(([name, rows], seriesIndex) => {
    const values = rows.map((row) => Number(row[index])).filter(Number.isFinite).sort((a, b) => a - b);
    const density = kernelDensity(values, 80);
    return { name, type: 'line', data: density, showSymbol: false, smooth: true, lineStyle: { width: context.spec.theme.lineWidth }, itemStyle: { color: paletteColor(context.spec, seriesIndex) } };
  });
  return { xAxis: axisOption(context.spec, 'x', 'value'), yAxis: axisOption(context.spec, 'y', 'value'), series };
}

function compileEcdf(context: CompileContext): Record<string, unknown> {
  const field = requireEncoding(context.spec, context.spec.encodings.x ? 'x' : 'y');
  const index = columnIndex(context.table, field);
  const groupIndex = context.spec.encodings.color ? columnIndex(context.table, context.spec.encodings.color) : -1;
  const groups = groupRows(context.rows, groupIndex);
  const series = [...groups.entries()].map(([name, rows], seriesIndex) => {
    const values = rows.map((row) => Number(row[index])).filter(Number.isFinite).sort((a, b) => a - b);
    return { name, type: 'line', step: 'end', showSymbol: false, data: values.map((value, i) => [value, (i + 1) / values.length]), itemStyle: { color: paletteColor(context.spec, seriesIndex) } };
  });
  return { xAxis: axisOption(context.spec, 'x', 'value'), yAxis: { ...axisOption(context.spec, 'y', 'value'), min: 0, max: 1 }, series };
}

function compileDistribution(context: CompileContext, type: ScientificChartType): Record<string, unknown> {
  const valueField = requireEncoding(context.spec, context.spec.encodings.y ? 'y' : 'x');
  const valueIndex = columnIndex(context.table, valueField);
  const groupField = context.spec.encodings.x ?? context.spec.encodings.color ?? context.spec.encodings.group;
  const groupIndex = groupField ? columnIndex(context.table, groupField) : -1;
  const groups = groupRows(context.rows, groupIndex);
  const labels = [...groups.keys()];
  const summaries = [...groups.values()].map((rows) => fiveNumber(rows.map((row) => Number(row[valueIndex])).filter(Number.isFinite)));
  const series: Array<Record<string, unknown>> = [];
  if (type !== 'beeswarm') series.push({ name: '分布摘要', type: 'boxplot', data: summaries, itemStyle: { color: '#ffffff', borderColor: '#526f8a' } });
  if (type === 'violin' || type === 'raincloud') {
    series.unshift({
      name: '密度',
      type: 'custom',
      data: [...groups.values()].map((rows, groupOffset) => [groupOffset, ...kernelDensity(rows.map((row) => Number(row[valueIndex])).filter(Number.isFinite), 40).flat()]),
      renderItem: renderViolin,
      itemStyle: { color: context.spec.theme.palette[0], opacity: 0.28 }
    });
  }
  if (type === 'raincloud' || type === 'beeswarm') {
    series.push({
      name: '观测值',
      type: 'scatter',
      symbolSize: Math.max(3, context.spec.theme.markerSize - 1),
      data: [...groups.values()].flatMap((rows, groupOffset) => rows.map((row, pointOffset) => [groupOffset + deterministicJitter(pointOffset), numericOrNull(row[valueIndex])])),
      itemStyle: { opacity: 0.58 }
    });
  }
  return { xAxis: axisOption(context.spec, 'x', 'category', labels), yAxis: axisOption(context.spec, 'y', 'value'), series };
}

function compileHeatmap(context: CompileContext, type: ScientificChartType): Record<string, unknown> {
  const xField = requireEncoding(context.spec, 'x');
  const yField = requireEncoding(context.spec, 'y');
  const valueField = context.spec.encodings.value ?? context.spec.encodings.color;
  const xIndex = columnIndex(context.table, xField);
  const yIndex = columnIndex(context.table, yField);
  const valueIndex = valueField ? columnIndex(context.table, valueField) : -1;
  if (type === 'density2d' || (type === 'contour' && valueIndex < 0)) {
    const density = densityGrid(context.rows, xIndex, yIndex, 28);
    if (type === 'contour') context.warnings.push('ECharts 轮廓预览使用二维密度栅格；最终 Python/R 可输出平滑等高线。');
    return {
      xAxis: axisOption(context.spec, 'x', 'category', density.xLabels),
      yAxis: axisOption(context.spec, 'y', 'category', density.yLabels),
      visualMap: visualMap(density.data.map((item) => item[2])),
      series: [{ type: 'heatmap', data: density.data, progressive: 2_000 }]
    };
  }
  if (valueIndex < 0) throw new Error(`${type} 需要 value 或 color 数值字段。`);
  const xValues = uniqueCells(context.rows.map((row) => row[xIndex]));
  const yValues = uniqueCells(context.rows.map((row) => row[yIndex]));
  const data = context.rows.map((row) => [
    xValues.findIndex((value) => stableCell(value) === stableCell(row[xIndex])),
    yValues.findIndex((value) => stableCell(value) === stableCell(row[yIndex])),
    numericOrNull(row[valueIndex])
  ]);
  return {
    xAxis: axisOption(context.spec, 'x', 'category', xValues.map(String)),
    yAxis: axisOption(context.spec, 'y', 'category', yValues.map(String)),
    visualMap: visualMap(data.map((item) => Number(item[2]))),
    series: [{ type: 'heatmap', data, progressive: 2_000 }]
  };
}

function compileCorrelation(context: CompileContext, clustered: boolean): Record<string, unknown> {
  const numericColumns = context.table.columns.filter(isNumericColumn);
  if (numericColumns.length < 2) throw new Error('相关矩阵至少需要两个数值字段。');
  const ordered = clustered ? clusterColumns(context.table, numericColumns) : numericColumns;
  const data: number[][] = [];
  ordered.forEach((left, leftIndex) => ordered.forEach((right, rightIndex) => {
    data.push([leftIndex, rightIndex, pearson(columnNumbers(context.table, left.id), columnNumbers(context.table, right.id))]);
  }));
  const labels = ordered.map((column) => column.label);
  return {
    xAxis: axisOption(context.spec, 'x', 'category', labels),
    yAxis: axisOption(context.spec, 'y', 'category', labels),
    visualMap: { min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 4, inRange: { color: ['#3f6685', '#f7f8fa', '#9b544e'] } },
    series: [{ type: 'heatmap', data, label: { show: true, formatter: (params: { value: number[] }) => Number(params.value[2]).toFixed(2) } }]
  };
}

function compile3d(context: CompileContext, type: ScientificChartType): Record<string, unknown> {
  const xIndex = columnIndex(context.table, requireEncoding(context.spec, 'x'));
  const yIndex = columnIndex(context.table, requireEncoding(context.spec, 'y'));
  const zField = context.spec.encodings.value ?? context.spec.encodings.size ?? context.spec.encodings.color;
  if (!zField) throw new Error(`${type} 需要第三个数值字段（value/size/color）。`);
  const zIndex = columnIndex(context.table, zField);
  const data = context.rows.map((row) => [numericOrNull(row[xIndex]), numericOrNull(row[yIndex]), numericOrNull(row[zIndex])]);
  return {
    tooltip: {},
    xAxis3D: { type: 'value', name: context.spec.axes.find((axis) => axis.id === 'x')?.label ?? context.table.columns[xIndex].label },
    yAxis3D: { type: 'value', name: context.spec.axes.find((axis) => axis.id === 'y')?.label ?? context.table.columns[yIndex].label },
    zAxis3D: { type: 'value', name: context.table.columns[zIndex].label },
    grid3D: { viewControl: { projection: 'perspective' }, boxWidth: 100, boxDepth: 80 },
    visualMap: type === 'surface3d' ? { dimension: 2, min: minFinite(data.map((item) => Number(item[2]))), max: maxFinite(data.map((item) => Number(item[2]))) } : undefined,
    series: [{ type: type === 'surface3d' ? 'surface' : 'scatter3D', data, symbolSize: context.spec.theme.markerSize + 2, shading: type === 'surface3d' ? 'lambert' : undefined }]
  };
}

function compileFlow(context: CompileContext): Record<string, unknown> {
  const sourceIndex = columnIndex(context.table, requireEncoding(context.spec, 'source'));
  const targetIndex = columnIndex(context.table, requireEncoding(context.spec, 'target'));
  const valueField = context.spec.encodings.value ?? context.spec.encodings.y;
  const valueIndex = valueField ? columnIndex(context.table, valueField) : -1;
  const links = context.rows.map((row) => ({ source: String(row[sourceIndex] ?? ''), target: String(row[targetIndex] ?? ''), value: valueIndex >= 0 ? Number(row[valueIndex]) || 1 : 1 }));
  const nodes = [...new Set(links.flatMap((link) => [link.source, link.target]))].map((name) => ({ name }));
  return { series: [{ type: 'sankey', data: nodes, links, nodeAlign: context.spec.chart.type === 'alluvial' ? 'justify' : 'left', emphasis: { focus: 'adjacency' }, lineStyle: { color: 'gradient', opacity: 0.35 } }] };
}

function compileSurvival(context: CompileContext): Record<string, unknown> {
  const compiled = compileCartesian(context, 'line');
  const series = (compiled.series as Array<Record<string, unknown>>).map((item) => ({ ...item, step: 'end', showSymbol: false }));
  return { ...compiled, series };
}

function compileForest(context: CompileContext): Record<string, unknown> {
  const labelIndex = columnIndex(context.table, requireEncoding(context.spec, 'y'));
  const estimateIndex = columnIndex(context.table, requireEncoding(context.spec, 'x'));
  const lowerIndex = columnIndex(context.table, requireEncoding(context.spec, 'errorLower'));
  const upperIndex = columnIndex(context.table, requireEncoding(context.spec, 'errorUpper'));
  const labels = context.rows.map((row) => String(row[labelIndex] ?? ''));
  return {
    xAxis: axisOption(context.spec, 'x', 'value'),
    yAxis: axisOption(context.spec, 'y', 'category', labels),
    series: [
      { type: 'custom', data: context.rows.map((row, index) => [numericOrNull(row[lowerIndex]), numericOrNull(row[upperIndex]), index]), renderItem: renderForestInterval, itemStyle: { color: '#526f8a' } },
      { type: 'scatter', data: context.rows.map((row, index) => [numericOrNull(row[estimateIndex]), index]), symbolSize: context.spec.theme.markerSize + 2 }
    ]
  };
}

function compileVolcano(context: CompileContext): Record<string, unknown> {
  const foldIndex = columnIndex(context.table, requireEncoding(context.spec, 'x'));
  const pIndex = columnIndex(context.table, requireEncoding(context.spec, 'y'));
  const labelIndex = context.spec.encodings.label ? columnIndex(context.table, context.spec.encodings.label) : -1;
  const data = context.rows.map((row) => {
    const fold = Number(row[foldIndex]);
    const p = Math.max(Number.MIN_VALUE, Number(row[pIndex]));
    const significant = p < 0.05 && Math.abs(fold) >= 1;
    return { value: [fold, -Math.log10(p)], name: labelIndex >= 0 ? String(row[labelIndex] ?? '') : '', itemStyle: { color: significant ? (fold > 0 ? '#9b544e' : '#3f6685') : '#aab2bb' } };
  });
  return { xAxis: axisOption(context.spec, 'x', 'value'), yAxis: { ...axisOption(context.spec, 'y', 'value'), name: '-log10(p)' }, series: [{ type: 'scatter', data, symbolSize: context.spec.theme.markerSize }] };
}

function compileRadar(context: CompileContext): Record<string, unknown> {
  const groupField = context.spec.encodings.group ?? context.spec.encodings.color ?? context.spec.encodings.label;
  const groupIndex = groupField ? columnIndex(context.table, groupField) : -1;
  const numericColumns = context.table.columns.filter((column) => isNumericColumn(column) && column.id !== groupField);
  if (numericColumns.length < 3) throw new Error('雷达图至少需要三个数值字段。');
  const indicators = numericColumns.map((column) => ({ name: column.label, max: maxFinite(columnNumbers(context.table, column.id)) || 1 }));
  const data = context.rows.map((row, index) => ({ name: groupIndex >= 0 ? String(row[groupIndex] ?? '') : `样本 ${index + 1}`, value: numericColumns.map((column) => numericOrNull(row[columnIndex(context.table, column.id)])) }));
  return { radar: { indicator: indicators, splitNumber: 4 }, series: [{ type: 'radar', data }] };
}

function compileFacets(spec: ScientificPlotSpec, table: PlotDataTable, analyses: TraceableAnalysisResult[]): EchartsCompilation {
  const rowField = spec.encodings.facetRow;
  const columnField = spec.encodings.facetColumn;
  const rowIndex = rowField ? columnIndex(table, rowField) : -1;
  const columnIndexValue = columnField ? columnIndex(table, columnField) : -1;
  const rowValues = rowIndex >= 0 ? uniqueCells(table.rows.map((row) => row[rowIndex])) : [''];
  const columnValues = columnIndexValue >= 0 ? uniqueCells(table.rows.map((row) => row[columnIndexValue])) : [''];
  const panels = rowValues.flatMap((rowValue) => columnValues.map((columnValue) => ({ rowValue, columnValue })));
  const series: Array<Record<string, unknown>> = [];
  const xAxis: Array<Record<string, unknown>> = [];
  const yAxis: Array<Record<string, unknown>> = [];
  const grid: Array<Record<string, unknown>> = [];
  const titles: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  panels.forEach((panel, panelIndex) => {
    const rows = table.rows.filter((row) =>
      (rowIndex < 0 || stableCell(row[rowIndex]) === stableCell(panel.rowValue)) &&
      (columnIndexValue < 0 || stableCell(row[columnIndexValue]) === stableCell(panel.columnValue))
    );
    const panelSpec: ScientificPlotSpec = { ...spec, encodings: { ...spec.encodings, facetRow: undefined, facetColumn: undefined }, chart: { ...spec.chart, title: '' } };
    const context: CompileContext = { spec: panelSpec, table: { ...table, rows }, rows, analyses, warnings };
    const compiled = compileChart(context);
    const columns = Math.max(1, columnValues.length);
    const rowsCount = Math.max(1, rowValues.length);
    const col = panelIndex % columns;
    const row = Math.floor(panelIndex / columns);
    grid.push({ left: `${6 + col * (90 / columns)}%`, top: `${10 + row * (82 / rowsCount)}%`, width: `${80 / columns}%`, height: `${68 / rowsCount}%`, containLabel: true });
    const panelXAxis = Array.isArray(compiled.xAxis) ? compiled.xAxis[0] : compiled.xAxis;
    const panelYAxis = Array.isArray(compiled.yAxis) ? compiled.yAxis[0] : compiled.yAxis;
    xAxis.push({ ...(panelXAxis as object), gridIndex: panelIndex });
    yAxis.push({ ...(panelYAxis as object), gridIndex: panelIndex });
    ((compiled.series ?? []) as Array<Record<string, unknown>>).forEach((item) => series.push({ ...item, xAxisIndex: panelIndex, yAxisIndex: panelIndex }));
    titles.push({ text: [String(panel.rowValue || ''), String(panel.columnValue || '')].filter(Boolean).join(' · '), left: `${8 + col * (90 / columns)}%`, top: `${4 + row * (82 / rowsCount)}%`, textStyle: { fontSize: spec.theme.baseFontSize } });
  });
  return {
    option: { ...baseOption(spec), title: titles, grid, xAxis, yAxis, series } as EChartsCoreOption,
    warnings,
    dataPointCount: table.rows.length,
    requiresGl: false
  };
}

function baseOption(spec: ScientificPlotSpec): Record<string, unknown> {
  const legendPositions: Record<string, object> = {
    top: { top: 2, left: 'center' }, right: { right: 2, top: 'middle', orient: 'vertical' },
    bottom: { bottom: 2, left: 'center' }, left: { left: 2, top: 'middle', orient: 'vertical' }, none: { show: false }
  };
  return {
    backgroundColor: spec.theme.canvas.background,
    color: spec.theme.palette,
    animation: false,
    textStyle: { fontFamily: spec.theme.fontFamily, fontSize: spec.theme.baseFontSize, color: '#26364a' },
    title: { text: spec.chart.title || spec.title, subtext: spec.chart.subtitle, left: 12, top: 8, textStyle: { fontFamily: spec.theme.fontFamily, fontSize: spec.theme.titleFontSize, fontWeight: 600 } },
    legend: { ...legendPositions[spec.theme.legendPosition], textStyle: { fontFamily: spec.theme.fontFamily, fontSize: spec.theme.baseFontSize } },
    tooltip: { trigger: 'axis', confine: true },
    grid: { left: 54, right: spec.theme.legendPosition === 'right' ? 96 : 24, top: 62, bottom: 48, containLabel: true }
  };
}

function axisOption(spec: ScientificPlotSpec, id: 'x' | 'y', type: 'value' | 'category', data?: unknown[]): Record<string, unknown> {
  const axis = spec.axes.find((item) => item.id === id);
  const resolvedType = axis?.scale === 'log' ? 'log' : axis?.scale === 'time' ? 'time' : axis?.scale === 'category' ? 'category' : type;
  const showGrid = axis?.showGrid ?? spec.theme.grid;
  return {
    type: resolvedType,
    scale: resolvedType === 'value',
    data,
    name: axis?.label,
    min: axis?.min,
    max: axis?.max,
    inverse: axis?.reverse,
    show: axis?.visible !== false,
    position: axis?.position === 'secondary' ? (id === 'x' ? 'top' : 'right') : (id === 'x' ? 'bottom' : 'left'),
    logBase: axis?.logBase ?? 10,
    splitNumber: axis?.tickCount,
    interval: axis?.tickInterval,
    nameLocation: 'middle',
    nameGap: axis?.titleGap ?? (id === 'x' ? 30 : 42),
    nameTextStyle: { fontSize: axis?.titleFontSize ?? spec.theme.baseFontSize, color: axis?.titleColor ?? '#26364a' },
    axisLine: { show: axis?.showLine !== false, lineStyle: { color: '#738193' } },
    axisTick: { show: axis?.showTicks !== false },
    minorTick: { show: axis?.minorTicks === true },
    splitLine: { show: showGrid, lineStyle: { color: axis?.gridColor ?? '#e4e8ed', width: axis?.gridWidth ?? 0.8 } },
    minorSplitLine: { show: axis?.showMinorGrid === true, lineStyle: { color: axis?.gridColor ?? '#eef1f4', width: Math.max(0.1, (axis?.gridWidth ?? 0.8) * 0.6) } },
    axisLabel: {
      show: axis?.showLabels !== false,
      hideOverlap: true,
      rotate: axis?.labelRotation ?? 0,
      fontSize: axis?.labelFontSize ?? spec.theme.baseFontSize,
      color: axis?.labelColor ?? '#526172',
      formatter: (value: unknown) => formatAxisLabel(value, axis)
    }
  };
}

function formatAxisLabel(value: unknown, axis: ScientificPlotSpec['axes'][number] | undefined): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  let text: string;
  if (!Number.isFinite(numeric) || axis?.numberFormat === 'auto' || !axis?.numberFormat) {
    text = String(value ?? '');
  } else if (axis.numberFormat === 'scientific') {
    text = numeric.toExponential(axis.decimalPlaces ?? 2);
  } else if (axis.numberFormat === 'percent') {
    text = `${(numeric * 100).toFixed(axis.decimalPlaces ?? 1)}%`;
  } else {
    text = numeric.toLocaleString(undefined, {
      useGrouping: axis.thousandsSeparator !== false,
      minimumFractionDigits: axis.decimalPlaces ?? 2,
      maximumFractionDigits: axis.decimalPlaces ?? 2
    });
  }
  return `${axis?.prefix ?? ''}${text}${axis?.suffix ?? ''}`;
}

function buildAnalysisGraphics(spec: ScientificPlotSpec, analyses: TraceableAnalysisResult[]): Array<Record<string, unknown>> {
  return spec.annotations.flatMap((annotation, index) => {
    if (annotation.kind !== 'significance' || !annotation.analysisId) return [];
    const result = analyses.find((item) => item.analysisId === annotation.analysisId && item.status === 'ok');
    if (!result || result.pValue === undefined) return [];
    const p = result.adjustedPValue ?? result.pValue;
    return [{ type: 'text', right: 18, top: 38 + index * 18, style: { text: `${result.method}: p ${p < 0.001 ? '< 0.001' : `= ${p.toFixed(3)}`}`, fill: '#405469', font: `${spec.theme.baseFontSize}px ${spec.theme.fontFamily}` } }];
  });
}

function groupRows(rows: PlotCell[][], groupIndex: number): Map<string, PlotCell[][]> {
  const groups = new Map<string, PlotCell[][]>();
  rows.forEach((row) => {
    const name = groupIndex >= 0 ? String(row[groupIndex] ?? '未分组') : '数据';
    const items = groups.get(name) ?? [];
    items.push(row);
    groups.set(name, items);
  });
  return groups;
}

function requireEncoding(spec: ScientificPlotSpec, key: keyof ScientificPlotSpec['encodings']): string {
  const field = spec.encodings[key];
  if (!field) throw new Error(`${spec.chart.type} 缺少 ${key} 字段映射。`);
  return field;
}

function columnIndex(table: PlotDataTable, field: string): number {
  const index = table.columns.findIndex((column) => column.id === field);
  if (index < 0) throw new Error(`字段不存在：${field}`);
  return index;
}

function isNumericColumn(column: PlotColumn): boolean {
  return column.type === 'number' || column.type === 'integer';
}

function columnNumbers(table: PlotDataTable, field: string): number[] {
  const index = columnIndex(table, field);
  return table.rows.map((row) => Number(row[index])).filter(Number.isFinite);
}

function uniqueCells(values: PlotCell[]): PlotCell[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = stableCell(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableCell(value: PlotCell): string {
  return `${typeof value}:${String(value)}`;
}

function numericOrNull(value: PlotCell): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function paletteColor(spec: ScientificPlotSpec, index: number): string {
  return spec.theme.palette[index % spec.theme.palette.length] ?? '#526f8a';
}

function fiveNumber(values: number[]): number[] {
  if (values.length === 0) return [0, 0, 0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  return [sorted[0], quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75), sorted[sorted.length - 1]];
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function kernelDensity(values: number[], points: number): number[][] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - values.reduce((a, b) => a + b, 0) / values.length) ** 2, 0) / Math.max(1, values.length - 1));
  const bandwidth = Math.max(Number.EPSILON, 1.06 * (sd || Math.max(1, max - min)) * values.length ** -0.2);
  const start = min - bandwidth * 2;
  const end = max + bandwidth * 2;
  return Array.from({ length: points }, (_, index) => {
    const x = start + (end - start) * index / Math.max(1, points - 1);
    const density = values.reduce((sum, value) => sum + Math.exp(-0.5 * ((x - value) / bandwidth) ** 2), 0) /
      (values.length * bandwidth * Math.sqrt(2 * Math.PI));
    return [x, density];
  });
}

function densityGrid(rows: PlotCell[][], xIndex: number, yIndex: number, bins: number): { xLabels: string[]; yLabels: string[]; data: number[][] } {
  const points = rows.map((row) => [Number(row[xIndex]), Number(row[yIndex])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = minFinite(xs); const maxX = maxFinite(xs); const minY = minFinite(ys); const maxY = maxFinite(ys);
  const counts = Array.from({ length: bins }, () => new Array(bins).fill(0));
  points.forEach(([x, y]) => {
    const xi = Math.min(bins - 1, Math.max(0, Math.floor((x - minX) / Math.max(Number.EPSILON, maxX - minX) * bins)));
    const yi = Math.min(bins - 1, Math.max(0, Math.floor((y - minY) / Math.max(Number.EPSILON, maxY - minY) * bins)));
    counts[yi][xi] += 1;
  });
  return {
    xLabels: Array.from({ length: bins }, (_, index) => formatNumber(minX + (maxX - minX) * index / Math.max(1, bins - 1))),
    yLabels: Array.from({ length: bins }, (_, index) => formatNumber(minY + (maxY - minY) * index / Math.max(1, bins - 1))),
    data: counts.flatMap((row, y) => row.map((value, x) => [x, y, value]))
  };
}

function clusterColumns(table: PlotDataTable, columns: PlotColumn[]): PlotColumn[] {
  if (columns.length < 3) return [...columns];
  const remaining = [...columns];
  const ordered = [remaining.shift() as PlotColumn];
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestScore = -Infinity;
    remaining.forEach((candidate, index) => {
      const score = Math.abs(pearson(columnNumbers(table, last.id), columnNumbers(table, candidate.id)));
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

function pearson(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length < 2) return 0;
  const a = left.slice(0, length); const b = right.slice(0, length);
  const ma = a.reduce((sum, value) => sum + value, 0) / length;
  const mb = b.reduce((sum, value) => sum + value, 0) / length;
  const numerator = a.reduce((sum, value, index) => sum + (value - ma) * (b[index] - mb), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0) * b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return denominator === 0 ? 0 : numerator / denominator;
}

function visualMap(values: number[]): Record<string, unknown> {
  return { min: minFinite(values), max: maxFinite(values), calculable: true, orient: 'horizontal', left: 'center', bottom: 2, inRange: { color: ['#edf2f5', '#9eb3c3', '#526f8a'] } };
}

function minFinite(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : 0;
}

function maxFinite(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : 1;
}

function formatNumber(value: number): string {
  return Math.abs(value) >= 1_000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01) ? value.toExponential(2) : Number(value.toFixed(3)).toString();
}

function deterministicJitter(index: number): number {
  return (((index * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.35;
}

function renderErrorInterval(params: any, api: any): any {
  const x = api.coord([api.value(0), api.value(1)]);
  const high = api.coord([api.value(0), api.value(2)]);
  return { type: 'line', shape: { x1: x[0], y1: x[1], x2: high[0], y2: high[1] }, style: api.style({ lineWidth: 5 }) };
}

function renderForestInterval(params: any, api: any): any {
  const low = api.coord([api.value(0), api.value(2)]);
  const high = api.coord([api.value(1), api.value(2)]);
  return { type: 'line', shape: { x1: low[0], y1: low[1], x2: high[0], y2: high[1] }, style: api.style({ lineWidth: 2 }) };
}

function renderViolin(params: any, api: any): any {
  const group = api.value(0);
  const values: number[] = [];
  for (let index = 1; index < params.data.length; index += 1) values.push(api.value(index));
  if (values.length < 4) return null;
  const points: number[][] = [];
  for (let index = 0; index < values.length; index += 2) {
    const coord = api.coord([group, values[index]]);
    const halfWidth = api.size([1, 0])[0] * Math.min(0.42, values[index + 1] * 0.35);
    points.push([coord[0] - halfWidth, coord[1]]);
  }
  for (let index = values.length - 2; index >= 0; index -= 2) {
    const coord = api.coord([group, values[index]]);
    const halfWidth = api.size([1, 0])[0] * Math.min(0.42, values[index + 1] * 0.35);
    points.push([coord[0] + halfWidth, coord[1]]);
  }
  return { type: 'polygon', shape: { points }, style: api.style() };
}
