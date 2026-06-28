import type { PaperRecord } from './papers';
import type { PresentationFigureCandidate } from './presentationOutline';

export interface PaperTutorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PaperTutorPromptInput {
  papers: PaperRecord[];
  figures: PresentationFigureCandidate[];
  evidenceBundles?: PaperTutorEvidenceBundle[];
  pdfTextSnippets?: string[];
  history: PaperTutorMessage[];
  userMessage: string;
}

export interface PaperTutorPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface PaperTutorEvidenceBundle {
  paperId: string;
  paperTitle: string;
  figures: PresentationFigureCandidate[];
  pdfTextSnippets: string[];
}

export interface PaperTutorEvidenceStoreEntry {
  figures: PresentationFigureCandidate[];
  pdfTextSnippets: string[];
}

export interface CollectPaperTutorEvidenceInput {
  papers: PaperRecord[];
  selectedPaperIds: string[];
  activePaperId: string | null;
  activeFigures: PresentationFigureCandidate[];
  activePdfTextSnippets: string[];
  evidenceByPaperId: Record<string, PaperTutorEvidenceStoreEntry>;
}

export interface CollectedPaperTutorEvidence {
  figures: PresentationFigureCandidate[];
  pdfTextSnippets: string[];
  bundles: PaperTutorEvidenceBundle[];
}

export interface PaperTutorSession {
  id: string;
  title: string;
  paperIds: string[];
  messages: PaperTutorMessage[];
  createdAt: string;
  updatedAt: string;
  manualTitle?: boolean;
}

const MAX_PAPERS = 5;
const MAX_FIGURES = 8;
const MAX_SNIPPETS = 12;
let sessionIdSequence = 0;
const PROMPT_SCAFFOLD_HEADING_PATTERN =
  /^(?:论文上下文|当前窗口选中论文|当前窗口证据包|图表上下文|当前 PDF 文本片段|最近对话|用户本轮输入|回答要求|current selected papers|current window selected papers|selected papers|evidence bundles|current window evidence bundles|figure context|figures|current pdf text snippets|pdf text|recent dialogue|recent conversation|user message|response requirements|paper \d+|evidence paper \d+)$/iu;

export function buildPaperTutorPrompt(input: PaperTutorPromptInput): PaperTutorPrompt {
  const papers = input.papers.slice(0, MAX_PAPERS);
  const evidenceBundles =
    input.evidenceBundles && input.evidenceBundles.length > 0
      ? input.evidenceBundles.slice(0, MAX_PAPERS)
      : buildFallbackEvidenceBundles(papers, input.figures, input.pdfTextSnippets ?? []);
  const figures = evidenceBundles.flatMap((bundle) => bundle.figures).slice(0, MAX_FIGURES);
  const pdfTextSnippets = evidenceBundles.flatMap((bundle) => bundle.pdfTextSnippets).slice(0, MAX_SNIPPETS);
  const history = input.history.slice(-10);

  return {
    systemPrompt: [
      '你是一个严格但建设性的组会导师，正在帮助研究生真正读懂论文。',
      '你的目标不是直接写综述，而是通过提问确认用户是否理解论文的方法、图表和实验逻辑。',
      '优先围绕：输入是什么、输出是什么、经过什么模型或算法变换、训练目标或损失是什么、实验指标如何支撑结论。',
      '如果用户说不会、不知道、看不懂，先给出清晰解答，再追加一个更小的追问。',
      '如果用户选择多篇论文，要主动比较它们的方法差异、假设差异、实验设置差异和可复现风险。',
      '你已经获得下面的论文证据包；回答时必须优先使用证据包中的标题、用户笔记、PDF 文本片段和图表 caption。',
      '不要说“我没有读到论文”或“需要你提供论文信息”，除非证据包明确为空；证据不足时指出还缺哪一页或哪张图。',
      '不要编造没有出现在论文标题、摘要、笔记、PDF 文本或图表 caption 中的信息；不确定时明确说需要回看原文。'
    ].join('\n'),
    userPrompt: [
      '# 当前窗口选中论文',
      formatTutorPapers(papers),
      '',
      '# 当前窗口证据包',
      formatTutorEvidenceBundles(evidenceBundles),
      '',
      '# 图表上下文',
      formatTutorFigures(figures),
      '',
      '# 当前 PDF 文本片段',
      formatTutorTextSnippets(pdfTextSnippets),
      '',
      '# 最近对话',
      formatTutorHistory(history),
      '',
      '# 用户本轮输入',
      input.userMessage.trim() || '请先像组会导师一样，基于论文和图表提出第一个问题。',
      '',
      '# 回答要求',
      '用中文回答。先判断用户回答是否到位，再给出导师式反馈。每轮最多提出 1-2 个问题，问题必须具体到论文方法或图表证据。',
      '不要复述系统提示、论文上下文标题或证据包字段名。如果需要表格，必须使用标准 Markdown 表格：表头行、--- 分隔行、内容行。'
    ].join('\n')
  };
}

