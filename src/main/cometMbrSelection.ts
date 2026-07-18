export interface TranslationCandidateSegment {
  source: string;
  translation: string;
  sourceTokenWeight: number;
  kind: 'title' | 'abstract';
}

export interface TranslationCandidateBundle {
  seed: number;
  titleZh: string;
  abstractZh: string;
  segments: TranslationCandidateSegment[];
  eligible: boolean;
  hardFailures: string[];
  softWarnings: string[];
}

export interface CometPairRequest {
  candidateSeed: number;
  referenceSeed: number;
  segmentIndex: number;
  source: string;
  translation: string;
  reference: string;
  sourceTokenWeight: number;
}

export interface CometPairScore extends CometPairRequest {
  score: number;
}

export type CometMbrSelectionMode =
  | 'comet-mbr'
  | 'two-candidate'
  | 'single-candidate'
  | 'single-unique-candidate'
  | 'no-eligible-candidate'
  | 'evaluator-failed';

export interface CometMbrCandidateScore {
  seed: number;
  bundleUtility: number;
  titleUtility: number;
  abstractUtility: number;
  worstComponent: number;
  worstSegment: number;
}

export interface CometMbrSelectionResult {
  bundle: TranslationCandidateBundle | null;
  mode: CometMbrSelectionMode;
  eligibleCandidateCount: number;
  uniqueCandidateCount: number;
  degradationReason?: string;
  candidateScores: CometMbrCandidateScore[];
}

export interface CometMbrSelectionOptions {
  evaluatorFailed?: boolean;
}

const FIXED_SEED_ORDER = [42, 3407, 7919] as const;

export function buildCometPairRequests(bundles: TranslationCandidateBundle[]): CometPairRequest[] {
  const unique = getEligibleUniqueBundles(bundles);
  const pairs: CometPairRequest[] = [];
  for (const candidate of unique) {
    for (const reference of unique) {
      if (candidate.seed === reference.seed) {
        continue;
      }
      candidate.segments.forEach((segment, segmentIndex) => {
        const referenceSegment = reference.segments[segmentIndex];
        if (!referenceSegment || referenceSegment.kind !== segment.kind) {
          return;
        }
        pairs.push({
          candidateSeed: candidate.seed,
          referenceSeed: reference.seed,
          segmentIndex,
          source: segment.source,
          translation: segment.translation,
          reference: referenceSegment.translation,
          sourceTokenWeight: normalizeWeight(segment.sourceTokenWeight)
        });
      });
    }
  }
  return pairs;
}

export function selectCometMbrBundle(
  bundles: TranslationCandidateBundle[],
  scores: CometPairScore[],
  options: CometMbrSelectionOptions = {}
): CometMbrSelectionResult {
  const eligible = bundles.filter((bundle) => bundle.eligible);
  const unique = getEligibleUniqueBundles(bundles);
  if (unique.length === 0) {
    return {
      bundle: null,
      mode: 'no-eligible-candidate',
      eligibleCandidateCount: 0,
      uniqueCandidateCount: 0,
      degradationReason: '所有候选都未通过结构与内容硬门禁。',
      candidateScores: []
    };
  }

  if (unique.length === 1) {
    return {
      bundle: unique[0],
      mode: eligible.length > 1 ? 'single-unique-candidate' : 'single-candidate',
      eligibleCandidateCount: eligible.length,
      uniqueCandidateCount: 1,
      degradationReason:
        eligible.length > 1
          ? '通过硬门禁的候选归一化后只有一份独立译文。'
          : '只有一份候选通过硬门禁，未运行候选互评。',
      candidateScores: []
    };
  }

  const expectedPairs = buildCometPairRequests(unique);
  const usableScores = indexUsableScores(scores, unique);
  const evaluatorComplete =
    !options.evaluatorFailed &&
    expectedPairs.length > 0 &&
    expectedPairs.every((pair) => usableScores.has(pairKey(pair)));
  const medianLength = median(unique.map(bundleTextLength));

  if (!evaluatorComplete) {
    const selected = [...unique].sort((left, right) => compareFallbackBundles(left, right, medianLength))[0];
    return {
      bundle: selected,
      mode: 'evaluator-failed',
      eligibleCandidateCount: eligible.length,
      uniqueCandidateCount: unique.length,
      degradationReason: options.evaluatorFailed
        ? '独立 COMET 评估不可用，已按硬门禁、警告与确定性顺序降级选择。'
        : '独立 COMET 评分不完整，已按硬门禁、警告与确定性顺序降级选择。',
      candidateScores: []
    };
  }

  const candidateScores = unique.map((bundle) => aggregateCandidateScore(bundle, unique, usableScores));
  const scoreBySeed = new Map(candidateScores.map((entry) => [entry.seed, entry]));
  const selected = [...unique].sort((left, right) => {
    const scoreComparison = compareCandidateScores(
      scoreBySeed.get(left.seed) as CometMbrCandidateScore,
      scoreBySeed.get(right.seed) as CometMbrCandidateScore
    );
    return scoreComparison !== 0 ? scoreComparison : compareFallbackBundles(left, right, medianLength);
  })[0];

  return {
    bundle: selected,
    mode: unique.length >= 3 ? 'comet-mbr' : 'two-candidate',
    eligibleCandidateCount: eligible.length,
    uniqueCandidateCount: unique.length,
    candidateScores
  };
}

