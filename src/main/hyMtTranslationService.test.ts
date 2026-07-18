import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHyMt2GenerationConfig,
  buildHyMt2Prompt,
  hasHyMt2ContextLeakage,
  hasHyMt2FluencyArtifact,
  inferHyMt2RuntimeDevice,
  normalizeHyMt2Output,
  resolveHyMt2ModelCacheIdentity,
  resolveHyMt2ModelPath,
  resolveHyMt2ServerCommand,
  validateHyMt2ProtectedMarkers
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
  it('uses the requested candidate seed without changing academic decoding', () => {
    expect(buildHyMt2GenerationConfig({ seed: 7919 })).toMatchObject({
      seed: 7919,
      temperature: 0.7,
      top_k: 20,
      top_p: 0.6
    });
  });

  it('derives a deterministic strict retry seed while preserving legacy defaults', () => {
    expect(buildHyMt2GenerationConfig({ seed: 42, strict: true }).seed).toBe(104771);
    expect(buildHyMt2GenerationConfig().seed).toBe(42);
    expect(buildHyMt2GenerationConfig({ strict: true }).seed).toBe(3407);
  });

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

  it('uses bounded paper context and an academic-paper style without translating the background', () => {
    const source = 'The residual is evaluated at every collocation point.';
    const prompt = buildHyMt2Prompt(source, {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      itemContext: {
        context: 'Paper title: Physics-Informed Robot Dynamics. Previous text: We enforce the governing equation.',
        style: 'academic-paper'
      }
    });

    expect(prompt).toContain('Paper title: Physics-Informed Robot Dynamics');
    expect(prompt).toContain('参考上面的信息');
    expect(prompt).toContain('不要翻译上文');
    expect(prompt).toContain('学术论文书面语');
    expect(prompt).toContain('忠实、准确、自然、简洁');
    expect(prompt.trimEnd().endsWith(source)).toBe(true);
  });

  it('requires every protected numeric marker to remain unchanged exactly once', () => {
    const source = 'The residual $r(x)$ is evaluated at 8675300901.';
    const prompt = buildHyMt2Prompt(source, {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      itemContext: { style: 'academic-paper' }
    });

    expect(prompt).toContain('8675300901');
    expect(prompt).toContain('原样保留');
    expect(prompt).toContain('恰好一次');
    expect(prompt).toContain('不得遗漏、修改或翻译');
  });

  it('accepts only the exact protected marker multiset', () => {
    expect(validateHyMt2ProtectedMarkers('A 8675300901 B', '甲 8675300901 乙')).toBe(true);
    expect(validateHyMt2ProtectedMarkers('A 8675300901 B', '甲')).toBe(false);
    expect(
      validateHyMt2ProtectedMarkers('A 8675300901 B', '甲 8675300901 8675300901 乙')
    ).toBe(false);
    expect(validateHyMt2ProtectedMarkers('plain source', '普通译文')).toBe(true);
  });

  it('rejects copied context-only phrases and implausible context expansion', () => {
    const source = 'The residual is small.';
    const context =
      'Paper title: Physics-Informed Control. The controller is evaluated on six real robotic platforms.';

    expect(hasHyMt2ContextLeakage(source, '该残差较小。', context)).toBe(false);
    expect(
      hasHyMt2ContextLeakage(
        source,
        '该残差较小。The controller is evaluated on six real robotic platforms.',
        context
      )
    ).toBe(true);
    expect(
      hasHyMt2ContextLeakage(
        source,
        '该残差较小，并在六个真实机器人平台上完成了控制器评估，同时还报告了训练过程、硬件配置、数据收集流程和全部实验结论。',
        context
      )
    ).toBe(true);
  });

  it('rejects repeated Chinese particles and duplicated predicates without flagging valid prose', () => {
    expect(hasHyMt2FluencyArtifact('在多个仿真平台上了进行了测试。')).toBe(true);
    expect(hasHyMt2FluencyArtifact('该方法实现了实现了稳定控制。')).toBe(true);
    expect(hasHyMt2FluencyArtifact('在多个仿真平台上进行了测试。')).toBe(false);
    expect(hasHyMt2FluencyArtifact('为了进行测试，我们保持策略架构不变。')).toBe(false);
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
