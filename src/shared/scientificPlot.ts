export const SCIENTIFIC_PLOT_SCHEMA_VERSION = '1.0';

export const PLOT_DATA_LIMITS = {
  maxColumns: 250,
  maxRows: 1_000_000,
  maxCellChars: 100_000,
  maxTitleChars: 500,
  maxLayers: 100,
  maxTransforms: 100,
  maxAnalyses: 100
} as const;

export const PLOT_RENDERER_LANGUAGES = ['javascript', 'python', 'r', 'matlab'] as const;
export type PlotRendererLanguage = (typeof PLOT_RENDERER_LANGUAGES)[number];

export const SCIENTIFIC_CHART_TYPES = [
  'line',
  'scatter',
  'bar',
  'area',
  'histogram',
  'density',
  'ecdf',
  'box',
  'violin',
  'raincloud',
  'beeswarm',
  'heatmap',
  'correlation',
  'clusteredHeatmap',
  'contour',
  'density2d',
  'scatter3d',
  'surface3d',
  'sankey',
  'alluvial',
  'survival',
  'forest',
  'volcano',
  'radar'
] as const;
export type ScientificChartType = (typeof SCIENTIFIC_CHART_TYPES)[number];

export type PlotColumnType = 'number' | 'integer' | 'category' | 'string' | 'boolean' | 'date';
export type PlotCell = string | number | boolean | null;

export interface PlotColumn {
  id: string;
  label: string;
  type: PlotColumnType;
  unit?: string;
  description?: string;
}

export interface PlotDataSource {
  kind: 'file' | 'researchSheet' | 'paste' | 'generated';
  name: string;
  filePath?: string;
  workbookId?: string;
  sheetName?: string;
  range?: string;
  mimeType?: string;
}

export interface PlotDataTable {
  id: string;
  source: PlotDataSource;
  columns: PlotColumn[];
  rows: PlotCell[][];
  createdAt: string;
  contentHash?: string;
  sampled?: boolean;
  totalRowCount?: number;
}

export type PlotTransformType =
  | 'rename'
  | 'cast'
  | 'missing'
  | 'filter'
  | 'sort'
  | 'groupAggregate'
  | 'wideToLong'
  | 'longToWide'
  | 'derive'
  | 'categoryOrder'
  | 'join'
  | 'append'
  | 'sample';

export interface PlotTransformStep {
  id: string;
  type: PlotTransformType;
  enabled: boolean;
  label: string;
  params: Record<string, unknown>;
}

export type PlotAnalysisType =
  | 'descriptive'
  | 'linearRegression'
  | 'independentT'
  | 'pairedT'
  | 'oneWayAnova'
  | 'mannWhitney'
  | 'wilcoxonSignedRank'
  | 'kruskalWallis'
  | 'friedman';

export type MultipleComparisonCorrection = 'none' | 'holm' | 'bonferroni' | 'benjaminiHochberg';
export type EffectSizeType =
  | 'none'
  | 'cohenD'
  | 'hedgesG'
  | 'etaSquared'
  | 'partialEtaSquared'
  | 'rankBiserial';

export interface AnalysisSpec {
  id: string;
  type: PlotAnalysisType;
  enabled: boolean;
  valueField: string;
  groupField?: string;
  subjectField?: string;
  groups?: string[];
  tail?: 'two-sided' | 'less' | 'greater';
  alpha?: number;
  confidenceLevel?: number;
  correction?: MultipleComparisonCorrection;
  effectSize?: EffectSizeType;
}

export interface ScientificChartSpec {
  type: ScientificChartType;
  title: string;
  subtitle?: string;
  orientation?: 'vertical' | 'horizontal';
  stacked?: boolean;
  smooth?: boolean;
  showPoints?: boolean;
}

export interface PlotEncodingSpec {
  x?: string;
  y?: string;
  color?: string;
  group?: string;
  size?: string;
  label?: string;
  facetRow?: string;
  facetColumn?: string;
  errorLower?: string;
  errorUpper?: string;
  source?: string;
  target?: string;
  value?: string;
}

export interface PlotLayerSpec {
  id: string;
  kind: 'data' | 'summary' | 'interval' | 'fit' | 'annotation' | 'reference';
  visible: boolean;
  label: string;
  params: Record<string, unknown>;
}

