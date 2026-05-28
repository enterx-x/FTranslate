import type { PaperRecord } from './papers';
import {
  BooleanNumber,
  CellValueType,
  LocaleType,
  type ICellData,
  type IStyleData,
  type IWorkbookData
} from '@univerjs/presets';

export const RESEARCH_WORKBOOK_KEY = 'pdfTranslationReader:researchWorkbook';
export const RESEARCH_SHEET_LINKS_KEY = 'pdfTranslationReader:researchSheetLinks';

export type ResearchColumnKey =
  | 'paper'
  | 'chineseTitle'
  | 'englishTitle'
  | 'innovation'
  | 'limitations'
  | 'method'
  | 'dataset'
  | 'metrics'
  | 'reproducePlan'
  | 'futureIdeas'
  | 'notes';

export interface ResearchSheetColumn {
  key: ResearchColumnKey | string;
  label: string;
  width: number;
}

export interface ResearchCellStyle {
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  univerStyle?: ICellData['s'];
}

export interface ResearchCell {
  value: string;
  style?: ResearchCellStyle;
}

export interface ResearchRow {
  id: string;
  height?: number;
  cells: ResearchCell[];
}

export interface ResearchWorkbook {
  id: string;
  sheetName: string;
  styles?: IWorkbookData['styles'];
  freeze: {
    ySplit: number;
    xSplit: number;
  };
  columns: ResearchSheetColumn[];
  rows: ResearchRow[];
}

export interface ResearchSheetLink {
  rowId: string;
  paperId: string;
}

export const RESEARCH_SHEET_COLUMNS: ResearchSheetColumn[] = [
  { key: 'paper', label: '论文', width: 180 },
  { key: 'chineseTitle', label: '中文标题', width: 220 },
  { key: 'englishTitle', label: '英文标题', width: 260 },
  { key: 'innovation', label: '创新点', width: 260 },
  { key: 'limitations', label: '局限点', width: 260 },
  { key: 'method', label: '方法', width: 240 },
  { key: 'dataset', label: '数据/任务', width: 220 },
  { key: 'metrics', label: '指标/结果', width: 220 },
  { key: 'reproducePlan', label: '复现计划', width: 240 },
  { key: 'futureIdeas', label: '后续 idea', width: 240 },
  { key: 'notes', label: '备注', width: 260 }
];

const LEGACY_SHEET_CELL_COLUMN: Record<string, ResearchColumnKey> = {
  innovation: 'innovation',
  limitations: 'limitations',
  method: 'method',
  dataset: 'dataset',
  metrics: 'metrics',
  reproducePlan: 'reproducePlan',
  futureIdeas: 'futureIdeas'
};

export function buildDefaultResearchWorkbook(): ResearchWorkbook {
  return {
    id: 'research-workbook',
    sheetName: '论文研究表',
    freeze: {
      ySplit: 1,
      xSplit: 0
    },
    columns: RESEARCH_SHEET_COLUMNS,
    rows: [
      {
        id: 'header',
        cells: RESEARCH_SHEET_COLUMNS.map((column) => ({
          value: column.label,
          style: {
            bold: true,
            fontSize: 13,
            color: '#ffffff',
            backgroundColor: '#111111',
            align: 'center'
          }
        }))
      }
    ]
  };
}

export function parseResearchWorkbook(value: string | null): ResearchWorkbook {
  if (!value) {
    return buildDefaultResearchWorkbook();
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return buildDefaultResearchWorkbook();
    }

    const fallback = buildDefaultResearchWorkbook();
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.map(parseRow).filter((row): row is ResearchRow => Boolean(row))
      : fallback.rows;

    const parsedColumns = Array.isArray(parsed.columns)
      ? parsed.columns.map(parseColumn).filter((column): column is ResearchSheetColumn => Boolean(column))
      : [];
    const columns = parsedColumns.length > 0 ? parsedColumns : fallback.columns;

    return {
      id: readString(parsed.id) || fallback.id,
      sheetName: readString(parsed.sheetName) || fallback.sheetName,
      styles: isRecord(parsed.styles) ? (parsed.styles as IWorkbookData['styles']) : fallback.styles,
      freeze: {
        ySplit: Math.max(1, Number(isRecord(parsed.freeze) ? parsed.freeze.ySplit : 1) || 1),
        xSplit: Math.max(0, Number(isRecord(parsed.freeze) ? parsed.freeze.xSplit : 0) || 0)
      },
      columns,
      rows: normalizeRows(rows.length > 0 ? rows : fallback.rows, columns)
    };
  } catch {
    return buildDefaultResearchWorkbook();
  }
}

