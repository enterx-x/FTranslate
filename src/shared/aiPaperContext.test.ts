import { describe, expect, it } from 'vitest';
import {
  buildOpenAiPdfDataResponseRequest,
  buildOpenAiPdfResponseRequest,
  buildOpenAiResponsesRequest,
  buildKimiFileExtractRequest,
  getPaperContextStrategy
} from './aiPaperContext';
import { AI_PROVIDER_PRESETS } from './aiTranslation';

describe('AI paper context provider strategy', () => {
  it('uses OpenAI Responses PDF input for OpenAI providers', () => {
    const request = buildOpenAiPdfResponseRequest(
      AI_PROVIDER_PRESETS.openai,
      'file-abc',
      '只输出单元格内容。'
    );

    expect(getPaperContextStrategy(AI_PROVIDER_PRESETS.openai).mode).toBe('openai-pdf-input');
    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.body.model).toBe(AI_PROVIDER_PRESETS.openai.model);
    expect(JSON.stringify(request.body)).toContain('file-abc');
    expect(JSON.stringify(request.body)).toContain('只输出单元格内容。');
  });

  it('can use base64 PDF data for OpenAI Responses input_file', () => {
    const request = buildOpenAiPdfDataResponseRequest(
      AI_PROVIDER_PRESETS.openai,
      'paper.pdf',
      'data:application/pdf;base64,AAAA',
      'Fill current cell'
    );

    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.body.input[0].content[0]).toEqual({
      type: 'input_file',
      filename: 'paper.pdf',
      file_data: 'data:application/pdf;base64,AAAA'
    });
  });

  it('applies runtime options to generic OpenAI Responses requests', () => {
    const request = buildOpenAiResponsesRequest(
      {
        provider: 'openai',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-5',
        temperature: 0.4,
        topP: 0.9,
        maxTokens: 4096,
        reasoningEffort: 'high'
      },
      [
        {
          type: 'input_file',
          file_id: 'file-1'
        },
        {
          type: 'input_file',
          file_id: 'file-2'
        },
        {
          type: 'input_text',
          text: 'Compare these papers.'
        }
      ],
      { enableWebSearch: true }
    );

    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.body.temperature).toBe(0.4);
    expect(request.body.top_p).toBe(0.9);
    expect(request.body.max_output_tokens).toBe(4096);
    expect(request.body.reasoning).toEqual({ effort: 'high' });
    expect(request.body.input[0].content).toEqual([
      { type: 'input_file', file_id: 'file-1' },
      { type: 'input_file', file_id: 'file-2' },
      { type: 'input_text', text: 'Compare these papers.' }
    ]);
    expect(request.body.tools).toEqual([{ type: 'web_search_preview' }]);
  });

  it('uses Kimi file-extract before chat completion for Kimi providers', () => {
    const request = buildKimiFileExtractRequest(AI_PROVIDER_PRESETS.kimi, 'file-abc');

    expect(getPaperContextStrategy(AI_PROVIDER_PRESETS.kimi).mode).toBe('kimi-file-extract');
    expect(request.url).toBe('https://api.moonshot.cn/v1/files/file-abc/content');
  });

  it('falls back to local extracted text for DeepSeek and custom providers', () => {
    expect(getPaperContextStrategy(AI_PROVIDER_PRESETS.deepseek)).toEqual({
      mode: 'local-text',
      reason: '当前 Provider 不支持统一 PDF 文件上传，将使用本地 PDF 文本提取结果。'
    });
  });
});
