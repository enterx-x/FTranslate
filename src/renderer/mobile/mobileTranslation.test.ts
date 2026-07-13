import { describe, expect, it } from 'vitest';
import { buildAcademicTranslationPrompt, buildTranslationEndpoint } from './mobileTranslation';

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
});
