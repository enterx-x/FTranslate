import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  createUniver,
  defaultTheme,
  LocaleType,
  type ICellData,
  type IWorkbookData
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import brandMark from '../assets/brand-mark.png';
import {
  fromUniverWorkbookData,
  getResearchCellText,
  getResearchColumnHeader,
  getResearchRowValues,
  setResearchCellText,
  toUniverWorkbookData,
  type ResearchSheetLink,
  type ResearchWorkbook
} from '../lib/researchWorkbook';
import type { PaperRecord } from '../lib/papers';

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

export function ResearchSheetPage(props: ResearchSheetPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<UniverInstance | null>(null);
  const workbookHandleRef = useRef<NonNullable<UniverWorkbook> | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const workbookModelRef = useRef(props.workbook);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(DEFAULT_SELECTED_CELL);
  const [selectedRanges, setSelectedRanges] = useState<SelectedRange[]>([DEFAULT_SELECTED_RANGE]);
  const [bindingPaperId, setBindingPaperId] = useState('');
  const [fontSize, setFontSize] = useState(12);
  const [fontColor, setFontColor] = useState('#111111');
  const [fillColor, setFillColor] = useState('#ffffff');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [localMessage, setLocalMessage] = useState('');

  const selectedRowId = getRowId(workbookModelRef.current, selectedCell.rowIndex);
  const linkedPaperId = props.links.find((link) => link.rowId === selectedRowId)?.paperId ?? '';
  const linkedPaper = props.papers.find((paper) => paper.id === linkedPaperId) ?? null;
  const selectedCellAddress = toA1(selectedCell.rowIndex, selectedCell.columnIndex);
  const selectedColumnHeader = getResearchColumnHeader(workbookModelRef.current, selectedCell.columnIndex);
  const selectedCellCount = countSelectedCells(selectedRanges);
  const selectedRangeLabel = formatSelectedRanges(selectedRanges);

  const aiTargetCount = useMemo(() => buildSelectedCellTargets().length, [
    props.links,
    props.papers,
    selectedRanges
  ]);

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
    const closeContextMenu = () => setContextMenu(null);
    window.addEventListener('click', closeContextMenu);
    return () => window.removeEventListener('click', closeContextMenu);
  }, []);

  useEffect(() => {
    if (!containerRef.current || univerRef.current) {
      return;
    }

    const instance = createUniver({
      theme: defaultTheme,
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: zhCN
      },
      presets: [
        UniverSheetsCorePreset({
          container: containerRef.current,
          header: false,
          toolbar: true,
          formulaBar: true,
          footer: {
            sheetBar: true,
            statisticBar: true,
            zoomSlider: true
          }
        })
      ]
    });
    const workbookHandle = instance.univerAPI.createWorkbook(toUniverWorkbookData(props.workbook));
    univerRef.current = instance;
    workbookHandleRef.current = workbookHandle;

    const commandDisposable = instance.univerAPI.onCommandExecuted(() => {
      scheduleWorkbookSave();
      updateSelectionFromUniver();
    });

    const container = containerRef.current;
    const updateSelectionLater = () => window.setTimeout(updateSelectionFromUniver, 0);
    container.addEventListener('mouseup', updateSelectionLater);
    container.addEventListener('keyup', updateSelectionLater);

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

    return () => {
      commandDisposable.dispose();
      container.removeEventListener('mouseup', updateSelectionLater);
      container.removeEventListener('keyup', updateSelectionLater);
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

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    updateSelectionFromUniver();
    setContextMenu({ x: event.clientX, y: event.clientY });
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
          <button type="button" onClick={props.onBackHome}>
            返回论文库
          </button>
        </div>
      </header>

      <section className="research-command-bar">
        <div>
          <strong>{statusText}</strong>
          <span>{localMessage || '当前工作簿会自动保存到本机 localStorage。'}</span>
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
            onClick={handleBindSelectedRow}
            disabled={!bindingPaperId || selectedCell.rowIndex === 0}
          >
            绑定
          </button>
          <button
            type="button"
            onClick={handleUnbindSelectedRow}
            disabled={!linkedPaper || selectedCell.rowIndex === 0}
          >
            解除绑定
          </button>
          <button
            type="button"
            onClick={() => linkedPaper && props.onOpenPaper(linkedPaper)}
            disabled={!linkedPaper}
          >
            打开行论文
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleFillSelectedCells}
            disabled={aiTargetCount === 0 || props.isAiBusy}
          >
            {props.isAiBusy ? 'AI 填写中...' : aiTargetCount > 1 ? `AI 填选区 ${aiTargetCount} 格` : 'AI 填此单元格'}
          </button>
        </div>
      </section>

      <section className="research-format-toolbar" aria-label="表格格式工具栏">
        <label>
          字号
          <select
            value={fontSize}
            onChange={(event) => {
              const size = Number(event.target.value);
              setFontSize(size);
              applyFormatToSelection((range) => range.setFontSize?.(size), `已将选区字号设为 ${size}。`);
            }}
          >
            {[10, 11, 12, 13, 14, 16, 18, 20, 24].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setFontWeight?.('bold'), '已加粗选区。')}>
          B
        </button>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setFontWeight?.('normal'), '已取消选区加粗。')}>
          常规
        </button>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setFontStyle?.('italic'), '已将选区设为斜体。')}>
          I
        </button>
        <label>
          字色
          <input
            type="color"
            value={fontColor}
            onChange={(event) => {
              setFontColor(event.target.value);
              applyFormatToSelection((range) => range.setFontColor?.(event.target.value), '已更新选区文字颜色。');
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
              applyFormatToSelection((range) => range.setBackground?.(event.target.value), '已更新选区底色。');
            }}
          />
        </label>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setHorizontalAlignment?.('left'), '已左对齐选区。')}>
          左
        </button>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setHorizontalAlignment?.('center'), '已居中选区。')}>
          中
        </button>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setHorizontalAlignment?.('right'), '已右对齐选区。')}>
          右
        </button>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setVerticalAlignment?.('middle'), '已垂直居中选区。')}>
          垂直居中
        </button>
        <button type="button" onClick={() => applyFormatToSelection((range) => range.setWrap?.(true), '已开启选区自动换行。')}>
          换行
        </button>
      </section>

      <section className="research-sheet-surface" onContextMenu={handleContextMenu}>
        <div ref={containerRef} className="univer-container" />
        {contextMenu ? (
          <div
            className="sheet-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
          >
            <button type="button" onClick={handleFillSelectedCells} disabled={aiTargetCount === 0 || props.isAiBusy}>
              AI 填充选区
            </button>
            <button type="button" onClick={handleUnbindSelectedRow} disabled={!linkedPaper || selectedCell.rowIndex === 0}>
              解除当前行绑定
            </button>
            <button type="button" onClick={() => applyFormatToSelection((range) => range.setHorizontalAlignment?.('center'), '已居中选区。')}>
              居中
            </button>
            <button type="button" onClick={() => applyFormatToSelection((range) => range.setWrap?.(true), '已开启选区自动换行。')}>
              自动换行
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
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

function getRowId(workbook: ResearchWorkbook, rowIndex: number): string {
  return workbook.rows[rowIndex]?.id ?? `row-${rowIndex}`;
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
