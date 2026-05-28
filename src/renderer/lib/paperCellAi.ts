import {
  PAPER_RESEARCH_COLUMNS,
  type PaperRecord,
  type PaperResearchColumnKey
} from './papers';

interface BuildPaperCellPromptInput {
  paper: PaperRecord & { sheetCells?: Partial<Record<PaperResearchColumnKey, string>> };
  field: PaperResearchColumnKey;
  contextText: string;
}

interface PaperCellPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const MAX_CONTEXT_LENGTH = 8000;

// 兼容旧版论文库表格的内部 helper。新版入口已迁移到独立研究表格。
export function buildPaperCellPrompt(input: BuildPaperCellPromptInput): PaperCellPrompt {
  const column = PAPER_RESEARCH_COLUMNS.find((entry) => entry.key === input.field);
  const currentValue = input.paper.sheetCells?.[input.field] ?? '';

  return {
    systemPrompt: [
      '你是科研论文阅读表格助手。',
      '只填写当前指定单元格，内容要简洁、可直接放入表格。',
      '不要输出 Markdown 表格，不要解释过程。'
    ].join('\n'),
    userPrompt: [
      `目标单元格：${column?.label ?? input.field}`,
      `当前已有内容：${currentValue || '空'}`,
      '',
      `中文标题：${input.paper.chineseTitle || '未填写'}`,
      `英文标题：${input.paper.englishTitle || '未填写'}`,
      `期刊：${input.paper.journal || '未填写'}`,
      `作者：${input.paper.authors || '未填写'}`,
      `年份：${input.paper.year || '未填写'}`,
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
