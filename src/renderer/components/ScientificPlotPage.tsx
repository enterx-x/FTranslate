import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { BarChart, BoxplotChart, CustomChart, HeatmapChart, LineChart, RadarChart, SankeyChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, DatasetComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TitleComponent, ToolboxComponent, TooltipComponent, TransformComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import {
  SCIENTIFIC_CHART_TYPES,
  getRendererCapability,
  type AnalysisSpec,
  type PlotArtifactPayload,
  type PlotColumnType,
  type PlotRendererLanguage,
  type PlotRuntimeInstallJob,
  type ScientificChartType,
  type ScientificPlotSpec
} from '../../shared/scientificPlot';
import type { ResearchWorkbook } from '../lib/researchWorkbook';
import type { ResearchSheetPlotRange } from '../lib/plotData';
import { getPlotThemePreset } from '../lib/plotThemes';
import { useScientificPlot } from '../hooks/useScientificPlot';
import styles from './ScientificPlotPage.module.css';

echarts.use([
  LineChart, ScatterChart, BarChart, BoxplotChart, HeatmapChart, SankeyChart, RadarChart, CustomChart,
  TitleComponent, TooltipComponent, LegendComponent, GridComponent, DatasetComponent, TransformComponent,
  MarkLineComponent, MarkAreaComponent, MarkPointComponent, DataZoomComponent, VisualMapComponent,
  GraphicComponent, ToolboxComponent, CanvasRenderer, SVGRenderer
]);

export interface ScientificPlotPageProps {
  researchWorkbook: ResearchWorkbook;
  researchSelection?: ResearchSheetPlotRange | null;
  onBackHome: () => void;
}

type InspectorTab = 'layers' | 'statistics' | 'style' | 'export';
type ImportSource = 'file' | 'researchSheet' | 'paste';
type HeaderMode = 'auto' | 'row' | 'none';

const CHART_LABELS: Record<ScientificChartType, string> = {
  line: '折线', scatter: '散点', bar: '柱状', area: '面积', histogram: '直方图',
  density: '密度', ecdf: 'ECDF', box: '箱线', violin: '小提琴', raincloud: '雨云',
  beeswarm: '蜂群', heatmap: '热图', correlation: '相关矩阵', clusteredHeatmap: '聚类热图',
  contour: '等高线', density2d: '二维密度', scatter3d: '3D 散点', surface3d: '3D 曲面',
  sankey: 'Sankey', alluvial: 'Alluvial', survival: '生存曲线', forest: '森林图',
  volcano: '火山图', radar: '雷达图'
};

const RENDERER_LABELS: Record<PlotRendererLanguage, string> = {
  javascript: 'JavaScript / ECharts', python: 'Python', r: 'R', matlab: 'MATLAB'
};

const PLOT_FONT_OPTIONS = [
  { label: '自动兼容中文（推荐）', value: 'Microsoft YaHei UI, Microsoft YaHei, Noto Sans CJK SC, SimHei, Arial, DejaVu Sans, sans-serif' },
  { label: 'Arial / 中文回退', value: 'Arial, Microsoft YaHei UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif' },
  { label: 'Helvetica / 中文回退', value: 'Arial, Helvetica, Microsoft YaHei UI, Noto Sans CJK SC, sans-serif' },
  { label: 'Times New Roman / 宋体回退', value: 'Times New Roman, SimSun, Noto Serif CJK SC, serif' },
  { label: '微软雅黑', value: 'Microsoft YaHei, Microsoft YaHei UI, Noto Sans CJK SC, sans-serif' },
  { label: '宋体', value: 'SimSun, Songti SC, Noto Serif CJK SC, Microsoft YaHei UI, serif' },
  { label: '黑体', value: 'SimHei, Microsoft YaHei, Noto Sans CJK SC, sans-serif' },
  { label: 'Noto Sans CJK', value: 'Noto Sans CJK SC, Microsoft YaHei, SimHei, sans-serif' }
] as const;

export function ScientificPlotPage(props: ScientificPlotPageProps) {
  const plot = useScientificPlot();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('layers');
  const [importOpen, setImportOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const chartRef = useRef<EChartsType | null>(null);
  const stale = plot.renderJob?.artifacts.some((artifact) => artifact.stale) === true;
  const runtime = plot.runtimes.find((item) => item.language === plot.spec.renderer.language);
  const chartCapability = getRendererCapability(plot.spec.renderer.language, plot.spec.chart.type);

  useEffect(() => {
    void window.electronAPI.getScientificPlotInstallerIntent().then(async (intent) => {
      if (!intent.python && !intent.r && !intent.matlabDetect) return;
      setRuntimeOpen(true);
      await window.electronAPI.acknowledgeScientificPlotInstallerIntent();
    });
  }, []);

  useEffect(() => {
    if (runtimeOpen && plot.runtimes.length === 0) void plot.refreshRuntimes();
  }, [plot.refreshRuntimes, plot.runtimes.length, runtimeOpen]);

  async function exportEcharts(format: 'png' | 'svg'): Promise<void> {
    const chart = chartRef.current;
    if (!chart || !plot.echarts) return;
    const defaultFileName = `${sanitizePlotFileName(plot.spec.title)}.${format}`;
    if (format === 'png') {
      const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: '#ffffff' });
      await window.electronAPI.exportScientificPlotGeneratedArtifact({
        format,
        defaultFileName,
        content: dataUrl.slice(dataUrl.indexOf(',') + 1),
        encoding: 'base64'
      });
      return;
    }
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:-10000px;width:${chart.getWidth()}px;height:${chart.getHeight()}px`;
    document.body.appendChild(host);
    const svgChart = echarts.init(host, undefined, { renderer: 'svg' });
    try {
      svgChart.setOption(plot.echarts.option, true);
      await window.electronAPI.exportScientificPlotGeneratedArtifact({
        format,
        defaultFileName,
        content: svgChart.renderToSVGString(),
        encoding: 'utf8'
      });
    } finally {
      svgChart.dispose();
      host.remove();
    }
  }

  function changeRenderer(language: PlotRendererLanguage): void {
    plot.updateSpec((current) => ({
      ...current,
      chart: getRendererCapability(language, current.chart.type).supported ? current.chart : { ...current.chart, type: 'line' },
      renderer: { ...current.renderer, language, autoRender: language === 'javascript' }
    }));
    const detected = plot.runtimes.find((item) => item.language === language);
    if (language !== 'javascript' && (!detected || detected.status === 'missing')) setRuntimeOpen(true);
  }

  return (
    <main className={styles.page} data-scientific-plot-page>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <button type="button" className={styles.backButton} onClick={props.onBackHome} aria-label="返回项目空间">←</button>
          <div><h1>{plot.spec.title}</h1><p>科研绘图 · {plot.rawData?.source.name ?? '尚未导入数据'} · {plot.projectCreated ? '已自动保存' : '未保存'}</p></div>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.rendererSelect}><span>绘图语言</span><select aria-label="选择绘图语言" value={plot.spec.renderer.language} onChange={(event) => changeRenderer(event.target.value as PlotRendererLanguage)}>{Object.entries(RENDERER_LABELS).map(([id, label]) => { const language = id as PlotRendererLanguage; const item = plot.runtimes.find((candidate) => candidate.language === language); const status = language === 'javascript' ? '内置' : !item ? plot.busy ? '检测中' : '未检测' : item.status === 'ready' ? '已检测' : item.status === 'degraded' ? '缺依赖' : '未安装'; return <option key={id} value={id}>{label}（{status}）</option>; })}</select></label>
          <span className={`${styles.runtimePill} ${runtime?.status === 'ready' || plot.spec.renderer.language === 'javascript' ? styles.runtimeReady : ''}`}>● {plot.spec.renderer.language === 'javascript' ? 'ECharts Ready' : runtime ? runtime.status : '未检测'}</span>
          <button type="button" className={styles.secondaryButton} onClick={() => setRuntimeOpen(true)}>管理环境</button>
          <button type="button" className={styles.secondaryButton} onClick={() => setScriptOpen(true)} disabled={!plot.rawData}>查看脚本</button>
          <button type="button" className={styles.primaryButton} onClick={() => setExportOpen(true)} disabled={!plot.rawData}>导出结果</button>
        </div>
      </header>

      <div className={`${styles.workspace} ${inspectorCollapsed ? styles.inspectorCollapsed : ''}`}>
        <aside className={styles.dataRail}>
          <div className={styles.railHeading}><h2>数据与字段</h2><button type="button" onClick={() => setImportOpen(true)}>更换数据</button></div>
          <button type="button" className={styles.importButton} onClick={() => setImportOpen(true)}>＋ 导入数据</button>
          {plot.health ? <div className={styles.dataCard}><strong>{plot.rawData?.source.name}</strong><span>{plot.health.rowCount} 行 × {plot.health.columnCount} 列</span><div className={styles.healthGrid}><div><b>{plot.health.rowCount}</b><small>有效行</small></div><div><b>{plot.health.missingCellCount}</b><small>缺失值</small></div><div><b>{plot.health.duplicateRowCount}</b><small>重复行</small></div></div></div> : <div className={styles.emptyData}>支持 CSV、TSV、Excel、当前科研表格和粘贴数据。全部在本机处理。</div>}
          <div className={styles.sectionHeading}><h3>字段</h3><span>{plot.rawData?.columns.length ?? 0}</span></div>
          <div className={styles.fieldList}>{plot.rawData?.columns.map((column) => <div className={styles.fieldRow} key={column.id}><span className={styles.fieldIcon}>{column.type === 'number' || column.type === 'integer' ? '#' : 'A'}</span><div><b title={column.label}>{column.label}</b><small>{column.id}</small></div><select value={column.type} aria-label={`${column.label} 字段类型`} onChange={(event) => addCastTransform(plot.spec, plot.updateSpec, column.id, event.target.value as PlotColumnType)}><option value="number">数值</option><option value="integer">整数</option><option value="category">分类</option><option value="string">文本</option><option value="boolean">布尔</option><option value="date">日期</option></select></div>)}</div>
          <div className={styles.sectionHeading}><h3>转换流水线</h3><button type="button" onClick={() => setTransformOpen(true)} disabled={!plot.rawData}>＋ 添加</button></div>
          <div className={styles.pipeline}>{plot.spec.transforms.length === 0 ? <p>尚未添加转换；原始快照保持只读。</p> : plot.spec.transforms.map((step, index) => <article key={step.id}><span>{index + 1}</span><div><b>{step.label}</b><small>{plot.transformRecords[index]?.message ?? step.type}</small></div><button type="button" onClick={() => plot.updateSpec((current) => ({ ...current, transforms: current.transforms.filter((item) => item.id !== step.id) }))}>×</button></article>)}</div>
        </aside>

        <section className={styles.canvasColumn}>
          <div className={styles.chartToolbar}>
            <div className={styles.chartQuick}>{(['line', 'scatter', 'bar', 'box', 'violin', 'heatmap'] as ScientificChartType[]).map((type) => { const supported = getRendererCapability(plot.spec.renderer.language, type).supported; return <button type="button" key={type} disabled={!supported} title={supported ? CHART_LABELS[type] : `${RENDERER_LABELS[plot.spec.renderer.language]} 暂不支持`} className={plot.spec.chart.type === type ? styles.activeTool : ''} onClick={() => setChartType(plot.spec, plot.updateSpec, type)}>{CHART_LABELS[type]}</button>; })}<select value={plot.spec.chart.type} onChange={(event) => setChartType(plot.spec, plot.updateSpec, event.target.value as ScientificChartType)}>{SCIENTIFIC_CHART_TYPES.map((type) => <option key={type} value={type} disabled={!getRendererCapability(plot.spec.renderer.language, type).supported}>{CHART_LABELS[type]}</option>)}</select></div>
            <div className={styles.canvasActions}><button type="button" onClick={() => void plot.render(true)} disabled={!plot.plotData || plot.busy || !chartCapability.supported}>{plot.spec.renderer.language === 'matlab' ? '重新渲染' : '渲染预览'}</button>{plot.renderJob && ['queued', 'running'].includes(plot.renderJob.status) ? <button type="button" onClick={() => void plot.cancelRender()}>取消</button> : null}</div>
          </div>
          <div className={styles.canvasSurface}>
            {!plot.plotData ? <div className={styles.canvasEmpty}><div>▦</div><h2>先导入一份实验数据</h2><p>导入前可检查工作表、表头、字段类型和缺失值。</p><button type="button" className={styles.primaryButton} onClick={() => setImportOpen(true)}>选择数据来源</button></div> : plot.spec.renderer.language === 'javascript' && plot.echarts ? <EChartsCanvas option={plot.echarts.option} requiresGl={plot.spec.chart.type === 'scatter3d' || plot.spec.chart.type === 'surface3d'} onReady={(chart) => { chartRef.current = chart; }} /> : plot.externalPreview ? <ExternalPreview payload={plot.externalPreview} /> : <div className={styles.canvasEmpty}><div>⌁</div><h2>等待 {RENDERER_LABELS[plot.spec.renderer.language]} 真实渲染</h2><p>不会使用 ECharts 代替当前语言。点击“渲染预览”开始。</p></div>}
            {stale ? <div className={styles.staleOverlay}><b>预览已过期</b><span>当前配置渲染失败，画布保留的是上一次成功结果，禁止作为当前结果导出。</span></div> : null}
          </div>
          <div className={styles.statusStrip}><div><b>数据</b><span>{plot.plotData ? `${plot.plotData.rows.length} 行完整数据` : '等待导入'}</span></div><div><b>统计</b><span>{plot.analyses.length ? `${plot.analyses.length} 项，${plot.analyses.filter((item) => item.status === 'invalid').length} 项无效` : '未配置或未运行'}</span></div><div><b>渲染器</b><span>{RENDERER_LABELS[plot.spec.renderer.language]}</span></div><div className={plot.error ? styles.statusError : ''}><b>{plot.error ? '错误' : '状态'}</b><span>{plot.error || plot.message}</span></div></div>
        </section>

        <aside className={styles.inspector}>
          <button type="button" className={styles.collapseInspector} onClick={() => setInspectorCollapsed((value) => !value)} aria-label={inspectorCollapsed ? '展开 Inspector' : '折叠 Inspector'}>{inspectorCollapsed ? '‹' : '›'}</button>
          {!inspectorCollapsed ? <><div className={styles.inspectorTabs}>{(['layers', 'statistics', 'style', 'export'] as InspectorTab[]).map((tab) => <button type="button" key={tab} className={inspectorTab === tab ? styles.activeTab : ''} onClick={() => setInspectorTab(tab)}>{tab === 'layers' ? '图层' : tab === 'statistics' ? '统计' : tab === 'style' ? '样式' : '导出'}</button>)}</div><div className={styles.inspectorBody}>
            {inspectorTab === 'layers' ? <LayersInspector plot={plot} /> : null}
            {inspectorTab === 'statistics' ? <StatisticsInspector plot={plot} /> : null}
            {inspectorTab === 'style' ? <StyleInspector plot={plot} /> : null}
            {inspectorTab === 'export' ? <ExportInspector plot={plot} onOpen={() => setExportOpen(true)} stale={stale} /> : null}
          </div></> : null}
        </aside>
      </div>

      {importOpen ? <ImportDialog plot={plot} workbook={props.researchWorkbook} selection={props.researchSelection} onClose={() => setImportOpen(false)} /> : null}
      {runtimeOpen ? <RuntimeDialog plot={plot} onClose={() => setRuntimeOpen(false)} /> : null}
      {exportOpen ? <ExportDialog plot={plot} stale={stale} onExportEcharts={exportEcharts} onClose={() => setExportOpen(false)} /> : null}
      {scriptOpen ? <ScriptDialog plot={plot} onClose={() => setScriptOpen(false)} /> : null}
      {transformOpen ? <TransformDialog plot={plot} onClose={() => setTransformOpen(false)} /> : null}
    </main>
  );
}

function LayersInspector({ plot }: { plot: ReturnType<typeof useScientificPlot> }) {
  const fields = plot.plotData?.columns ?? [];
  const supportsCurve = plot.spec.chart.type === 'line' || plot.spec.chart.type === 'area';
  const supportsStack = plot.spec.chart.type === 'bar' || plot.spec.chart.type === 'area';
  return <>
    <InspectorSection title="字段映射"><MappingSelect label="X 轴" value={plot.spec.encodings.x} fields={fields} onChange={(value) => setEncoding(plot, 'x', value)} /><MappingSelect label="Y 轴" value={plot.spec.encodings.y} fields={fields} onChange={(value) => setEncoding(plot, 'y', value)} /><MappingSelect label="颜色/分组" value={plot.spec.encodings.color} fields={fields} optional onChange={(value) => setEncoding(plot, 'color', value)} /><MappingSelect label="误差下界" value={plot.spec.encodings.errorLower} fields={fields} optional onChange={(value) => setEncoding(plot, 'errorLower', value)} /><MappingSelect label="误差上界" value={plot.spec.encodings.errorUpper} fields={fields} optional onChange={(value) => setEncoding(plot, 'errorUpper', value)} /><MappingSelect label="分面行" value={plot.spec.encodings.facetRow} fields={fields} optional onChange={(value) => setEncoding(plot, 'facetRow', value)} /><MappingSelect label="分面列" value={plot.spec.encodings.facetColumn} fields={fields} optional onChange={(value) => setEncoding(plot, 'facetColumn', value)} /></InspectorSection>
    <InspectorSection title="图形参数">
      {plot.spec.chart.type === 'bar' ? <label className={styles.formField}>方向<select value={plot.spec.chart.orientation} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, orientation: event.target.value as 'vertical' | 'horizontal' } }))}><option value="vertical">纵向</option><option value="horizontal">横向</option></select></label> : null}
      {supportsCurve ? <div className={styles.compactGrid}><label className={styles.formField}>线型<select value={plot.spec.chart.lineStyle ?? 'solid'} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, lineStyle: event.target.value as ScientificPlotSpec['chart']['lineStyle'] } }))}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label><label className={styles.formField}>标记<select value={plot.spec.chart.markerShape ?? 'circle'} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, markerShape: event.target.value as ScientificPlotSpec['chart']['markerShape'] } }))}><option value="circle">圆形</option><option value="square">方形</option><option value="diamond">菱形</option><option value="triangle">三角形</option><option value="none">无标记</option></select></label></div> : null}
      <label className={styles.formField}>图形透明度<input type="number" min="0" max="1" step="0.05" value={plot.spec.chart.opacity ?? 1} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, opacity: Math.min(1, Math.max(0, Number(event.target.value) || 0)) } }))} /></label>
      {supportsCurve || supportsStack ? <div className={styles.inlineChecks}>{supportsCurve ? <><label className={styles.checkRow}><input type="checkbox" checked={plot.spec.chart.showPoints} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, showPoints: event.target.checked } }))} />显示数据点</label><label className={styles.checkRow}><input type="checkbox" checked={plot.spec.chart.smooth} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, smooth: event.target.checked } }))} />平滑曲线</label></> : null}{supportsStack ? <label className={styles.checkRow}><input type="checkbox" checked={plot.spec.chart.stacked} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, stacked: event.target.checked } }))} />堆叠</label> : null}</div> : <p className={styles.muted}>当前图形没有额外的通用参数。</p>}
    </InspectorSection>
    <InspectorSection title="图层">{plot.spec.layers.map((layer, index) => <article className={styles.layerCard} key={layer.id}><b>{index + 1} · {layer.label}</b><button type="button" onClick={() => plot.updateSpec((current) => ({ ...current, layers: current.layers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item) }))}>{layer.visible ? '显示 ✓' : '隐藏'}</button><span>{layer.kind}</span></article>)}</InspectorSection>
  </>;
}

function StatisticsInspector({ plot }: { plot: ReturnType<typeof useScientificPlot> }) {
  const analysis = plot.spec.analysis[0];
  const fields = plot.plotData?.columns ?? [];
  return <><InspectorSection title="检验设计"><button type="button" className={styles.fullButton} disabled={!plot.plotData} onClick={() => plot.updateSpec((current) => ({ ...current, analysis: current.analysis.length ? current.analysis : [defaultAnalysis(current)] }))}>{analysis ? '已建立显式检验设计' : '＋ 添加统计检验'}</button>{analysis ? <><label className={styles.formField}>方法<select value={analysis.type} onChange={(event) => updateAnalysis(plot, { type: event.target.value as AnalysisSpec['type'] })}><option value="descriptive">描述统计 + CI</option><option value="linearRegression">线性回归</option><option value="independentT">独立样本 t</option><option value="pairedT">配对 t</option><option value="oneWayAnova">单因素 ANOVA</option><option value="mannWhitney">Mann-Whitney</option><option value="wilcoxonSignedRank">Wilcoxon 符号秩</option><option value="kruskalWallis">Kruskal-Wallis</option><option value="friedman">Friedman</option></select></label><MappingSelect label="数值字段" value={analysis.valueField} fields={fields} onChange={(value) => updateAnalysis(plot, { valueField: value })} /><MappingSelect label="分组字段" value={analysis.groupField} fields={fields} optional onChange={(value) => updateAnalysis(plot, { groupField: value || undefined })} /><MappingSelect label="seed/受试者" value={analysis.subjectField} fields={fields} optional onChange={(value) => updateAnalysis(plot, { subjectField: value || undefined })} /><label className={styles.formField}>比较组（逗号分隔）<input value={(analysis.groups ?? []).join(', ')} onChange={(event) => updateAnalysis(plot, { groups: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label><label className={styles.formField}>多重校正<select value={analysis.correction} onChange={(event) => updateAnalysis(plot, { correction: event.target.value as AnalysisSpec['correction'] })}><option value="none">无</option><option value="holm">Holm</option><option value="bonferroni">Bonferroni</option><option value="benjaminiHochberg">Benjamini-Hochberg</option></select></label><button type="button" className={styles.primaryWideButton} onClick={() => void plot.runAnalyses()}>运行统计</button></> : null}</InspectorSection><InspectorSection title="统计结果">{plot.analyses.length ? plot.analyses.map((result) => <article className={`${styles.analysisCard} ${result.status === 'invalid' ? styles.invalidCard : ''}`} key={result.analysisId}><b>{result.method}</b><span>{result.status === 'invalid' ? result.error : `p ${result.pValue === undefined ? '—' : result.pValue < .001 ? '< 0.001' : `= ${result.pValue.toFixed(4)}`}`}</span><small>{Object.entries(result.sampleSizes).map(([key, value]) => `${key}=${value}`).join(' · ')}</small></article>) : <p className={styles.muted}>系统不会自动猜测检验；请先配置实验设计。</p>}</InspectorSection></>;
}

function StyleInspector({ plot }: { plot: ReturnType<typeof useScientificPlot> }) {
  const updateTheme = (patch: Partial<ScientificPlotSpec['theme']>) => plot.updateSpec((current) => ({ ...current, theme: { ...current.theme, ...patch } }));
  return <>
    <InspectorSection title="论文/报告预设"><div className={styles.presetGrid}>{(['general', 'natureScience', 'ieee', 'elsevier', 'chineseThesis'] as const).map((id) => { const theme = getPlotThemePreset(id); return <button type="button" key={id} className={plot.spec.theme.presetId === id ? styles.activePreset : ''} onClick={() => plot.updateSpec((current) => ({ ...current, theme }))}>{theme.name}</button>; })}</div><p className={styles.muted}>预设是可编辑起点；下面所有参数仍可继续调整。</p></InspectorSection>
    <InspectorSection title="标题与画布">
      <label className={styles.formField}>标题<input value={plot.spec.chart.title} onChange={(event) => plot.updateSpec((current) => ({ ...current, title: event.target.value, chart: { ...current.chart, title: event.target.value } }))} /></label>
      <label className={styles.formField}>副标题<input value={plot.spec.chart.subtitle ?? ''} onChange={(event) => plot.updateSpec((current) => ({ ...current, chart: { ...current.chart, subtitle: event.target.value || undefined } }))} /></label>
      <div className={styles.compactGrid}><label className={styles.formField}>标题位置<select value={plot.spec.theme.titleAlign} onChange={(event) => updateTheme({ titleAlign: event.target.value as ScientificPlotSpec['theme']['titleAlign'] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><label className={styles.formField}>标题字重<select value={plot.spec.theme.titleFontWeight} onChange={(event) => updateTheme({ titleFontWeight: event.target.value as ScientificPlotSpec['theme']['titleFontWeight'] })}><option value="normal">常规</option><option value="bold">粗体</option></select></label><label className={styles.formField}>标题颜色<input type="color" value={plot.spec.theme.titleColor} onChange={(event) => updateTheme({ titleColor: event.target.value })} /></label><label className={styles.formField}>背景色<input type="color" value={plot.spec.theme.canvas.background} onChange={(event) => updateTheme({ canvas: { ...plot.spec.theme.canvas, background: event.target.value } })} /></label><label className={styles.formField}>宽度 mm<input type="number" min="20" value={plot.spec.theme.canvas.widthMm} onChange={(event) => updateThemeNumber(plot, 'widthMm', event.target.value)} /></label><label className={styles.formField}>高度 mm<input type="number" min="20" value={plot.spec.theme.canvas.heightMm} onChange={(event) => updateThemeNumber(plot, 'heightMm', event.target.value)} /></label><label className={styles.formField}>基础字号<input type="number" min="6" max="72" value={plot.spec.theme.baseFontSize} onChange={(event) => updateThemeNumber(plot, 'baseFontSize', event.target.value)} /></label><label className={styles.formField}>标题字号<input type="number" min="6" max="96" value={plot.spec.theme.titleFontSize} onChange={(event) => updateThemeNumber(plot, 'titleFontSize', event.target.value)} /></label></div>
      <h4 className={styles.subsectionTitle}>画图区边距</h4><div className={styles.compactGrid}>{(['left', 'right', 'top', 'bottom'] as const).map((side) => <label className={styles.formField} key={side}>{side === 'left' ? '左' : side === 'right' ? '右' : side === 'top' ? '上' : '下'}边距<input type="number" min="0" max="500" value={plot.spec.theme.plotPadding[side]} onChange={(event) => updateTheme({ plotPadding: { ...plot.spec.theme.plotPadding, [side]: Number(event.target.value) || 0 } })} /></label>)}</div>
    </InspectorSection>
    <InspectorSection title="字体、线条与配色">
      <label className={styles.formField}>字体<select value={plot.spec.theme.fontFamily} onChange={(event) => updateTheme({ fontFamily: event.target.value })}>{!PLOT_FONT_OPTIONS.some((item) => item.value === plot.spec.theme.fontFamily) ? <option value={plot.spec.theme.fontFamily}>当前预设兼容字体</option> : null}{PLOT_FONT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <div className={styles.compactGrid}><label className={styles.formField}>线宽<input type="number" min="0.1" step="0.1" value={plot.spec.theme.lineWidth} onChange={(event) => updateThemeNumber(plot, 'lineWidth', event.target.value)} /></label><label className={styles.formField}>标记大小<input type="number" min="0" step="0.5" value={plot.spec.theme.markerSize} onChange={(event) => updateThemeNumber(plot, 'markerSize', event.target.value)} /></label></div>
      <div className={styles.paletteGrid}>{plot.spec.theme.palette.slice(0, 8).map((color, index) => <label key={`${index}-${color}`}>颜色 {index + 1}<input type="color" value={color} onChange={(event) => updateTheme({ palette: plot.spec.theme.palette.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} /></label>)}</div>
    </InspectorSection>
    <InspectorSection title="图例">
      <div className={styles.compactGrid}><label className={styles.formField}>位置<select value={plot.spec.theme.legendPosition} onChange={(event) => updateTheme({ legendPosition: event.target.value as ScientificPlotSpec['theme']['legendPosition'], legendX: undefined, legendY: undefined })}><option value="top">顶部</option><option value="right">右侧</option><option value="bottom">底部</option><option value="left">左侧</option><option value="none">隐藏</option></select></label><label className={styles.formField}>排列<select value={plot.spec.theme.legendOrientation} onChange={(event) => updateTheme({ legendOrientation: event.target.value as ScientificPlotSpec['theme']['legendOrientation'] })}><option value="auto">自动</option><option value="horizontal">横向</option><option value="vertical">纵向</option></select></label><label className={styles.formField}>内容对齐<select value={plot.spec.theme.legendAlign} onChange={(event) => updateTheme({ legendAlign: event.target.value as ScientificPlotSpec['theme']['legendAlign'] })}><option value="start">起始</option><option value="center">居中</option><option value="end">末端</option></select></label><label className={styles.formField}>字号<input type="number" min="6" max="72" value={plot.spec.theme.legendFontSize} onChange={(event) => updateTheme({ legendFontSize: Number(event.target.value) || 6 })} /></label><label className={styles.formField}>自定义 X %<input type="number" min="0" max="100" value={plot.spec.theme.legendX ?? ''} placeholder="使用预设" onChange={(event) => updateTheme({ legendX: optionalNumber(event.target.value) })} /></label><label className={styles.formField}>自定义 Y %<input type="number" min="0" max="100" value={plot.spec.theme.legendY ?? ''} placeholder="使用预设" onChange={(event) => updateTheme({ legendY: optionalNumber(event.target.value) })} /></label><label className={styles.formField}>文字颜色<input type="color" value={plot.spec.theme.legendColor} onChange={(event) => updateTheme({ legendColor: event.target.value })} /></label><label className={styles.formField}>项目间距<input type="number" min="0" max="100" value={plot.spec.theme.legendItemGap} onChange={(event) => updateTheme({ legendItemGap: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>符号宽度<input type="number" min="0" max="100" value={plot.spec.theme.legendSymbolWidth} onChange={(event) => updateTheme({ legendSymbolWidth: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>符号高度<input type="number" min="0" max="100" value={plot.spec.theme.legendSymbolHeight} onChange={(event) => updateTheme({ legendSymbolHeight: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>边框宽度<input type="number" min="0" max="20" value={plot.spec.theme.legendBorderWidth} onChange={(event) => updateTheme({ legendBorderWidth: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>边框颜色<input type="color" value={plot.spec.theme.legendBorderColor} onChange={(event) => updateTheme({ legendBorderColor: event.target.value })} /></label></div>
      <div className={styles.inlineChecks}><label className={styles.checkRow}><input type="checkbox" checked={plot.spec.theme.legendBackgroundVisible} onChange={(event) => updateTheme({ legendBackgroundVisible: event.target.checked })} />显示背景</label></div>{plot.spec.theme.legendBackgroundVisible ? <label className={styles.formField}>背景颜色<input type="color" value={plot.spec.theme.legendBackground} onChange={(event) => updateTheme({ legendBackground: event.target.value })} /></label> : null}
    </InspectorSection>
    <AxisEditor plot={plot} id="x" /><AxisAppearanceEditor plot={plot} id="x" />
    <AxisEditor plot={plot} id="y" /><AxisAppearanceEditor plot={plot} id="y" />
  </>;
}

function AxisEditor({ plot, id }: { plot: ReturnType<typeof useScientificPlot>; id: 'x' | 'y' }) {
  const axis = plot.spec.axes.find((item) => item.id === id) ?? { id, scale: 'auto' as const };
  const axisName = id === 'x' ? '横轴 X' : '纵轴 Y';
  return <InspectorSection title={axisName}><div className={styles.axisEditor}><label className={styles.formField}>轴标题<input value={axis.label ?? ''} placeholder={id === 'x' ? '例如：年份' : '例如：GDP（亿元）'} onChange={(event) => updateAxis(plot, id, { label: event.target.value || undefined })} /></label><div className={styles.compactGrid}><label className={styles.formField}>尺度<select value={axis.scale ?? 'auto'} onChange={(event) => updateAxis(plot, id, { scale: event.target.value as typeof axis.scale })}><option value="auto">自动</option><option value="linear">线性</option><option value="log">对数</option><option value="category">分类</option><option value="time">时间</option></select></label><label className={styles.formField}>位置<select value={axis.position ?? 'primary'} onChange={(event) => updateAxis(plot, id, { position: event.target.value as 'primary' | 'secondary' })}><option value="primary">{id === 'x' ? '底部' : '左侧'}</option><option value="secondary">{id === 'x' ? '顶部' : '右侧'}</option></select></label><label className={styles.formField}>最小值<input type="number" value={axis.min ?? ''} placeholder="自动" onChange={(event) => updateAxis(plot, id, { min: optionalNumber(event.target.value) })} /></label><label className={styles.formField}>最大值<input type="number" value={axis.max ?? ''} placeholder="自动" onChange={(event) => updateAxis(plot, id, { max: optionalNumber(event.target.value) })} /></label><label className={styles.formField}>主刻度数<input type="number" min="2" max="50" value={axis.tickCount ?? ''} placeholder="自动" onChange={(event) => updateAxis(plot, id, { tickCount: optionalNumber(event.target.value) })} /></label><label className={styles.formField}>刻度间隔<input type="number" min="0" value={axis.tickInterval ?? ''} placeholder="自动" onChange={(event) => updateAxis(plot, id, { tickInterval: optionalNumber(event.target.value) })} /></label></div>{axis.scale === 'log' ? <label className={styles.formField}>对数底数<input type="number" min="2" max="100" value={axis.logBase ?? 10} onChange={(event) => updateAxis(plot, id, { logBase: Number(event.target.value) || 10 })} /></label> : null}<div className={styles.inlineChecks}><label className={styles.checkRow}><input type="checkbox" checked={axis.visible !== false} onChange={(event) => updateAxis(plot, id, { visible: event.target.checked })} />显示轴</label><label className={styles.checkRow}><input type="checkbox" checked={axis.reverse === true} onChange={(event) => updateAxis(plot, id, { reverse: event.target.checked })} />反向</label><label className={styles.checkRow}><input type="checkbox" checked={axis.showLine !== false} onChange={(event) => updateAxis(plot, id, { showLine: event.target.checked })} />轴线</label><label className={styles.checkRow}><input type="checkbox" checked={axis.showTicks !== false} onChange={(event) => updateAxis(plot, id, { showTicks: event.target.checked })} />刻度</label><label className={styles.checkRow}><input type="checkbox" checked={axis.minorTicks === true} onChange={(event) => updateAxis(plot, id, { minorTicks: event.target.checked })} />次刻度</label></div><h4>刻度标签</h4><div className={styles.compactGrid}><label className={styles.formField}>数字格式<select value={axis.numberFormat ?? 'auto'} onChange={(event) => updateAxis(plot, id, { numberFormat: event.target.value as typeof axis.numberFormat })}><option value="auto">自动</option><option value="fixed">定点小数</option><option value="scientific">科学计数</option><option value="percent">百分比</option></select></label><label className={styles.formField}>小数位<input type="number" min="0" max="10" value={axis.decimalPlaces ?? 2} onChange={(event) => updateAxis(plot, id, { decimalPlaces: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>旋转角度<input type="number" min="-90" max="90" value={axis.labelRotation ?? 0} onChange={(event) => updateAxis(plot, id, { labelRotation: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>标签字号<input type="number" min="6" max="72" value={axis.labelFontSize ?? plot.spec.theme.baseFontSize} onChange={(event) => updateAxis(plot, id, { labelFontSize: Number(event.target.value) || plot.spec.theme.baseFontSize })} /></label><label className={styles.formField}>前缀<input value={axis.prefix ?? ''} onChange={(event) => updateAxis(plot, id, { prefix: event.target.value || undefined })} /></label><label className={styles.formField}>后缀<input value={axis.suffix ?? ''} onChange={(event) => updateAxis(plot, id, { suffix: event.target.value || undefined })} /></label></div><div className={styles.inlineChecks}><label className={styles.checkRow}><input type="checkbox" checked={axis.showLabels !== false} onChange={(event) => updateAxis(plot, id, { showLabels: event.target.checked })} />显示标签</label><label className={styles.checkRow}><input type="checkbox" checked={axis.thousandsSeparator !== false} onChange={(event) => updateAxis(plot, id, { thousandsSeparator: event.target.checked })} />千位分隔</label></div><h4>网格与标题</h4><div className={styles.compactGrid}><label className={styles.formField}>标题字号<input type="number" min="6" max="72" value={axis.titleFontSize ?? plot.spec.theme.baseFontSize} onChange={(event) => updateAxis(plot, id, { titleFontSize: Number(event.target.value) || plot.spec.theme.baseFontSize })} /></label><label className={styles.formField}>标题间距<input type="number" min="0" max="200" value={axis.titleGap ?? (id === 'x' ? 30 : 42)} onChange={(event) => updateAxis(plot, id, { titleGap: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>网格颜色<input type="color" value={axis.gridColor ?? '#e4e8ed'} onChange={(event) => updateAxis(plot, id, { gridColor: event.target.value })} /></label><label className={styles.formField}>网格线宽<input type="number" min="0.1" max="10" step="0.1" value={axis.gridWidth ?? 0.8} onChange={(event) => updateAxis(plot, id, { gridWidth: Number(event.target.value) || 0.8 })} /></label></div><div className={styles.inlineChecks}><label className={styles.checkRow}><input type="checkbox" checked={axis.showGrid ?? plot.spec.theme.grid} onChange={(event) => updateAxis(plot, id, { showGrid: event.target.checked })} />主网格</label><label className={styles.checkRow}><input type="checkbox" checked={axis.showMinorGrid === true} onChange={(event) => updateAxis(plot, id, { showMinorGrid: event.target.checked })} />次网格</label></div></div></InspectorSection>;
}

function AxisAppearanceEditor({ plot, id }: { plot: ReturnType<typeof useScientificPlot>; id: 'x' | 'y' }) {
  const axis = plot.spec.axes.find((item) => item.id === id) ?? { id, scale: 'auto' as const };
  return <InspectorSection title={`${id === 'x' ? '横轴 X' : '纵轴 Y'} · 线条与颜色`}><div className={styles.compactGrid}><label className={styles.formField}>轴线颜色<input type="color" value={axis.lineColor ?? '#738193'} onChange={(event) => updateAxis(plot, id, { lineColor: event.target.value })} /></label><label className={styles.formField}>轴线宽度<input type="number" min="0.1" max="10" step="0.1" value={axis.lineWidth ?? 1} onChange={(event) => updateAxis(plot, id, { lineWidth: Number(event.target.value) || 1 })} /></label><label className={styles.formField}>刻度颜色<input type="color" value={axis.tickColor ?? axis.lineColor ?? '#738193'} onChange={(event) => updateAxis(plot, id, { tickColor: event.target.value })} /></label><label className={styles.formField}>刻度长度<input type="number" min="0" max="50" value={axis.tickLength ?? 5} onChange={(event) => updateAxis(plot, id, { tickLength: Number(event.target.value) || 0 })} /></label><label className={styles.formField}>标签颜色<input type="color" value={axis.labelColor ?? '#526172'} onChange={(event) => updateAxis(plot, id, { labelColor: event.target.value })} /></label><label className={styles.formField}>标题颜色<input type="color" value={axis.titleColor ?? '#26364a'} onChange={(event) => updateAxis(plot, id, { titleColor: event.target.value })} /></label></div></InspectorSection>;
}

function ExportInspector({ plot, onOpen, stale }: { plot: ReturnType<typeof useScientificPlot>; onOpen: () => void; stale: boolean }) {
  return <><InspectorSection title="当前语言导出"><p className={styles.muted}>图片和脚本均由 {RENDERER_LABELS[plot.spec.renderer.language]} 生成；不支持的格式不会切换语言代画。</p>{plot.spec.exports.map((item) => <article className={styles.exportRow} key={item.id}><div><b>{item.name}</b><small>{item.format.toUpperCase()} {item.dpi ? `· ${item.dpi} DPI` : ''}</small></div><span>{item.format}</span></article>)}<button type="button" className={styles.primaryWideButton} onClick={onOpen} disabled={!plot.rawData || stale}>打开导出中心</button>{stale ? <p className={styles.errorText}>当前预览已过期，重新渲染成功后才能导出。</p> : null}</InspectorSection></>;
}

function ImportDialog({ plot, workbook, selection, onClose }: { plot: ReturnType<typeof useScientificPlot>; workbook: ResearchWorkbook; selection?: ResearchSheetPlotRange | null; onClose: () => void }) {
  const [source, setSource] = useState<ImportSource>('file'); const [file, setFile] = useState<Awaited<ReturnType<typeof plot.selectDataFile>>>(null); const [sheet, setSheet] = useState(''); const [paste, setPaste] = useState(''); const [useSelection, setUseSelection] = useState(Boolean(selection)); const [headerMode, setHeaderMode] = useState<HeaderMode>('auto'); const [headerRow, setHeaderRow] = useState(1); const [encoding, setEncoding] = useState('utf8');
  async function selectFile() { const selected = await plot.selectDataFile(); setFile(selected); setSheet(selected?.sheets[0] ?? ''); }
  async function confirm() { if (source === 'file' && file) await plot.readDataFile({ filePath: file.filePath, sheetName: sheet || undefined, headerRow: headerMode === 'none' ? 0 : headerMode === 'row' ? headerRow : undefined, encoding }); else if (source === 'researchSheet') await plot.importResearchSheet(workbook, useSelection ? selection ?? undefined : undefined); else if (source === 'paste' && paste.trim()) await plot.importPaste(paste); onClose(); }
  return <Dialog title="导入科研数据" subtitle="选择来源 → 确认表头 → 创建本地只读快照" onClose={onClose} footer={<><button type="button" onClick={onClose}>取消</button><button type="button" className={styles.primaryButton} onClick={() => void confirm()} disabled={plot.busy || (source === 'file' && !file) || (source === 'paste' && !paste.trim())}>导入并创建数据快照</button></>}><div className={styles.sourceTabs}>{(['file', 'researchSheet', 'paste'] as ImportSource[]).map((id) => <button type="button" key={id} className={source === id ? styles.activeSource : ''} onClick={() => setSource(id)}><b>{id === 'file' ? '本地文件' : id === 'researchSheet' ? '当前科研表格' : '粘贴表格'}</b><span>{id === 'file' ? 'CSV / TSV / Excel' : id === 'researchSheet' ? '整个表格或最后选区' : 'Excel / Origin 剪贴板'}</span></button>)}</div>{source === 'file' ? <div className={styles.dialogGrid}><div className={styles.dropZone}><b>{file?.fileName ?? '选择 CSV、TSV 或 XLSX 文件'}</b><span>文件只在本机解析，不上传。没有列名的数据请选择“无表头”。</span><button type="button" onClick={() => void selectFile()}>浏览文件</button></div><div className={styles.importSettings}><label>工作表<select value={sheet} onChange={(event) => setSheet(event.target.value)} disabled={!file?.sheets.length}><option value="">{file?.sheets.length ? '选择工作表' : '不适用'}</option>{file?.sheets.map((item) => <option key={item}>{item}</option>)}</select></label><label>表头模式<select value={headerMode} onChange={(event) => setHeaderMode(event.target.value as HeaderMode)}><option value="auto">自动判断</option><option value="row">指定表头行</option><option value="none">无表头（保留第一行数据）</option></select></label>{headerMode === 'row' ? <label>表头行<input type="number" min="1" max="10000" value={headerRow} onChange={(event) => setHeaderRow(Math.max(1, Number(event.target.value) || 1))} /></label> : <p className={styles.muted}>{headerMode === 'auto' ? '数值型首行会自动作为数据，并生成“列 A / 列 B”字段名。' : '全部非空行都作为数据导入。'}</p>}<label>编码<select value={encoding} onChange={(event) => setEncoding(event.target.value)}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="latin1">Latin-1</option></select></label></div></div> : source === 'researchSheet' ? <div className={styles.researchSource}><b>{workbook.sheetName}</b><span>{workbook.rows.length - 1} 行 × {workbook.columns.length} 列</span><label className={styles.checkRow}><input type="radio" name="sheet-range" checked={!useSelection} onChange={() => setUseSelection(false)} />整个工作表</label><label className={styles.checkRow}><input type="radio" name="sheet-range" checked={useSelection} disabled={!selection} onChange={() => setUseSelection(true)} />最后选区 {selection?.a1Notation ?? '（尚无选区）'}</label></div> : <textarea className={styles.pasteArea} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={'algorithm\tsteps\tsuccess_rate\nPPO\t50000\t0.43'} />}</Dialog>;
}

function RuntimeDialog({ plot, onClose }: { plot: ReturnType<typeof useScientificPlot>; onClose: () => void }) {
  const [installJob, setInstallJob] = useState<PlotRuntimeInstallJob | null>(null);
  const [targetRoot, setTargetRoot] = useState('');
  useEffect(() => {
    if (!installJob || ['succeeded', 'failed', 'cancelled'].includes(installJob.status)) return;
    const timer = window.setInterval(() => void window.electronAPI.getScientificPlotRuntimeInstallJob(installJob.id).then((job) => {
      if (!job) return;
      setInstallJob(job);
      if (job.status === 'succeeded') void plot.refreshRuntimes();
    }), 800);
    return () => window.clearInterval(timer);
  }, [installJob, plot.refreshRuntimes]);
  async function chooseTargetRoot() { const selected = await window.electronAPI.selectDirectory({ title: '选择 Python / R 私有环境父目录', defaultPath: targetRoot || undefined }); if (selected) setTargetRoot(selected.directoryPath); }
  async function install(language: 'python' | 'r') { setInstallJob(await plot.startRuntimeInstall(language, targetRoot || undefined)); }
  async function repair(language: 'python' | 'r') { setInstallJob(await plot.repairRuntime(language)); }
  return <Dialog title="绘图运行环境管理" subtitle="优先使用系统已有环境；仅在完全缺失时安装 FTranslate 私有环境" onClose={onClose} footer={<><button type="button" onClick={onClose}>关闭</button><button type="button" className={styles.primaryButton} onClick={() => void plot.refreshRuntimes()}>重新检测</button></>}><div className={styles.runtimeTarget}><div><b>私有环境备用位置</b><span>{targetRoot || '默认：FTranslate 用户数据目录'}</span></div><button type="button" onClick={() => void chooseTargetRoot()}>选择目录</button>{targetRoot ? <button type="button" onClick={() => setTargetRoot('')}>恢复默认</button> : null}</div><div className={styles.runtimeList}>{(['javascript', 'python', 'r', 'matlab'] as PlotRendererLanguage[]).map((language) => { const item = plot.runtimes.find((runtime) => runtime.language === language); const source = language === 'javascript' ? '应用内置' : item?.managed ? 'FTranslate 私有环境' : item?.status === 'ready' || item?.status === 'degraded' ? '系统环境' : ''; const detecting = !item && plot.busy; return <article key={language}><span className={styles.runtimeIcon}>{language === 'javascript' ? 'JS' : language === 'python' ? 'Py' : language === 'r' ? 'R' : 'M'}</span><div><b>{RENDERER_LABELS[language]}</b><p>{item?.message ?? (language === 'javascript' ? '应用内置' : detecting ? '正在检测系统环境、注册表和常见安装目录…' : '尚未检测')}</p><small>{source}{item?.version ? ` · ${item.version}` : ''}{item?.executable ? ` · ${item.executable}` : ''}</small></div><div><strong>{item?.status ?? (language === 'javascript' ? 'ready' : detecting ? 'checking' : 'unknown')}</strong>{(language === 'python' || language === 'r') && item?.status === 'degraded' ? <button type="button" onClick={() => void repair(language)}>修复现有环境</button> : null}{(language === 'python' || language === 'r') && item?.status === 'missing' ? <button type="button" onClick={() => void install(language)}>安装私有环境</button> : null}{language === 'matlab' ? <span>{item?.status === 'ready' ? '可在顶部“绘图语言”中选择' : detecting ? '正在检测已有安装' : '仅检测，不安装'}</span> : null}</div></article>; })}</div>{installJob ? <div className={styles.installProgress}><div><b>{installJob.message}</b><span>{installJob.progress}%</span></div><progress max="100" value={installJob.progress} />{!['succeeded', 'failed', 'cancelled'].includes(installJob.status) ? <button type="button" onClick={() => void plot.cancelRuntimeInstall(installJob.id)}>取消</button> : null}</div> : null}</Dialog>;
}

function ExportDialog({ plot, stale, onExportEcharts, onClose }: { plot: ReturnType<typeof useScientificPlot>; stale: boolean; onExportEcharts: (format: 'png' | 'svg') => Promise<void>; onClose: () => void }) {
  const [raw, setRaw] = useState(false); const [derived, setDerived] = useState(false); const artifacts = plot.renderJob?.artifacts.filter((item) => item.kind === 'preview' || item.kind === 'export' || item.kind === 'script') ?? [];
  const isGlChart = plot.spec.chart.type === 'scatter3d' || plot.spec.chart.type === 'surface3d';
  return <Dialog title="导出科研绘图" subtitle={`当前渲染器：${RENDERER_LABELS[plot.spec.renderer.language]}`} onClose={onClose} footer={<><button type="button" onClick={onClose}>关闭</button><button type="button" className={styles.primaryButton} onClick={() => void plot.exportPackage(raw, derived)} disabled={stale}>导出 .fplot 可复现包</button></>}><div className={styles.exportDialogGrid}><section><h3>图片与源代码</h3>{plot.spec.renderer.language === 'javascript' ? <><button type="button" className={styles.artifactButton} disabled={stale || !plot.echarts} onClick={() => void onExportEcharts('png')}><span>图片 · 3× 像素密度</span><b>PNG</b></button><button type="button" className={styles.artifactButton} disabled={stale || !plot.echarts || isGlChart} onClick={() => void onExportEcharts('svg')}><span>{isGlChart ? '3D WebGL 不支持矢量导出' : '可编辑矢量图'}</span><b>SVG</b></button><p className={styles.muted}>ECharts 当前只直接导出 PNG / SVG；PDF / TIFF 不会偷偷切换到其他语言生成。</p></> : artifacts.length ? artifacts.map((artifact) => <button type="button" className={styles.artifactButton} key={artifact.filePath} disabled={stale} onClick={() => void window.electronAPI.exportScientificPlotArtifact({ filePath: artifact.filePath, defaultFileName: artifact.filePath.split(/[\\/]/).at(-1) ?? 'plot' })}><span>{artifact.kind}</span><b>{artifact.format.toUpperCase()}</b></button>) : <p className={styles.muted}>先成功渲染一次以生成图片和源代码。</p>}</section><section><h3>可复现包隐私</h3><label className={styles.checkRow}><input type="checkbox" checked={raw} onChange={(event) => setRaw(event.target.checked)} />包含原始数据快照</label><label className={styles.checkRow}><input type="checkbox" checked={derived} onChange={(event) => setDerived(event.target.checked)} />包含处理后绘图数据</label><p className={styles.muted}>默认不包含数据；包内始终保存 PlotSpec、转换、统计、主题、依赖清单和生成脚本。</p></section></div></Dialog>;
}

function ScriptDialog({ plot, onClose }: { plot: ReturnType<typeof useScientificPlot>; onClose: () => void }) {
  const [content, setContent] = useState('');
  useEffect(() => { const artifact = plot.renderJob?.artifacts.find((item) => item.kind === 'script'); if (artifact) void window.electronAPI.readScientificPlotArtifact(artifact.filePath).then((payload) => setContent(payload.text ?? '')); else if (plot.echarts) setContent(JSON.stringify(plot.echarts.option, null, 2)); }, [plot.echarts, plot.renderJob]);
  return <Dialog title="生成脚本" subtitle="只读查看；可复制或导出后在外部工具修改，应用内不执行任意编辑脚本" onClose={onClose} footer={<button type="button" onClick={onClose}>关闭</button>}><pre className={styles.scriptView}>{content || '当前语言尚未成功生成脚本。'}</pre></Dialog>;
}

function TransformDialog({ plot, onClose }: { plot: ReturnType<typeof useScientificPlot>; onClose: () => void }) {
  const fields = plot.rawData?.columns ?? []; const [type, setType] = useState<'filter' | 'groupAggregate' | 'wideToLong' | 'derive'>('filter'); const [field, setField] = useState(fields[0]?.id ?? ''); const [valueField, setValueField] = useState(fields.find((item) => item.type === 'number' || item.type === 'integer')?.id ?? ''); const [value, setValue] = useState('');
  function add() { const id=`transform-${crypto.randomUUID()}`; const params = type === 'filter' ? { field, operator: 'equals', value } : type === 'groupAggregate' ? { groupBy: [field], valueField, operation: 'mean', outputField: `mean_${valueField}` } : type === 'wideToLong' ? { idFields: [field], valueFields: fields.filter((item) => item.id !== field && (item.type === 'number' || item.type === 'integer')).map((item) => item.id), variableField: 'variable', valueField: 'value' } : { outputField: `${field}_scaled`, operation: 'multiply', field, value: Number(value) || 1 }; plot.updateSpec((current) => ({ ...current, transforms: [...current.transforms, { id, type, enabled: true, label: type === 'filter' ? `筛选 ${field}` : type === 'groupAggregate' ? '分组均值' : type === 'wideToLong' ? '宽表转长表' : '派生字段', params }] })); onClose(); }
  return <Dialog title="添加数据转换" subtitle="转换按顺序执行，原始数据快照不会被覆盖" onClose={onClose} footer={<><button type="button" onClick={onClose}>取消</button><button type="button" className={styles.primaryButton} onClick={add}>添加步骤</button></>}><div className={styles.transformForm}><label>转换类型<select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="filter">筛选行</option><option value="groupAggregate">分组聚合</option><option value="wideToLong">宽表转长表</option><option value="derive">派生字段/单位换算</option></select></label><label>主字段<select value={field} onChange={(event) => setField(event.target.value)}>{fields.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{type === 'groupAggregate' ? <label>数值字段<select value={valueField} onChange={(event) => setValueField(event.target.value)}>{fields.filter((item) => item.type === 'number' || item.type === 'integer').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}{type === 'filter' || type === 'derive' ? <label>{type === 'filter' ? '等于' : '乘数'}<input value={value} onChange={(event) => setValue(event.target.value)} /></label> : null}</div></Dialog>;
}

function Dialog({ title, subtitle, onClose, footer, children }: { title: string; subtitle: string; onClose: () => void; footer: ReactNode; children: ReactNode }) { return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></header><div className={styles.dialogBody}>{children}</div><footer>{footer}</footer></section></div>; }
function InspectorSection({ title, children }: { title: string; children: ReactNode }) { return <section className={styles.inspectorSection}><h3>{title}</h3>{children}</section>; }
function MappingSelect({ label, value, fields, optional, onChange }: { label: string; value?: string; fields: Array<{ id: string; label: string }>; optional?: boolean; onChange: (value: string) => void }) { return <label className={styles.mappingRow}><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">{optional ? '未设置' : '选择字段'}</option>{fields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label>; }

function EChartsCanvas({ option, requiresGl, onReady }: { option: EChartsCoreOption; requiresGl: boolean; onReady: (chart: EChartsType) => void }) { const ref=useRef<HTMLDivElement|null>(null); const onReadyRef=useRef(onReady); useEffect(()=>{onReadyRef.current=onReady;},[onReady]); useEffect(() => { let chart: EChartsType | null=null; let cancelled=false; const mount=async()=>{if(requiresGl)await import('echarts-gl');if(cancelled||!ref.current)return;chart=echarts.init(ref.current,undefined,{renderer:'canvas'});chart.setOption(option,true);onReadyRef.current(chart);};void mount();const resize=()=>chart?.resize();window.addEventListener('resize',resize);return()=>{cancelled=true;window.removeEventListener('resize',resize);chart?.dispose();}; },[option,requiresGl]); return <div ref={ref} className={styles.echartsCanvas} data-plot-canvas />; }
function ExternalPreview({ payload }: { payload: PlotArtifactPayload }) { const [url,setUrl]=useState(''); useEffect(()=>{ if(payload.mimeType==='text/html')return; const blob=payload.base64 ? new Blob([Uint8Array.from(atob(payload.base64),c=>c.charCodeAt(0))],{type:payload.mimeType}) : new Blob([payload.text??''],{type:payload.mimeType}); const next=URL.createObjectURL(blob); setUrl(next); return()=>URL.revokeObjectURL(next); },[payload]); return payload.mimeType==='text/html' ? <iframe className={styles.externalFrame} srcDoc={payload.text??''} sandbox="allow-scripts" title="外部语言绘图预览" /> : <img className={styles.externalImage} src={url} alt="外部语言生成的科研图" />; }

function updateAxis(plot: ReturnType<typeof useScientificPlot>, id: 'x' | 'y', patch: Partial<ScientificPlotSpec['axes'][number]>) { plot.updateSpec((current) => { const existing = current.axes.find((axis) => axis.id === id) ?? { id, scale: 'auto' as const }; return { ...current, axes: [...current.axes.filter((axis) => axis.id !== id), { ...existing, ...patch, id }] }; }); }
function optionalNumber(value: string): number | undefined { if (!value.trim()) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function updateThemeNumber(plot: ReturnType<typeof useScientificPlot>, key: 'widthMm' | 'heightMm' | 'baseFontSize' | 'titleFontSize' | 'lineWidth' | 'markerSize', value: string) { const parsed = Number(value); if (!Number.isFinite(parsed)) return; plot.updateSpec((current) => key === 'widthMm' || key === 'heightMm' ? { ...current, theme: { ...current.theme, canvas: { ...current.theme.canvas, [key]: parsed } } } : { ...current, theme: { ...current.theme, [key]: parsed } }); }
function setChartType(spec: ScientificPlotSpec, update: ReturnType<typeof useScientificPlot>['updateSpec'], type: ScientificChartType) { const capability=getRendererCapability(spec.renderer.language,type); if(!capability.supported)return; update((current)=>({...current,chart:{...current.chart,type}})); }
function setEncoding(plot: ReturnType<typeof useScientificPlot>, key: keyof ScientificPlotSpec['encodings'], value: string) { plot.updateSpec((current)=>({...current,encodings:{...current.encodings,[key]:value||undefined}})); }
function addCastTransform(spec: ScientificPlotSpec, update: ReturnType<typeof useScientificPlot>['updateSpec'], field: string, type: PlotColumnType) { const id=`cast-${field}`; update((current)=>({...current,transforms:[...current.transforms.filter((item)=>item.id!==id),{id,type:'cast',enabled:true,label:`设置 ${field} 类型`,params:{field,targetType:type}}]})); }
function defaultAnalysis(spec: ScientificPlotSpec): AnalysisSpec { return { id:`analysis-${crypto.randomUUID()}`,type:'descriptive',enabled:true,valueField:spec.encodings.y??'',groupField:spec.encodings.color,groups:[],tail:'two-sided',alpha:.05,confidenceLevel:.95,correction:'none',effectSize:'none' }; }
function updateAnalysis(plot: ReturnType<typeof useScientificPlot>, patch: Partial<AnalysisSpec>) { plot.updateSpec((current)=>({...current,analysis:current.analysis.map((item,index)=>index===0?{...item,...patch}:item)})); }
function sanitizePlotFileName(value: string): string { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'scientific-plot'; }
