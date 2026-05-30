import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BooleanNumber,
  createUniver,
  defaultTheme,
  LocaleType,
  mergeLocales,
  type ICellData,
  type IStyleData,
  type IWorkbookData
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import conditionalFormattingZhCN from '@univerjs/preset-sheets-conditional-formatting/locales/zh-CN';
import dataValidationZhCN from '@univerjs/preset-sheets-data-validation/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import brandMark from '../assets/brand-mark.png';
import uploadIcon from '../assets/icons/duotone/upload.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import homeIcon from '../assets/icons/duotone/home.svg';
import aiFillIcon from '../assets/icons/duotone/ai-fill.svg';
import analysisIcon from '../assets/icons/duotone/analysis.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import saveIcon from '../assets/icons/duotone/save.svg';
import refreshIcon from '../assets/icons/duotone/refresh.svg';
import { MathText } from './MathText';
import { MarkdownDocument } from './MarkdownDocument';
import {
  RESEARCH_SHEET_LINKS_KEY,
  RESEARCH_WORKBOOK_KEY,
  appendResearchWorkbookSheets,
  fromUniverWorkbookData,
  getResearchCellUniverStyle,
  getResearchCellText,
  getResearchColumnHeader,
  getResearchRowValues,
  isResearchCellStyleEnabled,
  parseResearchWorkbook,
  serializeResearchWorkbook,
  setResearchCellStyle,
  setResearchCellText,
  toUniverWorkbookData,
  type ResearchSheetLink,
  type ResearchWorkbook
} from '../lib/researchWorkbook';
import type { PaperRecord } from '../lib/papers';
import {
  LITERATURE_INSIGHT_STATE_KEY,
  LITERATURE_INSIGHT_HISTORY_KEY,
  appendLiteratureInsightHistory,
  completeLiteratureInsightRun,
  createLiteratureInsightRunState,
  describeLiteratureInsightAction,
  failLiteratureInsightRun,
  normalizeLiteratureInsightHistory,
  normalizeLiteratureInsightRunState,
  updateLiteratureInsightRunProgress,
  type LiteratureInsightHistoryEntry,
  type LiteratureInsightRunState,
  type LiteratureGapPaperInput
} from '../lib/literatureInsight';

export interface FillResearchCellTarget {
  rowIndex: number;
  columnIndex: number;
  cellAddress: string;
  columnHeader: string;
  currentCellText: string;
  neighborRowValues: Record<string, string>;
}

export interface FillResearchCellsRequest {
  paper: PaperRecord;
  cells: FillResearchCellTarget[];
}

export interface FillResearchCellResult {
  cellAddress: string;
  value: string;
}

export interface AnalyzeLiteratureGapRequest {
  papers: LiteratureGapPaperInput[];
  customPrompt?: string;
}

export interface AnalyzeLiteratureGapResult {
  text: string;
  provider: string;
  model: string;
  webSearchUsed?: boolean;
}

interface ResearchSheetPageProps {
  papers: PaperRecord[];
  workbook: ResearchWorkbook;
  links: ResearchSheetLink[];
  focusPaperId?: string | null;
  isAiBusy: boolean;
  onBackHome: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onWorkbookChange: (workbook: ResearchWorkbook) => void;
  onLinksChange: (links: ResearchSheetLink[]) => void;
  onFillCellsWithAi: (request: FillResearchCellsRequest) => Promise<FillResearchCellResult[]>;
  onAnalyzeLiteratureGap: (request: AnalyzeLiteratureGapRequest) => Promise<AnalyzeLiteratureGapResult>;
  onOpenAiAssistant: () => void;
  onOpenKnowledgeGraph: () => void;
}

interface SelectedCell {
  rowIndex: number;
  columnIndex: number;
}

interface SelectedRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

interface ResearchSheetActions {
  fillSelectedCells: () => void;
  toggleBindSelectedRow: () => void;
  openLinkedPaper: () => void;
  copyFormat: () => void;
  pasteFormat: () => void;
}

type UniverInstance = ReturnType<typeof createUniver>;
type UniverWorkbook = ReturnType<UniverInstance['univerAPI']['getActiveWorkbook']>;
type UniverRange = {
  getRange?: () => unknown;
  getA1Notation?: () => string;
  setFontSize?: (size: number | null) => unknown;
  setFontWeight?: (weight: 'bold' | 'normal' | null) => unknown;
  setFontStyle?: (style: 'italic' | 'normal' | null) => unknown;
  setFontColor?: (color: string | null) => unknown;
  setBackground?: (color: string) => unknown;
  setHorizontalAlignment?: (alignment: 'left' | 'center' | 'right' | 'normal') => unknown;
  setVerticalAlignment?: (alignment: 'top' | 'middle' | 'bottom') => unknown;
  setWrap?: (enabled: boolean) => unknown;
  setValue?: (value: ICellData | string) => unknown;
  getCellStyleData?: (type?: 'row' | 'col' | 'cell') => IStyleData | null;
  getValue?: () => unknown;
};

const DEFAULT_SELECTED_CELL: SelectedCell = {
  rowIndex: 1,
  columnIndex: 3
};

const DEFAULT_SELECTED_RANGE: SelectedRange = {
  startRow: 1,
  endRow: 1,
  startColumn: 3,
  endColumn: 3
};
const RESEARCH_UNIVER_CONTAINER_ID = 'ftranslate-research-univer-container';

