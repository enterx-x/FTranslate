import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultScientificPlotSpec,
  type PlotArtifactPayload,
  type PlotDataTable,
  type PlotRenderJob,
  type PlotRuntimeCapability,
  type PlotRuntimeInstallJob,
  type ScientificPlotSpec
} from '../../shared/scientificPlot';
import {
  applyPlotTransforms,
  auditPlotData,
  parsePastedPlotData,
  plotDataFromResearchWorkbook,
  type PlotDataHealth,
  type PlotTransformRecord,
  type ResearchSheetPlotRange
} from '../lib/plotData';
import { compileScientificEchartsOption, type EchartsCompilation } from '../lib/plotEcharts';
import { runPlotAnalyses, type TraceableAnalysisResult } from '../lib/plotStatistics';
import type { ResearchWorkbook } from '../lib/researchWorkbook';

export interface ScientificPlotController {
  spec: ScientificPlotSpec;
  rawData: PlotDataTable | null;
  plotData: PlotDataTable | null;
  health: PlotDataHealth | null;
  transformRecords: PlotTransformRecord[];
  analyses: TraceableAnalysisResult[];
  runtimes: PlotRuntimeCapability[];
  renderJob: PlotRenderJob | null;
  externalPreview: PlotArtifactPayload | null;
  echarts: EchartsCompilation | null;
  projectCreated: boolean;
  busy: boolean;
  message: string;
  error: string;
  updateSpec: (updater: (current: ScientificPlotSpec) => ScientificPlotSpec) => void;
  importTable: (table: PlotDataTable) => Promise<void>;
  importPaste: (text: string) => Promise<void>;
  importResearchSheet: (workbook: ResearchWorkbook, range?: ResearchSheetPlotRange) => Promise<void>;
  selectDataFile: () => Promise<Awaited<ReturnType<typeof window.electronAPI.selectScientificPlotDataFile>>>;
  readDataFile: (request: Parameters<typeof window.electronAPI.readScientificPlotDataFile>[0]) => Promise<void>;
  refreshRuntimes: () => Promise<void>;
  startRuntimeInstall: (language: 'python' | 'r', targetRoot?: string) => Promise<PlotRuntimeInstallJob>;
  cancelRuntimeInstall: (jobId: string) => Promise<boolean>;
  render: (force?: boolean) => Promise<void>;
  cancelRender: () => Promise<void>;
  runAnalyses: () => Promise<void>;
  exportPackage: (includeRawData: boolean, includeDerivedData: boolean) => Promise<void>;
  importPackage: () => Promise<void>;
}