export function serializeResearchWorkbook(workbook: ResearchWorkbook): string {
  return JSON.stringify(workbook, null, 2);
}

export function parseResearchSheetLinks(value: string | null): ResearchSheetLink[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const rowId = readString(item.rowId);
        const paperId = readString(item.paperId);
        return rowId && paperId ? { rowId, paperId } : null;
      })
      .filter((item): item is ResearchSheetLink => Boolean(item));
  } catch {
    return [];
  }
}

export function serializeResearchSheetLinks(links: ResearchSheetLink[]): string {
  return JSON.stringify(links, null, 2);
}

export function ensurePaperRow(
  workbook: ResearchWorkbook,
  links: ResearchSheetLink[],
  paper: PaperRecord
): { workbook: ResearchWorkbook; links: ResearchSheetLink[]; rowIndex: number } {
  const existingLink = links.find((link) => link.paperId === paper.id);
  if (existingLink) {
    const existingRowIndex = workbook.rows.findIndex((row) => row.id === existingLink.rowId);
    if (existingRowIndex > 0) {
      return { workbook, links, rowIndex: existingRowIndex };
    }
  }

  const rowIndex = Math.max(1, workbook.rows.length);
  const rowId = `row-${rowIndex}`;
  const nextWorkbook = {
    ...workbook,
    rows: [...workbook.rows, buildPaperRow(rowId, paper, workbook.columns)]
  };
  const nextLinks = [
    ...links.filter((link) => link.paperId !== paper.id && link.rowId !== rowId),
    { rowId, paperId: paper.id }
  ];

  return { workbook: nextWorkbook, links: nextLinks, rowIndex };
}

export function migrateLegacyPaperSheetCells(
  workbook: ResearchWorkbook,
  links: ResearchSheetLink[],
  papers: Array<PaperRecord | (PaperRecord & { sheetCells?: Record<string, string> })>
): { workbook: ResearchWorkbook; links: ResearchSheetLink[] } {
  return papers.reduce(
    (state, paper) => {
      const legacyCells = isRecord((paper as { sheetCells?: unknown }).sheetCells)
        ? ((paper as { sheetCells: Record<string, unknown> }).sheetCells)
        : null;
      if (!legacyCells) {
        return state;
      }

      const ensured = ensurePaperRow(state.workbook, state.links, paper);
      let nextWorkbook = ensured.workbook;

      Object.entries(LEGACY_SHEET_CELL_COLUMN).forEach(([legacyKey, columnKey]) => {
        const value = readString(legacyCells[legacyKey]);
        const columnIndex = RESEARCH_SHEET_COLUMNS.findIndex((column) => column.key === columnKey);
        if (value && columnIndex >= 0 && !getResearchCellText(nextWorkbook, ensured.rowIndex, columnIndex)) {
          nextWorkbook = setResearchCellText(nextWorkbook, ensured.rowIndex, columnIndex, value);
        }
      });

      return { workbook: nextWorkbook, links: ensured.links };
    },
    { workbook, links }
  );
}

export function getResearchCellText(workbook: ResearchWorkbook, rowIndex: number, columnIndex: number): string {
  return workbook.rows[rowIndex]?.cells[columnIndex]?.value ?? '';
}

export function setResearchCellText(
  workbook: ResearchWorkbook,
  rowIndex: number,
  columnIndex: number,
  value: string
): ResearchWorkbook {
  const sourceRows = ensureRows(workbook.rows, workbook.columns, rowIndex);
  const rows = sourceRows.map((row, currentRowIndex) => {
    if (currentRowIndex !== rowIndex) {
      return row;
    }

    const cells = normalizeCells(row.cells, workbook.columns).map((cell, currentColumnIndex) =>
      currentColumnIndex === columnIndex ? { ...cell, value } : cell
    );

    return { ...row, cells };
  });

  return {
    ...workbook,
    rows
  };
}