export function ResearchSheetPage(props: ResearchSheetPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<UniverInstance | null>(null);
  const workbookHandleRef = useRef<NonNullable<UniverWorkbook> | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const workbookModelRef = useRef(props.workbook);
  const copiedFormatRef = useRef<IStyleData | null>(null);
  const latestActionsRef = useRef<ResearchSheetActions>({
    fillSelectedCells: () => undefined,
    toggleBindSelectedRow: () => undefined,
    openLinkedPaper: () => undefined,
    copyFormat: () => undefined,
    pasteFormat: () => undefined
  });
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(DEFAULT_SELECTED_CELL);
  const [selectedRanges, setSelectedRanges] = useState<SelectedRange[]>([DEFAULT_SELECTED_RANGE]);
  const [bindingPaperId, setBindingPaperId] = useState('');
  const [fontSize, setFontSize] = useState(12);
  const [fontColor, setFontColor] = useState('#111111');
  const [fillColor, setFillColor] = useState('#ffffff');
  const [hasCopiedFormat, setHasCopiedFormat] = useState(false);
  const [localMessage, setLocalMessage] = useState('');
  const [showFormulaHelp, setShowFormulaHelp] = useState(false);
  const [literatureInsight, setLiteratureInsight] = useState('');
  const [literatureInsightProgress, setLiteratureInsightProgress] = useState('');
  const [literatureInsightHistory, setLiteratureInsightHistory] = useState<LiteratureInsightHistoryEntry[]>([]);
  const [selectedInsightHistoryId, setSelectedInsightHistoryId] = useState('');
  const [isLiteratureInsightRunning, setIsLiteratureInsightRunning] = useState(false);
  const [showRowDetail, setShowRowDetail] = useState(false);
  const literatureInsightStateRef = useRef<LiteratureInsightRunState | null>(null);

  const selectedRowId = getRowId(workbookModelRef.current, selectedCell.rowIndex);
  const linkedPaperId = props.links.find((link) => link.rowId === selectedRowId)?.paperId ?? '';
  const linkedPaper = props.papers.find((paper) => paper.id === linkedPaperId) ?? null;
  const selectedCellAddress = toA1(selectedCell.rowIndex, selectedCell.columnIndex);
  const selectedColumnHeader = getResearchColumnHeader(workbookModelRef.current, selectedCell.columnIndex);
  const selectedCellText = getResearchCellText(workbookModelRef.current, selectedCell.rowIndex, selectedCell.columnIndex);
  const selectedRowValues = getResearchRowValues(workbookModelRef.current, selectedCell.rowIndex);
  const selectedCellCount = countSelectedCells(selectedRanges);
  const selectedRangeLabel = formatSelectedRanges(selectedRanges);
  const selectedBindingPaper = props.papers.find((paper) => paper.id === bindingPaperId) ?? null;
  const isBoldActive = isResearchCellStyleEnabled(
    workbookModelRef.current,
    selectedCell.rowIndex,
    selectedCell.columnIndex,
    'bl'
  );
  const isItalicActive = isResearchCellStyleEnabled(
    workbookModelRef.current,
    selectedCell.rowIndex,
    selectedCell.columnIndex,
    'it'
  );
  const bindButtonLabel = linkedPaper
    ? selectedBindingPaper && selectedBindingPaper.id !== linkedPaper.id
      ? '更新绑定'
      : '解除绑定'
    : '绑定';
  const canToggleBinding = selectedCell.rowIndex > 0 && Boolean(linkedPaper || selectedBindingPaper);

  const aiTargetCount = useMemo(() => buildSelectedCellTargets().length, [
    props.links,
    props.papers,
    selectedRanges
  ]);
  const selectedLiteratureCount = useMemo(() => getSelectedLiteraturePapers().length, [
    props.links,
    props.papers,
    props.workbook,
    selectedRanges
  ]);
  const linkedLiteratureCount = useMemo(() => getAllLinkedLiteraturePapers().length, [
    props.links,
    props.papers,
    props.workbook
  ]);
  const literatureInsightAction = useMemo(
    () =>
      describeLiteratureInsightAction({
        selectedPaperCount: selectedLiteratureCount,
        linkedPaperCount: linkedLiteratureCount,
        isRunning: isLiteratureInsightRunning,
        isAiBusy: props.isAiBusy
      }),
    [isLiteratureInsightRunning, linkedLiteratureCount, props.isAiBusy, selectedLiteratureCount]
  );

  const statusText = useMemo(() => {
    if (selectedCell.rowIndex === 0) {
      return '当前选中表头；请选择正文行单元格后使用 AI 填写。';
    }

    if (!linkedPaper) {
      return `当前选区 ${selectedRangeLabel}，当前行未绑定论文；先选择论文绑定到该行。`;
    }

    return `当前选区 ${selectedRangeLabel}（${selectedCellCount} 格），当前行已绑定 ${linkedPaper.chineseTitle || linkedPaper.englishTitle || linkedPaper.pdfName}`;
  }, [linkedPaper, selectedCell.rowIndex, selectedCellCount, selectedRangeLabel]);

  useEffect(() => {
    workbookModelRef.current = props.workbook;
  }, [props.workbook]);

  useEffect(() => {
    const restored = readStoredLiteratureInsightState();
    if (restored) {
      applyLiteratureInsightState(restored);
    }
    const restoredHistory = readStoredLiteratureInsightHistory();
    setLiteratureInsightHistory(restoredHistory);
    setSelectedInsightHistoryId(restoredHistory[0]?.id ?? '');
  }, []);

  useEffect(() => {
    if (univerRef.current) {
      return;
    }

    let disposed = false;
    let frameId = 0;
    let commandDisposable: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let updateSelectionLater: (() => number) | null = null;

    const initializeWhenSized = (attempt = 0): void => {
      const container = containerRef.current;
      if (disposed || univerRef.current) {
        return;
      }
      if (!container) {
        if (attempt < 60) {
          frameId = window.requestAnimationFrame(() => initializeWhenSized(attempt + 1));
        }
        return;
      }

      const rect = container.getBoundingClientRect();
      if ((rect.width < 320 || rect.height < 260) && attempt < 30) {
        frameId = window.requestAnimationFrame(() => initializeWhenSized(attempt + 1));
        return;
      }

      initializeUniver(container);
    };

    const initializeUniver = (container: HTMLDivElement): void => {
      const instance = createUniver({
        theme: defaultTheme,
        locale: LocaleType.ZH_CN,
        locales: {
          [LocaleType.ZH_CN]: mergeLocales(zhCN, conditionalFormattingZhCN, dataValidationZhCN)
        },
        presets: [
          UniverSheetsCorePreset({
            container: RESEARCH_UNIVER_CONTAINER_ID,
            header: false,
            toolbar: true,
            formulaBar: true,
            footer: {
              sheetBar: true,
              statisticBar: true,
              zoomSlider: true
            }
          }),
          UniverSheetsConditionalFormattingPreset(),
          UniverSheetsDataValidationPreset({
            showEditOnDropdown: true,
            showSearchOnDropdown: true
          })
        ]
      });
      const workbookHandle = instance.univerAPI.createWorkbook(toUniverWorkbookData(props.workbook));
      univerRef.current = instance;
      workbookHandleRef.current = workbookHandle;
      registerNativeContextMenus(instance);

      commandDisposable = instance.univerAPI.onCommandExecuted(() => {
        scheduleWorkbookSave();
        updateSelectionFromUniver();
      });

      updateSelectionLater = () => window.setTimeout(updateSelectionFromUniver, 0);
      container.addEventListener('mouseup', updateSelectionLater);
      container.addEventListener('keyup', updateSelectionLater);
      resizeObserver = new ResizeObserver(() => {
        window.dispatchEvent(new Event('resize'));
      });
      resizeObserver.observe(container);
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });

      const focusedPaperId = props.focusPaperId;
      if (focusedPaperId) {
        const targetLink = props.links.find((link) => link.paperId === focusedPaperId);
        const targetRow = targetLink
          ? props.workbook.rows.findIndex((row) => row.id === targetLink.rowId)
          : -1;
        if (targetRow > 0) {
          workbookHandle.getActiveSheet().getRange(targetRow, 0).activate();
          setSelectedCell({ rowIndex: targetRow, columnIndex: 0 });
          setSelectedRanges([{ startRow: targetRow, endRow: targetRow, startColumn: 0, endColumn: 0 }]);
        }
      }
    };

    frameId = window.requestAnimationFrame(() => initializeWhenSized());

    return () => {
      disposed = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      commandDisposable?.dispose();
      resizeObserver?.disconnect();
      if (containerRef.current && updateSelectionLater) {
        containerRef.current.removeEventListener('mouseup', updateSelectionLater);
        containerRef.current.removeEventListener('keyup', updateSelectionLater);
      }
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      workbookHandleRef.current = null;
      univerRef.current?.univer.dispose();
      univerRef.current = null;
    };
    // Univer 必须只初始化一次；外部 workbook 更新由命令回写和打开前定位完成。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFillSelectedCells(): Promise<void> {
    const targets = buildSelectedCellTargets();
    if (targets.length === 0) {
      setLocalMessage('当前选区没有可填充单元格：请避开表头，并先给行绑定论文。');
      return;
    }

    const groups = new Map<string, { paper: PaperRecord; cells: FillResearchCellTarget[] }>();
    targets.forEach((target) => {
      const paper = getLinkedPaperForRow(target.rowIndex);
      if (!paper) {
        return;
      }

      const existing = groups.get(paper.id);
      if (existing) {
        existing.cells.push(target);
      } else {
        groups.set(paper.id, { paper, cells: [target] });
      }
    });

    for (const group of groups.values()) {
      const filled = await props.onFillCellsWithAi(group);
      setCellValues(filled, group.cells);
    }
  }

  function applyLiteratureInsightState(state: LiteratureInsightRunState | null): void {
    literatureInsightStateRef.current = state;
    if (state) {
      localStorage.setItem(LITERATURE_INSIGHT_STATE_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(LITERATURE_INSIGHT_STATE_KEY);
    }

    setIsLiteratureInsightRunning(state?.status === 'running');
    setLiteratureInsight(state?.result ?? '');
    setLiteratureInsightProgress(state && state.status !== 'completed' ? state.progress || state.error || '' : '');
  }

  function persistLiteratureInsightHistory(
    updater: (history: LiteratureInsightHistoryEntry[]) => LiteratureInsightHistoryEntry[]
  ): void {
    const next = updater(readStoredLiteratureInsightHistory());
    localStorage.setItem(LITERATURE_INSIGHT_HISTORY_KEY, JSON.stringify(next, null, 2));
    setLiteratureInsightHistory(next);
    setSelectedInsightHistoryId(next[0]?.id ?? '');
  }

  async function handleAnalyzeSelectedLiterature(): Promise<void> {
    const selectedPapers = getSelectedLiteraturePapers();
    const papers = selectedPapers.length > 0 ? selectedPapers : getAllLinkedLiteraturePapers();
    if (papers.length === 0) {
      setLocalMessage('请先选中有内容的表格行，或至少绑定一篇论文后再做 AI 大观分析。');
      return;
    }

    const startedAt = Date.now();
    let runState = createLiteratureInsightRunState(papers.length, startedAt);
    applyLiteratureInsightState(runState);
    setIsLiteratureInsightRunning(true);
    setLiteratureInsight('');
    setLiteratureInsightProgress(`正在准备 ${papers.length} 篇论文/表格行的上下文...`);
    const timer = window.setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      runState = updateLiteratureInsightRunProgress(
        runState,
        `AI 大观分析运行中 ${elapsedSeconds}s：正在读取 PDF 缓存、表格信息和笔记。`,
        Date.now()
      );
      applyLiteratureInsightState(runState);
      setLiteratureInsightProgress(`AI 大观分析运行中 ${elapsedSeconds}s：正在读取 PDF 缓存、表格信息和笔记。`);
    }, 1000);

    try {
      setLocalMessage(`AI 正在综合分析 ${papers.length} 篇论文/表格行...`);
      const analysis = await props.onAnalyzeLiteratureGap({ papers });
      const text = analysis.text.trim();
      if (text) {
        const completedAt = Date.now();
        runState = completeLiteratureInsightRun(runState, text, completedAt);
        applyLiteratureInsightState(runState);
        setLiteratureInsight(text);
        persistLiteratureInsightHistory((history) =>
          appendLiteratureInsightHistory(history, {
            title: `AI 大观分析 ${papers.length} 篇`,
            paperCount: papers.length,
            provider: analysis.provider,
            model: analysis.model,
            createdAt: completedAt,
            result: text,
            webSearchUsed: analysis.webSearchUsed
          })
        );
        setLocalMessage(`AI 已完成 ${papers.length} 篇论文/表格行的大观分析。`);
        setLiteratureInsightProgress('');
      } else {
        runState = failLiteratureInsightRun(
          runState,
          'AI 大观分析没有返回内容；请检查 API 设置或选择包含论文/表格内容的行。',
          Date.now()
        );
        applyLiteratureInsightState(runState);
        setLiteratureInsightProgress('AI 大观分析没有返回内容；请检查 API 设置或选择包含论文/表格内容的行。');
      }
    } catch (error) {
      runState = failLiteratureInsightRun(runState, `AI 大观分析失败：${String(error)}`, Date.now());
      applyLiteratureInsightState(runState);
      setLiteratureInsightProgress(`AI 大观分析失败：${String(error)}`);
    } finally {
      window.clearInterval(timer);
      setIsLiteratureInsightRunning(false);
    }
  }

  function handleBindSelectedRow(): void {
    const paper = props.papers.find((item) => item.id === bindingPaperId);
    if (!paper || selectedCell.rowIndex === 0) {
      return;
    }

    const rowId = getRowId(workbookModelRef.current, selectedCell.rowIndex);
    const nextLinks = [
      ...props.links.filter((link) => link.rowId !== rowId && link.paperId !== paper.id),
      { rowId, paperId: paper.id }
    ];
    let nextWorkbook = workbookModelRef.current;
    const presetValues = [paper.pdfName, paper.chineseTitle, paper.englishTitle];

    presetValues.forEach((value, columnIndex) => {
      if (value && !getResearchCellText(nextWorkbook, selectedCell.rowIndex, columnIndex)) {
        nextWorkbook = setResearchCellText(nextWorkbook, selectedCell.rowIndex, columnIndex, value);
        setCellValueInUniver(selectedCell.rowIndex, columnIndex, value, false);
      }
    });

    workbookModelRef.current = nextWorkbook;
    props.onWorkbookChange(nextWorkbook);
    props.onLinksChange(nextLinks);
    setBindingPaperId('');
    setLocalMessage('已绑定当前行论文。');
    scheduleWorkbookSave();
  }

  function handleUnbindSelectedRow(): void {
    if (selectedCell.rowIndex === 0) {
      return;
    }

    const rowId = getRowId(workbookModelRef.current, selectedCell.rowIndex);
    props.onLinksChange(props.links.filter((link) => link.rowId !== rowId));
    setLocalMessage('已解除当前行论文绑定，表格内容保留。');
  }

  function handleToggleBindSelectedRow(): void {
    if (selectedCell.rowIndex === 0) {
      return;
    }

    if (linkedPaper && (!selectedBindingPaper || selectedBindingPaper.id === linkedPaper.id)) {
      handleUnbindSelectedRow();
      return;
    }

    handleBindSelectedRow();
  }

  function setCellValues(values: FillResearchCellResult[], targets: FillResearchCellTarget[]): void {
    const targetByAddress = new Map(targets.map((target) => [target.cellAddress, target]));
    let nextWorkbook = workbookModelRef.current;

    values.forEach((item) => {
      const target = targetByAddress.get(item.cellAddress);
      if (!target || !item.value.trim()) {
        return;
      }

      nextWorkbook = setResearchCellText(nextWorkbook, target.rowIndex, target.columnIndex, item.value);
      setCellValueInUniver(target.rowIndex, target.columnIndex, item.value, false);
    });

    workbookModelRef.current = nextWorkbook;
    props.onWorkbookChange(nextWorkbook);
    scheduleWorkbookSave();
  }

  function setCellValueInUniver(
    rowIndex: number,
    columnIndex: number,
    value: string,
    shouldScheduleSave = true
  ): void {
    const worksheet = workbookHandleRef.current?.getActiveSheet();
    if (!worksheet) {
      return;
    }

    const cellValue: ICellData = value.trim().startsWith('=')
      ? { f: value }
      : { v: value };
    worksheet.getRange(rowIndex, columnIndex).setValue(cellValue);
    if (shouldScheduleSave) {
      scheduleWorkbookSave();
    }
  }

  function applyFormatToSelection(format: (range: UniverRange) => void, message: string): void {
    const ranges = getActiveRangeList();
    if (ranges.length === 0) {
      return;
    }

    ranges.forEach(format);
    setLocalMessage(message);
    scheduleWorkbookSave();
  }

  function applyStylePatchToSelection(stylePatch: IStyleData, message: string): void {
    const worksheet = workbookHandleRef.current?.getActiveSheet();
    if (!worksheet) {
      return;
    }

    let nextWorkbook = flushWorkbookFromUniver() ?? workbookModelRef.current;
    const seen = new Set<string>();

    selectedRanges.forEach((range) => {
      for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
        for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
          const address = toA1(rowIndex, columnIndex);
          if (seen.has(address)) {
            continue;
          }

          seen.add(address);
          nextWorkbook = setResearchCellStyle(nextWorkbook, rowIndex, columnIndex, stylePatch);
          const text = getResearchCellText(nextWorkbook, rowIndex, columnIndex);
          const style = getResearchCellUniverStyle(nextWorkbook, rowIndex, columnIndex);
          const cellValue: ICellData = text.trim().startsWith('=')
            ? { f: text, s: style }
            : { v: text, s: style };
          (worksheet.getRange(rowIndex, columnIndex) as UniverRange).setValue?.(cellValue);
        }
      }
    });

    workbookModelRef.current = nextWorkbook;
    props.onWorkbookChange(nextWorkbook);
    setLocalMessage(message);
    scheduleWorkbookSave();
  }

  function handleToggleBold(): void {
    applyStylePatchToSelection(
      { bl: isBoldActive ? BooleanNumber.FALSE : BooleanNumber.TRUE },
      isBoldActive ? '已取消选区加粗。' : '已加粗选区。'
    );
  }

  function handleToggleItalic(): void {
    applyStylePatchToSelection(
      { it: isItalicActive ? BooleanNumber.FALSE : BooleanNumber.TRUE },
      isItalicActive ? '已取消选区斜体。' : '已将选区设为斜体。'
    );
  }

  async function handleExportExcel(): Promise<void> {
    const workbook = flushWorkbookFromUniver() ?? workbookModelRef.current;
    const result = await window.electronAPI.exportResearchWorkbookExcel({ workbook });
    if (result) {
      setLocalMessage(`已导出 Excel：${result.fileName}`);
    }
  }

  async function handleImportExcel(): Promise<void> {
    const result = await window.electronAPI.importResearchWorkbookExcel();
    if (!result) {
      return;
    }

    const currentWorkbook = flushWorkbookFromUniver() ?? workbookModelRef.current;
    const importedWorkbook = parseResearchWorkbook(JSON.stringify(result.workbook));
    const nextWorkbook = appendResearchWorkbookSheets(currentWorkbook, importedWorkbook);
    workbookModelRef.current = nextWorkbook;
    props.onWorkbookChange(nextWorkbook);
    localStorage.setItem(RESEARCH_WORKBOOK_KEY, serializeResearchWorkbook(nextWorkbook));
    localStorage.setItem(RESEARCH_SHEET_LINKS_KEY, JSON.stringify(props.links, null, 2));
    setLocalMessage(`已导入 Excel：${result.fileName}。外部工作表已追加，原工作表和论文绑定已保留。`);
    window.location.reload();
  }

  function handleCopyFormat(): void {
    updateSelectionFromUniver();
    const worksheet = workbookHandleRef.current?.getActiveSheet();
    const sourceRange = worksheet?.getRange(selectedCell.rowIndex, selectedCell.columnIndex) as UniverRange | undefined;
    const sourceStyle = cloneStyle(sourceRange?.getCellStyleData?.('row') ?? sourceRange?.getCellStyleData?.('cell') ?? null);

    if (!sourceStyle) {
      setLocalMessage('当前单元格没有可复制的格式。');
      return;
    }

    copiedFormatRef.current = sourceStyle;
    setHasCopiedFormat(true);
    setLocalMessage(`已复制 ${selectedCellAddress} 的格式；请选择目标区域后点击“粘贴格式”。`);
  }

  function handlePasteCopiedFormat(): void {
    if (!copiedFormatRef.current) {
      setLocalMessage('还没有复制格式；请先选择一个源单元格并点击“复制格式”。');
      return;
    }
    const copiedStyle = copiedFormatRef.current;

    const worksheet = workbookHandleRef.current?.getActiveSheet();
    if (!worksheet) {
      return;
    }

    let nextWorkbook = flushWorkbookFromUniver() ?? workbookModelRef.current;
    const seen = new Set<string>();

    selectedRanges.forEach((range) => {
      for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
        for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
          const address = toA1(rowIndex, columnIndex);
          if (seen.has(address)) {
            continue;
          }

          seen.add(address);
          nextWorkbook = setResearchCellStyle(nextWorkbook, rowIndex, columnIndex, copiedStyle);
          const text = getResearchCellText(nextWorkbook, rowIndex, columnIndex);
          const style = getResearchCellUniverStyle(nextWorkbook, rowIndex, columnIndex);
          const cellValue: ICellData = text.trim().startsWith('=')
            ? { f: text, s: style }
            : { v: text, s: style };
          (worksheet.getRange(rowIndex, columnIndex) as UniverRange).setValue?.(cellValue);
        }
      }
    });

    workbookModelRef.current = nextWorkbook;
    props.onWorkbookChange(nextWorkbook);
    setLocalMessage(`已把复制的格式粘贴到 ${selectedRangeLabel}。`);
    scheduleWorkbookSave();
  }

  function registerNativeContextMenus(instance: UniverInstance): void {
    const api = instance.univerAPI;
    const aiMenu = api.createMenu({
      id: 'ftranslate.context.ai-fill-selection',
      title: 'AI 填充选区',
      tooltip: '用当前行绑定论文填充选中的一个或多个单元格',
      order: 90,
      action: () => latestActionsRef.current.fillSelectedCells()
    });
    const bindMenu = api.createMenu({
      id: 'ftranslate.context.toggle-bind-row',
      title: '绑定/解除当前行论文',
      tooltip: '当前行未绑定时绑定下拉框所选论文；已绑定时解除绑定',
      order: 91,
      action: () => latestActionsRef.current.toggleBindSelectedRow()
    });
    const copyFormatMenu = api.createMenu({
      id: 'ftranslate.context.copy-format',
      title: '复制格式',
      tooltip: '复制当前单元格格式',
      order: 92,
      action: () => latestActionsRef.current.copyFormat()
    });
    const pasteFormatMenu = api.createMenu({
      id: 'ftranslate.context.paste-format',
      title: '粘贴格式到选区',
      tooltip: '把已复制的格式刷到当前选区',
      order: 93,
      action: () => latestActionsRef.current.pasteFormat()
    });

    // 直接挂到 Univer 原生右键菜单底部，避免再弹一层子菜单影响填表效率。
    [aiMenu, bindMenu, copyFormatMenu, pasteFormatMenu].forEach((menu) => {
      menu.appendTo(['contextMenu.mainArea', 'contextMenu.others']);
    });
  }

  function buildSelectedCellTargets(): FillResearchCellTarget[] {
    const workbook = workbookModelRef.current;
    const targets: FillResearchCellTarget[] = [];
    const seen = new Set<string>();

    selectedRanges.forEach((range) => {
      for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
        if (rowIndex === 0 || !getLinkedPaperForRow(rowIndex)) {
          continue;
        }

        for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
          const cellAddress = toA1(rowIndex, columnIndex);
          if (seen.has(cellAddress)) {
            continue;
          }

          seen.add(cellAddress);
          targets.push({
            rowIndex,
            columnIndex,
            cellAddress,
            columnHeader: getResearchColumnHeader(workbook, columnIndex),
            currentCellText: getResearchCellText(workbook, rowIndex, columnIndex),
            neighborRowValues: getResearchRowValues(workbook, rowIndex)
          });
        }
      }
    });

    return targets;
  }

  function getSelectedLiteraturePapers(): LiteratureGapPaperInput[] {
    const workbook = workbookModelRef.current;
    const rows = new Set<number>();

    selectedRanges.forEach((range) => {
      for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
        if (rowIndex > 0) {
          rows.add(rowIndex);
        }
      }
    });

    return [...rows]
      .map((rowIndex) => buildLiteratureInputForRow(workbook, rowIndex, true))
      .filter((item): item is LiteratureGapPaperInput => Boolean(item));
  }

  function getAllLinkedLiteraturePapers(): LiteratureGapPaperInput[] {
    const workbook = workbookModelRef.current;

    return workbook.rows
      .map((_row, rowIndex) => (rowIndex > 0 ? buildLiteratureInputForRow(workbook, rowIndex, false) : null))
      .filter((item): item is LiteratureGapPaperInput => Boolean(item));
  }

  function buildLiteratureInputForRow(
    workbook: ResearchWorkbook,
    rowIndex: number,
    allowUnboundRow: boolean
  ): LiteratureGapPaperInput | null {
    const rowValues = getResearchRowValues(workbook, rowIndex);
    const paper = getLinkedPaperForRow(rowIndex);

    if (paper) {
      return { paper, rowValues };
    }

    if (!allowUnboundRow || !Object.values(rowValues).some((value) => value.trim())) {
      return null;
    }

    return {
      paper: createSheetRowPaper(rowIndex, rowValues),
      rowValues
    };
  }

  function getLinkedPaperForRow(rowIndex: number): PaperRecord | null {
    const rowId = getRowId(workbookModelRef.current, rowIndex);
    const paperId = props.links.find((link) => link.rowId === rowId)?.paperId;
    return props.papers.find((paper) => paper.id === paperId) ?? null;
  }

  function getActiveRangeList(): UniverRange[] {
    const worksheet = workbookHandleRef.current?.getActiveSheet();
    if (!worksheet) {
      return [];
    }

    const selection = worksheet.getSelection();
    const ranges = (selection?.getActiveRangeList?.() ?? []) as UniverRange[];
    if (ranges.length > 0) {
      return ranges;
    }

    return [worksheet.getRange(selectedCell.rowIndex, selectedCell.columnIndex) as UniverRange];
  }

  function updateSelectionFromUniver(): void {
    const worksheet = workbookHandleRef.current?.getActiveSheet();
    const selection = worksheet?.getSelection();
    const currentCell = selection?.getCurrentCell() as
      | { actualRow?: number; actualColumn?: number; row?: number; column?: number }
      | null
      | undefined;

    const rowIndex = currentCell?.actualRow ?? currentCell?.row;
    const columnIndex = currentCell?.actualColumn ?? currentCell?.column;

    if (typeof rowIndex === 'number' && typeof columnIndex === 'number') {
      setSelectedCell({ rowIndex, columnIndex });
    }

    const ranges = getActiveRangeList()
      .map((range) => normalizeUniverRange(range, rowIndex ?? selectedCell.rowIndex, columnIndex ?? selectedCell.columnIndex))
      .filter((range): range is SelectedRange => Boolean(range));

    if (ranges.length > 0) {
      setSelectedRanges(ranges);
    }
  }

  function scheduleWorkbookSave(): void {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const snapshot = workbookHandleRef.current?.save();
      if (!snapshot) {
        return;
      }

      const nextWorkbook = fromUniverWorkbookData(snapshot as IWorkbookData);
      workbookModelRef.current = nextWorkbook;
      props.onWorkbookChange(nextWorkbook);
    }, 350);
  }

  function flushWorkbookFromUniver(): ResearchWorkbook | null {
    const snapshot = workbookHandleRef.current?.save();
    if (!snapshot) {
      return null;
    }

    const nextWorkbook = fromUniverWorkbookData(snapshot as IWorkbookData);
    workbookModelRef.current = nextWorkbook;
    props.onWorkbookChange(nextWorkbook);
    return nextWorkbook;
  }

  latestActionsRef.current = {
    fillSelectedCells: () => void handleFillSelectedCells(),
    toggleBindSelectedRow: handleToggleBindSelectedRow,
    openLinkedPaper: () => {
      if (linkedPaper) {
        props.onOpenPaper(linkedPaper);
      }
    },
    copyFormat: handleCopyFormat,
    pasteFormat: handlePasteCopiedFormat
  };

  return (
    <main className="research-sheet-page">
      <header className="research-sheet-header">
        <div className="research-sheet-title">
          <img src={brandMark} alt="" />
          <div>
            <h1>研究表格</h1>
            <p>独立的论文整合工作台；首行冻结，支持公式、格式、增删行列和选区级 AI 填写。</p>
          </div>
        </div>
        <div className="research-sheet-actions">
          <button type="button" className="icon-button" onClick={handleImportExcel} title="导入 Excel" aria-label="导入 Excel">
            <img className="button-icon" src={uploadIcon} alt="" />
          </button>
          <button type="button" className="icon-button" onClick={handleExportExcel} title="导出 Excel" aria-label="导出 Excel">
            <img className="button-icon" src={downloadIcon} alt="" />
          </button>
          <button type="button" className="button-with-icon" onClick={props.onBackHome} title="返回主页" aria-label="返回主页">
            <img className="button-icon" src={homeIcon} alt="" />
            <span>主页</span>
          </button>
        </div>
      </header>

      <section className="research-sheet-workbench">
        <section className="research-command-bar">
          <div>
            <strong>{statusText}</strong>
            <span>{localMessage || '当前工作簿会自动保存到本机 localStorage；右键菜单已接入 AI 填写、绑定和格式刷操作。'}</span>
          </div>
          <div className="research-command-actions">
            <select
              value={bindingPaperId}
              onChange={(event) => setBindingPaperId(event.target.value)}
              disabled={selectedCell.rowIndex === 0}
            >
              <option value="">绑定论文到当前行</option>
              {props.papers.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.chineseTitle || paper.englishTitle || paper.pdfName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-button button-with-icon"
              onClick={handleToggleBindSelectedRow}
              disabled={!canToggleBinding}
            >
              <img className="button-icon" src={saveIcon} alt="" />
              <span>{bindButtonLabel}</span>
            </button>
            <button
              type="button"
              className="secondary-button button-with-icon"
              onClick={() => linkedPaper && props.onOpenPaper(linkedPaper)}
              disabled={!linkedPaper}
            >
              <img className="button-icon" src={pdfReaderIcon} alt="" />
              <span>打开行论文</span>
            </button>
            <button
              type="button"
              className="primary-button button-with-icon"
              onClick={handleFillSelectedCells}
              disabled={aiTargetCount === 0 || props.isAiBusy}
            >
              <img className="button-icon" src={aiFillIcon} alt="" />
              <span>{props.isAiBusy ? 'AI 填写中...' : aiTargetCount > 1 ? `AI 填选区 ${aiTargetCount} 格` : 'AI 填此单元格'}</span>
            </button>
            <button
              type="button"
              className="button-with-icon"
              onClick={props.onOpenAiAssistant}
              title="在 AI 助手中管理大观分析、联网查新、提示词和历史结果"
            >
              <img className="button-icon" src={analysisIcon} alt="" />
              <span>AI 大观分析</span>
            </button>
            <button
              type="button"
              className="secondary-button button-with-icon"
              onClick={props.onOpenKnowledgeGraph}
              title="根据研究表格和论文库生成知识图谱"
            >
              <img className="button-icon" src={analysisIcon} alt="" />
              <span>知识图谱</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowRowDetail(true)}
              disabled={selectedCell.rowIndex <= 0}
            >
              查看行详情
            </button>
          </div>
        </section>

        <section className="literature-insight-progress research-insight-strip research-context-strip" aria-live="polite">
          <span>{literatureInsightAction.scopeText}</span>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={() => setShowFormulaHelp((value) => !value)}
          >
            公式帮助
          </button>
          {isLiteratureInsightRunning ? <div className="indeterminate-progress" /> : null}
          {literatureInsightProgress ? <p>{literatureInsightProgress}</p> : null}
          {literatureInsightHistory[0] ? (
            <button type="button" className="ghost-button" onClick={props.onOpenAiAssistant}>
              最近一次：{new Date(literatureInsightHistory[0].createdAt).toLocaleString()} / 查看结果
            </button>
          ) : (
            <button type="button" className="ghost-button" onClick={props.onOpenAiAssistant}>
              打开 AI 助手配置大观分析
            </button>
          )}
        </section>
        {showFormulaHelp ? (
          <section className="formula-help-popover research-formula-help" role="note">
            <strong>公式写法</strong>
            <p>行内公式：<code>$E=mc^2$</code></p>
            <p>块级公式：<code>$$L = L_data + lambda L_physics$$</code></p>
            <p>编辑单元格时保留源码，单元格预览、笔记和 AI 结果会渲染公式。</p>
          </section>
        ) : null}

        <section className="research-format-toolbar" aria-label="表格格式工具栏">
          <label>
            字号
            <select
              value={fontSize}
              onChange={(event) => {
                const size = Number(event.target.value);
                setFontSize(size);
                applyStylePatchToSelection({ fs: size }, `已将选区字号设为 ${size}。`);
              }}
            >
              {[10, 11, 12, 13, 14, 16, 18, 20, 24].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <button type="button" className="icon-button" onClick={handleCopyFormat} title="复制格式" aria-label="复制格式">
            <img className="button-icon" src={saveIcon} alt="" />
          </button>
          <button type="button" className="icon-button" onClick={handlePasteCopiedFormat} disabled={!hasCopiedFormat} title="粘贴格式" aria-label="粘贴格式">
            <img className="button-icon" src={refreshIcon} alt="" />
          </button>
          <button
            type="button"
            className={`icon-button ${isBoldActive ? 'is-active' : ''}`}
            onClick={handleToggleBold}
            title={isBoldActive ? '取消加粗' : '加粗'}
            aria-label={isBoldActive ? '取消加粗' : '加粗'}
            aria-pressed={isBoldActive}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`icon-button ${isItalicActive ? 'is-active' : ''}`}
            onClick={handleToggleItalic}
            title={isItalicActive ? '取消斜体' : '斜体'}
            aria-label={isItalicActive ? '取消斜体' : '斜体'}
            aria-pressed={isItalicActive}
          >
            <em>I</em>
          </button>
          <label>
            字色
            <input
              type="color"
              value={fontColor}
              onChange={(event) => {
                setFontColor(event.target.value);
                applyStylePatchToSelection({ cl: { rgb: event.target.value } }, '已更新选区文字颜色。');
              }}
            />
          </label>
          <label>
            底色
            <input
              type="color"
              value={fillColor}
              onChange={(event) => {
                setFillColor(event.target.value);
                applyStylePatchToSelection({ bg: { rgb: event.target.value } }, '已更新选区底色。');
              }}
            />
          </label>
          <button type="button" className="icon-button" onClick={() => applyStylePatchToSelection({ ht: 1 }, '已左对齐选区。')} title="左对齐" aria-label="左对齐">
            ≡
          </button>
          <button type="button" className="icon-button" onClick={() => applyStylePatchToSelection({ ht: 2 }, '已居中选区。')} title="水平居中" aria-label="水平居中">
            ☰
          </button>
          <button type="button" className="icon-button" onClick={() => applyStylePatchToSelection({ ht: 3 }, '已右对齐选区。')} title="右对齐" aria-label="右对齐">
            ≣
          </button>
          <button type="button" className="icon-button" onClick={() => applyStylePatchToSelection({ vt: 2 }, '已垂直居中选区。')} title="垂直居中" aria-label="垂直居中">
            ↕
          </button>
          <button type="button" className="icon-button" onClick={() => applyFormatToSelection((range) => range.setWrap?.(true), '已开启选区自动换行。')} title="自动换行" aria-label="自动换行">
            ↵
          </button>
        </section>

        <section className="research-sheet-surface">
          <div ref={containerRef} id={RESEARCH_UNIVER_CONTAINER_ID} className="univer-container" />
        </section>
        {selectedCellText.trim() ? (
          <section className="formula-preview-strip">
            <span>{selectedCellAddress} / {selectedColumnHeader} 预览</span>
            <MathText text={selectedCellText} />
          </section>
        ) : null}
        {showRowDetail ? (
          <aside className="row-detail-drawer" role="dialog" aria-label="研究表格行详情">
            <header>
              <div>
                <strong>第 {selectedCell.rowIndex + 1} 行详情</strong>
                <p>{linkedPaper ? linkedPaper.chineseTitle || linkedPaper.englishTitle || linkedPaper.pdfName : '当前行未绑定论文'}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowRowDetail(false)} aria-label="关闭行详情">
                ×
              </button>
            </header>
            <div className="row-detail-list">
              {Object.entries(selectedRowValues).map(([key, value]) => (
                <p key={key}>
                  <span>{key}</span>
                  <em>{value || '-'}</em>
                </p>
              ))}
            </div>
            {linkedPaper?.notes.trim() ? (
              <section className="row-linked-notes">
                <strong>关联笔记</strong>
                <MarkdownDocument text={linkedPaper.notes} />
              </section>
            ) : null}
            <div className="row-detail-actions">
              <button type="button" className="secondary-button" disabled={!linkedPaper} onClick={() => linkedPaper && props.onOpenPaper(linkedPaper)}>
                查看对应论文
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void navigator.clipboard.writeText(formatRowValuesForCopy(selectedRowValues))}
              >
                复制行信息
              </button>
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  );
}

