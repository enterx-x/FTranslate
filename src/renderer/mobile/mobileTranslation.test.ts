import { describe, expect, it } from 'vitest';
import {
  applyAcademicTerminologyPolicy,
  MOBILE_AI_PAGE_REFLOW_VERSION,
  buildAcademicPageReflowPrompt,
  buildAcademicSelectionQuestionPrompt,
  buildAcademicSelectionPrompt,
  buildAcademicTranslationPrompt,
  buildTranslationEndpoint,
  hasSufficientAcademicPageCoverage,
  needsAcademicPageAiReview,
  parseAcademicPageReflowResult,
  parseAcademicPageReflowResponse,
  validateMobileTranslationSession
} from './mobileTranslation';

describe('mobile translation request', () => {
  it('normalizes OpenAI-compatible endpoints', () => {
    expect(buildTranslationEndpoint('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    expect(buildTranslationEndpoint('https://example.test/chat/completions')).toBe('https://example.test/chat/completions');
  });

  it('uses a strict academic translation prompt', () => {
    const messages = buildAcademicTranslationPrompt('Eq. (3) keeps h(x) >= 0.', {
      documentTitle: 'Safe Reinforcement Learning',
      introducedTerms: [{ english: 'Control Barrier Function', chinese: '控制障碍函数' }]
    });
    expect(messages[0].content).toContain('保留公式');
    expect(messages[0].content).toContain('English（中文释义）');
    expect(JSON.parse(messages[1].content)).toEqual({
      text: 'Eq. (3) keeps h(x) >= 0.',
      documentContext: {
        documentTitle: 'Safe Reinforcement Learning',
        introducedTerms: [{ english: 'Control Barrier Function', chinese: '控制障碍函数' }],
        previousBilingualParagraphs: []
      }
    });
  });

  it('uses surrounding paper context for concise selection translation', () => {
    const messages = buildAcademicSelectionPrompt('barrier certificate', {
      documentTitle: 'Safe Reinforcement Learning with Control Barrier Functions',
      surroundingOriginal: 'The barrier certificate guarantees forward invariance.',
      surroundingTranslation: '屏障证书保证前向不变性。'
    });
    expect(messages[0].content).toContain('当前研究语境');
    expect(messages[0].content).toContain('只输出简洁中文译文');
    expect(JSON.parse(messages[1].content)).toEqual({
      selection: 'barrier certificate',
      documentTitle: 'Safe Reinforcement Learning with Control Barrier Functions',
      surroundingOriginal: 'The barrier certificate guarantees forward invariance.',
      surroundingTranslation: '屏障证书保证前向不变性。'
    });
  });

  it('grounds a selection question in the selected excerpt and its paragraph context', () => {
    const messages = buildAcademicSelectionQuestionPrompt(
      'The barrier certificate guarantees forward invariance.',
      '这里的 forward invariance 对安全强化学习意味着什么？',
      {
        documentTitle: 'Safe Reinforcement Learning with Control Barrier Functions',
        surroundingOriginal: 'The barrier certificate guarantees forward invariance under the learned policy.',
        surroundingTranslation: '屏障证书保证学习策略下的前向不变性。'
      }
    );
    expect(messages[0].content).toContain('科研论文选段问答助手');
    expect(messages[0].content).toContain('区分原文直接支持的结论与合理推断');
    expect(messages[0].content).toContain('信息不足');
    expect(JSON.parse(messages[1].content)).toEqual({
      selection: 'The barrier certificate guarantees forward invariance.',
      question: '这里的 forward invariance 对安全强化学习意味着什么？',
      documentTitle: 'Safe Reinforcement Learning with Control Barrier Functions',
      surroundingOriginal: 'The barrier certificate guarantees forward invariance under the learned policy.',
      surroundingTranslation: '屏障证书保证学习策略下的前向不变性。'
    });
  });

  it('validates configured translation endpoints before sending a request', () => {
    expect(validateMobileTranslationSession({ baseURL: '', model: '', apiKey: '' })).toBe('');
    expect(validateMobileTranslationSession({ baseURL: '', model: '', apiKey: '' }, true))
      .toBe('开始翻译前请填写 API Key。');
    expect(validateMobileTranslationSession({ baseURL: '', model: 'deepseek-chat', apiKey: 'key' }))
      .toBe('请填写 Base URL。');
    expect(validateMobileTranslationSession({ baseURL: 'not-a-url', model: 'deepseek-chat', apiKey: 'key' }))
      .toBe('Base URL 不是有效网址。');
    expect(validateMobileTranslationSession({ baseURL: 'ftp://example.com', model: 'deepseek-chat', apiKey: 'key' }))
      .toBe('Base URL 只支持 http:// 或 https:// 地址。');
    expect(validateMobileTranslationSession({ baseURL: 'https://api.deepseek.com/v1', model: '', apiKey: 'key' }))
      .toBe('请填写模型名称。');
    expect(validateMobileTranslationSession({
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'key'
    })).toBe('');
  });

  it('marks legacy translations for one-time dual-view AI review', () => {
    expect(needsAcademicPageAiReview(undefined)).toBe(true);
    expect(needsAcademicPageAiReview({})).toBe(true);
    expect(needsAcademicPageAiReview({ aiReflowVersion: MOBILE_AI_PAGE_REFLOW_VERSION })).toBe(false);
    expect(needsAcademicPageAiReview({ aiReflowVersion: MOBILE_AI_PAGE_REFLOW_VERSION - 1 })).toBe(true);
  });

  it('asks DeepSeek to conservatively reflow extracted text without inventing content', () => {
    const messages = buildAcademicPageReflowPrompt([
      { index: 0, type: 'paragraph', text: 'The inter-' },
      { index: 1, type: 'paragraph', text: 'action remains stable.' }
    ], {
      documentTitle: 'Learning with Touch Dreaming',
      introducedTerms: [{ english: 'Touch Dreaming', chinese: '触觉梦境' }],
      previousBilingualParagraphs: [{
        original: 'We introduce Touch Dreaming for contact-rich manipulation.',
        translation: '我们提出 Touch Dreaming（触觉梦境），用于接触丰富的操作。',
        type: 'paragraph'
      }]
    });
    expect(messages[0].content).toContain('不得补写输入中不存在的论文内容');
    expect(messages[0].content).toContain('拆开被错误粘连的不同自然段');
    expect(messages[0].content).toContain('正确的段落边界不得随意改动');
    expect(messages[0].content).toContain('JSON');
    const payload = JSON.parse(messages[1].content) as {
      blocks: Array<{ index: number; type: string; text: string }>;
      continuousText: string;
      documentContext: {
        documentTitle: string;
        introducedTerms: Array<{ english: string; chinese: string }>;
        previousBilingualParagraphs: Array<{ original: string; translation: string; type: string }>;
      };
    };
    expect(payload.blocks).toEqual([
      { index: 0, type: 'paragraph', text: 'The inter-' },
      { index: 1, type: 'paragraph', text: 'action remains stable.' }
    ]);
    expect(payload.continuousText).toBe('The inter- action remains stable.');
    expect(payload.documentContext.documentTitle).toBe('Learning with Touch Dreaming');
    expect(payload.documentContext.introducedTerms).toEqual([
      { english: 'Touch Dreaming', chinese: '触觉梦境' }
    ]);
    expect(payload.documentContext.previousBilingualParagraphs[0]?.translation)
      .toContain('Touch Dreaming（触觉梦境）');
  });

  it('parses newly introduced proper terms and enforces first-use formatting', () => {
    const result = parseAcademicPageReflowResult(JSON.stringify({
      paragraphs: [{
        original: 'We use Touch Dreaming and Humanoid Transformer for manipulation.',
        translation: '我们使用 Touch Dreaming（触觉梦境）和 Humanoid Transformer 进行操作。',
        type: 'paragraph'
      }],
      terminology: [{ english: 'Humanoid Transformer', chinese: '人形机器人 Transformer' }]
    }));
    expect(result.terminology).toEqual([
      { english: 'Humanoid Transformer', chinese: '人形机器人 Transformer' }
    ]);
    expect(applyAcademicTerminologyPolicy(
      result.paragraphs,
      [{ english: 'Touch Dreaming', chinese: '触觉梦境' }],
      result.terminology
    )[0]?.translation).toBe(
      '我们使用 Touch Dreaming 和 Humanoid Transformer（人形机器人 Transformer）进行操作。'
    );
  });

  it('never reintroduces a term that the model incorrectly reports as new again', () => {
    const term = { english: 'Touch Dreaming', chinese: '触觉梦境' };
    expect(applyAcademicTerminologyPolicy([{
      original: 'Touch Dreaming improves contact-rich manipulation.',
      translation: 'Touch Dreaming（触觉梦境）改善了接触丰富的操作。',
      type: 'paragraph'
    }], [term], [term])[0]?.translation).toBe(
      'Touch Dreaming 改善了接触丰富的操作。'
    );
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
