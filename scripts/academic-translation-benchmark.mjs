#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { ArxivTranslationService } from '../src/main/arxivTranslationService.ts';
import {
  hasConfiguredHyMt2,
  resetHyMt2Runtime,
  resolveHyMt2ModelCacheIdentity,
  translateTextsWithHyMt2
} from '../src/main/hyMtTranslationService.ts';
import {
  COMET_MBR_MODEL_ID,
  COMET_MBR_MODEL_REVISION,
  CometMbrRuntime
} from '../src/main/cometMbrRuntime.ts';

const args = process.argv.slice(2);
const fixturePath = path.resolve(readArg('--fixture') ?? 'benchmarks/academic-translation-v1.json');
const outputRoot = path.resolve(readArg('--output') ?? '.tmp-academic-translation-benchmark');
const batchSize = Math.max(1, Math.min(30, Number(readArg('--batch-size') ?? 5)));
const validateOnly = args.includes('--validate');
const onlyIds = new Set(
  (readArg('--only') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
);
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const records = (fixture.records ?? []).filter((record) => onlyIds.size === 0 || onlyIds.has(record.id));
const fixtureValidation = validateFixture(fixture, records, onlyIds.size === 0);

if (validateOnly) {
  console.log(JSON.stringify(fixtureValidation, null, 2));
  process.exit(fixtureValidation.errors.length === 0 ? 0 : 1);
}
if (fixtureValidation.errors.length > 0) {
  throw new Error(`翻译基准数据无效：\n${fixtureValidation.errors.join('\n')}`);
}

const runId = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
const runRoot = path.join(outputRoot, runId);
await fs.mkdir(runRoot, { recursive: true });
const workerPath = path.resolve('assets/runtime/comet-mbr/comet_mbr_worker.py');
const cometRuntime = new CometMbrRuntime({ workerPath, timeoutMs: 240_000 });
const cometSnapshot = cometRuntime.snapshot();
if (!hasConfiguredHyMt2()) {
  throw new Error('HY-MT2 未配置，不能运行真实三候选质量基准。');
}
if (!cometSnapshot.configured) {
  throw new Error(`COMET-MBR 未配置：${JSON.stringify(cometSnapshot, null, 2)}`);
}

const requests = records.map((record) => ({
  stableId: record.id,
  title: record.title,
  summary: record.abstract
}));
const baselineDb = path.join(runRoot, 'baseline.sqlite');
const mbrDb = path.join(runRoot, 'mbr.sqlite');
const baselineTimings = [];
const mbrTimings = [];
const generatedCandidateSeeds = [];
const progressEvents = [];

console.log(`[benchmark] ${records.length} 条；批大小 ${batchSize}；HY-MT2 ${resolveHyMt2ModelCacheIdentity()}`);
const baselineService = new ArxivTranslationService({
  dbPath: baselineDb,
  timeoutMs: 240_000,
  protectGlossaryTerms: false,
  translateTextsWithEngine: (texts, options) =>
    translateTextsWithHyMt2(texts, 240_000, {
      itemContexts: options?.itemContexts,
      generation: { seed: 42, strict: true }
    }),
  fallbackTranslateTextsWithEngine: async () => {
    throw new Error('基准禁止静默切换后备引擎。');
  }
});
let baselineResults;
try {
  baselineResults = await runTranslationBatches(
    'baseline',
    baselineService,
    requests,
    batchSize,
    baselineTimings
  );
} finally {
  baselineService.close();
}

resetHyMt2Runtime();
const mbrService = new ArxivTranslationService({
  dbPath: mbrDb,
  timeoutMs: 240_000,
  protectGlossaryTerms: false,
  candidateTranslateTextsWithEngine: async (texts, seed, options) => {
    generatedCandidateSeeds.push(seed);
    return translateTextsWithHyMt2(texts, 240_000, {
      itemContexts: options?.itemContexts,
      generation: { seed, strict: true }
    });
  },
  cometEvaluator: (pairs) => cometRuntime.score(pairs),
  resetCandidateRuntime: resetHyMt2Runtime,
  unloadCometEvaluator: () => cometRuntime.unload(),
  onProgress: (progress) => {
    progressEvents.push({
      stableId: progress.stableId,
      phase: progress.phase,
      candidateIndex: progress.candidateIndex,
      candidateTotal: progress.candidateTotal
    });
  }
});
let mbrResults;
try {
  mbrResults = await runTranslationBatches('mbr', mbrService, requests, batchSize, mbrTimings);
} finally {
  mbrService.close();
}

resetHyMt2Runtime();
console.log('[benchmark] 正在用人工参考译文计算独立 COMET 分数。');
const referencePairEntries = [];
records.forEach((record, index) => {
  const variants = [
    ['baseline', baselineResults[index]],
    ['mbr', mbrResults[index]]
  ];
  variants.forEach(([variant, result]) => {
    if (!result?.titleZh || !result?.abstractZh) {
      return;
    }
    referencePairEntries.push({
      id: record.id,
      variant,
      kind: 'title',
      pair: { source: record.title, translation: result.titleZh, reference: record.referenceTitleZh }
    });
    referencePairEntries.push({
      id: record.id,
      variant,
      kind: 'abstract',
      pair: { source: record.abstract, translation: result.abstractZh, reference: record.referenceAbstractZh }
    });
  });
});

const referenceScores = await scoreInChunks(cometRuntime, referencePairEntries.map((entry) => entry.pair), 32);
await cometRuntime.unload().catch(() => undefined);
cometRuntime.close();
const scoreIndex = new Map(
  referencePairEntries.map((entry, index) => [`${entry.id}:${entry.variant}:${entry.kind}`, referenceScores[index]])
);
const runtimeEvidence = await loadRuntimeEvidence();
const rows = records.map((record, index) => {
  const baseline = evaluateVariant(record, baselineResults[index], scoreIndex, 'baseline');
  const mbr = evaluateVariant(record, mbrResults[index], scoreIndex, 'mbr');
  return {
    id: record.id,
    domain: record.domain,
    source: { title: record.title, abstract: record.abstract },
    reference: { titleZh: record.referenceTitleZh, abstractZh: record.referenceAbstractZh },
    baseline,
    mbr,
    cometDelta: finiteDifference(mbr.referenceCometMean, baseline.referenceCometMean),
    hardGateRegression: baseline.hardGatePassed && !mbr.hardGatePassed
  };
});
const blind = buildBlindReview(records, rows);
const humanReview = await loadHumanReview(readArg('--human-review'), blind.key);
const aggregate = buildAggregate(rows, baselineTimings, mbrTimings, humanReview);
const report = {
  benchmarkVersion: fixture.version,
  generatedAt: new Date().toISOString(),
  fixturePath,
  referenceReviewStatus: fixture.referenceReviewStatus,
  selectedRecordCount: records.length,
  fullFixtureRecordCount: fixture.records.length,
  batchSize,
  models: {
    generator: resolveHyMt2ModelCacheIdentity(),
    evaluator: `${COMET_MBR_MODEL_ID}@${COMET_MBR_MODEL_REVISION}`
  },
  runtimeEvidence,
  generatedCandidateSeeds,
  progressEventCount: progressEvents.length,
  timings: {
    interpretation: '每批墙钟耗时除以该批论文数，属于批处理摊销单篇耗时；另需保留单篇冷启动探针。',
    baselineAmortizedMs: baselineTimings,
    mbrAmortizedMs: mbrTimings
  },
  rows,
  aggregate
};

await fs.writeFile(path.join(runRoot, 'academic-translation-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(runRoot, 'academic-translation-report.md'), renderReportMarkdown(report), 'utf8');
await fs.writeFile(path.join(runRoot, 'blind-review.md'), blind.markdown, 'utf8');
await fs.writeFile(path.join(runRoot, 'blind-key.json'), `${JSON.stringify(blind.key, null, 2)}\n`, 'utf8');
console.log(`翻译质量报告：${path.join(runRoot, 'academic-translation-report.json')}`);
console.log(`盲评表：${path.join(runRoot, 'blind-review.md')}`);
console.log(JSON.stringify(aggregate, null, 2));

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function validateFixture(source, selectedRecords, requireFullSet) {
  const errors = [];
  const all = Array.isArray(source.records) ? source.records : [];
  if (requireFullSet && all.length !== 30) {
    errors.push(`完整基准必须恰好包含 30 条，实际 ${all.length} 条。`);
  }
  const ids = new Set();
  const domains = new Set();
  all.forEach((record, index) => {
    if (!record?.id || ids.has(record.id)) errors.push(`第 ${index + 1} 条 ID 缺失或重复。`);
    ids.add(record?.id);
    domains.add(record?.domain);
    for (const field of ['title', 'abstract', 'referenceTitleZh', 'referenceAbstractZh']) {
      if (typeof record?.[field] !== 'string' || !record[field].trim()) {
        errors.push(`${record?.id ?? index} 缺少 ${field}。`);
      }
    }
    for (const field of ['protectedLiterals', 'requiredTerms', 'forbiddenTerms']) {
      if (!Array.isArray(record?.[field])) errors.push(`${record?.id ?? index} 的 ${field} 必须为数组。`);
    }
    const sourceText = `${record?.title ?? ''}\n${record?.abstract ?? ''}`;
    const referenceText = `${record?.referenceTitleZh ?? ''}\n${record?.referenceAbstractZh ?? ''}`;
    for (const literal of record?.protectedLiterals ?? []) {
      if (!containsProtectedLiteral(sourceText, literal)) errors.push(`${record.id} 的保护字面量不在原文中：${literal}`);
      if (!containsProtectedLiteral(referenceText, literal)) errors.push(`${record.id} 的保护字面量不在参考译文中：${literal}`);
    }
  });
  if (requireFullSet && domains.size < 10) errors.push(`完整基准至少覆盖 10 个领域，实际 ${domains.size} 个。`);
  if (selectedRecords.length === 0) errors.push('没有选中任何基准记录。');
  return {
    version: source.version,
    totalRecordCount: all.length,
    selectedRecordCount: selectedRecords.length,
    domainCount: domains.size,
    humanReviewedCount: all.filter((record) => record.humanReviewed === true).length,
    referenceReviewStatus: source.referenceReviewStatus,
    errors
  };
}

async function runTranslationBatches(label, service, values, size, timings) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    const batch = values.slice(index, index + size);
    const startedAt = Date.now();
    console.log(`[${label}] ${index + 1}-${index + batch.length}/${values.length}`);
    const translated = await service.translatePapers(batch, {
      priority: 'foreground',
      sessionId: Date.now() * 100 + index
    });
    const durationMs = Date.now() - startedAt;
    const amortizedMs = durationMs / Math.max(1, batch.length);
    batch.forEach(() => timings.push(amortizedMs));
    output.push(...translated);
  }
  return output;
}

async function scoreInChunks(runtime, pairs, size) {
  const scores = [];
  for (let index = 0; index < pairs.length; index += size) {
    console.log(`[reference-comet] ${index + 1}-${Math.min(index + size, pairs.length)}/${pairs.length}`);
    scores.push(...await runtime.score(pairs.slice(index, index + size)));
  }
  return scores;
}

function evaluateVariant(record, result, scores, variant) {
  const text = `${result?.titleZh ?? ''}\n${result?.abstractZh ?? ''}`;
  const protectedMissing = (record.protectedLiterals ?? []).filter((literal) => !containsProtectedLiteral(text, literal));
  const requiredMissing = (record.requiredTerms ?? []).filter((term) => !containsRequiredTerm(text, term));
  const forbiddenHits = (record.forbiddenTerms ?? []).filter((term) => text.includes(term));
  const titleScore = scores.get(`${record.id}:${variant}:title`);
  const abstractScore = scores.get(`${record.id}:${variant}:abstract`);
  return {
    status: result?.status ?? 'missing',
    message: result?.message ?? '',
    qualityStatus: result?.qualityStatus ?? 'missing',
    selectionMode: result?.selectionMode ?? 'missing',
    selectedSeed: result?.selectedSeed ?? null,
    titleZh: result?.titleZh ?? '',
    abstractZh: result?.abstractZh ?? '',
    hardGatePassed: ['completed', 'cached'].includes(result?.status),
    protectedPassed: protectedMissing.length === 0,
    protectedMissing,
    requiredTermRecall: ratio((record.requiredTerms ?? []).length - requiredMissing.length, (record.requiredTerms ?? []).length),
    requiredMissing,
    forbiddenPassed: forbiddenHits.length === 0,
    forbiddenHits,
    referenceCometTitle: finiteOrNull(titleScore),
    referenceCometAbstract: finiteOrNull(abstractScore),
    referenceCometMean: mean([titleScore, abstractScore])
  };
}

function buildAggregate(rows, baselineLatency, mbrLatency, humanReview) {
  const pairedRows = rows.filter(
    (row) => Number.isFinite(row.baseline.referenceCometMean) && Number.isFinite(row.mbr.referenceCometMean)
  );
  const baselineComet = mean(pairedRows.map((row) => row.baseline.referenceCometMean));
  const mbrComet = mean(pairedRows.map((row) => row.mbr.referenceCometMean));
  const perDomain = Object.fromEntries(
    [...new Set(rows.map((row) => row.domain))].sort().map((domain) => {
      const subset = rows.filter((row) => row.domain === domain);
      const pairedSubset = subset.filter(
        (row) => Number.isFinite(row.baseline.referenceCometMean) && Number.isFinite(row.mbr.referenceCometMean)
      );
      return [domain, {
        count: subset.length,
        comparableCount: pairedSubset.length,
        baselineComet: mean(pairedSubset.map((row) => row.baseline.referenceCometMean)),
        mbrComet: mean(pairedSubset.map((row) => row.mbr.referenceCometMean)),
        delta: mean(pairedSubset.map((row) => row.cometDelta))
      }];
    })
  );
  const protectedRate = ratio(
    rows.filter((row) => row.mbr.protectedPassed).length,
    rows.length
  );
  const hardGateNoRegression = rows.every((row) => !row.hardGateRegression);
  const referenceCometNotLower =
    Number.isFinite(mbrComet) && Number.isFinite(baselineComet) && mbrComet >= baselineComet - 1e-9;
  const humanComplete = humanReview.reviewedCount === rows.length;
  const humanWinTiePass = humanComplete && humanReview.newWinOrTieRate >= 0.9;
  const automatedPassed = protectedRate === 1 && hardGateNoRegression && referenceCometNotLower;
  return {
    recordCount: rows.length,
    referenceCometPairCount: pairedRows.length,
    baseline: {
      hardGatePassRate: ratio(rows.filter((row) => row.baseline.hardGatePassed).length, rows.length),
      protectedPassRate: ratio(rows.filter((row) => row.baseline.protectedPassed).length, rows.length),
      requiredTermRecall: mean(rows.map((row) => row.baseline.requiredTermRecall)),
      forbiddenPassRate: ratio(rows.filter((row) => row.baseline.forbiddenPassed).length, rows.length),
      meanReferenceComet: baselineComet,
      p50AmortizedMs: percentile(baselineLatency, 0.5),
      p95AmortizedMs: percentile(baselineLatency, 0.95)
    },
    mbr: {
      hardGatePassRate: ratio(rows.filter((row) => row.mbr.hardGatePassed).length, rows.length),
      protectedPassRate: protectedRate,
      requiredTermRecall: mean(rows.map((row) => row.mbr.requiredTermRecall)),
      forbiddenPassRate: ratio(rows.filter((row) => row.mbr.forbiddenPassed).length, rows.length),
      meanReferenceComet: mbrComet,
      p50AmortizedMs: percentile(mbrLatency, 0.5),
      p95AmortizedMs: percentile(mbrLatency, 0.95)
    },
    meanReferenceCometDelta: finiteDifference(mbrComet, baselineComet),
    perDomain,
    humanReview,
    acceptance: {
      protectedContent100Percent: protectedRate === 1,
      hardGateNoRegression,
      referenceCometNotLower,
      humanWinOrTie90Percent: humanComplete ? humanWinTiePass : null,
      status: !automatedPassed ? 'failed' : humanComplete && humanWinTiePass ? 'passed' : 'incomplete-human-review'
    }
  };
}

function buildBlindReview(sourceRecords, rows) {
  const key = { schemaVersion: 1, generatedAt: new Date().toISOString(), assignments: [] };
  const sections = ['# 学术翻译盲评表', '', '每条从忠实性、术语、流畅性、完整性四方面比较 A/B；填写 `A`、`B` 或 `tie`。', ''];
  rows.forEach((row) => {
    const record = sourceRecords.find((item) => item.id === row.id);
    const baselineIsA = crypto.createHash('sha256').update(row.id).digest()[0] % 2 === 0;
    const a = baselineIsA ? row.baseline : row.mbr;
    const b = baselineIsA ? row.mbr : row.baseline;
    key.assignments.push({ id: row.id, A: baselineIsA ? 'baseline' : 'mbr', B: baselineIsA ? 'mbr' : 'baseline' });
    sections.push(
      `## ${row.id} · ${row.domain}`,
      '',
      `原文标题：${record.title}`,
      '',
      `原文摘要：${record.abstract}`,
      '',
      `A 标题：${a.titleZh}`,
      '',
      `A 摘要：${a.abstractZh}`,
      '',
      `B 标题：${b.titleZh}`,
      '',
      `B 摘要：${b.abstractZh}`,
      '',
      '- 偏好（A/B/tie）：',
      '- 忠实性备注：',
      '- 术语备注：',
      '- 流畅性备注：',
      '- 完整性备注：',
      ''
    );
  });
  return { key, markdown: `${sections.join('\n')}\n` };
}

async function loadHumanReview(filePath, blindKey) {
  if (!filePath) {
    return { status: 'incomplete', reviewedCount: 0, newWins: 0, ties: 0, baselineWins: 0, newWinOrTieRate: null };
  }
  const payload = JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'));
  const assignmentById = new Map(blindKey.assignments.map((entry) => [entry.id, entry]));
  let newWins = 0;
  let ties = 0;
  let baselineWins = 0;
  for (const review of payload.reviews ?? []) {
    const assignment = assignmentById.get(review.id);
    if (!assignment || !['A', 'B', 'tie'].includes(review.preferred)) continue;
    if (review.preferred === 'tie') ties += 1;
    else if (assignment[review.preferred] === 'mbr') newWins += 1;
    else baselineWins += 1;
  }
  const reviewedCount = newWins + ties + baselineWins;
  return {
    status: reviewedCount === blindKey.assignments.length ? 'complete' : 'incomplete',
    reviewedCount,
    newWins,
    ties,
    baselineWins,
    newWinOrTieRate: ratio(newWins + ties, reviewedCount)
  };
}

async function loadRuntimeEvidence() {
  const manifestPath = 'E:\\FTranslateTools\\comet-mbr\\manifest.json';
  const benchmarkRoot = path.resolve('.tmp-comet-benchmark');
  const manifest = await readJsonIfPresent(manifestPath);
  let runtimeBenchmark = null;
  try {
    const files = (await fs.readdir(benchmarkRoot))
      .filter((name) => /^comet-mbr-.*\.json$/u.test(name))
      .sort()
      .reverse();
    runtimeBenchmark = files[0] ? await readJsonIfPresent(path.join(benchmarkRoot, files[0])) : null;
  } catch {
    runtimeBenchmark = null;
  }
  return {
    manifest,
    runtimeBenchmark,
    system: { platform: process.platform, release: os.release(), totalMemoryBytes: os.totalmem() }
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function renderReportMarkdown(report) {
  const a = report.aggregate;
  const lines = [
    '# 学术翻译 COMET-MBR 基准',
    '',
    `- 样本：${a.recordCount}`,
    `- 可配对参考 COMET：${a.referenceCometPairCount}/${a.recordCount}`,
    `- 参考状态：${report.referenceReviewStatus}`,
    `- 基线参考 COMET：${formatNumber(a.baseline.meanReferenceComet)}`,
    `- MBR 参考 COMET：${formatNumber(a.mbr.meanReferenceComet)}`,
    `- 差值：${formatNumber(a.meanReferenceCometDelta)}`,
    `- MBR 保护内容通过率：${formatPercent(a.mbr.protectedPassRate)}`,
    `- MBR 必需术语召回率：${formatPercent(a.mbr.requiredTermRecall)}`,
    `- MBR 摊销 p50 / p95：${Math.round(a.mbr.p50AmortizedMs ?? 0)} / ${Math.round(a.mbr.p95AmortizedMs ?? 0)} ms`,
    `- 验收状态：${a.acceptance.status}`,
    '',
    '| ID | 领域 | 基线 COMET | MBR COMET | Δ | 选择模式 |',
    '|---|---|---:|---:|---:|---|',
    ...report.rows.map((row) =>
      `| ${row.id} | ${row.domain} | ${formatNumber(row.baseline.referenceCometMean)} | ${formatNumber(row.mbr.referenceCometMean)} | ${formatNumber(row.cometDelta)} | ${row.mbr.selectionMode} |`
    ),
    '',
    '> 盲评未完成时，自动指标即使通过也不得标记为发布验收通过。',
    ''
  ];
  return lines.join('\n');
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function mean(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function finiteDifference(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
}

function containsProtectedLiteral(text, literal) {
  return normalizeProtectedLiteral(text).includes(normalizeProtectedLiteral(literal));
}

function normalizeProtectedLiteral(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/\s+/gu, '');
}

function containsRequiredTerm(text, term) {
  const normalize = (value) => String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/\s+/gu, '')
    .replace(/的/gu, '');
  return normalize(text).includes(normalize(term));
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(4) : '—';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}