export interface PlotAxisSpec {
  id: 'x' | 'y' | 'z' | 'color';
  label?: string;
  scale?: 'linear' | 'log' | 'category' | 'time';
  min?: number;
  max?: number;
  reverse?: boolean;
}

export interface PlotAnnotationSpec {
  id: string;
  kind: 'text' | 'referenceLine' | 'referenceBand' | 'significance';
  label?: string;
  analysisId?: string;
  params: Record<string, unknown>;
}

export type PlotThemePresetId =
  | 'general'
  | 'natureScience'
  | 'ieee'
  | 'elsevier'
  | 'chineseThesis'
  | 'lab';

export interface PlotThemeSpec {
  presetId: PlotThemePresetId;
  name: string;
  fontFamily: string;
  baseFontSize: number;
  titleFontSize: number;
  lineWidth: number;
  markerSize: number;
  palette: string[];
  canvas: { widthMm: number; heightMm: number; background: string };
  legendPosition: 'top' | 'right' | 'bottom' | 'left' | 'none';
  grid: boolean;
}

export interface PlotRendererSpec {
  language: PlotRendererLanguage;
  runtimeId?: string;
  autoRender: boolean;
  preferredPreview: 'svg' | 'png' | 'html';
}

export type PlotExportFormat = 'png' | 'svg' | 'pdf' | 'tiff' | 'html' | 'fplot';

export interface PlotExportPreset {
  id: string;
  name: string;
  format: PlotExportFormat;
  widthPx?: number;
  heightPx?: number;
  dpi?: number;
  transparent?: boolean;
  embedFonts?: boolean;
}

export interface PlotProvenanceRecord {
  createdAt: string;
  updatedAt: string;
  dataSnapshotHash?: string;
  derivedDataHash?: string;
  analysisHash?: string;
  rendererVersion?: string;
  packageVersions?: Record<string, string>;
}

export interface ResearchObjectLink {
  kind: 'researchProject' | 'paper' | 'experiment' | 'researchSheet';
  id: string;
  label?: string;
}

export interface ScientificPlotSpec {
  schemaVersion: typeof SCIENTIFIC_PLOT_SCHEMA_VERSION;
  id: string;
  title: string;
  dataSource?: PlotDataSource;
  snapshotId?: string;
  transforms: PlotTransformStep[];
  analysis: AnalysisSpec[];
  chart: ScientificChartSpec;
  encodings: PlotEncodingSpec;
  layers: PlotLayerSpec[];
  axes: PlotAxisSpec[];
  annotations: PlotAnnotationSpec[];
  theme: PlotThemeSpec;
  renderer: PlotRendererSpec;
  exports: PlotExportPreset[];
  provenance: PlotProvenanceRecord;
  links: ResearchObjectLink[];
}

export type PlotRuntimeStatus = 'ready' | 'missing' | 'degraded' | 'checking' | 'installing' | 'failed';

export interface PlotRuntimeCapability {
  language: PlotRendererLanguage;
  status: PlotRuntimeStatus;
  version?: string;
  executable?: string;
  managed: boolean;
  packages: Record<string, string>;
  toolboxes?: string[];
  message: string;
  checkedAt: string;
}

export type PlotJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out';

export interface PlotRenderArtifact {
  kind: 'preview' | 'export' | 'script' | 'analysis' | 'manifest' | 'log';
  format: string;
  filePath: string;
  sha256: string;
  stale?: boolean;
}

export interface PlotRenderJob {
  id: string;
  projectId: string;
  specHash: string;
  language: PlotRendererLanguage;
  status: PlotJobStatus;
  progress: number;
  message: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  artifacts: PlotRenderArtifact[];
  cacheHit: boolean;
}

export interface PlotRendererCapability {
  language: PlotRendererLanguage;
  chartType: ScientificChartType;
  supported: boolean;
  reason: string;
  requiredPackages: string[];
}

