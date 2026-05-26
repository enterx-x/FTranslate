export type AiProviderId = 'openai' | 'deepseek' | 'kimi' | 'custom';
export type AiTranslatableBlockType = 'heading' | 'paragraph' | 'formula' | 'caption';

export interface AiProviderSettings {
  provider: AiProviderId;
  baseURL: string;
  model: string;
}

export interface AiTranslationItem {
  section: string;
  original: string;
  translation: string;
  type?: AiTranslatableBlockType;
  sourceHash?: string;
  translatedAt?: string;
  provider?: string;
  model?: string;
}

export interface ChatCompletionRequest {
  url: string;
  body: {
    model: string;
    temperature: number;
    messages: Array<{
      role: 'system' | 'user';
      content: string;
    }>;
  };
}

export const AI_PROVIDER_PRESETS: Record<Exclude<AiProviderId, 'custom'>, AiProviderSettings> = {
  openai: {
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  deepseek: {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  kimi: {
    provider: 'kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2'
  }
};

export function buildChatCompletionRequest(
  settings: AiProviderSettings,
  item: AiTranslationItem
): ChatCompletionRequest {
  return {
    url: buildChatCompletionsUrl(settings.baseURL),
    body: {
      model: settings.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '你是严谨的学术论文英译中助手。',
            '请忠实翻译英文论文段落为中文，保留术语、变量名、公式符号、引用编号和模型名称。',
            '只输出中文译文，不要解释，不要添加 Markdown 代码块。'
          ].join('\n')
        },
        {
          role: 'user',
          content: [`Section: ${item.section || 'Untitled'}`, '', item.original].join('\n')
        }
      ]
    }
  };
}

export function buildChatCompletionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/chat/completions`;
}

export function shouldTranslateItem(item: AiTranslationItem, force = false): boolean {
  if (item.type && item.type !== 'paragraph') {
    return false;
  }

  if (!item.original.trim()) {
    return false;
  }

  return force || !item.translation.trim();
}

export function applyAiTranslationResult<T extends AiTranslationItem>(
  item: T,
  translation: string,
  settings: AiProviderSettings,
  translatedAt = new Date().toISOString()
): T & Pick<AiTranslationItem, 'translation' | 'translatedAt' | 'provider' | 'model'> {
  return {
    ...item,
    translation,
    translatedAt,
    provider: settings.provider,
    model: settings.model
  };
}
