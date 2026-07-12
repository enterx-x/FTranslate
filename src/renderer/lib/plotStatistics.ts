import { jStat } from 'jstat';
import { linearRegression, mean, median, sampleStandardDeviation } from 'simple-statistics';
import type {
  AnalysisSpec,
  MultipleComparisonCorrection,
  PlotCell,
  PlotDataTable
} from '../../shared/scientificPlot';
import { assertPlotDataTable } from '../../shared/scientificPlot';
import { hashPlotDataTable } from './plotData';

export interface TraceableAnalysisResult {
  analysisId: string;
  method: string;
  status: 'ok' | 'invalid';
  sampleSizes: Record<string, number>;
  statistic?: number;
  degreesOfFreedom?: number | [number, number];
  pValue?: number;
  adjustedPValue?: number;
  effectSize?: { type: string; value: number };
  confidenceInterval?: { level: number; lower: number; upper: number };
  summary?: {
    mean: number;
    median: number;
    standardDeviation: number;
    standardError: number;
    min: number;
    max: number;
  };
  details: Record<string, unknown>;
  warnings: string[];
  error?: string;
  provenance: {
    engine: 'javascript';
    engineVersion: string;
    inputHash: string;
    generatedAt: string;
  };
}

export interface RunPlotAnalysisOptions {
  now?: string;
  inputHash?: string;
}

export async function runPlotAnalysis(
  table: PlotDataTable,
  spec: AnalysisSpec,
  options: RunPlotAnalysisOptions = {}
): Promise<TraceableAnalysisResult> {
  assertPlotDataTable(table);
  const provenance = {
    engine: 'javascript' as const,
    engineVersion: 'ftranslate-statistics-1.0/jstat-1.9.6',
    inputHash: options.inputHash ?? await hashPlotDataTable(table),
    generatedAt: options.now ?? new Date().toISOString()
  };

  try {
    if (!spec.enabled) return invalidResult(spec, provenance, '统计分析已禁用。');
    switch (spec.type) {
      case 'descriptive':
        return descriptive(table, spec, provenance);
      case 'linearRegression':
        return regression(table, spec, provenance);
      case 'independentT':
        return independentT(table, spec, provenance);
      case 'pairedT':
        return pairedT(table, spec, provenance);
      case 'oneWayAnova':
        return oneWayAnova(table, spec, provenance);
      case 'mannWhitney':
        return mannWhitney(table, spec, provenance);
      case 'wilcoxonSignedRank':
        return wilcoxonSignedRank(table, spec, provenance);
      case 'kruskalWallis':
        return kruskalWallis(table, spec, provenance);
      case 'friedman':
        return friedman(table, spec, provenance);
      default:
        return invalidResult(spec, provenance, `不支持的统计方法：${String(spec.type)}`);
    }
  } catch (error) {
    return invalidResult(spec, provenance, error instanceof Error ? error.message : String(error));
  }
}

export async function runPlotAnalyses(
  table: PlotDataTable,
  specs: AnalysisSpec[],
  options: RunPlotAnalysisOptions = {}
): Promise<TraceableAnalysisResult[]> {
  const inputHash = options.inputHash ?? await hashPlotDataTable(table);
  const results = await Promise.all(specs.map((spec) => runPlotAnalysis(table, spec, { ...options, inputHash })));
  const correctionGroups = new Map<MultipleComparisonCorrection, number[]>();
  specs.forEach((spec, index) => {
    const correction = spec.correction ?? 'none';
    if (correction !== 'none' && results[index].pValue !== undefined) {
      const indexes = correctionGroups.get(correction) ?? [];
      indexes.push(index);
      correctionGroups.set(correction, indexes);
    }
  });
  correctionGroups.forEach((indexes, correction) => {
    const adjusted = adjustPValues(indexes.map((index) => results[index].pValue as number), correction);
    indexes.forEach((resultIndex, offset) => {
      results[resultIndex].adjustedPValue = adjusted[offset];
    });
  });
  return results;
}

export function adjustPValues(
  pValues: number[],
  correction: MultipleComparisonCorrection
): number[] {
  const values = pValues.map(clampProbability);
  const count = values.length;
  if (correction === 'none' || count < 2) return [...values];
  if (correction === 'bonferroni') return values.map((value) => roundProbability(value * count));

  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const adjusted = new Array<number>(count);
  if (correction === 'holm') {
    let previous = 0;
    indexed.forEach((entry, rank) => {
      const value = Math.max(previous, Math.min(1, entry.value * (count - rank)));
      adjusted[entry.index] = roundProbability(value);
      previous = value;
    });
    return adjusted;
  }
  if (correction === 'benjaminiHochberg') {
    let next = 1;
    for (let rank = count - 1; rank >= 0; rank -= 1) {
      const entry = indexed[rank];
      const value = Math.min(next, entry.value * count / (rank + 1), 1);
      adjusted[entry.index] = roundProbability(value);
      next = value;
    }
    return adjusted;
  }
  return [...values];
}

