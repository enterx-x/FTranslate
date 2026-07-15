import { describe, expect, it } from 'vitest';
import {
  collapseLocalRepeatedFragments,
  collapseRepeatedTranslationTail,
  extractProtectedAcademicTerms,
  hasSevereAcademicTranslationLengthLoss,
  prepareAcademicTranslation,
  repairAcademicTranslation
} from './academicTranslationQuality';
import { applyAiTranslationResult, type AiProviderSettings, type AiTranslationItem } from './aiTranslation';

describe('academic translation quality repair', () => {
  it('extracts method names, acronyms, and hyphenated academic terms from source text', () => {
    const terms = extractProtectedAcademicTerms(
      'OmniAgent: Native Active Perception for Sim-to-Real Robot Navigation with VLA and CBF-MPC.'
    );

    expect(terms).toContain('OmniAgent');
    expect(terms).toContain('Sim-to-Real');
    expect(terms).toContain('VLA');
    expect(terms).toContain('CBF-MPC');
  });

  it('lets ordinary hyphenated prose translate instead of protecting most of a title', () => {
    const terms = extractProtectedAcademicTerms(
      'Physics-Informed Safe Reinforcement Learning for Contact-Rich Robot Navigation with safety-layer baselines.'
    );

    expect(terms).not.toContain('Physics-Informed');
    expect(terms).not.toContain('Contact-Rich');
    expect(terms).not.toContain('safety-layer');
  });

  it('extracts title-case academic phrases that local translators should not translate', () => {
    const terms = extractProtectedAcademicTerms(
      'HT-Bench: Benchmarking and Learning Dexterous Full-Hand Tactile Representations with Egocentric Vision'
    );

    expect(terms).toContain('HT-Bench');
    expect(terms).toContain('Full-Hand Tactile Representations');
    expect(terms).toContain('Egocentric Vision');
  });

  it('restores a leading proposed method name when a local translator transliterates it', () => {
    const repaired = repairAcademicTranslation(
      'OmniAgent: Native Active Perception as Reasoning for Omni-Modal Understanding',
      '奥姆尼代理：作为全模态理解推理的主动感知',
      { mode: 'title' }
    );

    expect(repaired).toBe('OmniAgent：作为全模态理解推理的主动感知');
  });

  it('does not append visible protected-term notes to abstracts', () => {
    const repaired = repairAcademicTranslation(
      'We introduce DexCap for contact-rich robot manipulation and Sim-to-Real transfer.',
      '我们提出一种用于接触丰富机器人操作和迁移的框架。',
      { mode: 'abstract' }
    );

    expect(repaired).not.toContain('保留术语');
    expect(repaired).not.toContain('术语');
  });

  it('collapses repeated translation tails without rejecting otherwise useful content', () => {
    expect(collapseRepeatedTranslationTail('本文提出一种机器人导航方法。方法方法方法方法')).toBe(
      '本文提出一种机器人导航方法。方法'
    );
    expect(collapseRepeatedTranslationTail('本文有效。本文有效。本文有效。')).toBe('本文有效。');
  });

  it('collapses duplicated trailing Chinese clauses in cached arXiv abstracts', () => {
    const repaired = repairAcademicTranslation(
      'We introduce a tactile teleoperation system for contact-rich manipulation.',
      '我们提出一种用于接触丰富操作的触觉遥操作系统，并通过精确的触觉测量提升操作效率，并通过测量和测量系统进行了更高的测量，并通过测量和测量系统进行了更高的测量。',
      { mode: 'abstract' }
    );

    expect(repaired.match(/并通过测量和测量系统进行了更高的测量/gu)).toHaveLength(1);
    expect(repaired).toContain('触觉遥操作系统');
  });

  it('repairs source-grounded RL and safety terminology without another model call', () => {
    const source =
      'We study reinforcement learning with control barrier functions, an ordinary differential equation residual, a safety filter, reward shaping, and generalization without increasing inference latency.';
    const repaired = repairAcademicTranslation(
      source,
      '我们研究增强学习、控制屏障功能、普通的差异方程残差、安全过器、塑造和通用化，从而增加了未见的障碍布局延迟。',
      { mode: 'abstract' }
    );

    expect(repaired).toContain('强化学习');
    expect(repaired).toContain('控制屏障函数');
    expect(repaired).toContain('常微分方程');
    expect(repaired).toContain('安全过滤器');
    expect(repaired).toContain('奖励塑形');
    expect(repaired).toContain('泛化到未见的障碍布局，且不增加推理延迟');
  });

  it('repairs AI translation results before storing provider metadata', () => {
    const settings: AiProviderSettings = {
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    };
    const item: AiTranslationItem = {
      section: 'Abstract',
      original: 'PILOT: Perceptive Integrated Low-level Controller for robot navigation.',
      translation: '',
      type: 'paragraph'
    };

    const result = applyAiTranslationResult(item, '飞行员：用于机器人导航的感知集成低层控制器控制器控制器控制器', settings);

    expect(result.translation).toContain('PILOT');
    expect(result.translation.endsWith('控制器控制器控制器控制器')).toBe(false);
    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-chat');
  });

  it('repairs arXiv title translations that damage method names and key English terms', () => {
    const repaired = repairAcademicTranslation(
      'TaCauchy: An Extensible FEM Framework for Vision-Based Tactile Simulation',
      '塔科奇: 基于视觉的触觉模拟的可扩展FEM框架',
      { mode: 'title' }
    );

    expect(repaired).toContain('TaCauchy');
    expect(repaired).toContain('FEM');
    expect(repaired).toContain('Vision-Based');
    expect(repaired).not.toContain('塔科奇');
    expect(repaired).not.toContain('术语');
  });

  it('keeps important title phrases visible when the local translator partially translates them', () => {
    const repaired = repairAcademicTranslation(
      'HT-Bench: Benchmarking and Learning Dexterous Full-Hand Tactile Representations with Egocentric Vision',
      'HT-Bench: 以以Egocentral Visia为视角的基准和学习 Dexterous Full-Hand Tactile 代表',
      { mode: 'title' }
    );

    expect(repaired).toContain('HT-Bench');
    expect(repaired).toContain('Egocentric Vision');
    expect(repaired).not.toContain('以以');
    expect(repaired).not.toContain('Egocentral Visia');
    expect(repaired).not.toContain('术语');
  });

  it('strips stale visible term annotations from cached translation text', () => {
    const repaired = repairAcademicTranslation(
      'Do as I Do: Dexterous Manipulation Data from Everyday Human Videos',
      '像我这样做: 从日常人类视频中获取机器人操作数据（保留术语：human-like；multi-fingered）',
      { mode: 'abstract' }
    );

    expect(repaired).not.toContain('保留术语');
    expect(repaired).not.toContain('human-like');
    expect(repaired).not.toContain('multi-fingered');
  });

  it('collapses repeated local fragments in the middle of low-quality translations', () => {
    expect(collapseLocalRepeatedFragments('以以Egocentric Vision 为为视角，方法方法有效。')).toBe(
      '以Egocentric Vision 为视角，方法有效。'
    );
  });

  it('strictly protects formulas, code, and citations while leaving recoverable terms visible to translation', () => {
    const source =
      'OmniAgent uses $x^2 + y^2$ and $$\\mathcal{L}=\\lambda \\|x\\|$$ with `policy.step()` and ``policy batch``; constraints are \\(E = mc^2\\) and \\[\\int_a^b f(x)dx\\]. See https://example.org/paper, doi:10.48550/arXiv.2607.01234, arXiv:2607.01234, arXiv:hep-th/9901001, and [1-3, 5] for Sim-to-Real CBF-MPC.';
    const prepared = prepareAcademicTranslation(source);

    expect(prepared.segments).toHaveLength(1);
    expect(prepared.segments[0]).toContain('OmniAgent');
    expect(prepared.segments[0]).toContain('https://example.org/paper');
    expect(prepared.segments[0]).not.toContain('$x^2 + y^2$');

    const restored = prepared.restore([`这是译文：${prepared.segments[0]}`]);

    expect(restored.ok).toBe(true);
    expect(restored.text).toContain('OmniAgent');
    expect(restored.text).toContain('$x^2 + y^2$');
    expect(restored.text).toContain('$$\\mathcal{L}=\\lambda \\|x\\|$$');
    expect(restored.text).toContain('`policy.step()`');
    expect(restored.text).toContain('``policy batch``');
    expect(restored.text).toContain('\\(E = mc^2\\)');
    expect(restored.text).toContain('\\[\\int_a^b f(x)dx\\]');
    expect(restored.text).toContain('https://example.org/paper');
    expect(restored.text).toContain('doi:10.48550/arXiv.2607.01234');
    expect(restored.text).toContain('arXiv:2607.01234');
    expect(restored.text).toContain('arXiv:hep-th/9901001');
    expect(restored.text).toContain('[1-3, 5]');
    expect(restored.text).toContain('Sim-to-Real');
    expect(restored.text).toContain('CBF-MPC');
  });

  it('restores project URLs deterministically when the translator omits metadata trailers', () => {
    const source =
      'We validate the method on challenging robot locomotion tasks. Project page: https://example.org/project/';
    const repaired = repairAcademicTranslation(source, '我们在具有挑战性的机器人运动任务上验证了该方法。', {
      mode: 'abstract'
    });

    expect(repaired).toContain('项目页面：https://example.org/project/');
  });

  it('does not duplicate equivalent http and https project links', () => {
    const source = 'Video and code are available at https://example.org/REGRIND.';
    const repaired = repairAcademicTranslation(source, '视频和代码可在 http://example.org/REGRIND 上找到。', {
      mode: 'abstract'
    });

    expect(repaired.match(/https?:\/\/example\.org\/REGRIND/giu)).toHaveLength(1);
  });

  it('repairs common reinforcement-learning terminology without another model call', () => {
    const source =
      'A Minimalist Retargeting-Guided Reinforcement Learning Recipe for Dexterous Manipulation uses an actor, critic, policy, agent, residual reinforcement learning, and system identification.';
    const repaired = repairAcademicTranslation(
      source,
      '微观主义的反指导强化学习方法用于巧妙的操纵，并使用演员、评论家、政策、代理人、残余强化学习和系统识别。',
      { mode: 'abstract' }
    );

    expect(repaired).toContain('极简');
    expect(repaired).toContain('重定向引导');
    expect(repaired).toContain('灵巧操作');
    expect(repaired).toContain('Actor');
    expect(repaired).toContain('Critic');
    expect(repaired).toContain('策略');
    expect(repaired).toContain('智能体');
    expect(repaired).toContain('残差强化学习');
    expect(repaired).toContain('系统辨识');

    const repairedTitle = repairAcademicTranslation(
      'A Minimalist Retargeting-Guided Reinforcement Learning Recipe for Dexterous Manipulation',
      '微观主义的反指导强化学习方法',
      { mode: 'title' }
    );
    expect(repairedTitle).toContain('极简');
    expect(repairedTitle).toContain('重定向引导');
    expect(repairedTitle).toContain('灵巧操作');
  });

  it('removes presentation-only LaTeX text commands before sending prose to the translator', () => {
    const prepared = prepareAcademicTranslation('We introduce \\textit{SKooP (Symmetric Koopman Predictions)}.');

    expect(prepared.segments).toEqual(['We introduce SKooP (Symmetric Koopman Predictions).']);
  });

  it('keeps academic term repair idempotent and ignores method-like URL paths', () => {
    const source =
      'We introduce \\textit{SKooP (Symmetric Koopman Predictions)}. Project page: https://example.org/SymmetricKoopmanPredictions/';
    const translated =
      'SKooP Symmetric Koopman Predictions：SKooP Symmetric Koopman Predictions：我们提出了 SKOOP（Symmetric Koopman Predictions）。';
    const repairedOnce = repairAcademicTranslation(source, translated, { mode: 'abstract' });
    const repairedTwice = repairAcademicTranslation(source, repairedOnce, { mode: 'abstract' });

    expect(repairedOnce).not.toContain('SKooP Symmetric Koopman Predictions：SKooP Symmetric Koopman Predictions：');
    expect(repairedTwice).toBe(repairedOnce);
    expect(extractProtectedAcademicTerms(source)).not.toContain('SymmetricKoopmanPredictions');
  });

  it('splits long abstracts at sentence boundaries and restores all segments in order', () => {
    const source = Array.from(
      { length: 18 },
      (_, index) => `Sentence-${String(index).padStart(2, '0')} describes a reproducible experiment with ${'details '.repeat(9)}.`
    ).join(' ');
    const prepared = prepareAcademicTranslation(source);

    expect(prepared.segments.length).toBeGreaterThan(1);
    expect(prepared.segments.every((segment) => segment.length <= 480)).toBe(true);

    const restored = prepared.restore(prepared.segments.map((segment, index) => `第${index}段：${segment}`));

    expect(restored.ok).toBe(true);
    expect(restored.text).toContain('Sentence-00');
    expect(restored.text).toContain('Sentence-17');
    expect(restored.text.indexOf('Sentence-00')).toBeLessThan(restored.text.indexOf('Sentence-17'));
  });

  it('allows natural marker reordering within a segment but rejects markers moved across segments', () => {
    const source =
      'We use $x^2$ with `policy.step()` in the first experiment. ' +
      `The second experiment has \\(E=mc^2\\) and ${'details '.repeat(130)}.`;
    const prepared = prepareAcademicTranslation(source);
    const markerGroups = prepared.segments.map((segment) => segment.match(/\b86753\d{2}901\b/gu) ?? []);
    const firstSegment = markerGroups.findIndex((markers) => markers.length >= 2);
    const secondSegment = markerGroups.findIndex((markers, index) => index !== firstSegment && markers.length > 0);

    expect(firstSegment).toBeGreaterThanOrEqual(0);
    expect(secondSegment).toBeGreaterThanOrEqual(0);

    const reordered = prepared.segments.map((segment, index) => {
      if (index !== firstSegment) {
        return segment;
      }
      const [first, second] = markerGroups[index];
      return segment.replace(first, '__FIRST__').replace(second, first).replace('__FIRST__', second);
    });
    const crossSegment = prepared.segments.map((segment, index) => {
      if (index === firstSegment) {
        return segment.replace(markerGroups[firstSegment][0], markerGroups[secondSegment][0]);
      }
      if (index === secondSegment) {
        return segment.replace(markerGroups[secondSegment][0], markerGroups[firstSegment][0]);
      }
      return segment;
    });

    expect(prepared.restore(reordered).ok).toBe(true);
    expect(prepared.restore(crossSegment).ok).toBe(false);
  });

  it('rejects severely truncated abstracts without applying title thresholds', () => {
    const source = `This abstract reports ${'reproducible experimental detail '.repeat(5)}.`;

    expect(hasSevereAcademicTranslationLengthLoss(source, '过短。', 'abstract')).toBe(true);
    expect(hasSevereAcademicTranslationLengthLoss(source, '短标题', 'title')).toBe(false);
  });
});