const DEFAULT_THEME: PlotThemeSpec = {
  presetId: 'general',
  name: '通用科研图',
  fontFamily: 'Arial, Microsoft YaHei UI, sans-serif',
  baseFontSize: 10,
  titleFontSize: 14,
  lineWidth: 1.8,
  markerSize: 6,
  palette: ['#526f8a', '#738c7a', '#87768f', '#a27468', '#547f87', '#8b815f'],
  canvas: { widthMm: 180, heightMm: 120, background: '#ffffff' },
  legendPosition: 'top',
  grid: true
};

const DEFAULT_EXPORTS: PlotExportPreset[] = [
  { id: 'png-300', name: 'PNG 300 DPI', format: 'png', dpi: 300, transparent: false },
  { id: 'svg-vector', name: 'SVG 矢量图', format: 'svg', transparent: true },
  { id: 'pdf-vector', name: 'PDF 矢量图', format: 'pdf', embedFonts: true },
  { id: 'tiff-600', name: 'TIFF 600 DPI', format: 'tiff', dpi: 600, transparent: false }
];

export function createDefaultScientificPlotSpec(id = createId('plot')): ScientificPlotSpec {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCIENTIFIC_PLOT_SCHEMA_VERSION,
    id,
    title: '未命名科研图',
    transforms: [],
    analysis: [],
    chart: {
      type: 'line',
      title: '未命名科研图',
      orientation: 'vertical',
      stacked: false,
      smooth: false,
      showPoints: true
    },
    encodings: {},
    layers: [
      { id: 'data-layer', kind: 'data', visible: true, label: '原始数据', params: {} }
    ],
    axes: [
      { id: 'x', scale: 'linear' },
      { id: 'y', scale: 'linear' }
    ],
    annotations: [],
    theme: cloneTheme(DEFAULT_THEME),
    renderer: {
      language: 'javascript',
      autoRender: true,
      preferredPreview: 'svg'
    },
    exports: DEFAULT_EXPORTS.map((item) => ({ ...item })),
    provenance: { createdAt: now, updatedAt: now },
    links: []
  };
}

export function normalizeScientificPlotSpec(value: unknown): ScientificPlotSpec {
  const record = asRecord(value, 'plot spec');
  const base = createDefaultScientificPlotSpec(readOptionalString(record.id) || createId('plot'));
  const chartRecord = record.chart === undefined ? {} : asRecord(record.chart, 'chart');
  const chartTypeValue = chartRecord.type ?? base.chart.type;
  if (!isScientificChartType(chartTypeValue)) {
    throw new Error(`Unsupported chart type: ${String(chartTypeValue)}`);
  }

  const rendererRecord = record.renderer === undefined ? {} : asRecord(record.renderer, 'renderer');
  const rendererLanguageValue = rendererRecord.language ?? base.renderer.language;
  if (!isPlotRendererLanguage(rendererLanguageValue)) {
    throw new Error(`Unsupported renderer language: ${String(rendererLanguageValue)}`);
  }

  const encodings = normalizeEncodings(record.encodings);
  const title = readOptionalString(record.title) || readOptionalString(chartRecord.title) || base.title;
  assertMaxLength(title, PLOT_DATA_LIMITS.maxTitleChars, 'plot title');

  return {
    ...base,
    id: readOptionalString(record.id) || base.id,
    title,
    dataSource: record.dataSource ? normalizeDataSource(record.dataSource) : undefined,
    snapshotId: readOptionalString(record.snapshotId),
    chart: {
      ...base.chart,
      type: chartTypeValue,
      title: readOptionalString(chartRecord.title) || title,
      subtitle: readOptionalString(chartRecord.subtitle),
      orientation: chartRecord.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      stacked: readOptionalBoolean(chartRecord.stacked) ?? base.chart.stacked,
      smooth: readOptionalBoolean(chartRecord.smooth) ?? base.chart.smooth,
      showPoints: readOptionalBoolean(chartRecord.showPoints) ?? base.chart.showPoints
    },
    encodings,
    renderer: {
      language: rendererLanguageValue,
      runtimeId: readOptionalString(rendererRecord.runtimeId),
      autoRender: readOptionalBoolean(rendererRecord.autoRender) ?? base.renderer.autoRender,
      preferredPreview: normalizePreview(rendererRecord.preferredPreview)
    },
    transforms: normalizeArray(record.transforms, PLOT_DATA_LIMITS.maxTransforms, normalizeTransform),
    analysis: normalizeArray(record.analysis, PLOT_DATA_LIMITS.maxAnalyses, normalizeAnalysis),
    layers: record.layers === undefined
      ? base.layers
      : normalizeArray(record.layers, PLOT_DATA_LIMITS.maxLayers, normalizeLayer),
    axes: record.axes === undefined ? base.axes : normalizeArray(record.axes, 4, normalizeAxis),
    annotations: record.annotations === undefined
      ? base.annotations
      : normalizeArray(record.annotations, 200, normalizeAnnotation),
    theme: record.theme === undefined ? base.theme : normalizeTheme(record.theme),
    exports: record.exports === undefined
      ? base.exports
      : normalizeArray(record.exports, 20, normalizeExport),
    provenance: record.provenance === undefined
      ? base.provenance
      : normalizeProvenance(record.provenance, base.provenance),
    links: record.links === undefined ? [] : normalizeArray(record.links, 200, normalizeLink)
  };
}

