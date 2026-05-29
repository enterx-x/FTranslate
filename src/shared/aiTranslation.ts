export type AiProviderId = 'openai' | 'deepseek' | 'kimi' | 'custom';
export type AiTranslatableBlockType = 'heading' | 'paragraph' | 'formula' | 'caption';
export type AiThinkingMode = 'auto' | 'enabled' | 'disabled';
export type AiReasoningEffort = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AiProviderSettings {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  thinkingMode?: AiThinkingMode;
  reasoningEffort?: AiReasoningEffort;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
}

export interface AiModelOption {
  value: string;
  label: string;
}

export interface AiTranslationItem {
  section: string;
  original: string;
  translation: string;
  type?: AiTranslatableBlockType;
  sectionId?: string;
  sectionOrder?: number;
  paragraphOrder?: number;
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
      type: 'enabled' | 'disabled';
    };
    top_p?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    reasoning_effort?: Exclude<AiReasoningEffort, 'auto'>;
  };
}

export interface GenericChatCompletionInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface AiBalanceRequest {
  supported: boolean;
  url?: string;
  reason?: string;
}

export interface AiModelsRequest {
  supported: boolean;
  url?: string;
  reason?: string;
}

export const AI_PROVIDER_PRESETS: Record<Exclude<AiProviderId, 'custom'>, AiProviderSettings> = {
  openai: {
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5.5'
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

export const AI_PROVIDER_MODEL_OPTIONS: Record<Exclude<AiProviderId, 'custom'>, AiModelOption[]> = {
  openai: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.4-nano', label: 'gpt-5.4-nano' },
    { value: 'gpt-5.2-pro', label: 'gpt-5.2-pro' },
    { value: 'gpt-5.2', label: 'gpt-5.2' },
    { value: 'gpt-5.2-chat-latest', label: 'gpt-5.2-chat-latest' },
    { value: 'gpt-5.1-chat-latest', label: 'gpt-5.1-chat-latest' },
    { value: 'gpt-5.1', label: 'gpt-5.1' },
    { value: 'gpt-5-chat-latest', label: 'gpt-5-chat-latest' },
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-5-nano', label: 'gpt-5-nano' },
    { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
    { value: 'gpt-4.1', label: 'gpt-4.1' },
    { value: 'gpt-4.1-nano', label: 'gpt-4.1-nano' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    { value: 'gpt-4o', label: 'gpt-4o' }
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'deepseek-chat' },
    { value: 'deepseek-reasoner', label: 'deepseek-reasoner' },
    { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
    { value: 'deepseek-v4', label: 'deepseek-v4' },
    { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    { value: 'deepseek-v3.2-exp', label: 'deepseek-v3.2-exp' }
  ],
  kimi: [
    { value: 'kimi-k2.6', label: 'kimi-k2.6' },
    { value: 'kimi-k2.5', label: 'kimi-k2.5' },
    { value: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' },
    { value: 'kimi-k2-0905-preview', label: 'kimi-k2-0905-preview' },
    { value: 'kimi-k2-0711-preview', label: 'kimi-k2-0711-preview' },
    { value: 'kimi-latest', label: 'kimi-latest' },
    { value: 'kimi-thinking-preview', label: 'kimi-thinking-preview' },
    { value: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
    { value: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
    { value: 'moonshot-v1-128k', label: 'moonshot-v1-128k' }
  ]
};

export interface ResolvedAiRuntimeOptions {
  thinkingMode: AiThinkingMode;
  reasoningEffort: AiReasoningEffort;
  temperature: number;
  topP?: number;
  maxTokens?: number;
  timeoutSeconds: number;
  maxRetries: number;
}

export const AI_THINKING_MODE_OPTIONS: Array<{ value: AiThinkingMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'disabled', label: '关闭思考' },
  { value: 'enabled', label: '开启思考' }
];

export const AI_REASONING_EFFORT_OPTIONS: Array<{ value: AiReasoningEffort; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'none', label: '不使用推理' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' }
];

export function resolveAiRuntimeOptions(settings: AiProviderSettings): ResolvedAiRuntimeOptions {
  const normalizedSettings = normalizeAiProviderSettings(settings);
  const isKimiK2 = isKimiK2Model(normalizedSettings);
  const isKimiThinkingModel = isKimiK2 && normalizedSettings.model.toLowerCase().includes('thinking');
  const explicitThinking = normalizedSettings.thinkingMode ?? 'auto';
  const thinkingMode: AiThinkingMode =
    isKimiK2
      ? isKimiThinkingModel
        ? explicitThinking === 'disabled'
          ? 'disabled'
          : 'enabled'
        : 'disabled'
      : explicitThinking;
  const defaultTemperature = isKimiK2
    ? thinkingMode === 'enabled'
      ? 1
      : 0.6
    : normalizedSettings.provider === 'openai'
      ? 0.2
      : 0.2;

  return {
    thinkingMode,
    reasoningEffort: normalizedSettings.reasoningEffort ?? 'auto',
    temperature: isKimiK2 ? defaultTemperature : normalizedSettings.temperature ?? defaultTemperature,
    topP: isKimiK2 ? 0.95 : normalizedSettings.topP,
    maxTokens: normalizedSettings.maxTokens,
    timeoutSeconds: normalizedSettings.timeoutSeconds ?? 120,
    maxRetries: normalizedSettings.maxRetries ?? 1
  };
}

export function withDefaultAiRuntimeOptions(settings: AiProviderSettings): AiProviderSettings {
  const normalizedSettings = normalizeAiProviderSettings(settings);
  const runtime = resolveAiRuntimeOptions(normalizedSettings);

  return {
    ...normalizedSettings,
    thinkingMode: normalizedSettings.thinkingMode ?? runtime.thinkingMode,
    reasoningEffort: normalizedSettings.reasoningEffort ?? runtime.reasoningEffort,
    temperature: normalizedSettings.temperature ?? runtime.temperature,
    topP: normalizedSettings.topP ?? runtime.topP,
    maxTokens: normalizedSettings.maxTokens,
    timeoutSeconds: normalizedSettings.timeoutSeconds ?? runtime.timeoutSeconds,
    maxRetries: normalizedSettings.maxRetries ?? runtime.maxRetries
  };
}

export function describeAiRuntimeOptions(settings: AiProviderSettings): string {
  const normalizedSettings = normalizeAiProviderSettings(settings);
  const runtime = resolveAiRuntimeOptions(normalizedSettings);

  if (isKimiK2Model(normalizedSettings)) {
    return runtime.thinkingMode === 'enabled'
      ? 'Kimi K2 系列开启思考时使用 temperature=1，适合复杂分析；生成双语 PDF 会同步传给 pdf2zh。'
      : 'Kimi K2 系列关闭思考时使用 temperature=0.6、top_p=0.95，避免 invalid temperature，并会向 API 传 thinking disabled。';
  }

  if (normalizedSettings.provider === 'openai') {
    return `OpenAI 会使用 temperature=${runtime.temperature}，reasoning=${runtime.reasoningEffort}，PDF/表格分析会按该推理强度请求。`;
  }

  return `当前请求会使用 temperature=${runtime.temperature}${runtime.topP ? `，top_p=${runtime.topP}` : ''}，超时 ${runtime.timeoutSeconds}s，重试 ${runtime.maxRetries} 次。`;
}

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
          '如果原文包含数学表达式，请用 LaTeX 定界符保留：行内公式使用 $...$，独立公式使用 $$...$$。',
          '只输出中文译文，不要解释，不要添加 Markdown 代码块。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [`Section: ${item.section || 'Untitled'}`, '', item.original].join('\n')
      }
    ]
  };

  applyRuntimeOptionsToChatBody(body, normalizedSettings);

  return {
    url: buildChatCompletionsUrl(normalizedSettings.baseURL),
    body
  };
}

export function buildGenericChatCompletionRequest(
  settings: AiProviderSettings,
  input: GenericChatCompletionInput
): ChatCompletionRequest {
  const normalizedSettings = normalizeAiProviderSettings(settings);
  const body: ChatCompletionRequest['body'] = {
    model: normalizedSettings.model,
    messages: [
      {
        role: 'system',
        content: input.systemPrompt
      },
      {
        role: 'user',
        content: input.userPrompt
      }
    ]
  };

  applyRuntimeOptionsToChatBody(body, normalizedSettings);

  return {
    url: buildChatCompletionsUrl(normalizedSettings.baseURL),
    body
  };
}

export function buildChatCompletionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/chat/completions`;
}

export function buildAiBalanceRequest(
  settings: AiProviderSettings,
  nowSeconds = Math.floor(Date.now() / 1000)
): AiBalanceRequest {
  const normalizedSettings = normalizeAiProviderSettings(settings);

  if (normalizedSettings.provider === 'kimi') {
    return {
      supported: true,
      url: `${normalizedSettings.baseURL.replace(/\/+$/u, '')}/users/me/balance`
    };
  }

  if (normalizedSettings.provider === 'deepseek') {
    return {
      supported: true,
      url: `${getUrlOrigin(normalizedSettings.baseURL)}/user/balance`
    };
  }

  if (normalizedSettings.provider === 'openai') {
    const sevenDaysAgo = Math.max(0, nowSeconds - 7 * 24 * 60 * 60);
    return {
      supported: true,
      url: `${getUrlOrigin(normalizedSettings.baseURL)}/v1/organization/costs?start_time=${sevenDaysAgo}&limit=7`
    };
  }

  return {
    supported: false,
    reason: 'Custom Provider 没有统一余额接口，请在对应服务商控制台查看。'
  };
}

export function buildAiModelsRequest(settings: AiProviderSettings): AiModelsRequest {
  const normalizedSettings = normalizeAiProviderSettings(settings);

  if (normalizedSettings.provider === 'custom') {
    return {
      supported: false,
      reason: 'Custom Provider 没有统一模型列表接口，请手动填写模型名。'
    };
  }

  return {
    supported: true,
    url: `${normalizedSettings.baseURL.replace(/\/+$/u, '')}/models`
  };
}

export function parseAiModelsResponse(responseText: string): AiModelOption[] {
  const parsed = parseJsonObject(responseText);
  const data = Array.isArray(parsed.data) ? parsed.data : [];

  return data
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const id = readString(entry.id);
      return id ? { value: id, label: id } : null;
    })
    .filter((option): option is AiModelOption => Boolean(option));
}

export function mergeAiModelOptions(
  fallbackOptions: AiModelOption[],
  apiOptions: AiModelOption[],
  currentModel?: string
): AiModelOption[] {
  const merged: AiModelOption[] = [];
  const seen = new Set<string>();

  const addOption = (option: AiModelOption | null): void => {
    if (!option || !option.value || seen.has(option.value)) {
      return;
    }

    seen.add(option.value);
    merged.push(option);
  };

  if (currentModel?.trim()) {
    addOption({ value: currentModel.trim(), label: currentModel.trim() });
  }

  apiOptions.forEach(addOption);
  fallbackOptions.forEach(addOption);
  return merged;
}

export function parseAiBalanceResponse(provider: AiProviderId, responseText: string): string {
  const parsed = parseJsonObject(responseText);

  if (provider === 'deepseek') {
    const balanceInfos = Array.isArray(parsed.balance_infos) ? parsed.balance_infos : [];
    const formattedInfos = balanceInfos
      .map((info) => (isRecord(info) ? formatDeepSeekBalanceInfo(info) : ''))
      .filter(Boolean);

    if (formattedInfos.length > 0) {
      return formattedInfos.join('；');
    }
  }

  if (provider === 'kimi') {
    const data = isRecord(parsed.data) ? parsed.data : parsed;
    const available =
      readString(data.available_balance) ?? readString(data.balance) ?? readString(data.total_balance);
    const cash = readString(data.cash_balance);
    const voucher = readString(data.voucher_balance);
    const parts = [
      available ? `可用余额 ${available}` : '',
      cash ? `现金 ${cash}` : '',
      voucher ? `赠金 ${voucher}` : ''
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join('，');
    }
  }

  if (provider === 'openai') {
    const summary = formatOpenAiCosts(parsed);

    if (summary) {
      return summary;
    }
  }

  return responseText.slice(0, 400);
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
    model: normalizedModel,
    thinkingMode: normalizeThinkingMode(settings.thinkingMode),
    reasoningEffort: normalizeReasoningEffort(settings.reasoningEffort),
    temperature: normalizeNumberOption(settings.temperature, 0, 2),
    topP: normalizeNumberOption(settings.topP, 0, 1),
    maxTokens: normalizeIntegerOption(settings.maxTokens, 1, 1_000_000),
    timeoutSeconds: normalizeIntegerOption(settings.timeoutSeconds, 10, 1800),
    maxRetries: normalizeIntegerOption(settings.maxRetries, 0, 8)
  };
}

function applyRuntimeOptionsToChatBody(
  body: ChatCompletionRequest['body'],
  settings: AiProviderSettings
): void {
  const normalizedSettings = normalizeAiProviderSettings(settings);
  const runtime = resolveAiRuntimeOptions(normalizedSettings);

  body.temperature = runtime.temperature;

  if (typeof runtime.topP === 'number') {
    body.top_p = runtime.topP;
  }

  if (normalizedSettings.provider === 'kimi' && isKimiK2Model(normalizedSettings)) {
    body.thinking = { type: runtime.thinkingMode === 'enabled' ? 'enabled' : 'disabled' };
  }

  if (runtime.maxTokens) {
    if (normalizedSettings.provider === 'openai') {
      body.max_completion_tokens = runtime.maxTokens;
    } else {
      body.max_tokens = runtime.maxTokens;
    }
  }

  if (
    normalizedSettings.provider === 'openai' &&
    runtime.reasoningEffort !== 'auto' &&
    runtime.reasoningEffort !== 'none'
  ) {
    body.reasoning_effort = runtime.reasoningEffort;
  }
}

export function isKimiK2Model(settings: AiProviderSettings): boolean {
  return settings.provider === 'kimi' && settings.model.trim().toLowerCase().startsWith('kimi-k2');
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

function normalizeThinkingMode(value: unknown): AiThinkingMode | undefined {
  return value === 'auto' || value === 'enabled' || value === 'disabled' ? value : undefined;
}

function normalizeReasoningEffort(value: unknown): AiReasoningEffort | undefined {
  return value === 'auto' ||
    value === 'none' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : undefined;
}

function normalizeNumberOption(value: unknown, min: number, max: number): number | undefined {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function normalizeIntegerOption(value: unknown, min: number, max: number): number | undefined {
  const numericValue = normalizeNumberOption(value, min, max);
  return typeof numericValue === 'number' ? Math.round(numericValue) : undefined;
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

function getUrlOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/u, '');
  }
}

function parseJsonObject(responseText: string): Record<string, unknown> {
  const parsed = JSON.parse(responseText) as unknown;

  if (!isRecord(parsed)) {
    return {};
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function formatDeepSeekBalanceInfo(info: Record<string, unknown>): string {
  const currency = readString(info.currency) ?? '余额';
  const total = readString(info.total_balance) ?? readString(info.balance) ?? readString(info.available_balance);
  const granted = readString(info.granted_balance);
  const toppedUp = readString(info.topped_up_balance);
  const details = [
    total ? `${currency} ${total}` : '',
    granted ? `赠金 ${granted}` : '',
    toppedUp ? `充值 ${toppedUp}` : ''
  ].filter(Boolean);

  return details.join('，');
}

function formatOpenAiCosts(parsed: Record<string, unknown>): string | null {
  const buckets = Array.isArray(parsed.data) ? parsed.data : [];
  const totalsByCurrency = new Map<string, number>();

  buckets.forEach((bucket) => {
    if (!isRecord(bucket) || !Array.isArray(bucket.results)) {
      return;
    }

    bucket.results.forEach((result) => {
      if (!isRecord(result) || !isRecord(result.amount)) {
        return;
      }

      const amount = typeof result.amount.value === 'number' ? result.amount.value : Number(result.amount.value);
      if (!Number.isFinite(amount)) {
        return;
      }

      const currency = (readString(result.amount.currency) ?? 'usd').toUpperCase();
      totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + amount);
    });
  });

  if (totalsByCurrency.size === 0) {
    return null;
  }

  const totals = [...totalsByCurrency.entries()]
    .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
    .join('，');

  return `近 7 天成本 ${totals}`;
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