export function createPaperTutorSession(input: {
  papers: PaperRecord[];
  now?: string;
  id?: string;
  messages?: PaperTutorMessage[];
}): PaperTutorSession {
  const now = input.now ?? new Date().toISOString();
  const paperIds = input.papers.slice(0, MAX_PAPERS).map((paper) => paper.id);
  const title = buildPaperTutorSessionTitle(input.papers);
  return {
    id: input.id ?? createPaperTutorSessionId(now, paperIds),
    title,
    paperIds,
    messages: (input.messages ?? []).slice(-30),
    createdAt: now,
    updatedAt: now
  };
}

function createPaperTutorSessionId(now: string, paperIds: string[]): string {
  sessionIdSequence = (sessionIdSequence + 1) % 1_000_000;
  const timestamp = Date.parse(now) || Date.now();
  const paperKey = paperIds.join('-') || 'empty';
  return `paper-tutor-${timestamp}-${sessionIdSequence}-${paperKey}`;
}

export function appendPaperTutorSessionMessage(
  session: PaperTutorSession,
  message: PaperTutorMessage,
  now = new Date().toISOString()
): PaperTutorSession {
  return {
    ...session,
    messages: [...session.messages, message].slice(-30),
    updatedAt: now
  };
}

export function trimPaperTutorSessionsForStorage(
  sessions: PaperTutorSession[],
  maxSessions = 12
): PaperTutorSession[] {
  return [...sessions]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, maxSessions)
    .map((session) => ({
      ...session,
      paperIds: session.paperIds.slice(0, MAX_PAPERS),
      messages: session.messages.slice(-30)
    }));
}

export function buildPaperTutorSessionTitle(papers: PaperRecord[]): string {
  if (papers.length === 0) {
    return '未选择论文';
  }

  const primary = papers[0];
  const title = primary.chineseTitle || primary.englishTitle || primary.pdfName || '论文问答';
  return papers.length > 1 ? `${truncateSessionTitle(title)} 等 ${papers.length} 篇` : truncateSessionTitle(title);
}

export function collectPaperTutorEvidence(input: CollectPaperTutorEvidenceInput): CollectedPaperTutorEvidence {
  const selectedIds = input.selectedPaperIds.length > 0
    ? input.selectedPaperIds
    : input.activePaperId
      ? [input.activePaperId]
      : input.papers[0]?.id
        ? [input.papers[0].id]
        : [];
  const selectedPapers = input.papers
    .filter((paper) => selectedIds.includes(paper.id))
    .slice(0, MAX_PAPERS);

  const bundles = selectedPapers.map((paper) => {
    const stored = input.evidenceByPaperId[paper.id];
    const isActivePaper = paper.id === input.activePaperId;
    const figures = stored?.figures ?? (isActivePaper ? input.activeFigures : []);
    const pdfTextSnippets = stored?.pdfTextSnippets ?? (isActivePaper ? input.activePdfTextSnippets : []);
    return {
      paperId: paper.id,
      paperTitle: formatTutorPaperTitle(paper),
      figures: figures.slice(0, MAX_FIGURES),
      pdfTextSnippets: pdfTextSnippets.filter(Boolean).slice(0, MAX_SNIPPETS)
    };
  });

  return {
    bundles,
    figures: bundles.flatMap((bundle) => bundle.figures).slice(0, MAX_FIGURES),
    pdfTextSnippets: bundles.flatMap((bundle) => bundle.pdfTextSnippets).slice(0, MAX_SNIPPETS)
  };
}