function InsightMarkdown(props: { text: string }) {
  const blocks = props.text
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="literature-insight-rendered">
      {blocks.map((block, index) => {
        const heading = block.match(/^(#{1,3})\s+(.+)$/u);
        if (heading) {
          const HeadingTag = heading[1].length === 1 ? 'h3' : 'h4';
          return (
            <HeadingTag key={index}>
              <MathText text={heading[2]} />
            </HeadingTag>
          );
        }

        const listLines = block.split('\n').filter((line) => /^\s*(?:[-*]|\d+\.)\s+/u.test(line));
        if (listLines.length >= 2) {
          return (
            <ul key={index}>
              {listLines.map((line, itemIndex) => (
                <li key={itemIndex}>
                  <MathText text={line.replace(/^\s*(?:[-*]|\d+\.)\s+/u, '')} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index}>
            <MathText text={block} />
          </p>
        );
      })}
    </div>
  );
}

function formatRowValuesForCopy(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${value || '-'}`)
    .join('\n');
}

function cloneStyle(style: IStyleData | null): IStyleData | null {
  if (!style) {
    return null;
  }

  return JSON.parse(JSON.stringify(style)) as IStyleData;
}

function isStyleObject(value: unknown): value is IStyleData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeUniverRange(
  range: UniverRange,
  fallbackRow: number,
  fallbackColumn: number
): SelectedRange | null {
  const raw = (range.getRange?.() ?? {}) as Record<string, unknown>;
  const startRow = readNumber(raw.startRow, fallbackRow);
  const startColumn = readNumber(raw.startColumn, fallbackColumn);
  const endRow = readNumber(raw.endRow, startRow);
  const endColumn = readNumber(raw.endColumn, startColumn);

  if ([startRow, startColumn, endRow, endColumn].some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startColumn: Math.min(startColumn, endColumn),
    endColumn: Math.max(startColumn, endColumn)
  };
}

function readStoredLiteratureInsightState(): LiteratureInsightRunState | null {
  try {
    const raw = localStorage.getItem(LITERATURE_INSIGHT_STATE_KEY);
    return raw ? normalizeLiteratureInsightRunState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function readStoredLiteratureInsightHistory(): LiteratureInsightHistoryEntry[] {
  try {
    const raw = localStorage.getItem(LITERATURE_INSIGHT_HISTORY_KEY);
    return raw ? normalizeLiteratureInsightHistory(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function getRowId(workbook: ResearchWorkbook, rowIndex: number): string {
  return workbook.rows[rowIndex]?.id ?? `row-${rowIndex}`;
}

function createSheetRowPaper(rowIndex: number, rowValues: Record<string, string>): PaperRecord {
  const englishTitle = rowValues['英文标题'] || rowValues['论文'] || `表格第 ${rowIndex + 1} 行`;

  return {
    id: `sheet-row-${rowIndex}`,
    pdfPath: '',
    pdfName: rowValues['论文'] || `表格第 ${rowIndex + 1} 行`,
    translationPath: '',
    translationName: '',
    chineseTitle: rowValues['中文标题'] || '',
    englishTitle,
    journal: rowValues['期刊/会议'] || rowValues['期刊'] || '',
    authors: rowValues['作者'] || '',
    year: rowValues['年份'] || '',
    notes: rowValues['备注'] || '',
    lastOpenedAt: new Date(0).toISOString(),
    lastPage: 1
  };
}

function countSelectedCells(ranges: SelectedRange[]): number {
  return ranges.reduce(
    (count, range) => count + (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1),
    0
  );
}

function formatSelectedRanges(ranges: SelectedRange[]): string {
  return ranges
    .map((range) =>
      range.startRow === range.endRow && range.startColumn === range.endColumn
        ? toA1(range.startRow, range.startColumn)
        : `${toA1(range.startRow, range.startColumn)}:${toA1(range.endRow, range.endColumn)}`
    )
    .join(', ');
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function toA1(rowIndex: number, columnIndex: number): string {
  let column = '';
  let value = columnIndex + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }

  return `${column}${rowIndex + 1}`;
}