export function setResearchCellStyle(
  workbook: ResearchWorkbook,
  rowIndex: number,
  columnIndex: number,
  stylePatch: IStyleData
): ResearchWorkbook {
  const sourceRows = ensureRows(workbook.rows, workbook.columns, rowIndex);
  const rows = sourceRows.map((row, currentRowIndex) => {
    if (currentRowIndex !== rowIndex) {
      return row;
    }

    const cells = normalizeCells(row.cells, workbook.columns).map((cell, currentColumnIndex) => {
      if (currentColumnIndex !== columnIndex) {
        return cell;
      }

      return {
        ...cell,
        style: {
          ...(cell.style ?? {}),
          // BooleanNumber.FALSE 是 0，不能用 truthy 判断丢掉，否则取消后无法再次切回。
          univerStyle: {
            ...getResearchCellUniverStyle(workbook, rowIndex, columnIndex),
            ...stylePatch
          }
        }
      };
    });

    return { ...row, cells };
  });

  return {
    ...workbook,
    rows
  };
}

export function getResearchCellUniverStyle(
  workbook: ResearchWorkbook,
  rowIndex: number,
  columnIndex: number
): IStyleData {
  const rawStyle = workbook.rows[rowIndex]?.cells[columnIndex]?.style?.univerStyle;
  if (typeof rawStyle === 'string') {
    const style = workbook.styles?.[rawStyle];
    return isRecord(style) ? cloneUniverStyle(style as IStyleData) : {};
  }

  return isRecord(rawStyle) ? cloneUniverStyle(rawStyle as IStyleData) : {};
}

export function getResearchRowValues(
  workbook: ResearchWorkbook,
  rowIndex: number
): Record<string, string> {
  return RESEARCH_SHEET_COLUMNS.reduce<Record<string, string>>((values, column, columnIndex) => {
    values[column.label] = getResearchCellText(workbook, rowIndex, columnIndex);
    return values;
  }, {});
}

export function getResearchColumnHeader(workbook: ResearchWorkbook, columnIndex: number): string {
  return workbook.columns[columnIndex]?.label ?? `Column ${columnIndex + 1}`;
}

export function toUniverWorkbookData(workbook: ResearchWorkbook): IWorkbookData {
  const sheetId = 'research-sheet';
  const styles: IWorkbookData['styles'] = {
    ...(workbook.styles ?? {}),
    header: {
      bg: { rgb: '#111111' },
      cl: { rgb: '#ffffff' },
      bl: BooleanNumber.TRUE,
      ht: 2,
      vt: 2,
      fs: 13
    },
    normal: {
      fs: 12,
      vt: 2
    }
  };
  const cellData: Record<number, Record<number, ICellData>> = {};

  workbook.rows.forEach((row, rowIndex) => {
    cellData[rowIndex] = {};
    row.cells.forEach((cell, columnIndex) => {
      const value = cell.value ?? '';
      const style = getCellUniverStyle(cell, rowIndex);
      cellData[rowIndex][columnIndex] =
        value.trim().startsWith('=')
          ? { f: value, s: style }
          : { v: value, t: CellValueType.STRING, s: style };
    });
  });

  return {
    id: workbook.id,
    name: workbook.sheetName,
    appVersion: '0.24.0',
    locale: LocaleType.ZH_CN,
    styles,
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: workbook.sheetName,
        tabColor: '#111111',
        hidden: BooleanNumber.FALSE,
        freeze: {
          xSplit: workbook.freeze.xSplit,
          ySplit: workbook.freeze.ySplit,
          startColumn: workbook.freeze.xSplit > 0 ? workbook.freeze.xSplit : -1,
          startRow: workbook.freeze.ySplit > 0 ? workbook.freeze.ySplit : -1
        },
        rowCount: Math.max(100, workbook.rows.length + 20),
        columnCount: Math.max(26, workbook.columns.length + 10),
        zoomRatio: 1,
        scrollTop: 0,
        scrollLeft: 0,
        defaultColumnWidth: 120,
        defaultRowHeight: 28,
        mergeData: [],
        cellData,
        rowData: workbook.rows.reduce<Record<number, { h: number }>>((rows, row, index) => {
          const height = row.height ?? (index === 0 ? 34 : undefined);
          if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
            rows[index] = { h: height };
          }
          return rows;
        }, {}),
        columnData: workbook.columns.reduce<Record<number, { w: number }>>((columns, column, index) => {
          columns[index] = { w: column.width };
          return columns;
        }, {}),
        rowHeader: { width: 46 },
        columnHeader: { height: 26 },
        showGridlines: BooleanNumber.TRUE,
        rightToLeft: BooleanNumber.FALSE
      }
    }
  };
}

