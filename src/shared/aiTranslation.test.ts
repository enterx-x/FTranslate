import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_PRESETS,
  applyAiTranslationResult,
  buildChatCompletionRequest,
  shouldTranslateItem
} from './aiTranslation';

describe('AI translation helpers', () => {
  it('uses OpenAI-compatible provider presets', () => {
    expect(AI_PROVIDER_PRESETS.openai.baseURL).toBe('https://api.openai.com/v1');
    expect(AI_PROVIDER_PRESETS.deepseek.baseURL).toBe('https://api.deepseek.com/v1');
    expect(AI_PROVIDER_PRESETS.kimi.baseURL).toBe('https://api.moonshot.cn/v1');
  });

  it('builds a chat completions request for an academic paragraph', () => {
    const request = buildChatCompletionRequest(
      {
        provider: 'deepseek',
        baseURL: 'https://api.deepseek.com/v1/',
        model: 'deepseek-chat'
      },
      {
        section: 'Abstract',
        original: 'Foundation models work on large and diverse datasets.',
        translation: '',
        type: 'paragraph'
      }
    );

    expect(request.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(request.body.model).toBe('deepseek-chat');
    expect(request.body.messages[0].role).toBe('system');
    expect(request.body.messages[1].content).toContain('Foundation models');
  });

  it('skips cached translations and non-translatable formula blocks', () => {
    expect(
      shouldTranslateItem({
        section: 'Intro',
        original: 'Already translated.',
        translation: '已有译文',
        type: 'paragraph'
      })
    ).toBe(false);
    expect(
      shouldTranslateItem({
        section: 'Equation',
        original: 'x_t = f(x, u)',
        translation: '',
        type: 'formula'
      })
    ).toBe(false);
  });

  it('allows forced retranslation of a cached paragraph', () => {
    expect(
      shouldTranslateItem(
        {
          section: 'Intro',
          original: 'Already translated.',
          translation: '已有译文',
          type: 'paragraph'
        },
        true
      )
    ).toBe(true);
  });

  it('applies translation result metadata for cache reuse', () => {
    const updated = applyAiTranslationResult(
      {
        section: 'Intro',
        original: 'Original paragraph.',
        translation: '',
        sourceHash: 'abc'
      },
      '中文译文',
      {
        provider: 'kimi',
        baseURL: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2'
      },
      '2026-05-26T12:00:00.000Z'
    );

    expect(updated.translation).toBe('中文译文');
    expect(updated.provider).toBe('kimi');
    expect(updated.model).toBe('kimi-k2');
    expect(updated.translatedAt).toBe('2026-05-26T12:00:00.000Z');
  });
});