export function useScientificPlot(): ScientificPlotController {
  const [spec, setSpec] = useState(() => createDefaultScientificPlotSpec(createPlotId()));
  const [rawData, setRawData] = useState<PlotDataTable | null>(null);
  const [projectCreated, setProjectCreated] = useState(false);
  const [analyses, setAnalyses] = useState<TraceableAnalysisResult[]>([]);
  const [runtimes, setRuntimes] = useState<PlotRuntimeCapability[]>([]);
  const [renderJob, setRenderJob] = useState<PlotRenderJob | null>(null);
  const [externalPreview, setExternalPreview] = useState<PlotArtifactPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('先导入一份实验数据。');
  const [error, setError] = useState('');
  const saveTimer = useRef<number | null>(null);

  const transformResult = useMemo(
    () => rawData ? applyPlotTransforms(rawData, spec.transforms) : null,
    [rawData, spec.transforms]
  );
  const plotData = transformResult?.table ?? rawData;
  const health = useMemo(() => rawData ? auditPlotData(rawData) : null, [rawData]);
  const echarts = useMemo(() => {
    if (!plotData || spec.renderer.language !== 'javascript') return null;
    try { return compileScientificEchartsOption(spec, plotData, analyses); }
    catch { return null; }
  }, [analyses, plotData, spec]);

  useEffect(() => {
    if (!projectCreated) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void window.electronAPI.saveScientificPlotSpec(spec).catch((reason) => {
        setError(`自动保存失败：${String(reason)}`);
      });
    }, 600);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [projectCreated, spec]);

  useEffect(() => {
    if (!renderJob || !['queued', 'running'].includes(renderJob.status)) return;
    const timer = window.setInterval(() => {
      void window.electronAPI.getScientificPlotRenderJob(renderJob.id).then(async (next) => {
        if (!next) return;
        setRenderJob(next);
        setMessage(next.message);
        if (['succeeded', 'failed', 'timed-out', 'cancelled'].includes(next.status)) {
          const preview = next.artifacts.find((artifact) => artifact.kind === 'preview');
          if (preview) setExternalPreview(await window.electronAPI.readScientificPlotArtifact(preview.filePath));
          if (next.status !== 'succeeded') setError(next.message);
        }
      }).catch((reason) => setError(`读取渲染状态失败：${String(reason)}`));
    }, 600);
    return () => window.clearInterval(timer);
  }, [renderJob]);

  const updateSpec = useCallback((updater: (current: ScientificPlotSpec) => ScientificPlotSpec) => {
    setSpec((current) => updater(cloneSpec(current)));
    setExternalPreview(null);
  }, []);

  const importTable = useCallback(async (table: PlotDataTable) => {
    setBusy(true); setError('');
    try {
      const next = createSpecForData(spec, table);
      await window.electronAPI.createScientificPlotProject({ spec: next, data: table });
      setSpec(next);
      setRawData(table);
      setProjectCreated(true);
      setAnalyses([]);
      setExternalPreview(null);
      setRenderJob(null);
      setMessage(`已导入 ${table.rows.length} 行 × ${table.columns.length} 列，并创建只读原始快照。`);
    } catch (reason) {
      setError(`导入数据失败：${String(reason)}`);
    } finally { setBusy(false); }
  }, [spec]);

  const importPaste = useCallback(async (text: string) => {
    const table = parsePastedPlotData(text, { id: `data-${createPlotId()}` });
    await importTable(table);
  }, [importTable]);

  const importResearchSheet = useCallback(async (workbook: ResearchWorkbook, range?: ResearchSheetPlotRange) => {
    const table = plotDataFromResearchWorkbook(workbook, range, { id: `data-${createPlotId()}` });
    await importTable(table);
  }, [importTable]);

  const selectDataFile = useCallback(async () => window.electronAPI.selectScientificPlotDataFile(), []);
  const readDataFile = useCallback(async (request: Parameters<typeof window.electronAPI.readScientificPlotDataFile>[0]) => {
    setBusy(true); setError('');
    try { await importTable(await window.electronAPI.readScientificPlotDataFile(request)); }
    catch (reason) { setError(`读取数据文件失败：${String(reason)}`); }
    finally { setBusy(false); }
  }, [importTable]);

  const refreshRuntimes = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const next = await window.electronAPI.detectScientificPlotRuntimes();
      setRuntimes(next);
      setMessage('绘图运行环境检测完成。');
    } catch (reason) { setError(`运行环境检测失败：${String(reason)}`); }
    finally { setBusy(false); }
  }, []);

  const startRuntimeInstall = useCallback(async (language: 'python' | 'r', targetRoot?: string) => {
    const job = await window.electronAPI.startScientificPlotRuntimeInstall({ language, targetRoot });
    setMessage(job.message);
    return job;
  }, []);

  const cancelRuntimeInstall = useCallback(async (jobId: string) =>
    window.electronAPI.cancelScientificPlotRuntimeInstall(jobId), []);

  const runAnalyses = useCallback(async () => {
    if (!plotData || spec.analysis.length === 0) { setAnalyses([]); return; }
    setBusy(true); setError('');
    try {
      const results = await runPlotAnalyses(plotData, spec.analysis);
      setAnalyses(results);
      const invalid = results.filter((result) => result.status === 'invalid').length;
      setMessage(invalid ? `${results.length} 项统计完成，${invalid} 项设计无效。` : `${results.length} 项统计分析完成。`);
    } catch (reason) { setError(`统计分析失败：${String(reason)}`); }
    finally { setBusy(false); }
  }, [plotData, spec.analysis]);

  const render = useCallback(async (force = false) => {
    if (!plotData) { setError('请先导入数据。'); return; }
    setError('');
    if (spec.analysis.length) await runAnalyses();
    if (spec.renderer.language === 'javascript') {
      try {
        compileScientificEchartsOption(spec, plotData, analyses);
        setMessage('ECharts 已根据当前配置真实生成预览。');
      } catch (reason) { setError(`ECharts 渲染配置无效：${String(reason)}`); }
      return;
    }
    setBusy(true);
    try {
      const job = await window.electronAPI.submitScientificPlotRender({ projectId: spec.id, spec, data: plotData, force });
      setRenderJob(job);
      setMessage(job.message);
    } catch (reason) { setError(`提交渲染失败：${String(reason)}`); }
    finally { setBusy(false); }
  }, [analyses, plotData, runAnalyses, spec]);

  const cancelRender = useCallback(async () => {
    if (!renderJob) return;
    await window.electronAPI.cancelScientificPlotRender(renderJob.id);
    setRenderJob((current) => current ? { ...current, status: 'cancelled', message: '渲染已取消。' } : current);
  }, [renderJob]);

  const exportPackage = useCallback(async (includeRawData: boolean, includeDerivedData: boolean) => {
    if (!projectCreated) { setError('当前绘图项目尚未保存。'); return; }
    const result = await window.electronAPI.exportScientificPlotPackage({ projectId: spec.id, includeRawData, includeDerivedData });
    if (result) setMessage(`已导出：${result.fileName}`);
  }, [projectCreated, spec.id]);

  const importPackage = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const imported = await window.electronAPI.importScientificPlotPackage();
      if (!imported) return;
      const loaded = await window.electronAPI.loadScientificPlotProject(imported.projectId);
      setSpec(loaded.spec); setRawData(loaded.data ?? null); setProjectCreated(true); setAnalyses([]); setExternalPreview(null);
      setMessage(`已导入可复现绘图项目：${loaded.manifest.title}`);
    } catch (reason) { setError(`导入 .fplot 失败：${String(reason)}`); }
    finally { setBusy(false); }
  }, []);

  return {
    spec, rawData, plotData, health, transformRecords: transformResult?.records ?? [], analyses,
    runtimes, renderJob, externalPreview, echarts, projectCreated, busy, message, error,
    updateSpec, importTable, importPaste, importResearchSheet, selectDataFile, readDataFile,
    refreshRuntimes, startRuntimeInstall, cancelRuntimeInstall, render, cancelRender,
    runAnalyses, exportPackage, importPackage
  };
}

