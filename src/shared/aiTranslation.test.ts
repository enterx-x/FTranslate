import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_PRESETS,
  AI_PROVIDER_MODEL_OPTIONS,
  buildAiBalanceRequest,
  buildAiModelsRequest,
  applyAiTranslationResult,
  buildGenericChatCompletionRequest,
  buildChatCompletionRequest,
  mergeAiModelOptions,
  parseAiModelsResponse,
  parseAiBalanceResponse,
  shouldTranslateItem
} from './aiTranslation';

describe('AI translation helpers', () => {
  it('uses OpenAI-compatible provider presets', () => {
    expect(AI_PROVIDER_PRESETS.openai.baseURL).toBe('https://api.openai.com/v1');
    expect(AI_PROVIDER_PRESETS.openai.model).toBe('gpt-5.5');
    expect(AI_PROVIDER_PRESETS.deepseek.baseURL).toBe('https://api.deepseek.com/v1');
    expect(AI_PROVIDER_PRESETS.kimi.baseURL).toBe('https://api.moonshot.cn/v1');
    expect(AI_PROVIDER_PRESETS.kimi.model).toBe('kimi-k2.5');
  });

  it('exposes provider model options for quick model switching', () => {
    expect(AI_PROVIDER_MODEL_OPTIONS.openai.map((option) => option.value)).toEqual(
      expect.arrayContaining(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'])
    );
    expect(AI_PROVIDER_MODEL_OPTIONS.deepseek.map((option) => option.value)).toContain('deepseek-chat');
    expect(AI_PROVIDER_MODEL_OPTIONS.deepseek.map((option) => option.value)).toContain('deepseek-v4-pro');
    expect(AI_PROVIDER_MODEL_OPTIONS.deepseek.map((option) => option.value)).toContain('deepseek-v4-flash');
    expect(AI_PROVIDER_MODEL_OPTIONS.kimi.map((option) => option.value)).toContain('kimi-k2.5');
    expect(AI_PROVIDER_MODEL_OPTIONS.kimi.map((option) => option.value)).toContain('kimi-k2.6');
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
    expect(request.body.messages[0].content).toContain('LaTeX');
    expect(request.body.messages[0].content).toContain('$...$');
    expect(request.body.messages[1].content).toContain('Foundation models');
    expect(request.body.temperature).toBe(0.2);
    expect(request.body.thinking).toBeUndefined();
  });

  it('builds a generic chat completions request for paper spreadsheet cells', () => {
    const request = buildGenericChatCompletionRequest(AI_PROVIDER_PRESETS.kimi, {
      systemPrompt: '你是科研表格助手。',
      userPrompt: '填写创新点。'
    });

    expect(request.url).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(request.body.model).toBe('kimi-k2.5');
    expect(request.body.messages).toEqual([
      { role: 'system', content: '你是科研表格助手。' },
      { role: 'user', content: '填写创新点。' }
    ]);
    expect(request.body.thinking).toEqual({ type: 'disabled' });
  });

  it('builds a Kimi K2.5 request without unsupported temperature override', () => {
    const request = buildChatCompletionRequest(
      AI_PROVIDER_PRESETS.kimi,
      {
        section: 'Abstract',
        original: 'Foundation models work on large and diverse datasets.',
        translation: '',
        type: 'paragraph'
      }
    );

    expect(request.url).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(request.body.model).toBe('kimi-k2.5');
    expect(request.body.temperature).toBeUndefined();
    expect(request.body.thinking).toEqual({ type: 'disabled' });
  });

  it('builds a Kimi K2.6 request with thinking disabled for translation', () => {
    const request = buildChatCompletionRequest(
      {
        provider: 'kimi',
        baseURL: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6'
      },
      {
        section: 'Abstract',
        original: 'Foundation models work on large and diverse datasets.',
        translation: '',
        type: 'paragraph'
      }
    );

    expect(request.body.model).toBe('kimi-k2.6');
    expect(request.body.temperature).toBeUndefined();
    expect(request.body.thinking).toEqual({ type: 'disabled' });
  });

  it('normalizes Kimi API host to include the required v1 path', () => {
    const request = buildChatCompletionRequest(
      {
        provider: 'kimi',
        baseURL: 'https://api.moonshot.cn',
        model: 'kimi-k2'
      },
      {
        section: 'Abstract',
        original: 'Foundation models work on large and diverse datasets.',
        translation: '',
        type: 'paragraph'
      }
    );

    expect(request.url).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(request.body.model).toBe('kimi-k2.5');
    expect(request.body.temperature).toBeUndefined();
    expect(request.body.thinking).toEqual({ type: 'disabled' });
  });

  it('normalizes Kimi console URLs to the API endpoint', () => {
    const request = buildChatCompletionRequest(
      {
        provider: 'kimi',
        baseURL: 'https://platform.moonshot.cn/console/api-keys',
        model: 'kimi-k2.5'
      },
      {
        section: 'Abstract',
        original: 'Foundation models work on large and diverse datasets.',
        translation: '',
        type: 'paragraph'
      }
    );

    expect(request.url).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(request.body.model).toBe('kimi-k2.5');
  });

  it('builds provider-specific balance requests where supported', () => {
    expect(buildAiBalanceRequest(AI_PROVIDER_PRESETS.kimi)).toMatchObject({
      supported: true,
      url: 'https://api.moonshot.cn/v1/users/me/balance'
    });
    expect(buildAiBalanceRequest(AI_PROVIDER_PRESETS.deepseek)).toMatchObject({
      supported: true,
      url: 'https://api.deepseek.com/user/balance'
    });
    const openAiBalanceRequest = buildAiBalanceRequest(AI_PROVIDER_PRESETS.openai, 1_730_419_200);
    expect(openAiBalanceRequest).toMatchObject({
      supported: true,
      url: 'https://api.openai.com/v1/organization/costs?start_time=1729814400&limit=7'
    });
  });

  it('builds OpenAI-compatible model list requests for saved providers', () => {
    expect(buildAiModelsRequest(AI_PROVIDER_PRESETS.openai)).toMatchObject({
      supported: true,
      url: 'https://api.openai.com/v1/models'
    });
    expect(buildAiModelsRequest(AI_PROVIDER_PRESETS.kimi)).toMatchObject({
      supported: true,
      url: 'https://api.moonshot.cn/v1/models'
    });
  });

  it('parses and merges provider model options returned by the API', () => {
    const apiOptions = parseAiModelsResponse(
      JSON.stringify({
        data: [{ id: 'kimi-k2.6' }, { id: 'kimi-k2.5' }, { id: 'moonshot-v1-128k' }]
      })
    );
    const merged = mergeAiModelOptions(
      [{ value: 'kimi-k2.5', label: 'kimi-k2.5' }],
      apiOptions,
      'kimi-k2-pro-preview'
    );

    expect(merged.map((option) => option.value)).toEqual([
      'kimi-k2-pro-preview',
      'kimi-k2.6',
      'kimi-k2.5',
      'moonshot-v1-128k'
    ]);
  });

  it('formats Kimi, DeepSeek, and OpenAI balance responses', () => {
    expect(
      parseAiBalanceResponse(
        'kimi',
        JSON.stringify({
          data: {
            available_balance: '12.50',
            cash_balance: '10.00',
            voucher_balance: '2.50'
          }
        })
      )
    ).toContain('可用余额 12.50');
    expect(
      parseAiBalanceResponse(
        'deepseek',
        JSON.stringify({
          is_available: true,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '88.00',
              granted_balance: '8.00',
              topped_up_balance: '80.00'
            }
          ]
        })
      )
    ).toContain('CNY 88.00');
    expect(
      parseAiBalanceResponse(
        'openai',
        JSON.stringify({
          data: [
            {
              results: [
                {
                  amount: {
                    value: 0.06,
                    currency: 'usd'
                  }
                }
              ]
            },
            {
              results: [
                {
                  amount: {
                    value: 1.25,
                    currency: 'usd'
                  }
                }
              ]
            }
          ]
        })
      )
    ).toBe('近 7 天成本 USD 1.31');
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
    expect(
      shouldTranslateItem({
        section: 'Title',
        original: 'A Robotic Foundation Model',
        translation: '',
        type: 'heading'
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
        model: 'kimi-k2.5'
      },
      '2026-05-26T12:00:00.000Z'
    );

    expect(updated.translation).toBe('中文译文');
    expect(updated.provider).toBe('kimi');
    expect(updated.model).toBe('kimi-k2.5');
    expect(updated.translatedAt).toBe('2026-05-26T12:00:00.000Z');
  });
});
