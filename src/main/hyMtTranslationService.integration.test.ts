import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ArxivTranslationService } from './arxivTranslationService';
import { resetHyMt2Runtime, translateTextsWithHyMt2 } from './hyMtTranslationService';

const integrationIt = process.env.FTRANSLATE_RUN_HYMT_INTEGRATION === '1' ? it : it.skip;

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
