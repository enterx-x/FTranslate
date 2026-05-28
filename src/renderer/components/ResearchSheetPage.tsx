import { useEffect, useMemo, useRef, useState } from 'react';
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
  getResearchCellText,
  getResearchColumnHeader,
  getResearchRowValues,
  setResearchCellText,
  toUniverWorkbookData,
  fromUniverWorkbookData,
  type ResearchSheetLink,
  type ResearchWorkbook
} from '../lib/researchWorkbook';
import type { PaperRecord } from '../lib/papers';

export interface FillResearchCellRequest {
  paper: PaperRecord;
  rowIndex: number;
  columnIndex: number;
  cellAddress: string;
  columnHeader: string;
  currentCellText: string;
  neighborRowValues: Record<string, string>;
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
  onFillCellWithAi: (request: FillResearchCellRequest) => Promise<string | null>;
}

interface SelectedCell {
  rowIndex: number;
  columnIndex: number;
}

type UniverInstance = ReturnType<typeof createUniver>;
type UniverWorkbook = ReturnType<UniverInstance['univerAPI']['getActiveWorkbook']>;

const DEFAULT_SELECTED_CELL: SelectedCell = {
  rowIndex: 1,
  columnIndex: 3
};

export function ResearchSheetPage(props: ResearchSheetPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<UniverInstance | null>(null);
  const workbookHandleRef = useRef<NonNullable<UniverWorkbook> | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const workbookModelRef = useRef(props.workbook);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(DEFAULT_SELECTED_CELL);
  const [bindingPaperId, setBindingPaperId] = useState('');

  const selectedRowId = getRowId(workbookModelRef.current, selectedCell.rowIndex);
  const linkedPaperId = props.links.find((link) => link.rowId === selectedRowId)?.paperId ?? '';
  const linkedPaper = props.papers.find((paper) => paper.id === linkedPaperId) ?? null;
  const selectedCellAddress = toA1(selectedCell.rowIndex, selectedCell.columnIndex);
  const selectedColumnHeader = getResearchColumnHeader(workbookModelRef.current, selectedCell.columnIndex);
  const selectedCellText = getResearchCellText(
    workbookModelRef.current,
    selectedCell.rowIndex,
    selectedCell.columnIndex
  );

  const statusText = useMemo(() => {
    if (selectedCell.rowIndex === 0) {
      return '当前选中表头；请选择正文行单元格后使用 AI 填写。';
    }

    if (!linkedPaper) {
      return '当前行未绑定论文；先在右侧选择论文绑定到该行。';
    }

    return `当前选中：${selectedCellAddress} / ${selectedColumnHeader}，已绑定 ${linkedPaper.chineseTitle || linkedPaper.englishTitle || linkedPaper.pdfName}`;
  }, [linkedPaper, selectedCell.rowIndex, selectedCellAddress, selectedColumnHeader]);

  useEffect(() => {
    workbookModelRef.current = props.workbook;
  }, [props.workbook]);

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

  async function handleFillSelectedCell(): Promise<void> {
    if (!linkedPaper || selectedCell.rowIndex === 0) {
      return;
    }

    const text = await props.onFillCellWithAi({
      paper: linkedPaper,
      rowIndex: selectedCell.rowIndex,
      columnIndex: selectedCell.columnIndex,
      cellAddress: selectedCellAddress,
      columnHeader: selectedColumnHeader,
      currentCellText: selectedCellText,
      neighborRowValues: getResearchRowValues(workbookModelRef.current, selectedCell.rowIndex)
    });

    if (!text) {
      return;
    }

    setCurrentCellValue(text);
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
        setCellValueInUniver(selectedCell.rowIndex, columnIndex, value);
      }
    });

    workbookModelRef.current = nextWorkbook;
    props.onWorkbookChange(nextWorkbook);
    props.onLinksChange(nextLinks);
    setBindingPaperId('');
  }

  function setCurrentCellValue(value: string): void {
    const nextWorkbook = setResearchCellText(
      workbookModelRef.current,
      selectedCell.rowIndex,
      selectedCell.columnIndex,
      value
    );
    workbookModelRef.current = nextWorkbook;
    setCellValueInUniver(selectedCell.rowIndex, selectedCell.columnIndex, value);
    props.onWorkbookChange(nextWorkbook);
  }

  function setCellValueInUniver(rowIndex: number, columnIndex: number, value: string): void {
    const worksheet = workbookHandleRef.current?.getActiveSheet();
    if (!worksheet) {
      return;
    }

    const cellValue: ICellData = value.trim().startsWith('=')
      ? { f: value }
      : { v: value };
    worksheet.getRange(rowIndex, columnIndex).setValue(cellValue);
    scheduleWorkbookSave();
  }

  function updateSelectionFromUniver(): void {
    const selection = workbookHandleRef.current?.getActiveSheet().getSelection();
    const currentCell = selection?.getCurrentCell() as
      | { actualRow?: number; actualColumn?: number; row?: number; column?: number }
      | null
      | undefined;

    const rowIndex = currentCell?.actualRow ?? currentCell?.row;
    const columnIndex = currentCell?.actualColumn ?? currentCell?.column;

    if (typeof rowIndex !== 'number' || typeof columnIndex !== 'number') {
      return;
    }

    setSelectedCell({
      rowIndex,
      columnIndex
    });
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
            <p>独立的论文整合工作台；首行冻结，支持公式、格式、增删行列和单元格级 AI 填写。</p>
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
          <span>当前工作簿会自动保存到本机 localStorage。</span>
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
            onClick={() => linkedPaper && props.onOpenPaper(linkedPaper)}
            disabled={!linkedPaper}
          >
            打开行论文
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleFillSelectedCell}
            disabled={!linkedPaper || selectedCell.rowIndex === 0 || props.isAiBusy}
          >
            {props.isAiBusy ? 'AI 填写中...' : 'AI 填此单元格'}
          </button>
        </div>
      </section>

      <section className="research-sheet-surface">
        <div ref={containerRef} className="univer-container" />
      </section>
    </main>
  );
}

function getRowId(workbook: ResearchWorkbook, rowIndex: number): string {
  return workbook.rows[rowIndex]?.id ?? `row-${rowIndex}`;
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
