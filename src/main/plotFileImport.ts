import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { assertPlotDataTable, type PlotCell, type PlotColumn, type PlotColumnType, type PlotDataTable } from '../shared/scientificPlot';

export interface PlotDataFileSelection {
  filePath: string;
  fileName: string;
  kind: 'delimited' | 'excel';
  sheets: string[];
}

export interface PlotDataFileReadRequest {
  filePath: string;
  sheetName?: string;
  headerRow?: number;
  delimiter?: string;
  encoding?: BufferEncoding;
}

const MAX_PLOT_FILE_BYTES = 200 * 1024 * 1024;

export class PlotFileImportService {
  private readonly authorizedPaths = new Set<string>();

  async authorize(filePath: string): Promise<PlotDataFileSelection> {
    const normalized = path.resolve(filePath);
    const extension = path.extname(normalized).toLowerCase();
    if (!['.csv', '.tsv', '.txt', '.xlsx'].includes(extension)) throw new Error('仅支持 CSV、TSV、TXT 和 XLSX 数据文件。');
    const info = await stat(normalized);
    if (!info.isFile() || info.size > MAX_PLOT_FILE_BYTES) throw new Error('数据文件不存在或超过 200 MB。');
    this.authorizedPaths.add(normalized.toLowerCase());
    const sheets = extension === '.xlsx' ? await listExcelSheets(normalized) : [];
    return { filePath: normalized, fileName: path.basename(normalized), kind: extension === '.xlsx' ? 'excel' : 'delimited', sheets };
  }

  async read(request: PlotDataFileReadRequest): Promise<PlotDataTable> {
    const filePath = path.resolve(request.filePath);
    if (!this.authorizedPaths.has(filePath.toLowerCase())) throw new Error('该数据路径尚未通过文件选择对话框授权。');
    const extension = path.extname(filePath).toLowerCase();
    const raw = extension === '.xlsx'
      ? await readExcelRows(filePath, request.sheetName, request.headerRow)
      : await readDelimitedRows(filePath, request.delimiter, request.encoding);
    const table = typedTable(raw.headers, raw.rows, {
      kind: 'file',
      name: path.basename(filePath),
      filePath,
      sheetName: raw.sheetName,
      mimeType: extension === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : extension === '.tsv' ? 'text/tab-separated-values' : 'text/csv'
    });
    assertPlotDataTable(table);
    return table;
  }
}

async function listExcelSheets(filePath: string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.worksheets.map((sheet) => sheet.name);
}

async function readExcelRows(filePath: string, sheetName?: string, headerRow = 1): Promise<{ headers: string[]; rows: string[][]; sheetName: string }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!sheet) throw new Error(`Excel 工作表不存在：${sheetName ?? '(first sheet)'}`);
  const header = sheet.getRow(Math.max(1, headerRow));
  const columnCount = Math.max(header.cellCount, sheet.columnCount);
  const headers = Array.from({ length: columnCount }, (_, index) => excelCellText(header.getCell(index + 1).value));
  const rows: string[][] = [];
  for (let rowIndex = Math.max(1, headerRow) + 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = Array.from({ length: columnCount }, (_, index) => excelCellText(sheet.getRow(rowIndex).getCell(index + 1).value));
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return { headers, rows, sheetName: sheet.name };
}

async function readDelimitedRows(filePath: string, delimiter?: string, encoding: BufferEncoding = 'utf8'): Promise<{ headers: string[]; rows: string[][]; sheetName: string }> {
  const text = (await readFile(filePath)).toString(encoding).replace(/^\uFEFF/, '');
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error(`CSV/TSV 解析失败：${parsed.errors[0].message}`);
  if (!parsed.data.length) throw new Error('数据文件为空。');
  const headers = parsed.data[0].map(String);
  const rows = parsed.data.slice(1).map((row) => Array.from({ length: headers.length }, (_, index) => String(row[index] ?? '')));
  return { headers, rows, sheetName: '' };
}

function typedTable(headers: string[], rows: string[][], source: PlotDataTable['source']): PlotDataTable {
  const normalized = normalizeHeaders(headers);
  const types = normalized.map((_, index) => inferType(rows.map((row) => row[index] ?? '')));
  const columns: PlotColumn[] = normalized.map((header, index) => ({ ...header, type: types[index] }));
  const converted: PlotCell[][] = rows.map((row) => row.map((value, index) => convert(value, types[index])));
  return { id: `data-${randomUUID()}`, source, columns, rows: converted, createdAt: new Date().toISOString() };
}

function normalizeHeaders(headers: string[]): Array<{ id: string; label: string }> {
  const used = new Map<string, number>();
  return headers.map((header, index) => {
    const label = header.trim() || `字段 ${index + 1}`;
    const base = label.replace(/[\s/\\]+/g, '_').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || `field_${index + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return { id: count === 1 ? base : `${base}_${count}`, label };
  });
}

function inferType(values: string[]): PlotColumnType {
  const present = values.map((value) => value.trim()).filter(Boolean);
  if (!present.length) return 'string';
  if (present.every((value) => /^(true|false)$/i.test(value))) return 'boolean';
  if (present.every((value) => Number.isFinite(Number(value)))) return present.every((value) => Number.isInteger(Number(value))) ? 'integer' : 'number';
  return new Set(present).size <= Math.max(20, Math.ceil(present.length * .5)) ? 'category' : 'string';
}

function convert(value: string, type: PlotColumnType): PlotCell {
  const text = value.trim();
  if (!text) return null;
  if (type === 'boolean') return text.toLowerCase() === 'true';
  if (type === 'number' || type === 'integer') return Number(text);
  return text;
}

function excelCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return String(value.result ?? '');
    if ('text' in value) return String(value.text ?? '');
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join('');
    return '';
  }
  return String(value);
}