function descriptive(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const values = selectSingleGroupValues(table, spec);
  requireMinimum(values, 2, '描述统计');
  const average = mean(values);
  const sd = sampleStandardDeviation(values);
  const standardError = sd / Math.sqrt(values.length);
  const level = spec.confidenceLevel ?? 0.95;
  const critical = jStat.studentt.inv(1 - (1 - level) / 2, values.length - 1);
  return okResult(spec, provenance, {
    method: 'Descriptive statistics with Student t confidence interval',
    sampleSizes: { n: values.length },
    confidenceInterval: {
      level,
      lower: average - critical * standardError,
      upper: average + critical * standardError
    },
    summary: {
      mean: average,
      median: median(values),
      standardDeviation: sd,
      standardError,
      min: Math.min(...values),
      max: Math.max(...values)
    }
  });
}

function regression(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const xField = spec.groupField;
  if (!xField) throw new Error('线性回归需要把 X 字段设置为 groupField。');
  const points = selectNumericPairs(table, xField, spec.valueField);
  requireMinimum(points, 3, '线性回归');
  const model = linearRegression(points);
  const yMean = mean(points.map((point) => point[1]));
  const fitted = points.map(([x]) => model.m * x + model.b);
  const ssResidual = points.reduce((sum, point, index) => sum + (point[1] - fitted[index]) ** 2, 0);
  const ssTotal = points.reduce((sum, point) => sum + (point[1] - yMean) ** 2, 0);
  return okResult(spec, provenance, {
    method: 'Ordinary least squares linear regression',
    sampleSizes: { n: points.length },
    statistic: model.m,
    details: { slope: model.m, intercept: model.b, rSquared: ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal }
  });
}

function independentT(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const [left, right, leftName, rightName] = selectTwoGroups(table, spec);
  requireMinimum(left, 2, '独立样本 t 检验');
  requireMinimum(right, 2, '独立样本 t 检验');
  const meanLeft = mean(left);
  const meanRight = mean(right);
  const varianceLeft = sampleStandardDeviation(left) ** 2;
  const varianceRight = sampleStandardDeviation(right) ** 2;
  const standardErrorSquared = varianceLeft / left.length + varianceRight / right.length;
  if (standardErrorSquared === 0) throw new Error('两组数据方差为零，无法执行 Welch t 检验。');
  const statistic = (meanLeft - meanRight) / Math.sqrt(standardErrorSquared);
  const numerator = standardErrorSquared ** 2;
  const denominator = (varianceLeft / left.length) ** 2 / (left.length - 1) +
    (varianceRight / right.length) ** 2 / (right.length - 1);
  const degreesOfFreedom = numerator / denominator;
  const pooledSd = Math.sqrt(
    ((left.length - 1) * varianceLeft + (right.length - 1) * varianceRight) /
    (left.length + right.length - 2)
  );
  const cohenD = pooledSd === 0 ? 0 : (meanLeft - meanRight) / pooledSd;
  const correction = 1 - 3 / (4 * (left.length + right.length) - 9);
  const effectType = spec.effectSize === 'hedgesG' ? 'hedgesG' : 'cohenD';
  return okResult(spec, provenance, {
    method: 'Welch independent-samples t-test',
    sampleSizes: { [leftName]: left.length, [rightName]: right.length },
    statistic,
    degreesOfFreedom,
    pValue: tPValue(statistic, degreesOfFreedom, spec.tail),
    effectSize: { type: effectType, value: effectType === 'hedgesG' ? cohenD * correction : cohenD },
    details: { means: { [leftName]: meanLeft, [rightName]: meanRight } }
  });
}

function pairedT(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const pairs = selectPairedValues(table, spec);
  requireMinimum(pairs, 2, '配对 t 检验');
  const differences = pairs.map(([left, right]) => left - right);
  const average = mean(differences);
  const sd = sampleStandardDeviation(differences);
  if (sd === 0) throw new Error('配对差值方差为零，无法执行配对 t 检验。');
  const statistic = average / (sd / Math.sqrt(differences.length));
  return okResult(spec, provenance, {
    method: 'Paired-samples t-test',
    sampleSizes: { pairs: pairs.length },
    statistic,
    degreesOfFreedom: pairs.length - 1,
    pValue: tPValue(statistic, pairs.length - 1, spec.tail),
    effectSize: { type: 'cohenDz', value: average / sd }
  });
}

