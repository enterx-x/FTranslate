import {
  type AiProviderSettings,
  normalizeAiProviderSettings,
  resolveAiRuntimeOptions
} from './aiTranslation';

export type PaperContextStrategyMode = 'openai-pdf-input' | 'kimi-file-extract' | 'local-text';

export interface PaperContextStrategy {
  mode: PaperContextStrategyMode;
  reason?: string;
}

export interface OpenAiPdfResponseRequest {
  url: string;
  body: {
    model: string;
    input: Array<{
      role: 'user';
      content: Array<
        | {
            type: 'input_text';
            text: string;
          }
        | {
            type: 'input_file';
            file_id: string;
          }
        | {
            type: 'input_file';
            filename: string;
            file_data: string;
          }
      >;
    }>;
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    reasoning?: {
      effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    };
    tools?: Array<{
      type: 'web_search_preview';
    }>;
  };
}

export type OpenAiResponsesInputContent = OpenAiPdfResponseRequest['body']['input'][number]['content'][number];

export interface OpenAiResponsesOptions {
  enableWebSearch?: boolean;
}

export interface KimiFileExtractRequest {
  url: string;
}

export function getPaperContextStrategy(settings: AiProviderSettings): PaperContextStrategy {
  const normalized = normalizeAiProviderSettings(settings);

  if (normalized.provider === 'openai') {
    return { mode: 'openai-pdf-input' };
  }

  if (normalized.provider === 'kimi') {
    return { mode: 'kimi-file-extract' };
  }

  return {
    mode: 'local-text',
    reason: '当前 Provider 不支持统一 PDF 文件上传，将使用本地 PDF 文本提取结果。'
  };
}

export function buildOpenAiPdfResponseRequest(
  settings: AiProviderSettings,
  fileId: string,
  prompt: string
): OpenAiPdfResponseRequest {
  return buildOpenAiResponsesRequest(settings, [
    {
      type: 'input_file',
      file_id: fileId
    },
    {
      type: 'input_text',
      text: prompt
    }
  ]);
}

export function buildOpenAiPdfDataResponseRequest(
  settings: AiProviderSettings,
  filename: string,
  fileData: string,
  prompt: string
): OpenAiPdfResponseRequest {
  return buildOpenAiResponsesRequest(settings, [
    {
      type: 'input_file',
      filename,
      file_data: fileData
    },
    {
      type: 'input_text',
      text: prompt
    }
  ]);
}

export function buildOpenAiResponsesRequest(
  settings: AiProviderSettings,
  content: OpenAiResponsesInputContent[],
  options: OpenAiResponsesOptions = {}
): OpenAiPdfResponseRequest {
  const normalized = normalizeAiProviderSettings(settings);
  const runtime = resolveAiRuntimeOptions(normalized);
  const body = withOpenAiRuntimeOptions(
    {
      model: normalized.model,
      input: [
        {
          role: 'user',
          content
        }
      ]
    },
    runtime
  );

  if (options.enableWebSearch) {
    // OpenAI Responses 内置 web_search_preview 工具用于运行时联网查新。
    body.tools = [{ type: 'web_search_preview' }];
  }

  return {
    url: `${normalized.baseURL.replace(/\/+$/u, '')}/responses`,
    body
  };
}

export function buildKimiFileExtractRequest(
  settings: AiProviderSettings,
  fileId: string
): KimiFileExtractRequest {
  const normalized = normalizeAiProviderSettings(settings);
  return {
    url: `${normalized.baseURL.replace(/\/+$/u, '')}/files/${encodeURIComponent(fileId)}/content`
  };
}

function withOpenAiRuntimeOptions(
  body: OpenAiPdfResponseRequest['body'],
  runtime: ReturnType<typeof resolveAiRuntimeOptions>
): OpenAiPdfResponseRequest['body'] {
  const next = { ...body };
  next.temperature = runtime.temperature;

  if (typeof runtime.topP === 'number') {
    next.top_p = runtime.topP;
  }

  if (runtime.maxTokens) {
    next.max_output_tokens = runtime.maxTokens;
  }

  if (runtime.reasoningEffort !== 'auto' && runtime.reasoningEffort !== 'none') {
    next.reasoning = { effort: runtime.reasoningEffort };
  }

  return next;
}
