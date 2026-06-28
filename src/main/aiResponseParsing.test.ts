import { describe, expect, it } from 'vitest';
import {
  parseChatCompletionContent,
  formatAiErrorBody,
  parseKimiFileUploadId,
  parseOpenAiFileUploadId,
  parseOpenAiResponsesContent,
  parseProviderTextPayload
} from './aiResponseParsing';

describe('AI response parsing', () => {
  it('extracts chat completion message text', () => {
    expect(
      parseChatCompletionContent(
        JSON.stringify({
          choices: [{ message: { content: '  translated text  ' } }]
        })
      )
    ).toBe('translated text');
  });

  it('throws a friendly error for malformed chat completion JSON', () => {
    expect(() => parseChatCompletionContent('{ bad json')).toThrow('AI 响应不是有效 JSON。');
  });

  it('extracts OpenAI Responses direct output text', () => {
    expect(parseOpenAiResponsesContent(JSON.stringify({ output_text: '  response text  ' }))).toBe(
      'response text'
    );
  });

  it('throws a friendly error for malformed OpenAI Responses JSON', () => {
    expect(() => parseOpenAiResponsesContent('{ bad json')).toThrow('AI 响应不是有效 JSON。');
  });

  it('extracts OpenAI file upload id', () => {
    expect(parseOpenAiFileUploadId(JSON.stringify({ id: 'file-123' }))).toBe('file-123');
  });

  it('throws a friendly error for malformed OpenAI file upload JSON', () => {
    expect(() => parseOpenAiFileUploadId('{ bad json')).toThrow('OpenAI 文件上传响应不是有效 JSON。');
  });

  it('extracts Kimi file upload id from direct and nested payloads', () => {
    expect(parseKimiFileUploadId(JSON.stringify({ id: 'kimi-direct' }))).toBe('kimi-direct');
    expect(parseKimiFileUploadId(JSON.stringify({ data: { id: 'kimi-nested' } }))).toBe('kimi-nested');
  });

  it('throws a friendly error for malformed Kimi file upload JSON', () => {
    expect(() => parseKimiFileUploadId('{ bad json')).toThrow('Kimi 文件上传响应不是有效 JSON。');
  });

  it('extracts provider text payloads without changing raw non-JSON text', () => {
    expect(parseProviderTextPayload(JSON.stringify({ content: '  extracted content  ' }))).toBe('extracted content');
    expect(parseProviderTextPayload(JSON.stringify({ data: { text: 'nested text' } }))).toBe('nested text');
    expect(parseProviderTextPayload('plain provider text')).toBe('plain provider text');
  });

  it('formats provider error bodies with JSON fallback', () => {
    expect(
      formatAiErrorBody(
        JSON.stringify({
          error: { message: 'quota exceeded', type: 'rate_limit', code: 429 }
        })
      )
    ).toBe('quota exceeded / rate_limit / 429');
    expect(formatAiErrorBody('x'.repeat(900))).toHaveLength(800);
  });
});