function oneWayAnova(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const groups = selectGroups(table, spec, 2);
  const all = groups.flatMap((group) => group.values);
  const overall = mean(all);
  const between = groups.reduce((sum, group) => sum + group.values.length * (mean(group.values) - overall) ** 2, 0);
  const within = groups.reduce(
    (sum, group) => sum + group.values.reduce((inner, value) => inner + (value - mean(group.values)) ** 2, 0),
    0
  );
  const dfBetween = groups.length - 1;
  const dfWithin = all.length - groups.length;
  if (dfWithin <= 0 || within === 0) throw new Error('组内自由度或方差不足，无法执行 ANOVA。');
  const statistic = (between / dfBetween) / (within / dfWithin);
  return okResult(spec, provenance, {
    method: 'One-way ANOVA',
    sampleSizes: Object.fromEntries(groups.map((group) => [group.name, group.values.length])),
    statistic,
    degreesOfFreedom: [dfBetween, dfWithin],
    pValue: clampProbability(1 - jStat.centralF.cdf(statistic, dfBetween, dfWithin)),
    effectSize: { type: 'etaSquared', value: between / (between + within) },
    details: { groupMeans: Object.fromEntries(groups.map((group) => [group.name, mean(group.values)])) }
  });
}

function mannWhitney(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const [left, right, leftName, rightName] = selectTwoGroups(table, spec);
  requireMinimum(left, 1, 'Mann-Whitney U 检验');
  requireMinimum(right, 1, 'Mann-Whitney U 检验');
  const combined = [
    ...left.map((value) => ({ value, group: 0 })),
    ...right.map((value) => ({ value, group: 1 }))
  ];
  const ranks = averageRanks(combined.map((item) => item.value));
  const rankLeft = ranks.reduce((sum, rank, index) => sum + (combined[index].group === 0 ? rank : 0), 0);
  const uLeft = rankLeft - left.length * (left.length + 1) / 2;
  const uRight = left.length * right.length - uLeft;
  const statistic = Math.min(uLeft, uRight);
  const expected = left.length * right.length / 2;
  const tieCorrection = rankTieCorrection(combined.map((item) => item.value));
  const variance = left.length * right.length * ((combined.length + 1) - tieCorrection) / 12;
  const z = variance > 0 ? (uLeft - expected) / Math.sqrt(variance) : 0;
  return okResult(spec, provenance, {
    method: 'Mann-Whitney U test with average ranks',
    sampleSizes: { [leftName]: left.length, [rightName]: right.length },
    statistic,
    pValue: normalPValue(z, spec.tail),
    effectSize: { type: 'rankBiserial', value: 1 - 2 * statistic / (left.length * right.length) },
    details: { uLeft, uRight, z }
  });
}

function wilcoxonSignedRank(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const differences = selectPairedValues(table, spec)
    .map(([left, right]) => left - right)
    .filter((value) => value !== 0);
  requireMinimum(differences, 2, 'Wilcoxon 符号秩检验');
  const ranks = averageRanks(differences.map(Math.abs));
  const positive = ranks.reduce((sum, rank, index) => sum + (differences[index] > 0 ? rank : 0), 0);
  const negative = ranks.reduce((sum, rank, index) => sum + (differences[index] < 0 ? rank : 0), 0);
  const statistic = Math.min(positive, negative);
  const expected = differences.length * (differences.length + 1) / 4;
  const variance = differences.length * (differences.length + 1) * (2 * differences.length + 1) / 24;
  const z = variance > 0 ? (positive - expected) / Math.sqrt(variance) : 0;
  return okResult(spec, provenance, {
    method: 'Wilcoxon signed-rank test',
    sampleSizes: { pairs: differences.length },
    statistic,
    pValue: normalPValue(z, spec.tail),
    effectSize: { type: 'rankBiserial', value: (positive - negative) / (positive + negative) },
    details: { positiveRankSum: positive, negativeRankSum: negative, z }
  });
}

