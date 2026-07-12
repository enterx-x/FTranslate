import Papa from 'papaparse';
import type {
  PlotCell,
  PlotColumn,
  PlotColumnType,
  PlotDataSource,
  PlotDataTable,
  PlotTransformStep
} from '../../shared/scientificPlot';
import { assertPlotDataTable } from '../../shared/scientificPlot';
import type { ResearchWorkbook } from './researchWorkbook';

export interface ParseDelimitedPlotDataOptions {
  id: string;
  sourceName: string;
  createdAt?: string;
  delimiter?: string;
  source?: PlotDataSource;
}

export interface ParsePastedPlotDataOptions {
  id: string;
  createdAt?: string;
}

export interface ResearchSheetPlotRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  a1Notation?: string;
}

export interface PlotDataHealth {
  rowCount: number;
  columnCount: number;
  missingCellCount: number;
  duplicateRowCount: number;
  sampled: boolean;
  fields: Array<{
    id: string;
    type: PlotColumnType;
    missingCount: number;
    uniqueCount: number;
  }>;
}

export interface PlotTransformRecord {
  stepId: string;
  label: string;
  status: 'applied' | 'skipped' | 'failed';
  inputRows: number;
  outputRows: number;
  message: string;
}

export interface PlotTransformResult {
  table: PlotDataTable;
  records: PlotTransformRecord[];
}

export function parseDelimitedPlotData(
  input: string,
  options: ParseDelimitedPlotDataOptions
): PlotDataTable {
  const text = input.replace(/^\uFEFF/, '');
  const parsed = Papa.parse<string[]>(text, {
    delimiter: options.delimiter,
    skipEmptyLines: 'greedy'
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`无法解析表格数据：${first.message}${first.row !== undefined ? `（第 ${first.row + 1} 行）` : ''}`);
  }
  if (parsed.data.length < 1) {
    throw new Error('表格数据为空。');
  }

  const rawHeaders = parsed.data[0].map((value) => String(value ?? '').trim());
  if (rawHeaders.every((value) => !value)) {
    throw new Error('表头不能为空。');
  }
  const headers = normalizeHeaders(rawHeaders);
  const rawRows = parsed.data
    .slice(1)
    .map((row) => normalizeRawRow(row, headers.length))
    .filter((row) => row.some((value) => value.trim() !== ''));

  return createTypedTable(
    headers,
    rawRows,
    options.id,
    options.source ?? inferFileSource(options.sourceName, options.delimiter),
    options.createdAt
  );
}

export function parsePastedPlotData(input: string, options: ParsePastedPlotDataOptions): PlotDataTable {
  return parseDelimitedPlotData(input, {
    id: options.id,
    sourceName: '剪贴板数据',
    createdAt: options.createdAt,
    delimiter: input.includes('\t') ? '\t' : undefined,
    source: { kind: 'paste', name: '剪贴板数据' }
  });
}

export function plotDataFromResearchWorkbook(
  workbook: ResearchWorkbook,
  range: ResearchSheetPlotRange | undefined,
  options: { id: string; createdAt?: string }
): PlotDataTable {
  if (workbook.columns.length === 0) throw new Error('研究表格没有可导入的列。');
  const startColumn = clampInteger(range?.startColumn ?? 0, 0, workbook.columns.length - 1);
  const endColumn = clampInteger(
    range?.endColumn ?? workbook.columns.length - 1,
    startColumn,
    workbook.columns.length - 1
  );
  const firstDataRow = Math.max(1, range?.startRow ?? 1);
  const lastDataRow = clampInteger(
    range?.endRow ?? workbook.rows.length - 1,
    firstDataRow,
    Math.max(firstDataRow, workbook.rows.length - 1)
  );
  const headers = normalizeHeaders(
    workbook.columns.slice(startColumn, endColumn + 1).map((column) => column.label || String(column.key))
  );
  const rawRows = workbook.rows
    .slice(firstDataRow, lastDataRow + 1)
    .map((row) =>
      row.cells
        .slice(startColumn, endColumn + 1)
        .map((cell) => String(cell?.value ?? ''))
    );

  return createTypedTable(
    headers,
    rawRows,
    options.id,
    {
      kind: 'researchSheet',
      name: workbook.sheetName,
      workbookId: workbook.id,
      sheetName: workbook.sheetName,
      range: range?.a1Notation
    },
    options.createdAt
  );
}

