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
    messages: Array<{
      role: 'system' | 'user';
      content: string;
    }>;
    temperature?: number;
    thinking?: {
      type: 'disabled';
    };
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
    model: 'kimi-k2.5'
  }
};

export function buildChatCompletionRequest(
  settings: AiProviderSettings,
  item: AiTranslationItem
): ChatCompletionRequest {
  const normalizedSettings = normalizeAiProviderSettings(settings);
  const body: ChatCompletionRequest['body'] = {
    model: normalizedSettings.model,
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
  };

  if (
    normalizedSettings.provider === 'kimi' &&
    normalizedSettings.model.toLowerCase().startsWith('kimi-k2.5')
  ) {
    body.thinking = { type: 'disabled' };
  } else {
    body.temperature = 0.2;
  }

  return {
    url: buildChatCompletionsUrl(normalizedSettings.baseURL),
    body
  };
}

export function buildChatCompletionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/chat/completions`;
}

export function normalizeAiProviderSettings(settings: AiProviderSettings): AiProviderSettings {
  const preset = settings.provider === 'custom' ? null : AI_PROVIDER_PRESETS[settings.provider];
  const normalizedModel = normalizeAiModel(settings.provider, settings.model, preset?.model ?? settings.model);
  const normalizedBaseURL = normalizeAiBaseURL(
    settings.provider,
    settings.baseURL,
    preset?.baseURL ?? settings.baseURL
  );

  return {
    provider: settings.provider,
    baseURL: normalizedBaseURL,
    model: normalizedModel
  };
}

function normalizeAiBaseURL(provider: AiProviderId, baseURL: string, fallback: string): string {
  const cleaned = (baseURL.trim() || fallback.trim())
    .replace(/\/chat\/completions\/?$/iu, '')
    .replace(/\/+$/u, '');

  if (provider === 'kimi') {
    return normalizeKimiBaseURL(cleaned);
  }

  return cleaned || fallback.trim();
}

function normalizeAiModel(provider: AiProviderId, model: string, fallback: string): string {
  const trimmed = model.trim();

  if (provider === 'kimi' && (!trimmed || trimmed === 'kimi-k2')) {
    return AI_PROVIDER_PRESETS.kimi.model;
  }

  return trimmed || fallback.trim();
}

function normalizeKimiBaseURL(baseURL: string): string {
  const fallback = AI_PROVIDER_PRESETS.kimi.baseURL;

  if (!baseURL) {
    return fallback;
  }

  try {
    const url = new URL(baseURL);
    const host = url.hostname.toLowerCase();
    const lowerPath = url.pathname.toLowerCase();
    const isConsoleHost =
      host === 'platform.moonshot.cn' ||
      host === 'platform.moonshot.ai' ||
      host === 'platform.kimi.com' ||
      host === 'kimi.moonshot.cn' ||
      host === 'moonshot.cn' ||
      host === 'www.moonshot.cn';

    // Kimi 的控制台和官网不是 OpenAI-compatible API 入口，统一回落到官方 API baseURL。
    if (isConsoleHost || lowerPath.includes('/console')) {
      return fallback;
    }

    if (host === 'api.moonshot.cn' || host === 'api.moonshot.ai') {
      return `${url.protocol}//${host}/v1`;
    }

    return baseURL;
  } catch {
    return fallback;
  }
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
