import type { PaperRecord } from './papers';

export interface LiteratureGapPaperInput {
  paper: PaperRecord;
  rowValues: Record<string, string>;
  fallbackContextText?: string;
}

export interface BuildLiteratureGapPromptInput {
  papers: LiteratureGapPaperInput[];
}

export interface LiteratureGapPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export function buildLiteratureGapPrompt(input: BuildLiteratureGapPromptInput): LiteratureGapPrompt {
  return {
    systemPrompt: [
      '你是严谨的跨论文研究洞察助手，擅长从多篇学术论文中提炼真实研究缺口。',
      '你的任务不是改名蹭热点，也不是把多个模块机械拼接成 idea。',
      '必须拒绝模块堆砌、概念包装和无实验支撑的泛泛建议。',
      '必须基于论文中反复出现、一直没解决或被多篇论文共同绕开的核心缺口，提出 1 个可验证研究 idea。',
      '输出必须具体、可复现、可实验验证；不要输出 Markdown 表格。'
    ].join('\n'),
    userPrompt: [
      '请基于下面选定论文和表格信息，完成一次“领域大观分析”。',
      '',
      '必须回答：',
      '1. 这些论文里反复出现、一直没解决的核心缺口是什么？为什么它是真缺口，而不是表面缺点？',
      '2. 围绕这个缺口，提出 1 个研究 idea，必须回答明确科学问题。',
      '3. 给出可验证技术路线：关键模块、输入输出、训练/优化目标、需要控制的变量。',
      '4. 给出实验方案：baseline、对照组、消融、评价指标、数据/环境、失败时如何诊断。',
      '5. 明确拒绝哪些伪创新：例如简单换模型、换名字、堆模块、蹭热点但没有机制差异。',
      '',
      '选定论文：',
      ...input.papers.map(formatPaperForPrompt)
    ].join('\n')
  };
}

export function parseLiteratureGapResponse(value: string): string {
  return value
    .replace(/^```(?:markdown|md|text)?\s*/iu, '')
    .replace(/```$/u, '')
    .trim();
}

function formatPaperForPrompt(input: LiteratureGapPaperInput, index: number): string {
  const rowEntries = Object.entries(input.rowValues)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `  - ${key}: ${value}`)
    .join('\n');
  const context = input.fallbackContextText?.trim()
    ? input.fallbackContextText.trim().slice(0, 6000)
    : '未提供额外上下文，主进程会尽量读取 PDF 或复用已缓存的论文全文。';

  return [
    '',
    `【论文 ${index + 1}】`,
    `中文标题：${input.paper.chineseTitle || '未填写'}`,
    `英文标题：${input.paper.englishTitle || input.paper.pdfName}`,
    `期刊/来源：${input.paper.journal || '未填写'}`,
    `作者：${input.paper.authors || '未填写'}`,
    `年份：${input.paper.year || '未填写'}`,
    `阅读笔记：${input.paper.notes || '空'}`,
    rowEntries ? `表格已有信息：\n${rowEntries}` : '表格已有信息：空',
    `已有缓存/摘要上下文：\n${context}`
  ].join('\n');
}
