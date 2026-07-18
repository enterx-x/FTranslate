import { describe, expect, it } from 'vitest';
import {
  buildAcademicPageReflowPrompt,
  buildAcademicTranslationPrompt,
  buildTranslationEndpoint,
  hasSufficientAcademicPageCoverage,
  needsAcademicPageAiReview,
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

  it('marks legacy translations for one-time dual-view AI review', () => {
    expect(needsAcademicPageAiReview(undefined)).toBe(true);
    expect(needsAcademicPageAiReview({})).toBe(true);
    expect(needsAcademicPageAiReview({ aiReflowVersion: 1 })).toBe(false);
  });

  it('asks DeepSeek to conservatively reflow extracted text without inventing content', () => {
    const messages = buildAcademicPageReflowPrompt([
      { index: 0, type: 'paragraph', text: 'The inter-' },
      { index: 1, type: 'paragraph', text: 'action remains stable.' }
    ]);
    expect(messages[0].content).toContain('不得补写输入中不存在的论文内容');
    expect(messages[0].content).toContain('拆开被错误粘连的不同自然段');
    expect(messages[0].content).toContain('正确的段落边界不得随意改动');
    expect(messages[0].content).toContain('JSON');
    const payload = JSON.parse(messages[1].content) as {
      blocks: Array<{ index: number; type: string; text: string }>;
      continuousText: string;
    };
    expect(payload.blocks).toEqual([
      { index: 0, type: 'paragraph', text: 'The inter-' },
      { index: 1, type: 'paragraph', text: 'action remains stable.' }
    ]);
    expect(payload.continuousText).toBe('The inter- action remains stable.');
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

  it('rejects a page response that silently drops repeated source content', () => {
    const input = [
      { index: 0, type: 'paragraph' as const, text: 'The controller preserves contact stability during every manipulation trial.' },
      { index: 1, type: 'paragraph' as const, text: 'The controller preserves contact stability during every evaluation trial.' },
      { index: 2, type: 'paragraph' as const, text: 'The controller preserves contact stability during every deployment trial.' }
    ];
    expect(hasSufficientAcademicPageCoverage(input, [{
      original: input[0].text,
      translation: '控制器在每次操作试验中保持接触稳定性。',
      type: 'paragraph'
    }])).toBe(false);
  });
});
