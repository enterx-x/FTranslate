import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_TRANSLATION_GLOSSARY_VERSION,
  collectAcademicGlossaryMatches
} from './academicTranslationGlossary';

describe('academicTranslationGlossary', () => {
  it('maps recurring academic mistranslations with longest phrases first', () => {
    const source =
      'Trust-region diffusion policies use policy training, KL-divergence, ablation studies, ' +
      'proprioceptive feedback, fall recovery for humanoid robots, and Unitree G1.';

    const matches = collectAcademicGlossaryMatches(source);

    expect(ACADEMIC_TRANSLATION_GLOSSARY_VERSION).toMatch(/^academic-en-zh-v\d+$/u);
    expect(matches.map(({ source: matchedSource, target }) => [matchedSource, target])).toEqual([
      ['Trust-region', '信赖域'],
      ['diffusion policies', '扩散策略'],
      ['policy', '策略'],
      ['training', '训练'],
      ['KL-divergence', 'KL 散度'],
      ['ablation studies', '消融实验'],
      ['proprioceptive', '本体感知'],
      ['fall recovery', '跌倒恢复'],
      ['humanoid robots', '人形机器人'],
      ['Unitree G1', '宇树 G1']
    ]);
  });

  it('does not emit a shorter overlapping policy match inside diffusion policy', () => {
    expect(
      collectAcademicGlossaryMatches('A diffusion policy improves the policy.').map((match) => [
        match.source,
        match.target
      ])
    ).toEqual([
      ['diffusion policy', '扩散策略'],
      ['policy', '策略']
    ]);
  });

  it('maps robotics locomotion tracking to the established motion-tracking term', () => {
    expect(
      collectAcademicGlossaryMatches('Robust locomotion tracking and motion tracking.').map((match) => [
        match.source,
        match.target
      ])
    ).toEqual([
      ['locomotion tracking', '运动跟踪'],
      ['motion tracking', '运动跟踪']
    ]);
  });

  it('requires ASCII word boundaries instead of matching inside identifiers', () => {
    expect(collectAcademicGlossaryMatches('metapolicy policy policy2').map((match) => match.source)).toEqual([
      'policy'
    ]);
  });

  it('covers the core RL, robotics, control, and scientific-computing vocabulary', () => {
    const source =
      'Reinforcement learning with an actor-critic and a world model uses a control barrier function, ' +
      'model predictive control, a physics-informed neural network, an ordinary differential equation, ' +
      'system identification, sample efficiency, generalization, and robustness for humanoid motion tracking.';

    expect(collectAcademicGlossaryMatches(source).map((match) => match.target)).toEqual([
      '强化学习',
      'Actor-Critic',
      '世界模型',
      '控制屏障函数',
      '模型预测控制',
      '物理信息神经网络',
      '常微分方程',
      '系统辨识',
      '样本效率',
      '泛化',
      '鲁棒性',
      '人形机器人运动跟踪'
    ]);
  });
});