function getEligibleUniqueBundles(bundles: TranslationCandidateBundle[]): TranslationCandidateBundle[] {
  const identities = new Set<string>();
  const unique: TranslationCandidateBundle[] = [];
  [...bundles]
    .filter((bundle) => bundle.eligible)
    .sort(compareSeedOrder)
    .forEach((bundle) => {
      const identity = normalizeBundleIdentity(bundle);
      if (identities.has(identity)) {
        return;
      }
      identities.add(identity);
      unique.push(bundle);
    });
  return unique;
}

function normalizeBundleIdentity(bundle: TranslationCandidateBundle): string {
  return `${normalizeTranslationIdentity(bundle.titleZh)}\u0000${normalizeTranslationIdentity(bundle.abstractZh)}`;
}

function normalizeTranslationIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[，,。.!！？?；;：:"“”'‘’（）()\[\]{}]/gu, '');
}

function indexUsableScores(
  scores: CometPairScore[],
  bundles: TranslationCandidateBundle[]
): Map<string, number[]> {
  const seeds = new Set(bundles.map((bundle) => bundle.seed));
  const indexed = new Map<string, number[]>();
  scores.forEach((score) => {
    if (
      !seeds.has(score.candidateSeed) ||
      !seeds.has(score.referenceSeed) ||
      score.candidateSeed === score.referenceSeed ||
      !Number.isFinite(score.score)
    ) {
      return;
    }
    const key = pairKey(score);
    indexed.set(key, [...(indexed.get(key) ?? []), score.score]);
  });
  return indexed;
}

function pairKey(pair: Pick<CometPairRequest, 'candidateSeed' | 'referenceSeed' | 'segmentIndex'>): string {
  return `${pair.candidateSeed}:${pair.referenceSeed}:${pair.segmentIndex}`;
}

function aggregateCandidateScore(
  bundle: TranslationCandidateBundle,
  allBundles: TranslationCandidateBundle[],
  indexedScores: Map<string, number[]>
): CometMbrCandidateScore {
  const referenceSeeds = allBundles.filter((candidate) => candidate.seed !== bundle.seed).map((candidate) => candidate.seed);
  const segmentScores = bundle.segments.map((segment, segmentIndex) => {
    const values = referenceSeeds.flatMap(
      (referenceSeed) => indexedScores.get(`${bundle.seed}:${referenceSeed}:${segmentIndex}`) ?? []
    );
    return {
      kind: segment.kind,
      weight: normalizeWeight(segment.sourceTokenWeight),
      utility: average(values)
    };
  });
  const titleSegments = segmentScores.filter((segment) => segment.kind === 'title');
  const abstractSegments = segmentScores.filter((segment) => segment.kind === 'abstract');
  const titleUtility = weightedAverage(titleSegments);
  const abstractUtility = weightedAverage(abstractSegments);
  const bundleUtility = 0.25 * titleUtility + 0.75 * abstractUtility;
  return {
    seed: bundle.seed,
    bundleUtility,
    titleUtility,
    abstractUtility,
    worstComponent: Math.min(titleUtility, abstractUtility),
    worstSegment: Math.min(...segmentScores.map((segment) => segment.utility))
  };
}

function weightedAverage(values: Array<{ utility: number; weight: number }>): number {
  if (values.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  return values.reduce((sum, value) => sum + value.utility * value.weight, 0) / totalWeight;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareCandidateScores(left: CometMbrCandidateScore, right: CometMbrCandidateScore): number {
  return (
    compareDescending(left.bundleUtility, right.bundleUtility) ||
    compareDescending(left.worstComponent, right.worstComponent) ||
    compareDescending(left.worstSegment, right.worstSegment)
  );
}

function compareFallbackBundles(
  left: TranslationCandidateBundle,
  right: TranslationCandidateBundle,
  medianLength: number
): number {
  return (
    left.softWarnings.length - right.softWarnings.length ||
    Math.abs(bundleTextLength(left) - medianLength) - Math.abs(bundleTextLength(right) - medianLength) ||
    compareSeedOrder(left, right)
  );
}

function compareDescending(left: number, right: number): number {
  const difference = right - left;
  return Math.abs(difference) < 1e-12 ? 0 : difference;
}

function compareSeedOrder(left: TranslationCandidateBundle, right: TranslationCandidateBundle): number {
  return seedOrder(left.seed) - seedOrder(right.seed) || left.seed - right.seed;
}

function seedOrder(seed: number): number {
  const index = FIXED_SEED_ORDER.indexOf(seed as (typeof FIXED_SEED_ORDER)[number]);
  return index >= 0 ? index : FIXED_SEED_ORDER.length;
}

function normalizeWeight(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function bundleTextLength(bundle: TranslationCandidateBundle): number {
  return [...bundle.titleZh, ...bundle.abstractZh].length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