function kruskalWallis(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const groups = selectGroups(table, spec, 2);
  const combined = groups.flatMap((group, groupIndex) => group.values.map((value) => ({ value, groupIndex })));
  const ranks = averageRanks(combined.map((item) => item.value));
  const rankSums = groups.map(() => 0);
  combined.forEach((item, index) => { rankSums[item.groupIndex] += ranks[index]; });
  const n = combined.length;
  let statistic = 12 / (n * (n + 1)) * rankSums.reduce(
    (sum, rankSum, index) => sum + rankSum ** 2 / groups[index].values.length,
    0
  ) - 3 * (n + 1);
  const tieFactor = 1 - rankTieSum(combined.map((item) => item.value)) / (n ** 3 - n);
  if (tieFactor > 0) statistic /= tieFactor;
  const df = groups.length - 1;
  return okResult(spec, provenance, {
    method: 'Kruskal-Wallis rank-sum test',
    sampleSizes: Object.fromEntries(groups.map((group) => [group.name, group.values.length])),
    statistic,
    degreesOfFreedom: df,
    pValue: clampProbability(1 - jStat.chisquare.cdf(statistic, df)),
    effectSize: { type: 'epsilonSquared', value: Math.max(0, (statistic - groups.length + 1) / (n - groups.length)) }
  });
}

function friedman(
  table: PlotDataTable,
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance']
): TraceableAnalysisResult {
  const blocks = selectCompleteBlocks(table, spec);
  const groupNames = requireGroups(spec, 3);
  requireMinimum(blocks, 2, 'Friedman 检验');
  const rankSums = groupNames.map(() => 0);
  blocks.forEach((block) => averageRanks(block).forEach((rank, index) => { rankSums[index] += rank; }));
  const n = blocks.length;
  const k = groupNames.length;
  const statistic = 12 / (n * k * (k + 1)) * rankSums.reduce((sum, value) => sum + value ** 2, 0) - 3 * n * (k + 1);
  return okResult(spec, provenance, {
    method: 'Friedman test',
    sampleSizes: { subjects: n, conditions: k },
    statistic,
    degreesOfFreedom: k - 1,
    pValue: clampProbability(1 - jStat.chisquare.cdf(statistic, k - 1)),
    effectSize: { type: 'kendallW', value: statistic / (n * (k - 1)) },
    details: { groups: groupNames }
  });
}

function selectSingleGroupValues(table: PlotDataTable, spec: AnalysisSpec): number[] {
  if (!spec.groupField || !spec.groups?.length) return numericColumn(table, spec.valueField);
  const group = spec.groups[0];
  return groupedNumericValues(table, spec.valueField, spec.groupField).get(group) ?? [];
}

function selectTwoGroups(table: PlotDataTable, spec: AnalysisSpec): [number[], number[], string, string] {
  if (!spec.groupField) throw new Error('该检验需要分组字段。');
  const names = requireGroups(spec, 2).slice(0, 2);
  const grouped = groupedNumericValues(table, spec.valueField, spec.groupField);
  return [grouped.get(names[0]) ?? [], grouped.get(names[1]) ?? [], names[0], names[1]];
}

function selectGroups(table: PlotDataTable, spec: AnalysisSpec, minimum: number): Array<{ name: string; values: number[] }> {
  if (!spec.groupField) throw new Error('该检验需要分组字段。');
  const names = requireGroups(spec, minimum);
  const grouped = groupedNumericValues(table, spec.valueField, spec.groupField);
  return names.map((name) => {
    const values = grouped.get(name) ?? [];
    requireMinimum(values, 1, `分组 ${name}`);
    return { name, values };
  });
}

function selectPairedValues(table: PlotDataTable, spec: AnalysisSpec): Array<[number, number]> {
  if (!spec.groupField || !spec.subjectField) throw new Error('配对检验需要分组字段和受试者/seed 字段。');
  const groups = requireGroups(spec, 2).slice(0, 2);
  const groupIndex = columnIndex(table, spec.groupField);
  const subjectIndex = columnIndex(table, spec.subjectField);
  const valueIndex = columnIndex(table, spec.valueField);
  const subjects = new Map<string, Map<string, number>>();
  table.rows.forEach((row) => {
    const group = String(row[groupIndex] ?? '');
    const subject = String(row[subjectIndex] ?? '');
    const value = Number(row[valueIndex]);
    if (!groups.includes(group) || !subject || !Number.isFinite(value)) return;
    const values = subjects.get(subject) ?? new Map<string, number>();
    values.set(group, value);
    subjects.set(subject, values);
  });
  return [...subjects.values()]
    .filter((values) => values.has(groups[0]) && values.has(groups[1]))
    .map((values) => [values.get(groups[0]) as number, values.get(groups[1]) as number]);
}