export function fromUniverWorkbookData(snapshot: IWorkbookData): ResearchWorkbook {
  const sheetId = snapshot.sheetOrder[0];
  const sheet = sheetId ? snapshot.sheets[sheetId] : undefined;
  if (!sheet) {
    return buildDefaultResearchWorkbook();
  }

  const rowCount = Math.max(1, Number(sheet.rowCount) || 1);
  const columnCount = getMeaningfulColumnCount(sheet);
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const fallback = RESEARCH_SHEET_COLUMNS[index];
    const header = readCellText(sheet.cellData?.[0]?.[index]) || fallback?.label || `列 ${index + 1}`;
    return {
      key: fallback?.key ?? `custom-${index}`,
      label: header,
      width: Number(sheet.columnData?.[index]?.w) || fallback?.width || 140
    };
  });
  const allRows = Array.from({ length: rowCount }, (_, rowIndex) => ({
    id: rowIndex === 0 ? 'header' : `row-${rowIndex}`,
    height: Number(sheet.rowData?.[rowIndex]?.h) || undefined,
    cells: columns.map((_, columnIndex) => ({
      value: readCellText(sheet.cellData?.[rowIndex]?.[columnIndex]),
      style: readCellStyle(sheet.cellData?.[rowIndex]?.[columnIndex])
    }))
  }));
  let lastUsedRowIndex = 0;
  allRows.forEach((row, index) => {
    if (index === 0 || row.cells.some((cell) => cell.value.trim() || cell.style?.univerStyle)) {
      lastUsedRowIndex = index;
    }
  });
  const rows = allRows.slice(0, lastUsedRowIndex + 1);

  return {
    id: snapshot.id || 'research-workbook',
    sheetName: snapshot.name || sheet.name || '论文研究表',
    styles: snapshot.styles,
    freeze: {
      ySplit: Math.max(1, Number(sheet.freeze?.ySplit) || 1),
      xSplit: Math.max(0, Number(sheet.freeze?.xSplit) || 0)
    },
    columns,
    rows: normalizeRows(rows, columns)
  };
}

function buildPaperRow(rowId: string, paper: PaperRecord, columns: ResearchSheetColumn[]): ResearchRow {
  const values: Partial<Record<ResearchColumnKey, string>> = {
    paper: paper.pdfName || paper.englishTitle,
    chineseTitle: paper.chineseTitle,
    englishTitle: paper.englishTitle,
    notes: paper.notes
  };

  return {
    id: rowId,
    cells: columns.map((column) => ({
      value: values[column.key as ResearchColumnKey] ?? ''
    }))
  };
}

function normalizeRows(rows: ResearchRow[], columns: ResearchSheetColumn[]): ResearchRow[] {
  const normalized = rows.map((row, index) => ({
    id: row.id || (index === 0 ? 'header' : `row-${index}`),
    height: row.height,
    cells: normalizeCells(row.cells, columns)
  }));

  if (normalized[0]?.id === 'header') {
    return normalized;
  }

  return [...buildDefaultResearchWorkbook().rows, ...normalized];
}

function normalizeCells(cells: ResearchCell[], columns: ResearchSheetColumn[]): ResearchCell[] {
  return columns.map((_, index) => ({
    value: cells[index]?.value ?? '',
    style: cells[index]?.style
  }));
}

function ensureRows(rows: ResearchRow[], columns: ResearchSheetColumn[], rowIndex: number): ResearchRow[] {
  if (rowIndex < rows.length) {
    return rows;
  }

  const nextRows = [...rows];
  for (let index = nextRows.length; index <= rowIndex; index += 1) {
    nextRows.push({
      id: `row-${index}`,
      cells: columns.map(() => ({ value: '' }))
    });
  }

  return nextRows;
}

