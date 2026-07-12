import type { PlotThemePresetId, PlotThemeSpec } from '../../shared/scientificPlot';

const BASE_PALETTE = ['#526f8a', '#738c7a', '#87768f', '#a27468', '#547f87', '#8b815f'];

export const PLOT_THEME_PRESETS: Record<Exclude<PlotThemePresetId, 'lab'>, PlotThemeSpec> = {
  general: {
    presetId: 'general',
    name: '通用科研图',
    fontFamily: 'Arial, Microsoft YaHei UI, sans-serif',
    baseFontSize: 10,
    titleFontSize: 14,
    lineWidth: 1.8,
    markerSize: 6,
    palette: BASE_PALETTE,
    canvas: { widthMm: 180, heightMm: 120, background: '#ffffff' },
    legendPosition: 'top',
    grid: true
  },
  natureScience: {
    presetId: 'natureScience',
    name: 'Nature / Science 起始样式',
    fontFamily: 'Arial, Helvetica, sans-serif',
    baseFontSize: 8,
    titleFontSize: 10,
    lineWidth: 1.2,
    markerSize: 5,
    palette: ['#3c5488', '#00a087', '#e64b35', '#4dbbd5', '#f39b7f', '#8491b4'],
    canvas: { widthMm: 183, heightMm: 115, background: '#ffffff' },
    legendPosition: 'top',
    grid: false
  },
  ieee: {
    presetId: 'ieee',
    name: 'IEEE 起始样式',
    fontFamily: 'Times New Roman, serif',
    baseFontSize: 8,
    titleFontSize: 9,
    lineWidth: 1.1,
    markerSize: 4,
    palette: ['#000000', '#4d4d4d', '#808080', '#b3b3b3', '#2f5d7c', '#7c4f4f'],
    canvas: { widthMm: 88.9, heightMm: 66, background: '#ffffff' },
    legendPosition: 'top',
    grid: true
  },
  elsevier: {
    presetId: 'elsevier',
    name: 'Elsevier 起始样式',
    fontFamily: 'Arial, Helvetica, sans-serif',
    baseFontSize: 9,
    titleFontSize: 11,
    lineWidth: 1.4,
    markerSize: 5,
    palette: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#56b4e9'],
    canvas: { widthMm: 190, heightMm: 125, background: '#ffffff' },
    legendPosition: 'right',
    grid: true
  },
  chineseThesis: {
    presetId: 'chineseThesis',
    name: '中文学位论文起始样式',
    fontFamily: 'SimSun, Songti SC, Microsoft YaHei UI, serif',
    baseFontSize: 10.5,
    titleFontSize: 14,
    lineWidth: 1.5,
    markerSize: 6,
    palette: ['#314f6b', '#6d8068', '#775f78', '#8b654f', '#4f747a', '#7b744c'],
    canvas: { widthMm: 150, heightMm: 100, background: '#ffffff' },
    legendPosition: 'top',
    grid: true
  }
};

export function getPlotThemePreset(id: Exclude<PlotThemePresetId, 'lab'>): PlotThemeSpec {
  return cloneTheme(PLOT_THEME_PRESETS[id]);
}

export function createLabPlotTheme(name: string, base: PlotThemeSpec): PlotThemeSpec {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('实验室模板名称不能为空。');
  return {
    ...cloneTheme(base),
    presetId: 'lab',
    name: normalizedName
  };
}

export function mergePlotTheme(base: PlotThemeSpec, patch: Partial<PlotThemeSpec>): PlotThemeSpec {
  return {
    ...cloneTheme(base),
    ...patch,
    palette: patch.palette ? [...patch.palette] : [...base.palette],
    canvas: { ...base.canvas, ...(patch.canvas ?? {}) }
  };
}

function cloneTheme(theme: PlotThemeSpec): PlotThemeSpec {
  return { ...theme, palette: [...theme.palette], canvas: { ...theme.canvas } };
}
