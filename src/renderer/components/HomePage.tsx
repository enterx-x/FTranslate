import { useMemo, useState } from 'react';
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellFocusedEvent,
  type CellValueChangedEvent,
  type ColDef,
  type ICellRendererParams
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import {
  PAPER_RESEARCH_COLUMNS,
  getPaperSheetCell,
  updatePaperSheetCell,
  type PaperRecord,
  type PaperResearchColumnKey
} from '../lib/papers';
import brandMark from '../assets/brand-mark.png';
import { MathText } from './MathText';

ModuleRegistry.registerModules([AllCommunityModule]);

interface HomePageProps {
  papers: PaperRecord[];
  isAiBusy?: boolean;
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onUpdatePaper: (paper: PaperRecord) => void;
  onRemovePaper: (paper: PaperRecord) => void;
  onFillPaperCellWithAi?: (paper: PaperRecord, field: PaperResearchColumnKey) => void;
}

type EditablePaperField =
  | 'chineseTitle'
  | 'englishTitle'
  | 'journal'
  | 'authors'
  | 'year'
  | 'notes';

interface SelectedResearchCell {
  paperId: string;
  field: PaperResearchColumnKey;
}

const editableFields = new Set<EditablePaperField>([
  'chineseTitle',
  'englishTitle',
  'journal',
  'authors',
  'year',
  'notes'
]);