function getMeaningfulColumnCount(sheet: IWorkbookData['sheets'][string]): number {
  const usedIndexes = new Set<number>();

  Object.keys(sheet.columnData ?? {}).forEach((key) => {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0) {
      usedIndexes.add(index);
    }
  });

  Object.values(sheet.cellData ?? {}).forEach((row) => {
    Object.entries(row ?? {}).forEach(([key, cell]) => {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) {
        return;
      }

      const typedCell = cell as ICellData | undefined;
      if (readCellText(typedCell).trim() || typedCell?.s) {
        usedIndexes.add(index);
      }
    });
  });

  const highestUsedIndex = usedIndexes.size > 0 ? Math.max(...usedIndexes) : -1;
  return Math.max(RESEARCH_SHEET_COLUMNS.length, highestUsedIndex + 1);
}

function parseRow(value: unknown): ResearchRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (!id) {
    return null;
  }

  const cells = Array.isArray(value.cells)
    ? value.cells.map((cell) =>
        isRecord(cell)
          ? {
              value: readString(cell.value),
              style: parseCellStyle(cell.style)
            }
          : { value: '' }
      )
    : [];

  return {
    id,
    height: typeof value.height === 'number' && Number.isFinite(value.height) ? value.height : undefined,
    cells
  };
}

function parseColumn(value: unknown): ResearchSheetColumn | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = readString(value.label);
  if (!label) {
    return null;
  }

  return {
    key: readString(value.key) || label,
    label,
    width: Math.max(60, Number(value.width) || 140)
  };
}

function getCellUniverStyle(cell: ResearchCell, rowIndex: number): ICellData['s'] {
  if (cell.style?.univerStyle) {
    return cell.style.univerStyle;
  }

  const style = toUniverStyle(cell.style);
  if (style) {
    return style;
  }

  return rowIndex === 0 ? 'header' : 'normal';
}

function toUniverStyle(style: ResearchCellStyle | undefined): IStyleData | null {
  if (!style) {
    return null;
  }

  return {
    fs: style.fontSize,
    bl: style.bold === undefined ? undefined : style.bold ? BooleanNumber.TRUE : BooleanNumber.FALSE,
    it: style.italic === undefined ? undefined : style.italic ? BooleanNumber.TRUE : BooleanNumber.FALSE,
    cl: style.color ? { rgb: style.color } : undefined,
    bg: style.backgroundColor ? { rgb: style.backgroundColor } : undefined,
    ht: style.align === 'left' ? 1 : style.align === 'center' ? 2 : style.align === 'right' ? 3 : undefined,
    vt: 2
  };
}

function readCellStyle(cell: ICellData | undefined): ResearchCellStyle | undefined {
  if (!cell?.s) {
    return undefined;
  }

  return {
    univerStyle: cell.s
  };
}

function parseCellStyle(value: unknown): ResearchCellStyle | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const style: ResearchCellStyle = {};
  if (typeof value.fontSize === 'number') {
    style.fontSize = value.fontSize;
  }
  if (typeof value.color === 'string') {
    style.color = value.color;
  }
  if (typeof value.backgroundColor === 'string') {
    style.backgroundColor = value.backgroundColor;
  }
  if (typeof value.bold === 'boolean') {
    style.bold = value.bold;
  }
  if (typeof value.italic === 'boolean') {
    style.italic = value.italic;
  }
  if (value.align === 'left' || value.align === 'center' || value.align === 'right') {
    style.align = value.align;
  }
  if (typeof value.univerStyle === 'string' || isRecord(value.univerStyle)) {
    style.univerStyle = value.univerStyle as ICellData['s'];
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function readCellText(cell: ICellData | undefined): string {
  if (!cell) {
    return '';
  }

  if (typeof cell.f === 'string' && cell.f) {
    return cell.f;
  }

  if (typeof cell.v === 'string') {
    return cell.v;
  }

  if (typeof cell.v === 'number' || typeof cell.v === 'boolean') {
    return String(cell.v);
  }

  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneUniverStyle(style: IStyleData): IStyleData {
  return JSON.parse(JSON.stringify(style)) as IStyleData;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