export function sanitizePaperTutorAnswer(answer: string): string {
  const withoutFence = answer
    .trim()
    .replace(/^```(?:markdown|md)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  const lines = withoutFence.split(/\r?\n/u);
  const cleaned: string[] = [];
  let skippingPromptSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      if (!skippingPromptSection) {
        cleaned.push('');
      }
      continue;
    }

    if (/^(system|user|assistant|developer)\s*prompt\s*[:：]/iu.test(trimmed)) {
      skippingPromptSection = true;
      continue;
    }

    if (isPromptScaffoldHeading(trimmed)) {
      skippingPromptSection = true;
      continue;
    }

    if (skippingPromptSection) {
      if (/^#{1,4}\s+.+/u.test(trimmed) && !isPromptScaffoldHeading(trimmed)) {
        skippingPromptSection = false;
      } else {
        continue;
      }
    }

    if (cleaned.length === 0 && isPromptScaffoldFieldLine(trimmed)) {
      continue;
    }

    cleaned.push(line);
  }

  return cleaned.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function isPromptScaffoldHeading(trimmedLine: string): boolean {
  const heading = trimmedLine.match(/^#{1,4}\s*(.+?)\s*$/u);
  return Boolean(heading?.[1] && PROMPT_SCAFFOLD_HEADING_PATTERN.test(heading[1]));
}

function isPromptScaffoldFieldLine(trimmedLine: string): boolean {
  return /^(?:paperId|title|caption|image|page|kind|crop|source|Snippet \d+|Figure \d+)\s*[=:]/iu.test(trimmedLine);
}

export function buildTutorStarterQuestion(
  papers: PaperRecord[],
  figures: PresentationFigureCandidate[]
): string {
  const primary = papers[0];
  const title = primary?.chineseTitle || primary?.englishTitle || primary?.pdfName || '这篇论文';
  const figureHint = figures[0]?.caption ? `，并结合第 ${figures[0].pageNumber} 页图表` : '';
  return `请先讲一下《${title}》的方法主线${figureHint}：输入是什么，输出是什么，中间经过哪些模型或算法变换？`;
}

export function resolvePaperTutorSelection(
  papers: PaperRecord[],
  selectedIds: string[],
  activePaperId: string | null
): PaperRecord[] {
  const selected = papers.filter((paper) => selectedIds.includes(paper.id));
  if (selected.length > 0) {
    return selected.slice(0, MAX_PAPERS);
  }

  const activePaper = activePaperId ? papers.find((paper) => paper.id === activePaperId) : null;
  return activePaper ? [activePaper] : papers.slice(0, 1);
}

export function prioritizeActivePaperSelection(
  selectedIds: string[],
  activePaperId: string | null,
  papers: Pick<PaperRecord, 'id'>[],
  maxPapers = MAX_PAPERS
): string[] {
  const validIds = new Set(papers.map((paper) => paper.id));
  const normalizedSelection = selectedIds
    .filter((paperId, index, array) => validIds.has(paperId) && array.indexOf(paperId) === index);
  if (!activePaperId || !validIds.has(activePaperId)) {
    return normalizedSelection.slice(0, maxPapers);
  }
  return [activePaperId, ...normalizedSelection.filter((paperId) => paperId !== activePaperId)].slice(0, maxPapers);
}

function formatTutorPapers(papers: PaperRecord[]): string {
  if (papers.length === 0) {
    return '暂无选中的论文。';
  }

  return papers
    .map((paper, index) =>
      [
        `## Paper ${index + 1}`,
        `标题：${paper.chineseTitle || paper.englishTitle || paper.pdfName || 'Untitled'}`,
        paper.englishTitle ? `英文标题：${paper.englishTitle}` : '',
        paper.authors ? `作者：${paper.authors}` : '',
        paper.year ? `年份：${paper.year}` : '',
        paper.journal ? `来源：${paper.journal}` : '',
        paper.notes ? `用户笔记：${paper.notes.slice(0, 1200)}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
}

function formatTutorFigures(figures: PresentationFigureCandidate[]): string {
  if (figures.length === 0) {
    return '暂无已提取图片；如果需要分析图示，请先在 PDF 阅读页点击“提取文献图片”。';
  }

  return figures
    .map((figure, index) =>
      [
        `- Figure ${index + 1}: page=${figure.pageNumber}, kind=${figure.figureKind ?? 'figure'}, source=${formatFigureAssetSource(figure)}`,
        `  caption=${figure.caption}`,
        figure.imageDataUrl ? '  image=已提取图像，可在界面查看' : '  image=仅有 caption，未可靠提取'
      ].join('\n')
    )
    .join('\n');
}

function formatFigureAssetSource(figure: PresentationFigureCandidate): string {
  if (figure.imageExtractionMethod === 'native-image') {
    return 'native-pdf-image';
  }
  if (figure.imageExtractionMethod === 'page-crop') {
    return 'page-crop';
  }
  return figure.cropStatus ?? 'caption-only';
}

function formatTutorEvidenceBundles(bundles: PaperTutorEvidenceBundle[]): string {
  if (bundles.length === 0) {
    return '证据包为空：当前窗口没有选中论文或还没有从 PDF 提取文本/图表。';
  }

  return bundles
    .map((bundle, index) =>
      [
        `## Evidence Paper ${index + 1}`,
        `paperId=${bundle.paperId}`,
        `title=${bundle.paperTitle}`,
        '### Figures',
        bundle.figures.length > 0
          ? bundle.figures
              .slice(0, MAX_FIGURES)
              .map(
                (figure, figureIndex) =>
                  `- Figure ${figureIndex + 1}: page=${figure.pageNumber}, kind=${figure.figureKind ?? 'figure'}, caption=${figure.caption}`
              )
              .join('\n')
          : '- 暂无该论文图表 caption。',
        '### PDF Text',
        bundle.pdfTextSnippets.length > 0
          ? bundle.pdfTextSnippets
              .slice(0, MAX_SNIPPETS)
              .map((snippet, snippetIndex) => `- Snippet ${snippetIndex + 1}: ${snippet.slice(0, 800)}`)
              .join('\n')
          : '- 暂无该论文 PDF 文本片段。'
      ].join('\n')
    )
    .join('\n\n');
}

