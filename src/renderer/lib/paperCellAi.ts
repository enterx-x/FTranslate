import {
  PAPER_RESEARCH_COLUMNS,
  getPaperSheetCell,
  type PaperRecord,
  type PaperResearchColumnKey
} from './papers';

interface BuildPaperCellPromptInput {
  paper: PaperRecord;
  field: PaperResearchColumnKey;
  contextText: string;
}

interface PaperCellPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const MAX_CONTEXT_LENGTH = 7200;

export function buildPaperCellPrompt(input: BuildPaperCellPromptInput): PaperCellPrompt {
  const column = PAPER_RESEARCH_COLUMNS.find((entry) => entry.key === input.field);
  const label = column?.label ?? input.field;
  const aiHint = column?.aiHint ?? '填写该论文阅读表格单元格。';
  const currentValue = getPaperSheetCell(input.paper, input.field);

  return {
    systemPrompt: [
      '你是严谨的科研论文阅读表格助手。',
      '你的任务是根据论文标题、用户笔记和已有翻译/AI 缓存内容，填写一个表格单元格。',
      '输出必须简洁、具体、适合放在 Excel 风格单元格中。',
      '如果涉及数学公式，请保留 LaTeX 定界符，例如 $L=\\sum_i x_i^2$。',
      '不要输出 Markdown 表格，不要解释过程。'
    ].join('\n'),
    userPrompt: [
      `目标单元格：${label}`,
      `填写要求：${aiHint}`,
      '',
      '论文信息：',
      `中文标题：${input.paper.chineseTitle || '未填写'}`,
      `英文标题：${input.paper.englishTitle || '未填写'}`,
      `期刊/来源：${input.paper.journal || '未填写'}`,
      `作者：${input.paper.authors || '未填写'}`,
      `年份：${input.paper.year || '未填写'}`,
      '',
      `当前单元格已有内容：${currentValue || '空'}`,
      `阅读笔记：${input.paper.notes || '空'}`,
      '',
      '论文上下文：',
      clipContext(input.contextText),
      '',
      '只输出该单元格内容。'
    ].join('\n')
  };
}

function clipContext(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= MAX_CONTEXT_LENGTH) {
    return normalized || '无可用上下文。';
  }

  return `${normalized.slice(0, MAX_CONTEXT_LENGTH)}\n[上下文已截断]`;
}