export function assertPlotDataTable(value: unknown): value is PlotDataTable {
  const record = asRecord(value, 'plot data table');
  const columns = record.columns;
  const rows = record.rows;
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('Plot data table must define at least one column.');
  }
  if (columns.length > PLOT_DATA_LIMITS.maxColumns) {
    throw new Error(`Plot data table cannot exceed ${PLOT_DATA_LIMITS.maxColumns} columns.`);
  }
  if (!Array.isArray(rows)) {
    throw new Error('Plot data table rows must be an array.');
  }
  if (rows.length > PLOT_DATA_LIMITS.maxRows) {
    throw new Error(`Plot data table cannot exceed ${PLOT_DATA_LIMITS.maxRows} rows.`);
  }

  const normalizedColumns = columns.map((column, index) => normalizeColumn(column, index));
  const ids = new Set(normalizedColumns.map((column) => column.id));
  if (ids.size !== normalizedColumns.length) {
    throw new Error('Plot data table column ids must be unique.');
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new Error(`Row ${rowIndex + 1} does not match the declared column count.`);
    }
    row.forEach((cell, columnIndex) => assertPlotCell(cell, rowIndex, columnIndex));
  }

  normalizeDataSource(record.source);
  requireNonEmptyString(record.id, 'data table id');
  requireIsoDate(record.createdAt, 'data table createdAt');
  return true;
}

export function getRendererCapability(
  language: PlotRendererLanguage,
  chartType: ScientificChartType
): PlotRendererCapability {
  const packages: Record<PlotRendererLanguage, string[]> = {
    javascript: chartType === 'scatter3d' || chartType === 'surface3d' ? ['echarts', 'echarts-gl'] : ['echarts'],
    python: ['pandas', 'matplotlib', 'seaborn', 'scipy', 'statsmodels'],
    r: ['jsonlite', 'ggplot2', 'patchwork'],
    matlab: []
  };
  const unsupported: Partial<Record<PlotRendererLanguage, ScientificChartType[]>> = {
    matlab: ['alluvial', 'raincloud']
  };
  const supported = !(unsupported[language] ?? []).includes(chartType);
  return {
    language,
    chartType,
    supported,
    reason: supported
      ? 'Available through the selected renderer.'
      : `${chartType} is not available in the controlled ${language} renderer.`,
    requiredPackages: packages[language]
  };
}

export function isScientificChartType(value: unknown): value is ScientificChartType {
  return typeof value === 'string' && (SCIENTIFIC_CHART_TYPES as readonly string[]).includes(value);
}

export function isPlotRendererLanguage(value: unknown): value is PlotRendererLanguage {
  return typeof value === 'string' && (PLOT_RENDERER_LANGUAGES as readonly string[]).includes(value);
}

function normalizeColumn(value: unknown, index: number): PlotColumn {
  const record = asRecord(value, `column ${index + 1}`);
  const id = requireNonEmptyString(record.id, `column ${index + 1} id`);
  const label = requireNonEmptyString(record.label, `column ${index + 1} label`);
  const type = record.type;
  if (!['number', 'integer', 'category', 'string', 'boolean', 'date'].includes(String(type))) {
    throw new Error(`Unsupported type for column ${id}: ${String(type)}`);
  }
  return { id, label, type: type as PlotColumnType };
}

