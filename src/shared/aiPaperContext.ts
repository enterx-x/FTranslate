import { type AiProviderSettings, normalizeAiProviderSettings } from './aiTranslation';

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
  };
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
  const normalized = normalizeAiProviderSettings(settings);
  return {
    url: `${normalized.baseURL.replace(/\/+$/u, '')}/responses`,
    body: {
      model: normalized.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              file_id: fileId
            },
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }
      ]
    }
  };
}

export function buildOpenAiPdfDataResponseRequest(
  settings: AiProviderSettings,
  filename: string,
  fileData: string,
  prompt: string
): OpenAiPdfResponseRequest {
  const normalized = normalizeAiProviderSettings(settings);
  return {
    url: `${normalized.baseURL.replace(/\/+$/u, '')}/responses`,
    body: {
      model: normalized.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename,
              file_data: fileData
            },
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }
      ]
    }
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
