import { CapacitorHttp } from '@capacitor/core';
import type { ExtractedBlockType } from '../lib/pdfTextStructure';
import type { MobileTranslationSession } from './mobileTypes';

interface ChatCompletionPayload {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export interface AcademicPageReflowInput {
  index: number;
  type: ExtractedBlockType;
  text: string;
}

export interface AcademicPageReflowParagraph {
  original: string;
  translation: string;
  type: ExtractedBlockType;
}

export function buildTranslationEndpoint(baseURL: string): string {
  const clean = baseURL.trim().replace(/\/+$/u, '');
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}

export function buildAcademicTranslationPrompt(text: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '你是科研论文翻译助手。将英文准确翻译为简体中文，保留公式、变量、引用编号、Figure/Table 编号、DOI 和专有名词。只输出译文，不添加解释。'
    },
    { role: 'user', content: text.trim() }
  ];
}

export function buildAcademicPageReflowPrompt(
  blocks: AcademicPageReflowInput[]
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        '你是科研论文 OCR 校对、版面重排和翻译助手。输入是一页按本地版面分析得到的英文片段。',
        '先恢复正确阅读顺序和自然段：合并同一段的断行、修复明确的行末断词与明显 OCR 字符错误，并去掉孤立页码或图片标签。',
        '只允许依据输入文字做保守校对；不得补写输入中不存在的论文内容，不得改写作者论点，不确定处保留原样。',
        '再把每个恢复后的英文自然段准确翻译为简体中文，保留公式、变量、引用编号、Figure/Table 编号、DOI 和专有名词。',
        '只输出严格 JSON，不要 Markdown 或解释。格式为 {"paragraphs":[{"original":"校对后的完整英文段落","translation":"对应中文","type":"heading|paragraph|formula|caption"}]}。'
      ].join('')
    },
    {
      role: 'user',
      content: JSON.stringify({ blocks: blocks.map((block) => ({
        index: block.index,
        type: block.type,
        text: block.text.trim()
      })) })
    }
  ];
}

export async function translateAcademicText(
  text: string,
  session: MobileTranslationSession
): Promise<string> {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('没有可翻译的文本。');
  }
  if (!session.apiKey.trim()) {
    throw new Error('请先填写本次会话使用的 API Key。');
  }
  return requestChatCompletion(buildAcademicTranslationPrompt(cleanText), session, 0.2);
}

export async function reflowAndTranslateAcademicPage(
  blocks: AcademicPageReflowInput[],
  session: MobileTranslationSession
): Promise<AcademicPageReflowParagraph[]> {
  const cleanBlocks = blocks
    .map((block) => ({ ...block, text: block.text.trim() }))
    .filter((block) => block.text);
  if (cleanBlocks.length === 0) {
    throw new Error('这一页没有可校对和翻译的文本。');
  }
  const content = await requestChatCompletion(buildAcademicPageReflowPrompt(cleanBlocks), session, 0.1, 90_000);
  const paragraphs = parseAcademicPageReflowResponse(content);
  if (paragraphs.length === 0) {
    throw new Error('AI 没有返回可用的双语段落。');
  }
  if (!hasSufficientAcademicPageCoverage(cleanBlocks, paragraphs)) {
    throw new Error('AI 校对结果与本页原文覆盖不足，已拒绝覆盖本地原文；请重试当前页。');
  }
  return paragraphs;
}

export function hasSufficientAcademicPageCoverage(
  input: AcademicPageReflowInput[],
  output: AcademicPageReflowParagraph[]
): boolean {
  const inputText = input.map((block) => block.text).join(' ');
  const outputText = output.map((paragraph) => paragraph.original).join(' ');
  const inputTokens = new Set(tokenizeEnglishText(inputText));
  const outputTokens = new Set(tokenizeEnglishText(outputText));
  if (inputTokens.size === 0 || outputTokens.size === 0) {
    return false;
  }
  const sharedTokens = Array.from(inputTokens).filter((token) => outputTokens.has(token)).length;
  const tokenRecall = sharedTokens / inputTokens.size;
  const inputLength = canonicalEnglishText(inputText).length;
  const outputLength = canonicalEnglishText(outputText).length;
  const lengthRatio = outputLength / Math.max(1, inputLength);
  return tokenRecall >= 0.5 && lengthRatio >= 0.35 && lengthRatio <= 1.6;
}

export function parseAcademicPageReflowResponse(content: string): AcademicPageReflowParagraph[] {
  const unfenced = content.trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  const objectStart = unfenced.indexOf('{');
  const objectEnd = unfenced.lastIndexOf('}');
  const candidate = objectStart >= 0 && objectEnd > objectStart
    ? unfenced.slice(objectStart, objectEnd + 1)
    : unfenced;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    throw new Error('AI 校对结果不是有效 JSON，请重试当前页。');
  }
  const paragraphs = (parsed as { paragraphs?: unknown })?.paragraphs;
  if (!Array.isArray(paragraphs)) {
    throw new Error('AI 校对结果缺少 paragraphs 数组，请重试当前页。');
  }
  return paragraphs.flatMap((value): AcademicPageReflowParagraph[] => {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const record = value as { original?: unknown; translation?: unknown; type?: unknown };
    const original = typeof record.original === 'string' ? normalizeReturnedParagraph(record.original) : '';
    const translation = typeof record.translation === 'string' ? normalizeReturnedParagraph(record.translation) : '';
    if (!original || !translation) {
      return [];
    }
    return [{
      original,
      translation,
      type: isExtractedBlockType(record.type) ? record.type : 'paragraph'
    }];
  }).slice(0, 120);
}

async function requestChatCompletion(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  session: MobileTranslationSession,
  temperature: number,
  readTimeout = 60_000
): Promise<string> {
  if (!session.apiKey.trim()) {
    throw new Error('请先填写本次会话使用的 API Key。');
  }
  const response = await CapacitorHttp.post({
    url: buildTranslationEndpoint(session.baseURL),
    headers: {
      Authorization: `Bearer ${session.apiKey.trim()}`,
      'Content-Type': 'application/json'
    },
    data: {
      model: session.model.trim(),
      messages,
      temperature
    },
    connectTimeout: 20_000,
    readTimeout
  });
  const payload = normalizePayload(response.data);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(payload.error?.message || `翻译请求失败：HTTP ${response.status}`);
  }
  const translation = payload.choices?.[0]?.message?.content?.trim();
  if (!translation) {
    throw new Error('翻译接口没有返回文本。');
  }
  return translation;
}

function normalizeReturnedParagraph(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function tokenizeEnglishText(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9]+/gu)?.filter((token) => token.length >= 3) ?? [];
}

function canonicalEnglishText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function isExtractedBlockType(value: unknown): value is ExtractedBlockType {
  return value === 'heading' || value === 'paragraph' || value === 'formula' || value === 'caption';
}

function normalizePayload(value: unknown): ChatCompletionPayload {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as ChatCompletionPayload;
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as ChatCompletionPayload) : {};
}