function assertPlotCell(value: unknown, rowIndex: number, columnIndex: number): asserts value is PlotCell {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new Error(`Unsupported cell value at row ${rowIndex + 1}, column ${columnIndex + 1}.`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Non-finite number at row ${rowIndex + 1}, column ${columnIndex + 1}.`);
  }
  if (typeof value === 'string' && value.length > PLOT_DATA_LIMITS.maxCellChars) {
    throw new Error(`Cell text cannot exceed ${PLOT_DATA_LIMITS.maxCellChars} characters.`);
  }
}

function normalizeDataSource(value: unknown): PlotDataSource {
  const record = asRecord(value, 'data source');
  const kind = record.kind;
  if (!['file', 'researchSheet', 'paste', 'generated'].includes(String(kind))) {
    throw new Error(`Unsupported plot data source: ${String(kind)}`);
  }
  return {
    kind: kind as PlotDataSource['kind'],
    name: requireNonEmptyString(record.name, 'data source name'),
    filePath: readOptionalString(record.filePath),
    workbookId: readOptionalString(record.workbookId),
    sheetName: readOptionalString(record.sheetName),
    range: readOptionalString(record.range),
    mimeType: readOptionalString(record.mimeType)
  };
}

function normalizeEncodings(value: unknown): PlotEncodingSpec {
  if (value === undefined) return {};
  const record = asRecord(value, 'encodings');
  const result: PlotEncodingSpec = {};
  const keys: Array<keyof PlotEncodingSpec> = [
    'x', 'y', 'color', 'group', 'size', 'label', 'facetRow', 'facetColumn',
    'errorLower', 'errorUpper', 'source', 'target', 'value'
  ];
  keys.forEach((key) => {
    const field = readOptionalString(record[key]);
    if (field) result[key] = field;
  });
  return result;
}

function normalizeTransform(value: unknown, index: number): PlotTransformStep {
  const record = asRecord(value, `transform ${index + 1}`);
  const type = String(record.type ?? '');
  const accepted: PlotTransformType[] = [
    'rename', 'cast', 'missing', 'filter', 'sort', 'groupAggregate', 'wideToLong',
    'longToWide', 'derive', 'categoryOrder', 'join', 'append', 'sample'
  ];
  if (!accepted.includes(type as PlotTransformType)) throw new Error(`Unsupported transform type: ${type}`);
  return {
    id: requireNonEmptyString(record.id, 'transform id'),
    type: type as PlotTransformType,
    enabled: readOptionalBoolean(record.enabled) ?? true,
    label: readOptionalString(record.label) || type,
    params: record.params === undefined ? {} : asRecord(record.params, 'transform params')
  };
}

function normalizeAnalysis(value: unknown, index: number): AnalysisSpec {
  const record = asRecord(value, `analysis ${index + 1}`);
  const accepted: PlotAnalysisType[] = [
    'descriptive', 'linearRegression', 'independentT', 'pairedT', 'oneWayAnova',
    'mannWhitney', 'wilcoxonSignedRank', 'kruskalWallis', 'friedman'
  ];
  const type = String(record.type ?? '');
  if (!accepted.includes(type as PlotAnalysisType)) throw new Error(`Unsupported analysis type: ${type}`);
  return {
    id: requireNonEmptyString(record.id, 'analysis id'),
    type: type as PlotAnalysisType,
    enabled: readOptionalBoolean(record.enabled) ?? true,
    valueField: requireNonEmptyString(record.valueField, 'analysis value field'),
    groupField: readOptionalString(record.groupField),
    subjectField: readOptionalString(record.subjectField),
    groups: Array.isArray(record.groups) ? record.groups.map(String) : undefined,
    tail: record.tail === 'less' || record.tail === 'greater' ? record.tail : 'two-sided',
    alpha: readBoundedNumber(record.alpha, 0, 1) ?? 0.05,
    confidenceLevel: readBoundedNumber(record.confidenceLevel, 0, 1) ?? 0.95,
    correction: normalizeCorrection(record.correction),
    effectSize: normalizeEffectSize(record.effectSize)
  };
}

function normalizeLayer(value: unknown, index: number): PlotLayerSpec {
  const record = asRecord(value, `layer ${index + 1}`);
  const kind = String(record.kind ?? '');
  if (!['data', 'summary', 'interval', 'fit', 'annotation', 'reference'].includes(kind)) {
    throw new Error(`Unsupported layer kind: ${kind}`);
  }
  return {
    id: requireNonEmptyString(record.id, 'layer id'),
    kind: kind as PlotLayerSpec['kind'],
    visible: readOptionalBoolean(record.visible) ?? true,
    label: readOptionalString(record.label) || kind,
    params: record.params === undefined ? {} : asRecord(record.params, 'layer params')
  };
}

function normalizeAxis(value: unknown, index: number): PlotAxisSpec {
  const record = asRecord(value, `axis ${index + 1}`);
  const id = String(record.id ?? '');
  if (!['x', 'y', 'z', 'color'].includes(id)) throw new Error(`Unsupported axis: ${id}`);
  const scale = String(record.scale ?? 'linear');
  if (!['linear', 'log', 'category', 'time'].includes(scale)) throw new Error(`Unsupported axis scale: ${scale}`);
  return {
    id: id as PlotAxisSpec['id'],
    label: readOptionalString(record.label),
    scale: scale as NonNullable<PlotAxisSpec['scale']>,
    min: readOptionalFiniteNumber(record.min),
    max: readOptionalFiniteNumber(record.max),
    reverse: readOptionalBoolean(record.reverse)
  };
}

function normalizeAnnotation(value: unknown, index: number): PlotAnnotationSpec {
  const record = asRecord(value, `annotation ${index + 1}`);
  const kind = String(record.kind ?? '');
  if (!['text', 'referenceLine', 'referenceBand', 'significance'].includes(kind)) {
    throw new Error(`Unsupported annotation kind: ${kind}`);
  }
  return {
    id: requireNonEmptyString(record.id, 'annotation id'),
    kind: kind as PlotAnnotationSpec['kind'],
    label: readOptionalString(record.label),
    analysisId: readOptionalString(record.analysisId),
    params: record.params === undefined ? {} : asRecord(record.params, 'annotation params')
  };
}

function normalizeTheme(value: unknown): PlotThemeSpec {
  const record = asRecord(value, 'plot theme');
  const preset = String(record.presetId ?? DEFAULT_THEME.presetId);
  const accepted: PlotThemePresetId[] = ['general', 'natureScience', 'ieee', 'elsevier', 'chineseThesis', 'lab'];
  if (!accepted.includes(preset as PlotThemePresetId)) throw new Error(`Unsupported theme preset: ${preset}`);
  const canvasRecord = record.canvas === undefined ? {} : asRecord(record.canvas, 'theme canvas');
  const palette = Array.isArray(record.palette)
    ? record.palette.filter((item): item is string => typeof item === 'string').slice(0, 32)
    : DEFAULT_THEME.palette;
  return {
    presetId: preset as PlotThemePresetId,
    name: readOptionalString(record.name) || DEFAULT_THEME.name,
    fontFamily: readOptionalString(record.fontFamily) || DEFAULT_THEME.fontFamily,
    baseFontSize: readBoundedNumber(record.baseFontSize, 6, 72) ?? DEFAULT_THEME.baseFontSize,
    titleFontSize: readBoundedNumber(record.titleFontSize, 6, 96) ?? DEFAULT_THEME.titleFontSize,
    lineWidth: readBoundedNumber(record.lineWidth, 0.1, 20) ?? DEFAULT_THEME.lineWidth,
    markerSize: readBoundedNumber(record.markerSize, 0, 100) ?? DEFAULT_THEME.markerSize,
    palette: palette.length > 0 ? palette : [...DEFAULT_THEME.palette],
    canvas: {
      widthMm: readBoundedNumber(canvasRecord.widthMm, 20, 2_000) ?? DEFAULT_THEME.canvas.widthMm,
      heightMm: readBoundedNumber(canvasRecord.heightMm, 20, 2_000) ?? DEFAULT_THEME.canvas.heightMm,
      background: readOptionalString(canvasRecord.background) || DEFAULT_THEME.canvas.background
    },
    legendPosition: normalizeLegendPosition(record.legendPosition),
    grid: readOptionalBoolean(record.grid) ?? DEFAULT_THEME.grid
  };
}

function normalizeExport(value: unknown, index: number): PlotExportPreset {
  const record = asRecord(value, `export preset ${index + 1}`);
  const format = String(record.format ?? '');
  if (!['png', 'svg', 'pdf', 'tiff', 'html', 'fplot'].includes(format)) {
    throw new Error(`Unsupported export format: ${format}`);
  }
  return {
    id: requireNonEmptyString(record.id, 'export preset id'),
    name: requireNonEmptyString(record.name, 'export preset name'),
    format: format as PlotExportFormat,
    widthPx: readBoundedNumber(record.widthPx, 32, 100_000),
    heightPx: readBoundedNumber(record.heightPx, 32, 100_000),
    dpi: readBoundedNumber(record.dpi, 36, 2_400),
    transparent: readOptionalBoolean(record.transparent),
    embedFonts: readOptionalBoolean(record.embedFonts)
  };
}

function normalizeProvenance(value: unknown, fallback: PlotProvenanceRecord): PlotProvenanceRecord {
  const record = asRecord(value, 'plot provenance');
  return {
    createdAt: readOptionalString(record.createdAt) || fallback.createdAt,
    updatedAt: readOptionalString(record.updatedAt) || fallback.updatedAt,
    dataSnapshotHash: readOptionalString(record.dataSnapshotHash),
    derivedDataHash: readOptionalString(record.derivedDataHash),
    analysisHash: readOptionalString(record.analysisHash),
    rendererVersion: readOptionalString(record.rendererVersion),
    packageVersions: record.packageVersions === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(asRecord(record.packageVersions, 'package versions'))
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .slice(0, 100)
        )
  };
}

function normalizeLink(value: unknown, index: number): ResearchObjectLink {
  const record = asRecord(value, `research link ${index + 1}`);
  const kind = String(record.kind ?? '');
  if (!['researchProject', 'paper', 'experiment', 'researchSheet'].includes(kind)) {
    throw new Error(`Unsupported research link kind: ${kind}`);
  }
  return {
    kind: kind as ResearchObjectLink['kind'],
    id: requireNonEmptyString(record.id, 'research link id'),
    label: readOptionalString(record.label)
  };
}

function normalizeArray<T>(
  value: unknown,
  maxLength: number,
  normalize: (item: unknown, index: number) => T
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Expected an array.');
  if (value.length > maxLength) throw new Error(`Array cannot exceed ${maxLength} items.`);
  return value.map(normalize);
}

function normalizePreview(value: unknown): PlotRendererSpec['preferredPreview'] {
  return value === 'png' || value === 'html' ? value : 'svg';
}

function normalizeCorrection(value: unknown): MultipleComparisonCorrection {
  return value === 'holm' || value === 'bonferroni' || value === 'benjaminiHochberg' ? value : 'none';
}

function normalizeEffectSize(value: unknown): EffectSizeType {
  return ['cohenD', 'hedgesG', 'etaSquared', 'partialEtaSquared', 'rankBiserial'].includes(String(value))
    ? value as EffectSizeType
    : 'none';
}

function normalizeLegendPosition(value: unknown): PlotThemeSpec['legendPosition'] {
  return ['right', 'bottom', 'left', 'none'].includes(String(value))
    ? value as PlotThemeSpec['legendPosition']
    : 'top';
}

function cloneTheme(theme: PlotThemeSpec): PlotThemeSpec {
  return { ...theme, palette: [...theme.palette], canvas: { ...theme.canvas } };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoundedNumber(value: unknown, min: number, max: number): number | undefined {
  const number = readOptionalFiniteNumber(value);
  return number !== undefined && number >= min && number <= max ? number : undefined;
}

function assertMaxLength(value: string, maxLength: number, label: string): void {
  if (value.length > maxLength) throw new Error(`${label} cannot exceed ${maxLength} characters.`);
}

function requireIsoDate(value: unknown, label: string): string {
  const text = requireNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date.`);
  return text;
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}
