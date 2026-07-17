import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ArxivTranslationService } from './arxivTranslationService';
import { resetHyMt2Runtime, translateTextsWithHyMt2 } from './hyMtTranslationService';

const integrationIt = process.env.FTRANSLATE_RUN_HYMT_INTEGRATION === '1' ? it : it.skip;

interface AcademicBenchmarkCase {
  source: string;
  context: string;
  required: string[];
  forbidden: string[];
  protected: string[];
  contextOnly: string[];
}

const ACADEMIC_BENCHMARK_CASES: AcademicBenchmarkCase[] = [
  {
    source:
      'A reinforcement learning policy enables robust locomotion tracking and fall recovery for humanoid robots under external disturbances.',
    context: 'Paper title: Robust Fall Recovery for Humanoid Robots',
    required: ['强化学习', '运动跟踪', '跌倒恢复', '人形机器人'],
    forbidden: ['政策', '培训', '人造人'],
    protected: [],
    contextOnly: []
  },
  {
    source:
      'The physics-informed neural network minimizes the partial differential equation residual while enforcing boundary conditions.',
    context: 'Paper title: Physics-Informed Solvers for Nonlinear Dynamics',
    required: ['物理信息神经网络', '偏微分方程', '残差', '边界条件'],
    forbidden: ['物理通知'],
    protected: [],
    contextOnly: []
  },
  {
    source:
      'We combine a control barrier function with model predictive control to guarantee safe path planning.',
    context: 'Paper title: Safety-Critical Motion Planning for Autonomous Robots',
    required: ['控制屏障函数', '模型预测控制', '路径规划'],
    forbidden: ['控制障碍功能'],
    protected: [],
    contextOnly: []
  },
  {
    source:
      'Tactile sensing and haptic feedback improve dexterous manipulation under uncertain contact forces.',
    context: 'Paper title: Contact-Rich Dexterous Robot Manipulation',
    required: ['触觉感知', '触觉反馈', '灵巧操作', '接触力'],
    forbidden: ['触感反馈'],
    protected: [],
    contextOnly: []
  },
  {
    source:
      'RoboMamba is evaluated in RoboCasa, ManiSkill, and MetaWorld without changing the policy architecture.',
    context: 'Paper title: Generalist Robot Policies across Simulation Benchmarks',
    required: ['策略'],
    forbidden: ['政策', '了进行了', '上了进行'],
    protected: ['RoboMamba', 'RoboCasa', 'ManiSkill', 'MetaWorld'],
    contextOnly: []
  },
  {
    source: 'The residual at 8675300901 is used for the ablation study.',
    context:
      'Paper title: Residual Diagnostics for Scientific Learning. This context-only benchmark sentence must never be translated.',
    required: ['残差', '消融实验'],
    forbidden: [],
    protected: ['8675300901'],
    contextOnly: ['This context-only benchmark sentence must never be translated.']
  }
];

describe('HY-MT2 real local runtime', () => {
  afterAll(() => {
    resetHyMt2Runtime();
  });

  integrationIt('translates academic robotics text with domain terminology intact', async () => {
    const result = await translateTextsWithHyMt2([
      'Stubborn: A Simple and Unified Framework for Reinforcement Learning-based Robust Locomotion Tracking and Fall Recovery of Humanoid Robots',
      'The policy and training procedure are evaluated with ablation studies.'
    ]);

    expect(result.engine).toBe('hy-mt2-q4');
    expect(result.device).toBe('cuda');
    expect(result.texts[0]).toContain('强化学习');
    expect(result.texts[0]).toContain('人形机器人');
    expect(result.texts[0]).toContain('跌倒恢复');
    expect(result.texts[1]).toContain('策略');
    expect(result.texts[1]).toContain('训练');
    expect(result.texts.join('')).not.toMatch(/政策|培训|人造人/u);
  }, 90_000);

  integrationIt('passes the context-aware academic quality benchmark on cold and warm runs', async () => {
    resetHyMt2Runtime();
    const options = {
      sourceLanguage: 'en' as const,
      targetLanguage: 'zh' as const,
      itemContexts: ACADEMIC_BENCHMARK_CASES.map((item) => ({
        context: item.context,
        style: 'academic-paper' as const
      }))
    };
    const coldStartedAt = performance.now();
    const cold = await translateTextsWithHyMt2(
      ACADEMIC_BENCHMARK_CASES.map((item) => item.source),
      undefined,
      options
    );
    const coldDurationMs = Math.round(performance.now() - coldStartedAt);
    const warmStartedAt = performance.now();
    const warm = await translateTextsWithHyMt2(
      ACADEMIC_BENCHMARK_CASES.map((item) => item.source),
      undefined,
      options
    );
    const warmDurationMs = Math.round(performance.now() - warmStartedAt);

    console.info(
      `[HY-MT2 benchmark] cold=${coldDurationMs}ms warm=${warmDurationMs}ms device=${cold.device ?? 'unknown'}`
    );
    cold.texts.forEach((translated, index) => {
      console.info(`[HY-MT2 benchmark case ${index + 1}] ${translated}`);
    });
    expect(cold.engine).toBe('hy-mt2-q4');
    expect(cold.device).toBe('cuda');
    expect(warm.engine).toBe('hy-mt2-q4');
    for (const [runIndex, translatedTexts] of [cold.texts, warm.texts].entries()) {
      for (const [index, benchmark] of ACADEMIC_BENCHMARK_CASES.entries()) {
        const translated = translatedTexts[index] ?? '';
        for (const required of benchmark.required) {
          expect(translated, `run ${runIndex + 1} case ${index + 1} should contain ${required}`).toContain(required);
        }
        for (const forbidden of benchmark.forbidden) {
          expect(translated, `run ${runIndex + 1} case ${index + 1} should not contain ${forbidden}`).not.toContain(forbidden);
        }
        for (const protectedText of benchmark.protected) {
          expect(translated.match(new RegExp(protectedText, 'gu')) ?? []).toHaveLength(1);
        }
        for (const contextOnly of benchmark.contextOnly) {
          expect(translated).not.toContain(contextOnly);
        }
      }
    }
  }, 180_000);

  integrationIt('runs the complete arXiv terminology, quality, and cache pipeline', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-hymt2-arxiv-'));
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'translation.sqlite')
    });
    try {
      const request = {
        stableId: '2607.99999',
        title:
          'Stubborn: A Simple and Unified Framework for Reinforcement Learning-based Robust Locomotion Tracking and Fall Recovery of Humanoid Robots',
        summary:
          'Recent reinforcement learning approaches have improved locomotion tracking and fall recovery for humanoid robots. Extensive comparisons with state-of-the-art methods and ablation studies evaluate the efficiency of the policy and training procedure.'
      };
      const first = await service.translatePaper(request);
      const cached = await service.translatePaper(request);

      expect(first.status).toBe('completed');
      expect(first.engine).toBe('hy-mt2-q4');
      expect(first.titleZh).toContain('强化学习');
      expect(first.titleZh).toContain('人形机器人');
      expect(first.abstractZh).toContain('消融实验');
      expect(first.abstractZh).toContain('策略');
      expect(cached.status).toBe('cached');
      expect(cached.abstractZh).toBe(first.abstractZh);
    } finally {
      service.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 90_000);
});
