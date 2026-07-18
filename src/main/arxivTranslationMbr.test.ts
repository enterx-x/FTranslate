import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArxivTranslationService } from './arxivTranslationService';

const request = {
  stableId: '2607.12345',
  title: 'Safe Reinforcement Learning for Robot Navigation',
  summary: 'We propose a safe reinforcement learning method for robot navigation and evaluate success rate.'
};

function preserveMarkers(source: string, text: string): string {
  const markers = source.match(/\b86753\d{2}901\b/gu) ?? [];
  return `${markers.join(' ')} ${text}`.trim();
}

function translatedText(source: string, seed: number, index: number): string {
  const candidateLabel = String(seed).padStart(4, '0');
  return preserveMarkers(
    source,
    index === 0
      ? `候选${candidateLabel}：机器人导航安全强化学习`
      : `候选${candidateLabel}提出面向机器人导航的安全强化学习方法，并完整报告成功率、实验设置与主要结论。`
  );
}

describe('ArxivTranslationService COMET-MBR bundles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-arxiv-mbr-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates three seeds, selects one complete bundle, and caches its selection metadata', async () => {
    const generatedSeeds: number[] = [];
    const progressPhases: string[] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'translations.sqlite'),
      candidateTranslateTextsWithEngine: async (texts: string[], seed: number) => {
        generatedSeeds.push(seed);
        return {
          texts: texts.map((text, index) => translatedText(text, seed, index)),
          engine: 'hy-mt2-q4' as const
        };
      },
      cometEvaluator: async (pairs) =>
        pairs.map((pair) => (pair.candidateSeed === 3407 ? 0.95 : 0.55)),
      resetCandidateRuntime: () => undefined,
      unloadCometEvaluator: async () => undefined,
      onProgress: (progress) => progressPhases.push(progress.phase)
    });

    try {
      const first = await service.translatePaper(request);
      const cached = await service.translatePaper(request);

      expect(generatedSeeds).toEqual([42, 3407, 7919]);
      expect(first).toMatchObject({
        selectionMode: 'comet-mbr',
        selectedSeed: 3407,
        candidateCount: 3,
        eligibleCandidateCount: 3,
        evaluator: 'Unbabel/wmt22-comet-da',
        cacheHit: false
      });
      expect(first.titleZh).toContain('候选3407');
      expect(first.abstractZh).toContain('候选3407');
      expect(cached).toMatchObject({
        cacheHit: true,
        selectionMode: 'comet-mbr',
        selectedSeed: 3407,
        candidateCount: 3
      });
      expect(generatedSeeds).toHaveLength(3);
      expect(progressPhases).toEqual([
        'candidate-generating',
        'candidate-generating',
        'candidate-generating',
        'candidate-validating',
        'quality-evaluating'
      ]);
    } finally {
      service.close();
    }
  });

  it('excludes a structurally invalid bundle before COMET scoring', async () => {
    const scoredSeeds = new Set<number>();
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'invalid.sqlite'),
      candidateTranslateTextsWithEngine: async (texts: string[], seed: number) => ({
        texts: texts.map((text, index) =>
          seed === 7919 && index === 1
            ? '损坏占位符但仍然看似完整的摘要译文'
            : translatedText(text, seed, index)
        ),
        engine: 'hy-mt2-q4' as const
      }),
      cometEvaluator: async (pairs) => pairs.map((pair) => {
        scoredSeeds.add(pair.candidateSeed);
        scoredSeeds.add(pair.referenceSeed);
        return pair.candidateSeed === 3407 ? 0.9 : 0.6;
      }),
      resetCandidateRuntime: () => undefined,
      unloadCometEvaluator: async () => undefined
    });

    try {
      const result = await service.translatePaper(request);
      expect(result).toMatchObject({
        selectionMode: 'two-candidate',
        eligibleCandidateCount: 2,
        selectedSeed: 3407
      });
      expect(scoredSeeds.has(7919)).toBe(false);
    } finally {
      service.close();
    }
  });

  it('deduplicates normalized complete bundles before evaluation', async () => {
    let scoreCalls = 0;
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'duplicates.sqlite'),
      candidateTranslateTextsWithEngine: async (texts: string[]) => ({
        texts: texts.map((text, index) => translatedText(text, 42, index)),
        engine: 'hy-mt2-q4' as const
      }),
      cometEvaluator: async () => {
        scoreCalls += 1;
        return [];
      },
      resetCandidateRuntime: () => undefined,
      unloadCometEvaluator: async () => undefined
    });

    try {
      const result = await service.translatePaper(request);
      expect(result).toMatchObject({
        selectionMode: 'single-unique-candidate',
        candidateCount: 3,
        eligibleCandidateCount: 3,
        selectedSeed: 42
      });
      expect(scoreCalls).toBe(0);
    } finally {
      service.close();
    }
  });

  it('reports evaluator failure and falls back deterministically without claiming COMET success', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'evaluator-failed.sqlite'),
      candidateTranslateTextsWithEngine: async (texts: string[], seed: number) => ({
        texts: texts.map((text, index) => translatedText(text, seed, index)),
        engine: 'hy-mt2-q4' as const
      }),
      cometEvaluator: async () => {
        throw new Error('evaluator unavailable');
      },
      resetCandidateRuntime: () => undefined,
      unloadCometEvaluator: async () => undefined
    });

    try {
      const result = await service.translatePaper(request);
      expect(result).toMatchObject({
        selectionMode: 'evaluator-failed',
        selectedSeed: 42
      });
      expect(result).not.toHaveProperty('evaluator');
      expect(result.degradationReason).toContain('COMET');
      expect(result.message).not.toContain('COMET 评估完成');
    } finally {
      service.close();
    }
  });

  it('uses the validated NLLB/Argos fallback chain when no HY-MT2 bundle is eligible', async () => {
    let evaluatorCalls = 0;
    let fallbackCalls = 0;
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'all-invalid.sqlite'),
      candidateTranslateTextsWithEngine: async (texts: string[]) => ({
        texts: texts.map(() => 'invalid output without protected markers'),
        engine: 'hy-mt2-q4' as const
      }),
      cometEvaluator: async () => {
        evaluatorCalls += 1;
        return [];
      },
      fallbackTranslateTextsWithEngine: async (texts: string[]) => {
        fallbackCalls += 1;
        return {
          texts: texts.map((text, index) => translatedText(text, 42, index)),
          engine: 'nllb-ct2-int8' as const
        };
      },
      resetCandidateRuntime: () => undefined,
      unloadCometEvaluator: async () => undefined
    });

    try {
      const result = await service.translatePaper(request);
      expect(result).toMatchObject({
        status: 'completed',
        selectionMode: 'fallback-engine',
        candidateCount: 3,
        eligibleCandidateCount: 0,
        engine: 'nllb-ct2-int8'
      });
      expect(result.degradationReason).toContain('后备');
      expect(fallbackCalls).toBe(1);
      expect(evaluatorCalls).toBe(0);
    } finally {
      service.close();
    }
  });

  it('retries papers independently when one item makes a seeded batch fail', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'isolated-retry.sqlite'),
      candidateTranslateTextsWithEngine: async (texts: string[], seed: number, options) => {
        const corpus = [
          ...texts,
          ...(options?.itemContexts ?? []).map((item) => item.context ?? '')
        ].join('\n');
        const hasBroken = corpus.includes('BROKEN');
        const hasGood = corpus.includes('Safe Reinforcement Learning');
        if (hasBroken && hasGood) {
          throw new Error('one paper failed the shared candidate batch');
        }
        return {
          texts: hasBroken
            ? texts.map(() => 'untranslated invalid output')
            : texts.map((text, index) => translatedText(text, seed, index)),
          engine: 'hy-mt2-q4' as const
        };
      },
      cometEvaluator: async (pairs) => pairs.map((pair) => pair.candidateSeed === 3407 ? 0.9 : 0.6),
      fallbackTranslateTextsWithEngine: async () => {
        throw new Error('fallback intentionally unavailable');
      },
      resetCandidateRuntime: () => undefined,
      unloadCometEvaluator: async () => undefined
    });

    try {
      const results = await service.translatePapers([
        request,
        {
          stableId: '2607.99999',
          title: 'BROKEN Candidate Isolation Case',
          summary: 'BROKEN output must not invalidate a neighboring paper in the same batch.'
        }
      ]);
      expect(results[0]).toMatchObject({ status: 'completed', selectedSeed: 3407 });
      expect(results[1]).toMatchObject({ status: 'failed', selectionMode: 'no-eligible-candidate' });
      expect(results[1].degradationReason).toContain('失败类型');
    } finally {
      service.close();
    }
  });

  it('isolates validated fallback translations after a shared fallback batch fails', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'isolated-fallback.sqlite'),
      candidateTranslateTextsWithEngine: async (texts: string[]) => ({
        texts: texts.map(() => 'invalid candidate output'),
        engine: 'hy-mt2-q4' as const
      }),
      cometEvaluator: async () => [],
      fallbackTranslateTextsWithEngine: async (texts, options) => {
        const corpus = [
          ...texts,
          ...(options?.itemContexts ?? []).map((item) => item.context ?? '')
        ].join('\n');
        const hasBroken = corpus.includes('BROKEN');
        const hasGood = corpus.includes('Safe Reinforcement Learning');
        if (hasBroken && hasGood) {
          throw new Error('one paper failed the shared fallback batch');
        }
        if (hasBroken) {
          throw new Error('broken paper fallback unavailable');
        }
        return {
          texts: texts.map((text, index) => translatedText(text, 42, index)),
          engine: 'nllb-ct2-int8' as const
        };
      },
      resetCandidateRuntime: () => undefined,
      unloadCometEvaluator: async () => undefined
    });

    try {
      const results = await service.translatePapers([
        request,
        {
          stableId: '2607.99998',
          title: 'BROKEN Fallback Isolation Case',
          summary: 'BROKEN output must not invalidate a neighboring fallback translation.'
        }
      ]);
      expect(results[0]).toMatchObject({ status: 'completed', selectionMode: 'fallback-engine' });
      expect(results[1]).toMatchObject({ status: 'failed', selectionMode: 'no-eligible-candidate' });
    } finally {
      service.close();
    }
  });
});
