import type { PaperRecord } from './papers';

export interface BuildSheetCellPromptInput {
  paper: PaperRecord;
  columnHeader: string;
  cellAddress: string;
  currentCellText: string;
  neighborRowValues: Record<string, string>;
  paperContext: string;
}

export interface SheetCellPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const MAX_CONTEXT_LENGTH = 9000;

export function buildSheetCellPrompt(input: BuildSheetCellPromptInput): SheetCellPrompt {
  return {
    systemPrompt: [
      '你是严谨的科研论文研究表格助手。',
      '你只负责填写当前选中的一个单元格，不能改写其它单元格。',
      '输出要简洁、可直接放进电子表格单元格。',
      '如果涉及数学公式，请保留 LaTeX 定界符，例如 $L=\\sum_i x_i^2$。',
      '不要输出 Markdown 表格，不要解释过程。'
    ].join('\n'),
    userPrompt: [
      `目标单元格：${input.cellAddress} / ${input.columnHeader}`,
      `当前单元格已有内容：${input.currentCellText || '空'}`,
      '',
      '同一行已有信息：',
      formatNeighborValues(input.neighborRowValues),
      '',
      '论文信息：',
      `中文标题：${input.paper.chineseTitle || '未填写'}`,
      `英文标题：${input.paper.englishTitle || '未填写'}`,
      `期刊/来源：${input.paper.journal || '未填写'}`,
      `作者：${input.paper.authors || '未填写'}`,
      `年份：${input.paper.year || '未填写'}`,
      `阅读笔记：${input.paper.notes || '空'}`,
      '',
      '论文上下文：',
      clipContext(input.paperContext),
      '',
      '只输出该单元格内容。'
    ].join('\n')
  };
}

function formatNeighborValues(values: Record<string, string>): string {
  const entries = Object.entries(values)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}：${value}`);

  return entries.length > 0 ? entries.join('\n') : '空';
}

function clipContext(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '无可用上下文。';
  }

  if (normalized.length <= MAX_CONTEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_CONTEXT_LENGTH)}\n[上下文已截断]`;
}
