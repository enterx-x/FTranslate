import type { PaperRecord } from './papers';

export interface BuildSheetCellPromptInput {
  paper: PaperRecord;
  columnHeader: string;
  cellAddress: string;
  currentCellText: string;
  neighborRowValues: Record<string, string>;
  paperContext?: string;
}

export interface SheetCellTarget {
  rowIndex: number;
  columnIndex: number;
  cellAddress: string;
  columnHeader: string;
  currentCellText: string;
  neighborRowValues: Record<string, string>;
}

export interface BuildSheetCellsPromptInput {
  paper: PaperRecord;
  cells: SheetCellTarget[];
}

export interface SheetCellPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export function buildSheetCellPrompt(input: BuildSheetCellPromptInput): SheetCellPrompt {
  return buildSheetCellsPrompt({
    paper: input.paper,
    cells: [
      {
        rowIndex: 0,
        columnIndex: 0,
        cellAddress: input.cellAddress,
        columnHeader: input.columnHeader,
        currentCellText: input.currentCellText,
        neighborRowValues: input.neighborRowValues
      }
    ]
  });
}

export function buildSheetCellsPrompt(input: BuildSheetCellsPromptInput): SheetCellPrompt {
  const isSingleCell = input.cells.length === 1;
  return {
    systemPrompt: [
      '你是严谨的科研论文研究表格助手。',
      isSingleCell
        ? '你只负责填写当前选中的一个单元格，不能改写其它单元格。'
        : '你只负责填写用户选中的这些单元格，不能新增、删除或改写其它单元格。',
      '输出要简洁、可直接放进电子表格单元格。',
      '如果涉及数学公式，请保留 LaTeX 定界符，例如 $L=\\sum_i x_i^2$。',
      isSingleCell
        ? '不要输出 Markdown 表格，不要解释过程。'
        : '必须输出 JSON 数组，不要 Markdown 代码块，不要解释过程。'
    ].join('\n'),
    userPrompt: [
      isSingleCell ? formatSingleCellTarget(input.cells[0]) : formatMultiCellTargets(input.cells),
      '',
      formatPaperInfo(input.paper),
      '',
      isSingleCell
        ? '只输出该单元格内容。'
        : '输出格式必须是 JSON 数组，例如 [{"cellAddress":"D2","value":"..."}]。每个选中单元格都必须返回一项。'
    ].join('\n')
  };
}

export function parseSheetCellsAiResponse(responseText: string, cells: SheetCellTarget[]): Array<{
  cellAddress: string;
  value: string;
}> {
  const trimmed = stripCodeFence(responseText.trim());

  if (cells.length === 1) {
    const parsed = tryParseJsonCells(trimmed);
    if (parsed.length > 0) {
      return parsed;
    }

    return [{ cellAddress: cells[0].cellAddress, value: trimmed }];
  }

  const parsed = tryParseJsonCells(trimmed);
  if (parsed.length > 0) {
    return parsed;
  }

  return cells.map((cell) => ({
    cellAddress: cell.cellAddress,
    value: ''
  }));
}

function formatSingleCellTarget(cell: SheetCellTarget): string {
  return [
    `目标单元格：${cell.cellAddress} / ${cell.columnHeader}`,
    `当前单元格已有内容：${cell.currentCellText || '空'}`,
    '',
    '同一行已有信息：',
    formatNeighborValues(cell.neighborRowValues)
  ].join('\n');
}

function formatMultiCellTargets(cells: SheetCellTarget[]): string {
  return [
    '目标单元格列表：',
    ...cells.map((cell, index) =>
      [
        `${index + 1}. ${cell.cellAddress} / ${cell.columnHeader}`,
        `当前内容：${cell.currentCellText || '空'}`,
        '同行信息：',
        formatNeighborValues(cell.neighborRowValues)
      ].join('\n')
    )
  ].join('\n\n');
}

function formatPaperInfo(paper: PaperRecord): string {
  return [
    '论文信息：',
    `中文标题：${paper.chineseTitle || '未填写'}`,
    `英文标题：${paper.englishTitle || '未填写'}`,
    `期刊/来源：${paper.journal || '未填写'}`,
    `作者：${paper.authors || '未填写'}`,
    `年份：${paper.year || '未填写'}`,
    `阅读笔记：${paper.notes || '空'}`
  ].join('\n');
}

function formatNeighborValues(values: Record<string, string>): string {
  const entries = Object.entries(values)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}：${value}`);

  return entries.length > 0 ? entries.join('\n') : '空';
}

function tryParseJsonCells(value: string): Array<{ cellAddress: string; value: string }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const cellAddress = typeof record.cellAddress === 'string' ? record.cellAddress : '';
      const text = typeof record.value === 'string' ? record.value : '';
      return cellAddress ? [{ cellAddress, value: text }] : [];
    }
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const record = item as Record<string, unknown>;
        const cellAddress = typeof record.cellAddress === 'string' ? record.cellAddress : '';
        const text = typeof record.value === 'string' ? record.value : '';
        return cellAddress ? { cellAddress, value: text } : null;
      })
      .filter((item): item is { cellAddress: string; value: string } => Boolean(item));
  } catch {
    return [];
  }
}

function stripCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  return match ? match[1].trim() : value;
}