export function auditPlotData(table: PlotDataTable): PlotDataHealth {
  assertPlotDataTable(table);
  const seenRows = new Set<string>();
  let duplicateRowCount = 0;
  let missingCellCount = 0;
  const fieldValues = table.columns.map(() => new Set<string>());
  const fieldMissing = table.columns.map(() => 0);

  table.rows.forEach((row) => {
    const rowKey = JSON.stringify(row);
    if (seenRows.has(rowKey)) duplicateRowCount += 1;
    else seenRows.add(rowKey);
    row.forEach((value, columnIndex) => {
      if (value === null || value === '') {
        missingCellCount += 1;
        fieldMissing[columnIndex] += 1;
      } else {
        fieldValues[columnIndex].add(stableCellKey(value));
      }
    });
  });

  return {
    rowCount: table.rows.length,
    columnCount: table.columns.length,
    missingCellCount,
    duplicateRowCount,
    sampled: table.sampled === true,
    fields: table.columns.map((column, index) => ({
      id: column.id,
      type: column.type,
      missingCount: fieldMissing[index],
      uniqueCount: fieldValues[index].size
    }))
  };
}

export function applyPlotTransforms(
  source: PlotDataTable,
  steps: PlotTransformStep[]
): PlotTransformResult {
  assertPlotDataTable(source);
  let table = cloneTable(source);
  const records: PlotTransformRecord[] = [];
  let blocked = false;

  for (const step of steps) {
    const inputRows = table.rows.length;
    if (!step.enabled || blocked) {
      records.push({
        stepId: step.id,
        label: step.label,
        status: 'skipped',
        inputRows,
        outputRows: inputRows,
        message: blocked ? '前一步失败，未继续执行。' : '该步骤已禁用。'
      });
      continue;
    }
    try {
      table = applyTransform(table, step);
      assertPlotDataTable(table);
      records.push({
        stepId: step.id,
        label: step.label,
        status: 'applied',
        inputRows,
        outputRows: table.rows.length,
        message: `已应用，${inputRows} 行 → ${table.rows.length} 行。`
      });
    } catch (error) {
      blocked = true;
      records.push({
        stepId: step.id,
        label: step.label,
        status: 'failed',
        inputRows,
        outputRows: inputRows,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { table, records };
}

export async function hashPlotDataTable(table: PlotDataTable): Promise<string> {
  assertPlotDataTable(table);
  const stable = JSON.stringify({
    id: table.id,
    source: table.source,
    columns: table.columns,
    rows: table.rows,
    createdAt: table.createdAt,
    sampled: table.sampled ?? false,
    totalRowCount: table.totalRowCount
  });
  const bytes = new TextEncoder().encode(stable);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return fallbackHash(bytes);
}

function applyTransform(table: PlotDataTable, step: PlotTransformStep): PlotDataTable {
  switch (step.type) {
    case 'rename':
      return renameField(table, step.params);
    case 'cast':
      return castField(table, step.params);
    case 'missing':
      return handleMissing(table, step.params);
    case 'filter':
      return filterRows(table, step.params);
    case 'sort':
      return sortRows(table, step.params);
    case 'groupAggregate':
      return groupAggregate(table, step.params);
    case 'wideToLong':
      return wideToLong(table, step.params);
    case 'longToWide':
      return longToWide(table, step.params);
    case 'derive':
      return deriveField(table, step.params);
    case 'categoryOrder':
      return categoryOrder(table, step.params);
    case 'sample':
      return sampleRows(table, step.params);
    case 'append':
      return appendTable(table, step.params);
    case 'join':
      return joinTable(table, step.params);
    default:
      throw new Error(`尚不支持转换：${String(step.type)}`);
  }
}

function renameField(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const field = requireField(params.field);
  const label = requireString(params.label, '新字段名');
  return {
    ...cloneTable(table),
    columns: table.columns.map((column) => column.id === field ? { ...column, label } : { ...column })
  };
}

function castField(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const field = requireField(params.field);
  const type = requireString(params.targetType, '目标类型') as PlotColumnType;
  if (!['number', 'integer', 'category', 'string', 'boolean', 'date'].includes(type)) {
    throw new Error(`不支持的字段类型：${type}`);
  }
  const index = requireColumnIndex(table, field);
  const rows = table.rows.map((row) => row.map((value, columnIndex) =>
    columnIndex === index ? castValue(value, type) : value
  ));
  return {
    ...cloneTable(table),
    columns: table.columns.map((column, columnIndex) => columnIndex === index ? { ...column, type } : { ...column }),
    rows
  };
}

function handleMissing(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const field = requireField(params.field);
  const index = requireColumnIndex(table, field);
  const strategy = requireString(params.strategy, '缺失值策略');
  if (strategy === 'dropRows') {
    return { ...cloneTable(table), rows: table.rows.filter((row) => row[index] !== null && row[index] !== '') };
  }
  if (strategy === 'replace') {
    const replacement = normalizeCell(params.value);
    return {
      ...cloneTable(table),
      rows: table.rows.map((row) => row.map((value, columnIndex) =>
        columnIndex === index && (value === null || value === '') ? replacement : value
      ))
    };
  }
  if (strategy === 'keep') return cloneTable(table);
  throw new Error(`不支持的缺失值策略：${strategy}`);
}

function filterRows(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const field = requireField(params.field);
  const index = requireColumnIndex(table, field);
  const operator = requireString(params.operator, '筛选操作');
  const expected = normalizeCell(params.value);
  const rows = table.rows.filter((row) => compare(row[index], operator, expected));
  return { ...cloneTable(table), rows: rows.map((row) => [...row]) };
}

function sortRows(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const field = requireField(params.field);
  const index = requireColumnIndex(table, field);
  const direction = params.direction === 'descending' ? -1 : 1;
  const rows = table.rows.map((row) => [...row]).sort((left, right) => compareCells(left[index], right[index]) * direction);
  return { ...cloneTable(table), rows };
}

function wideToLong(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const idFields = requireStringArray(params.idFields, '标识字段');
  const valueFields = requireStringArray(params.valueFields, '数值字段');
  const variableField = requireString(params.variableField, '变量字段');
  const valueField = requireString(params.valueField, '值字段');
  const idIndexes = idFields.map((field) => requireColumnIndex(table, field));
  const valueIndexes = valueFields.map((field) => requireColumnIndex(table, field));
  const rows: PlotCell[][] = [];
  table.rows.forEach((row) => {
    valueFields.forEach((field, offset) => {
      rows.push([...idIndexes.map((index) => row[index]), field, row[valueIndexes[offset]]]);
    });
  });
  const columns: PlotColumn[] = [
    ...idFields.map((field, index) => ({ ...table.columns[idIndexes[index]] })),
    { id: uniqueFieldId(table, variableField, idFields), label: variableField, type: 'category' },
    { id: uniqueFieldId(table, valueField, [...idFields, variableField]), label: valueField, type: inferColumnType(rows.map((row) => rawString(row[row.length - 1]))) }
  ];
  return { ...cloneTable(table), columns, rows };
}

function longToWide(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const idFields = requireStringArray(params.idFields, '标识字段');
  const variableField = requireField(params.variableField);
  const valueField = requireField(params.valueField);
  const idIndexes = idFields.map((field) => requireColumnIndex(table, field));
  const variableIndex = requireColumnIndex(table, variableField);
  const valueIndex = requireColumnIndex(table, valueField);
  const variables = [...new Set(table.rows.map((row) => String(row[variableIndex] ?? '')))].filter(Boolean);
  const grouped = new Map<string, PlotCell[]>();
  table.rows.forEach((row) => {
    const ids = idIndexes.map((index) => row[index]);
    const key = JSON.stringify(ids);
    const output = grouped.get(key) ?? [...ids, ...variables.map(() => null)];
    const variableOffset = variables.indexOf(String(row[variableIndex] ?? ''));
    if (variableOffset >= 0) output[idFields.length + variableOffset] = row[valueIndex];
    grouped.set(key, output);
  });
  const columns = [
    ...idFields.map((field, index) => ({ ...table.columns[idIndexes[index]] })),
    ...variables.map((variable) => ({ id: safeHeaderId(variable), label: variable, type: table.columns[valueIndex].type }))
  ];
  return { ...cloneTable(table), columns, rows: [...grouped.values()] };
}

function deriveField(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const outputField = requireString(params.outputField, '派生字段');
  const field = requireField(params.field);
  const fieldIndex = requireColumnIndex(table, field);
  const operation = requireString(params.operation, '派生操作');
  const operand = Number(params.value);
  if (!Number.isFinite(operand)) throw new Error('派生操作数必须是有限数值。');
  const rows = table.rows.map((row) => {
    const current = Number(row[fieldIndex]);
    let value: PlotCell = null;
    if (Number.isFinite(current)) {
      if (operation === 'multiply') value = current * operand;
      else if (operation === 'divide') value = operand === 0 ? null : current / operand;
      else if (operation === 'add') value = current + operand;
      else if (operation === 'subtract') value = current - operand;
      else throw new Error(`不支持的派生操作：${operation}`);
    }
    return [...row, value];
  });
  const id = uniqueFieldId(table, outputField);
  return {
    ...cloneTable(table),
    columns: [...table.columns.map((column) => ({ ...column })), { id, label: outputField, type: 'number' }],
    rows
  };
}

function groupAggregate(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const groupBy = requireStringArray(params.groupBy, '分组字段');
  const valueField = requireField(params.valueField);
  const operation = requireString(params.operation, '聚合操作');
  const outputField = requireString(params.outputField, '输出字段');
  const groupIndexes = groupBy.map((field) => requireColumnIndex(table, field));
  const valueIndex = requireColumnIndex(table, valueField);
  const groups = new Map<string, { keys: PlotCell[]; values: number[] }>();
  table.rows.forEach((row) => {
    const keys = groupIndexes.map((index) => row[index]);
    const key = JSON.stringify(keys);
    const group = groups.get(key) ?? { keys, values: [] };
    const value = Number(row[valueIndex]);
    if (Number.isFinite(value)) group.values.push(value);
    groups.set(key, group);
  });
  const rows = [...groups.values()].map((group) => [...group.keys, aggregate(group.values, operation)]);
  const columns: PlotColumn[] = [
    ...groupBy.map((field, index) => ({ ...table.columns[groupIndexes[index]] })),
    { id: safeHeaderId(outputField), label: outputField, type: operation === 'count' ? 'integer' : 'number' }
  ];
  return { ...cloneTable(table), columns, rows };
}

function categoryOrder(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const field = requireField(params.field);
  const order = requireStringArray(params.order, '分类顺序');
  const index = requireColumnIndex(table, field);
  const ranks = new Map(order.map((value, rank) => [value, rank]));
  const rows = table.rows.map((row) => [...row]).sort((left, right) =>
    (ranks.get(String(left[index])) ?? Number.MAX_SAFE_INTEGER) -
    (ranks.get(String(right[index])) ?? Number.MAX_SAFE_INTEGER)
  );
  return { ...cloneTable(table), rows };
}

function sampleRows(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const size = Math.max(1, Math.floor(Number(params.size) || 0));
  const method = params.method === 'systematic' ? 'systematic' : 'head';
  if (size >= table.rows.length) return cloneTable(table);
  const rows = method === 'head'
    ? table.rows.slice(0, size)
    : Array.from({ length: size }, (_, index) => table.rows[Math.floor(index * table.rows.length / size)]);
  return { ...cloneTable(table), rows: rows.map((row) => [...row]), sampled: true, totalRowCount: table.rows.length };
}

function appendTable(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const other = params.table;
  if (!assertPlotDataTable(other)) throw new Error('追加数据无效。');
  if (JSON.stringify(table.columns.map(({ id, type }) => ({ id, type }))) !== JSON.stringify(other.columns.map(({ id, type }) => ({ id, type })))) {
    throw new Error('追加数据的字段与类型必须完全一致。');
  }
  return { ...cloneTable(table), rows: [...table.rows, ...other.rows].map((row) => [...row]) };
}

function joinTable(table: PlotDataTable, params: Record<string, unknown>): PlotDataTable {
  const other = params.table;
  if (!assertPlotDataTable(other)) throw new Error('连接数据无效。');
  const leftField = requireField(params.leftField);
  const rightField = requireString(params.rightField, '右侧连接字段');
  const leftIndex = requireColumnIndex(table, leftField);
  const rightIndex = requireColumnIndex(other, rightField);
  const rightLookup = new Map(other.rows.map((row) => [stableCellKey(row[rightIndex]), row]));
  const rightColumns = other.columns.filter((_, index) => index !== rightIndex);
  const rightIndexes = other.columns.map((_, index) => index).filter((index) => index !== rightIndex);
  const rows = table.rows.map((row) => {
    const match = rightLookup.get(stableCellKey(row[leftIndex]));
    return [...row, ...rightIndexes.map((index) => match?.[index] ?? null)];
  });
  return { ...cloneTable(table), columns: [...table.columns, ...rightColumns].map((column) => ({ ...column })), rows };
}

function createTypedTable(
  headers: Array<{ id: string; label: string }>,
  rawRows: string[][],
  id: string,
  source: PlotDataSource,
  createdAt?: string
): PlotDataTable {
  const types = headers.map((_, index) => inferColumnType(rawRows.map((row) => row[index] ?? '')));
  const columns: PlotColumn[] = headers.map((header, index) => ({ ...header, type: types[index] }));
  const rows: PlotCell[][] = rawRows.map((row) => row.map((value, index) => convertRawValue(value, types[index])));
  const table: PlotDataTable = {
    id,
    source,
    columns,
    rows,
    createdAt: createdAt ?? new Date().toISOString()
  };
  assertPlotDataTable(table);
  return table;
}

function inferColumnType(values: string[]): PlotColumnType {
  const present = values.map((value) => value.trim()).filter(Boolean);
  if (present.length === 0) return 'string';
  if (present.every((value) => /^(true|false)$/i.test(value))) return 'boolean';
  if (present.every((value) => isFiniteNumericText(value))) {
    return present.every((value) => Number.isInteger(Number(value))) ? 'integer' : 'number';
  }
  if (present.every((value) => /^\d{4}-\d{2}-\d{2}(?:[T ][^\s]+)?$/.test(value) && Number.isFinite(Date.parse(value)))) {
    return 'date';
  }
  const unique = new Set(present).size;
  return unique <= Math.max(20, Math.ceil(present.length * 0.5)) ? 'category' : 'string';
}

function convertRawValue(value: string, type: PlotColumnType): PlotCell {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (type === 'boolean') return trimmed.toLowerCase() === 'true';
  if (type === 'number' || type === 'integer') return Number(trimmed);
  return trimmed;
}

function normalizeHeaders(headers: string[]): Array<{ id: string; label: string }> {
  const used = new Map<string, number>();
  return headers.map((label, index) => {
    const normalizedLabel = label || `字段 ${index + 1}`;
    const base = safeHeaderId(normalizedLabel) || `field_${index + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return { id: count === 1 ? base : `${base}_${count}`, label: normalizedLabel };
  });
}

function safeHeaderId(value: string): string {
  return value
    .trim()
    .replace(/[\s/\\]+/g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '') || 'field';
}

function normalizeRawRow(row: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => String(row[index] ?? ''));
}

function inferFileSource(sourceName: string, delimiter?: string): PlotDataSource {
  const extension = sourceName.toLowerCase().split('.').pop();
  return {
    kind: 'file',
    name: sourceName,
    mimeType: delimiter === '\t' || extension === 'tsv' ? 'text/tab-separated-values' : 'text/csv'
  };
}

function requireField(value: unknown): string {
  return requireString(value, '字段');
}

function requireColumnIndex(table: PlotDataTable, field: string): number {
  const index = table.columns.findIndex((column) => column.id === field);
  if (index < 0) throw new Error(`字段不存在：${field}`);
  return index;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空。`);
  return value.trim();
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label}必须是非空字段列表。`);
  }
  return value.map((item) => String(item).trim());
}

function normalizeCell(value: unknown): PlotCell {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('转换参数中的单元格值无效。');
}

function castValue(value: PlotCell, type: PlotColumnType): PlotCell {
  if (value === null) return null;
  if (type === 'string' || type === 'category' || type === 'date') return String(value);
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (/^(true|1|yes)$/i.test(String(value))) return true;
    if (/^(false|0|no)$/i.test(String(value))) return false;
    throw new Error(`无法把“${String(value)}”转换为布尔值。`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`无法把“${String(value)}”转换为数值。`);
  return type === 'integer' ? Math.trunc(number) : number;
}

function compare(actual: PlotCell, operator: string, expected: PlotCell): boolean {
  if (operator === 'equals') return actual === expected || String(actual) === String(expected);
  if (operator === 'notEquals') return !compare(actual, 'equals', expected);
  if (operator === 'contains') return String(actual ?? '').includes(String(expected ?? ''));
  if (operator === 'isMissing') return actual === null || actual === '';
  if (operator === 'isNotMissing') return actual !== null && actual !== '';
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === 'greaterThan') return left > right;
  if (operator === 'greaterOrEqual') return left >= right;
  if (operator === 'lessThan') return left < right;
  if (operator === 'lessOrEqual') return left <= right;
  throw new Error(`不支持的筛选操作：${operator}`);
}

function compareCells(left: PlotCell, right: PlotCell): number {
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
}

function aggregate(values: number[], operation: string): number | null {
  if (operation === 'count') return values.length;
  if (values.length === 0) return null;
  if (operation === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (operation === 'mean') return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (operation === 'min') return Math.min(...values);
  if (operation === 'max') return Math.max(...values);
  if (operation === 'median') {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  if (operation === 'sd') {
    if (values.length < 2) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  }
  throw new Error(`不支持的聚合操作：${operation}`);
}

function cloneTable(table: PlotDataTable): PlotDataTable {
  return {
    ...table,
    source: { ...table.source },
    columns: table.columns.map((column) => ({ ...column })),
    rows: table.rows.map((row) => [...row])
  };
}

function uniqueFieldId(table: PlotDataTable, value: string, additional: string[] = []): string {
  const base = safeHeaderId(value);
  const used = new Set([...table.columns.map((column) => column.id), ...additional]);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function stableCellKey(value: PlotCell): string {
  return `${typeof value}:${String(value)}`;
}

function rawString(value: PlotCell): string {
  return value === null ? '' : String(value);
}

function isFiniteNumericText(value: string): boolean {
  if (!value.trim()) return false;
  const number = Number(value);
  return Number.isFinite(number);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function fallbackHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  });
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}
