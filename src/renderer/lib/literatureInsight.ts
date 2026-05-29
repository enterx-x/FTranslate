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

export interface LiteratureInsightActionInput {
  selectedPaperCount: number;
  linkedPaperCount: number;
  isRunning: boolean;
  isAiBusy: boolean;
}

export interface LiteratureInsightActionState {
  disabled: boolean;
  label: string;
  scopeText: string;
}

export const LITERATURE_INSIGHT_STATE_KEY = 'pdfTranslationReader:literatureInsightState';
export const LITERATURE_INSIGHT_HISTORY_KEY = 'pdfTranslationReader:literatureInsightHistory';
export const LITERATURE_INSIGHT_STALE_MS = 30 * 60 * 1000;

export type LiteratureInsightRunStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface LiteratureInsightRunState {
  status: LiteratureInsightRunStatus;
  paperCount: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  progress: string;
  result?: string;
  error?: string;
}

export interface LiteratureInsightHistoryEntry {
  id: string;
  title: string;
  paperCount: number;
  provider: string;
  model: string;
  createdAt: number;
  result: string;
  webSearchUsed?: boolean;
}

export function describeLiteratureInsightAction(input: LiteratureInsightActionInput): LiteratureInsightActionState {
  const activeCount = input.selectedPaperCount > 0 ? input.selectedPaperCount : input.linkedPaperCount;

  if (input.isRunning) {
    return {
      disabled: true,
      label: 'AI 大观分析中...',
      scopeText: activeCount > 0
        ? `正在综合分析 ${activeCount} 篇${input.selectedPaperCount > 0 ? '选中' : '已绑定'}论文。`
        : '正在等待论文上下文。'
    };
  }

  if (activeCount === 0) {
    return {
      disabled: true,
      label: 'AI 大观分析',
      scopeText: '请先选中已绑定论文的行，或在表格中至少绑定一篇论文。'
    };
  }

  if (input.isAiBusy) {
    return {
      disabled: true,
      label: 'AI 忙碌中',
      scopeText: '当前有其它 AI 任务在运行，请稍后再做大观分析。'
    };
  }

  if (input.selectedPaperCount > 0) {
    return {
      disabled: false,
      label: `AI 大观分析 ${input.selectedPaperCount} 篇`,
      scopeText: `将分析 ${input.selectedPaperCount} 篇选中论文。`
    };
  }

  return {
    disabled: false,
    label: `AI 大观分析全部 ${input.linkedPaperCount} 篇`,
    scopeText: `未选中绑定行，将分析全部 ${input.linkedPaperCount} 篇已绑定论文。`
  };
}

export function createLiteratureInsightRunState(
  paperCount: number,
  now = Date.now()
): LiteratureInsightRunState {
  return {
    status: 'running',
    paperCount,
    startedAt: now,
    updatedAt: now,
    progress: `正在准备 ${paperCount} 篇论文/表格行的上下文...`
  };
}

export function updateLiteratureInsightRunProgress(
  state: LiteratureInsightRunState,
  progress: string,
  now = Date.now()
): LiteratureInsightRunState {
  return {
    ...state,
    status: 'running',
    updatedAt: now,
    progress
  };
}

export function completeLiteratureInsightRun(
  state: LiteratureInsightRunState,
  result: string,
  now = Date.now()
): LiteratureInsightRunState {
  return {
    ...state,
    status: 'completed',
    updatedAt: now,
    completedAt: now,
    progress: '',
    result
  };
}

export function failLiteratureInsightRun(
  state: LiteratureInsightRunState,
  error: string,
  now = Date.now()
): LiteratureInsightRunState {
  return {
    ...state,
    status: 'failed',
    updatedAt: now,
    completedAt: now,
    progress: error,
    error
  };
}

export function normalizeLiteratureInsightRunState(
  value: unknown,
  now = Date.now(),
  staleMs = LITERATURE_INSIGHT_STALE_MS
): LiteratureInsightRunState | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = typeof value.status === 'string' ? value.status : '';
  if (!['running', 'completed', 'failed', 'interrupted'].includes(status)) {
    return null;
  }

  const startedAt = Number(value.startedAt);
  const updatedAt = Number(value.updatedAt);
  const paperCount = Math.max(0, Number(value.paperCount) || 0);
  if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt)) {
    return null;
  }

  const state: LiteratureInsightRunState = {
    status: status as LiteratureInsightRunStatus,
    paperCount,
    startedAt,
    updatedAt,
    completedAt: Number.isFinite(Number(value.completedAt)) ? Number(value.completedAt) : undefined,
    progress: typeof value.progress === 'string' ? value.progress : '',
    result: typeof value.result === 'string' ? value.result : undefined,
    error: typeof value.error === 'string' ? value.error : undefined
  };

  if (state.status === 'running' && now - state.updatedAt > staleMs) {
    return {
      ...state,
      status: 'interrupted',
      updatedAt: now,
      completedAt: now,
      progress: `上次 AI 大观分析在 ${Math.round((now - state.updatedAt) / 1000)} 秒前停止更新，已标记为中断。`
    };
  }

  return state;
}

export function normalizeLiteratureInsightHistory(value: unknown): LiteratureInsightHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): LiteratureInsightHistoryEntry | null => {
      if (!isRecord(item)) {
        return null;
      }

      const createdAt = Number(item.createdAt);
      const paperCount = Math.max(0, Number(item.paperCount) || 0);
      const result = typeof item.result === 'string' ? item.result.trim() : '';
      if (!Number.isFinite(createdAt) || !result) {
        return null;
      }

      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `insight-${createdAt}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `AI 大观分析 ${paperCount} 篇`,
        paperCount,
        provider: typeof item.provider === 'string' ? item.provider : '',
        model: typeof item.model === 'string' ? item.model : '',
        createdAt,
        result,
        webSearchUsed: Boolean(item.webSearchUsed)
      };
    })
    .filter((item): item is LiteratureInsightHistoryEntry => Boolean(item))
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function appendLiteratureInsightHistory(
  history: LiteratureInsightHistoryEntry[],
  entry: Omit<LiteratureInsightHistoryEntry, 'id'> & { id?: string },
  limit = 20
): LiteratureInsightHistoryEntry[] {
  const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now();
  const normalizedEntry: LiteratureInsightHistoryEntry = {
    id: entry.id || `insight-${createdAt}-${hashText(`${entry.title}|${entry.result}`)}`,
    title: entry.title.trim() || `AI 大观分析 ${entry.paperCount} 篇`,
    paperCount: Math.max(0, entry.paperCount),
    provider: entry.provider,
    model: entry.model,
    createdAt,
    result: entry.result,
    webSearchUsed: Boolean(entry.webSearchUsed)
  };

  return [normalizedEntry, ...history.filter((item) => item.id !== normalizedEntry.id)]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, Math.max(1, limit));
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
      '如果当前模型/工具具备联网检索能力，请先用英文标题、关键词、方法名和 proposed idea 关键词检索公开网页、论文页、arXiv、GitHub 和项目页，排除已经高度重合的工作后再提出 idea；如果没有联网能力，必须明确标注“未进行实时网页查新”。',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
