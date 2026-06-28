import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_MODEL_OPTIONS, type AiModelOption } from '../../shared/aiTranslation';
import { getModelOptionsForProvider } from './useAiSettings';

describe('getModelOptionsForProvider', () => {
  it('uses runtime options for built-in providers and returns none for custom provider', () => {
    const runtimeOptions: AiModelOption[] = [{ value: 'runtime-model', label: 'Runtime Model' }];

    expect(
      getModelOptionsForProvider('deepseek', { deepseek: runtimeOptions })
    ).toBe(runtimeOptions);
    expect(getModelOptionsForProvider('custom', { deepseek: runtimeOptions })).toEqual([]);
    expect(getModelOptionsForProvider('kimi', {})).toBe(AI_PROVIDER_MODEL_OPTIONS.kimi);
  });
});
