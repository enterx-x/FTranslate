import { describe, expect, it } from 'vitest';
import {
  buildCometPairRequests,
  selectCometMbrBundle,
  type CometPairScore,
  type TranslationCandidateBundle
} from './cometMbrSelection';

function bundle(
  seed: number,
  overrides: Partial<TranslationCandidateBundle> = {}
): TranslationCandidateBundle {
  return {
    seed,
    titleZh: `标题-${seed}`,
    abstractZh: `摘要-${seed}`,
    segments: [
      {
        source: 'Paper title',
        translation: `标题-${seed}`,
        sourceTokenWeight: 4,
        kind: 'title'
      },
      {
        source: 'The first and longer abstract segment.',
        translation: `摘要甲-${seed}`,
        sourceTokenWeight: 20,
        kind: 'abstract'
      },
      {
        source: 'The second abstract segment.',
        translation: `摘要乙-${seed}`,
        sourceTokenWeight: 10,
        kind: 'abstract'
      }
    ],
    eligible: true,
    hardFailures: [],
    softWarnings: [],
    ...overrides
  };
}

function scorePairs(
  bundles: TranslationCandidateBundle[],
  scoreFor: (candidateSeed: number, segmentIndex: number, referenceSeed: number) => number
): CometPairScore[] {
  return buildCometPairRequests(bundles).map((pair) => ({
    ...pair,
    score: scoreFor(pair.candidateSeed, pair.segmentIndex, pair.referenceSeed)
  }));
}

describe('COMET-MBR complete bundle selection', () => {
  it('selects one complete title and abstract bundle without cross-seed mixing', () => {
    const bundles = [bundle(42), bundle(3407), bundle(7919)];
    const scores = scorePairs(bundles, (candidateSeed) => (candidateSeed === 3407 ? 0.9 : 0.6));
    const selected = selectCometMbrBundle(bundles, scores);

    expect(selected.mode).toBe('comet-mbr');
    expect(selected.bundle?.seed).toBe(3407);
    expect(selected.bundle?.titleZh).toBe(bundles[1].titleZh);
    expect(selected.bundle?.abstractZh).toBe(bundles[1].abstractZh);
  });

  it('never lets a high COMET score rescue an ineligible bundle', () => {
    const bundles = [bundle(42, { eligible: false, hardFailures: ['marker-missing'] }), bundle(3407), bundle(7919)];
    const scores = scorePairs(bundles, (candidateSeed) => (candidateSeed === 42 ? 1 : 0.5));
    const selected = selectCometMbrBundle(bundles, scores);

    expect(selected.bundle?.seed).not.toBe(42);
    expect(selected.eligibleCandidateCount).toBe(2);
  });

  it('deduplicates normalized complete bundles only after hard validation', () => {
    const duplicate = bundle(3407, {
      titleZh: ' 标题 － 42 ',
      abstractZh: '摘要－42。',
      segments: bundle(42).segments.map((segment) => ({
        ...segment,
        translation: segment.translation.replace('-', '－')
      }))
    });
    const invalidDuplicate = bundle(7919, {
      titleZh: '标题-42',
      abstractZh: '摘要-42',
      eligible: false,
      hardFailures: ['truncated']
    });
    const selected = selectCometMbrBundle([bundle(42), duplicate, invalidDuplicate], []);

    expect(selected.mode).toBe('single-unique-candidate');
    expect(selected.eligibleCandidateCount).toBe(2);
    expect(selected.uniqueCandidateCount).toBe(1);
    expect(selected.bundle?.seed).toBe(42);
  });

  it('uses source-token weighting within abstract utility', () => {
    const bundles = [bundle(42), bundle(3407), bundle(7919)];
    const scores = scorePairs(bundles, (candidateSeed, segmentIndex) => {
      if (candidateSeed === 42) {
        return segmentIndex === 1 ? 0.2 : 1;
      }
      if (candidateSeed === 3407) {
        return 0.7;
      }
      return 0.4;
    });
    const selected = selectCometMbrBundle(bundles, scores);

    expect(selected.bundle?.seed).toBe(3407);
  });

  it('breaks equal bundle utility by worst component and then worst segment', () => {
    const bundles = [bundle(42), bundle(3407), bundle(7919)];
    const scores = scorePairs(bundles, (candidateSeed, segmentIndex) => {
      if (candidateSeed === 42) {
        return segmentIndex === 0 ? 0.9 : 0.6;
      }
      if (candidateSeed === 3407) {
        return segmentIndex === 0 ? 0.6 : 0.7;
      }
      return 0.2;
    });
    const selected = selectCometMbrBundle(bundles, scores);

    expect(selected.bundle?.seed).toBe(3407);
  });

  it('uses warning count, median length, and fixed seed order for deterministic ties', () => {
    const bundles = [
      bundle(42, { softWarnings: ['style'] }),
      bundle(3407, { abstractZh: '摘要-3407-长度居中' }),
      bundle(7919, { abstractZh: '摘要-7919-长度居中' })
    ];
    const scores = scorePairs(bundles, () => 0.8);
    const selected = selectCometMbrBundle(bundles, scores);

    expect(selected.bundle?.seed).toBe(3407);
  });

  it('reports three, two, one, duplicate-only, evaluator-failed, and zero-candidate modes truthfully', () => {
    const three = [bundle(42), bundle(3407), bundle(7919)];
    expect(selectCometMbrBundle(three, scorePairs(three, () => 0.7)).mode).toBe('comet-mbr');

    const two = [bundle(42), bundle(3407), bundle(7919, { eligible: false })];
    expect(selectCometMbrBundle(two, scorePairs(two, () => 0.7)).mode).toBe('two-candidate');

    expect(selectCometMbrBundle([bundle(42)], []).mode).toBe('single-candidate');

    const duplicates = [bundle(42), bundle(3407, { titleZh: '标题-42', abstractZh: '摘要-42' })];
    expect(selectCometMbrBundle(duplicates, []).mode).toBe('single-unique-candidate');

    expect(selectCometMbrBundle(three, [], { evaluatorFailed: true }).mode).toBe('evaluator-failed');
    expect(selectCometMbrBundle([bundle(42, { eligible: false })], []).mode).toBe('no-eligible-candidate');
  });
});
