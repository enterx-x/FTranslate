import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHyMt2Prompt,
  inferHyMt2RuntimeDevice,
  normalizeHyMt2Output,
  resolveHyMt2ModelCacheIdentity,
  resolveHyMt2ModelPath,
  resolveHyMt2ServerCommand
} from './hyMtTranslationService';

const originalServer = process.env.FTRANSLATE_HYMT_SERVER;
const originalModel = process.env.FTRANSLATE_HYMT_MODEL;

afterEach(() => {
  if (originalServer === undefined) {
    delete process.env.FTRANSLATE_HYMT_SERVER;
  } else {
    process.env.FTRANSLATE_HYMT_SERVER = originalServer;
  }
  if (originalModel === undefined) {
    delete process.env.FTRANSLATE_HYMT_MODEL;
  } else {
    process.env.FTRANSLATE_HYMT_MODEL = originalModel;
  }
});

describe('HY-MT2 local translation runtime', () => {
  it('uses explicit runtime paths before the stable local installation directory', () => {
    process.env.FTRANSLATE_HYMT_SERVER = 'D:\\translation\\llama-server.exe';
    process.env.FTRANSLATE_HYMT_MODEL = 'D:\\translation\\Hy-MT2.gguf';

    expect(resolveHyMt2ServerCommand()).toBe('D:\\translation\\llama-server.exe');
    expect(resolveHyMt2ModelPath()).toBe('D:\\translation\\Hy-MT2.gguf');
    expect(resolveHyMt2ModelCacheIdentity()).toBe('hy-mt2');
  });

  it('builds the official terminology-intervention prompt from matched academic terms', () => {
    const source =
      'Recent reinforcement learning approaches improve fall recovery for humanoid robots; ' +
      'ablation studies evaluate the policy and training procedure.';

    const prompt = buildHyMt2Prompt(source, { sourceLanguage: 'en', targetLanguage: 'zh' });

    expect(prompt).toContain('reinforcement learning 翻译成 强化学习');
    expect(prompt).toContain('fall recovery 翻译成 跌倒恢复');
    expect(prompt).toContain('humanoid robots 翻译成 人形机器人');
    expect(prompt).toContain('ablation studies 翻译成 消融实验');
    expect(prompt).toContain('policy 翻译成 策略');
    expect(prompt).toContain('training 翻译成 训练');
    expect(prompt).toContain('将以下文本翻译为中文');
    expect(prompt.trimEnd().endsWith(source)).toBe(true);
  });

  it('supports Chinese-to-English selection translation without injecting reverse glossary guesses', () => {
    const prompt = buildHyMt2Prompt('强化学习用于机器人导航。', {
      sourceLanguage: 'zh',
      targetLanguage: 'en'
    });

    expect(prompt).toContain('将以下文本翻译为英文');
    expect(prompt).not.toContain('参考下面的翻译');
  });

  it('normalizes formatted and fenced model output to translation text only', () => {
    expect(normalizeHyMt2Output('<target>人形机器人的跌倒恢复</target>')).toBe('人形机器人的跌倒恢复');
    expect(normalizeHyMt2Output('```text\n强化学习策略\n```')).toBe('强化学习策略');
  });

  it('recognizes the current llama.cpp CUDA device log instead of reporting CPU', () => {
    expect(
      inferHyMt2RuntimeDevice(
        'common_param: - CUDA0 : NVIDIA GeForce RTX 4060 Laptop GPU\n' +
          'load_tensors: offloaded 33/33 layers to GPU'
      )
    ).toBe('cuda');
    expect(inferHyMt2RuntimeDevice('using CPU backend only')).toBe('cpu');
    expect(inferHyMt2RuntimeDevice('model loaded')).toBe('unknown');
  });
});
