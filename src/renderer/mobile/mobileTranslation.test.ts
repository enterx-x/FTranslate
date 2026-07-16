import { describe, expect, it } from 'vitest';
import {
  buildAcademicPageReflowPrompt,
  buildAcademicTranslationPrompt,
  buildTranslationEndpoint,
  hasSufficientAcademicPageCoverage,
  parseAcademicPageReflowResponse
} from './mobileTranslation';

describe('mobile translation request', () => {
  it('normalizes OpenAI-compatible endpoints', () => {
    expect(buildTranslationEndpoint('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    expect(buildTranslationEndpoint('https://example.test/chat/completions')).toBe('https://example.test/chat/completions');
  });

  it('uses a strict academic translation prompt', () => {
    const messages = buildAcademicTranslationPrompt('Eq. (3) keeps h(x) >= 0.');
    expect(messages[0].content).toContain('保留公式');
    expect(messages[1].content).toBe('Eq. (3) keeps h(x) >= 0.');
  });

  it('asks DeepSeek to reflow OCR only as a no-invention fallback', () => {
    const messages = buildAcademicPageReflowPrompt([
      { index: 0, type: 'paragraph', text: 'The inter-' },
      { index: 1, type: 'paragraph', text: 'action remains stable.' }
    ]);
    expect(messages[0].content).toContain('不得补写输入中不存在的论文内容');
    expect(messages[0].content).toContain('JSON');
    expect(messages[1].content).toContain('The inter-');
  });

  it('parses fenced page reflow JSON and rejects empty pairs', () => {
    expect(parseAcademicPageReflowResponse(`\`\`\`json
      {"paragraphs":[
        {"original":"The interaction remains stable.","translation":"该交互保持稳定。","type":"paragraph"},
        {"original":"","translation":"ignored","type":"paragraph"}
      ]}
    \`\`\``)).toEqual([
      { original: 'The interaction remains stable.', translation: '该交互保持稳定。', type: 'paragraph' }
    ]);
  });

  it('rejects an AI reflow that replaces the page with unrelated content', () => {
    const input = [{ index: 0, type: 'paragraph' as const, text: 'The controller preserves safe whole-body execution.' }];
    expect(hasSufficientAcademicPageCoverage(input, [{
      original: 'The controller preserves safe whole-body execution.',
      translation: '控制器保持安全的全身执行。',
      type: 'paragraph'
    }])).toBe(true);
    expect(hasSufficientAcademicPageCoverage(input, [{
      original: 'A completely unrelated invented conclusion about another experiment.',
      translation: '无关内容。',
      type: 'paragraph'
    }])).toBe(false);
  });
});