function selectCompleteBlocks(table: PlotDataTable, spec: AnalysisSpec): number[][] {
  if (!spec.groupField || !spec.subjectField) throw new Error('Friedman 检验需要分组字段和受试者/seed 字段。');
  const groups = requireGroups(spec, 3);
  const groupIndex = columnIndex(table, spec.groupField);
  const subjectIndex = columnIndex(table, spec.subjectField);
  const valueIndex = columnIndex(table, spec.valueField);
  const subjects = new Map<string, Map<string, number>>();
  table.rows.forEach((row) => {
    const group = String(row[groupIndex] ?? '');
    const subject = String(row[subjectIndex] ?? '');
    const value = Number(row[valueIndex]);
    if (!groups.includes(group) || !subject || !Number.isFinite(value)) return;
    const values = subjects.get(subject) ?? new Map<string, number>();
    values.set(group, value);
    subjects.set(subject, values);
  });
  return [...subjects.values()]
    .filter((values) => groups.every((group) => values.has(group)))
    .map((values) => groups.map((group) => values.get(group) as number));
}

function numericColumn(table: PlotDataTable, field: string): number[] {
  const index = columnIndex(table, field);
  return table.rows.map((row) => Number(row[index])).filter(Number.isFinite);
}

function selectNumericPairs(table: PlotDataTable, xField: string, yField: string): Array<[number, number]> {
  const xIndex = columnIndex(table, xField);
  const yIndex = columnIndex(table, yField);
  return table.rows
    .map((row) => [Number(row[xIndex]), Number(row[yIndex])] as [number, number])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function groupedNumericValues(table: PlotDataTable, valueField: string, groupField: string): Map<string, number[]> {
  const valueIndex = columnIndex(table, valueField);
  const groupIndex = columnIndex(table, groupField);
  const grouped = new Map<string, number[]>();
  table.rows.forEach((row) => {
    const group = String(row[groupIndex] ?? '');
    const value = Number(row[valueIndex]);
    if (!group || !Number.isFinite(value)) return;
    const values = grouped.get(group) ?? [];
    values.push(value);
    grouped.set(group, values);
  });
  return grouped;
}

function requireGroups(spec: AnalysisSpec, minimum: number): string[] {
  const groups = (spec.groups ?? []).filter(Boolean);
  if (groups.length < minimum) throw new Error(`该检验至少需要显式选择 ${minimum} 个分组。`);
  return groups;
}

function columnIndex(table: PlotDataTable, field: string): number {
  const index = table.columns.findIndex((column) => column.id === field);
  if (index < 0) throw new Error(`统计字段不存在：${field}`);
  return index;
}

function averageRanks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const average = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index].index] = average;
    start = end;
  }
  return ranks;
}

function rankTieSum(values: number[]): number {
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.values()].reduce((sum, count) => sum + (count ** 3 - count), 0);
}

function rankTieCorrection(values: number[]): number {
  const n = values.length;
  return n > 1 ? rankTieSum(values) / (n * (n - 1)) : 0;
}

function tPValue(statistic: number, df: number, tail: AnalysisSpec['tail']): number {
  const cdf = jStat.studentt.cdf(statistic, df);
  if (tail === 'less') return clampProbability(cdf);
  if (tail === 'greater') return clampProbability(1 - cdf);
  return clampProbability(2 * (1 - jStat.studentt.cdf(Math.abs(statistic), df)));
}

function normalPValue(z: number, tail: AnalysisSpec['tail']): number {
  const cdf = jStat.normal.cdf(z, 0, 1);
  if (tail === 'less') return clampProbability(cdf);
  if (tail === 'greater') return clampProbability(1 - cdf);
  return clampProbability(2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1)));
}

function okResult(
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance'],
  values: Partial<TraceableAnalysisResult> & Pick<TraceableAnalysisResult, 'method' | 'sampleSizes'>
): TraceableAnalysisResult {
  return {
    analysisId: spec.id,
    status: 'ok',
    details: {},
    warnings: [],
    provenance,
    ...values
  };
}

function invalidResult(
  spec: AnalysisSpec,
  provenance: TraceableAnalysisResult['provenance'],
  error: string
): TraceableAnalysisResult {
  return {
    analysisId: spec.id,
    method: spec.type,
    status: 'invalid',
    sampleSizes: {},
    details: {},
    warnings: [],
    error,
    provenance
  };
}

function requireMinimum<T>(values: T[], minimum: number, label: string): void {
  if (values.length < minimum) throw new Error(`${label}至少需要 ${minimum} 个有效观测。`);
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function roundProbability(value: number): number {
  return Number(clampProbability(value).toPrecision(14));
}