function createSpecForData(current: ScientificPlotSpec, table: PlotDataTable): ScientificPlotSpec {
  const next = cloneSpec(current);
  next.id = createPlotId();
  next.title = table.source.name.replace(/\.[^.]+$/, '') || '未命名科研图';
  next.chart.title = next.title;
  next.dataSource = { ...table.source };
  next.snapshotId = table.id;
  next.transforms = [];
  next.analysis = [];
  next.provenance = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const numeric = table.columns.filter((column) => column.type === 'number' || column.type === 'integer');
  const category = table.columns.find((column) => column.type === 'category' || column.type === 'string');
  const errorLower = table.columns.find((column) => /^(ci[_ -]?low|lower|lower[_ -]?ci|error[_ -]?low)$/i.test(column.id));
  const errorUpper = table.columns.find((column) => /^(ci[_ -]?high|upper|upper[_ -]?ci|error[_ -]?high)$/i.test(column.id));
  if (numeric.length >= 2) next.encodings = { x: numeric[0].id, y: numeric[1].id, color: category?.id, errorLower: errorLower?.id, errorUpper: errorUpper?.id };
  else if (numeric.length === 1) next.encodings = { x: category?.id, y: numeric[0].id, color: category?.id };
  else next.encodings = { x: table.columns[0]?.id, y: table.columns[1]?.id };
  return next;
}

function cloneSpec(spec: ScientificPlotSpec): ScientificPlotSpec {
  return structuredClone(spec);
}

function createPlotId(): string {
  return `plot-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
