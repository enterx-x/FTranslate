import { CapacitorHttp } from '@capacitor/core';
import type { MobileTranslationSession } from './mobileTypes';

interface ChatCompletionPayload {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
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
  const response = await CapacitorHttp.post({
    url: buildTranslationEndpoint(session.baseURL),
    headers: {
      Authorization: `Bearer ${session.apiKey.trim()}`,
      'Content-Type': 'application/json'
    },
    data: {
      model: session.model.trim(),
      messages: buildAcademicTranslationPrompt(cleanText),
      temperature: 0.2
    },
    connectTimeout: 20_000,
    readTimeout: 60_000
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