export function HomePage(props: HomePageProps) {
  const {
    papers,
    isAiBusy,
    onNewProject,
    onOpenPaper,
    onUpdatePaper,
    onRemovePaper,
    onFillPaperCellWithAi
  } = props;
  const [selectedResearchCell, setSelectedResearchCell] = useState<SelectedResearchCell | null>(null);
  const selectedPaper = selectedResearchCell
    ? papers.find((paper) => paper.id === selectedResearchCell.paperId) ?? null
    : null;
  const selectedColumn = selectedResearchCell
    ? PAPER_RESEARCH_COLUMNS.find((column) => column.key === selectedResearchCell.field) ?? null
    : null;

  const columnDefs = useMemo<Array<ColDef<PaperRecord>>>(() => {
    const researchColumns: Array<ColDef<PaperRecord>> = PAPER_RESEARCH_COLUMNS.map((column) => ({
      colId: `sheet:${column.key}`,
      headerName: column.label,
      minWidth: 220,
      flex: 1,
      editable: true,
      wrapText: true,
      autoHeight: true,
      valueGetter: (params) => (params.data ? getPaperSheetCell(params.data, column.key) : ''),
      valueSetter: (params) => {
        if (!params.data) {
          return false;
        }
        params.data.sheetCells = {
          ...params.data.sheetCells,
          [column.key]: String(params.newValue ?? '')
        };
        return true;
      },
      cellRenderer: MathCellRenderer
    }));

    return [
      {
        headerName: '中文标题',
        field: 'chineseTitle',
        colId: 'chineseTitle',
        pinned: 'left',
        minWidth: 220,
        editable: true,
        wrapText: true,
        autoHeight: true,
        cellRenderer: TitleCellRenderer
      },
      {
        headerName: '英文标题',
        field: 'englishTitle',
        colId: 'englishTitle',
        minWidth: 260,
        editable: true,
        wrapText: true,
        autoHeight: true,
        cellRenderer: MathCellRenderer
      },
      ...researchColumns,
      { headerName: '期刊', field: 'journal', colId: 'journal', minWidth: 130, editable: true },
      { headerName: '作者', field: 'authors', colId: 'authors', minWidth: 220, editable: true },
      { headerName: '年份', field: 'year', colId: 'year', minWidth: 95, editable: true },
      {
        headerName: '阅读笔记',
        field: 'notes',
        colId: 'notes',
        minWidth: 260,
        editable: true,
        wrapText: true,
        autoHeight: true,
        cellRenderer: MathCellRenderer
      },
      {
        headerName: '最近打开',
        field: 'lastOpenedAt',
        colId: 'lastOpenedAt',
        minWidth: 150,
        valueFormatter: (params) => formatDateTime(String(params.value ?? ''))
      },
      {
        headerName: '页码',
        field: 'lastPage',
        colId: 'lastPage',
        minWidth: 90,
        valueFormatter: (params) => `第 ${params.value || 1} 页`
      },
      {
        headerName: '操作',
        colId: 'actions',
        pinned: 'right',
        minWidth: 220,
        cellRenderer: (params: ICellRendererParams<PaperRecord>) => (
          <div className="paper-grid-actions">
            <button type="button" onClick={() => params.data && onOpenPaper(params.data)}>
              打开阅读
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => params.data && onRemovePaper(params.data)}
            >
              移除
            </button>
          </div>
        )
      }
    ];
  }, [onOpenPaper, onRemovePaper]);

  function handleCellValueChanged(event: CellValueChangedEvent<PaperRecord>): void {
    if (!event.data || event.oldValue === event.newValue) {
      return;
    }

    const colId = event.column.getColId();
    if (colId.startsWith('sheet:')) {
      const field = colId.slice('sheet:'.length) as PaperResearchColumnKey;
      onUpdatePaper(updatePaperSheetCell(event.data, field, String(event.newValue ?? '')));
      return;
    }

    if (editableFields.has(colId as EditablePaperField)) {
      onUpdatePaper({
        ...event.data,
        [colId]: String(event.newValue ?? '')
      });
    }
  }

  function handleCellFocused(event: CellFocusedEvent<PaperRecord>): void {
    const colId =
      typeof event.column === 'string' ? event.column : event.column?.getColId() ?? '';
    const row =
      typeof event.rowIndex === 'number'
        ? event.api.getDisplayedRowAtIndex(event.rowIndex)?.data ?? null
        : null;

    if (row && colId.startsWith('sheet:')) {
      setSelectedResearchCell({
        paperId: row.id,
        field: colId.slice('sheet:'.length) as PaperResearchColumnKey
      });
      return;
    }

    setSelectedResearchCell(null);
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <img className="home-header-mark" src={brandMark} alt="" />
        <div>
          <h1>论文库</h1>
          <p>像表格一样管理论文、阅读笔记、创新点、局限点和复现实验想法。</p>
        </div>
        <div className="home-header-actions">
          <button
            type="button"
            disabled={!selectedPaper || !selectedColumn || isAiBusy}
            onClick={() =>
              selectedPaper && selectedColumn && onFillPaperCellWithAi?.(selectedPaper, selectedColumn.key)
            }
            title="选中创新点、局限点等研究列单元格后，可让 AI 根据论文缓存和笔记自动填写。"
          >
            AI 填当前单元格
          </button>
          <button type="button" onClick={onNewProject}>
            新建翻译项目
          </button>
        </div>
      </header>

      {papers.length === 0 ? (
        <section className="home-empty">
          <h2>还没有论文记录</h2>
          <p>点击“新建翻译项目”，选择 PDF 和翻译文件后会自动加入论文库。</p>
        </section>
      ) : (
        <section className="paper-table-wrap paper-grid-shell">
          <div className="paper-grid-toolbar">
            <span>
              已收录 <strong>{props.papers.length}</strong> 篇论文
            </span>
            <span>
              表头固定，中文标题列固定；双击单元格可编辑，输入 `$...$` 可渲染公式。
            </span>
            <span>
              当前选中：{selectedPaper && selectedColumn ? `${selectedPaper.englishTitle} / ${selectedColumn.label}` : '无'}
            </span>
          </div>
          <div className="ag-theme-quartz paper-grid">
            <AgGridReact<PaperRecord>
              rowData={papers}
              columnDefs={columnDefs}
              getRowId={(params) => params.data.id}
              defaultColDef={{
                resizable: true,
                sortable: true,
                filter: true,
                editable: false,
                suppressHeaderMenuButton: true
              }}
              singleClickEdit
              suppressColumnVirtualisation
              stopEditingWhenCellsLoseFocus
              animateRows={false}
              onCellFocused={handleCellFocused}
              onCellValueChanged={handleCellValueChanged}
            />
          </div>
        </section>
      )}
    </main>
  );
}

function MathCellRenderer(params: ICellRendererParams<PaperRecord, string>) {
  const value = String(params.value ?? '').trim();
  return (
    <div className="paper-grid-cell-text">
      <MathText text={value || '-'} />
    </div>
  );
}

function TitleCellRenderer(params: ICellRendererParams<PaperRecord, string>) {
  const paper = params.data;
  const value = String(params.value ?? '').trim();
  return (
    <div className="paper-grid-title-cell">
      <strong>{value || '未填写'}</strong>
      {paper?.translationName ? <small>{paper.translationName}</small> : null}
      {paper?.aiCacheName ? <small>AI 缓存：{paper.aiCacheName}</small> : null}
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