function formatTutorTextSnippets(snippets: string[]): string {
  const cleaned = snippets.map((snippet) => snippet.trim()).filter(Boolean).slice(0, 10);
  if (cleaned.length === 0) {
    return '暂无当前 PDF 文本片段。';
  }
  return cleaned.map((snippet, index) => `- Snippet ${index + 1}: ${snippet.slice(0, 800)}`).join('\n');
}

function formatTutorHistory(history: PaperTutorMessage[]): string {
  if (history.length === 0) {
    return '暂无历史对话。';
  }

  return history.map((message) => `${message.role === 'assistant' ? '导师' : '学生'}：${message.content}`).join('\n');
}

function buildFallbackEvidenceBundles(
  papers: PaperRecord[],
  figures: PresentationFigureCandidate[],
  pdfTextSnippets: string[]
): PaperTutorEvidenceBundle[] {
  if (papers.length === 0) {
    return [];
  }

  const primary = papers[0];
  return [
    {
      paperId: primary.id,
      paperTitle: formatTutorPaperTitle(primary),
      figures: figures.slice(0, MAX_FIGURES),
      pdfTextSnippets: pdfTextSnippets.slice(0, MAX_SNIPPETS)
    },
    ...papers.slice(1).map((paper) => ({
      paperId: paper.id,
      paperTitle: formatTutorPaperTitle(paper),
      figures: [],
      pdfTextSnippets: []
    }))
  ];
}

function formatTutorPaperTitle(paper: PaperRecord): string {
  const titles = [paper.chineseTitle, paper.englishTitle]
    .map((title) => title.trim())
    .filter(Boolean);
  return titles.length > 0 ? Array.from(new Set(titles)).join(' / ') : paper.pdfName || paper.id;
}

function truncateSessionTitle(title: string): string {
  return title.length > 28 ? `${title.slice(0, 27)}...` : title;
}
