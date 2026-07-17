#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { buildArxivApiUrl, parseArxivSearchResult } from '../src/shared/arxiv.ts';

const args = process.argv.slice(2);
const fixturePath = path.resolve(readArg('--fixture') ?? 'benchmarks/arxiv-retrieval-v1.json');
const outputRoot = path.resolve(readArg('--output') ?? '.tmp-arxiv-benchmark');
const live = args.includes('--live');
const offline = args.includes('--offline') || !live;
const force = args.includes('--force');
const onlyIds = new Set((readArg('--only') ?? '').split(',').map((value) => value.trim()).filter(Boolean));
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const queries = Array.isArray(fixture) ? fixture : fixture.queries;

if (!Array.isArray(queries) || queries.length === 0) {
  throw new Error(`检索基准没有查询项：${fixturePath}`);
}

const rawRoot = path.join(outputRoot, 'raw');
await fs.mkdir(rawRoot, { recursive: true });

if (live) {
  await runLiveQueries(onlyIds.size > 0 ? queries.filter((item) => onlyIds.has(item.id)) : queries);
}

if (offline || live) {
  const report = await buildReport(queries);
  const jsonPath = path.join(outputRoot, 'arxiv-retrieval-report.json');
  const markdownPath = path.join(outputRoot, 'arxiv-retrieval-report.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, renderMarkdown(report), 'utf8');
  console.log(`arXiv retrieval report: ${jsonPath}`);
  console.log(`arXiv retrieval report: ${markdownPath}`);
  console.log(JSON.stringify(report.aggregate, null, 2));
}

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runLiveQueries(items) {
  let previousRequestAt = 0;
  for (const item of items) {
    const rawPath = path.join(rawRoot, `${item.id}.xml`);
    if (!force && await isUsableFile(rawPath)) {
      console.log(`[resume] ${item.id}`);
      continue;
    }

    const remaining = Math.max(0, 3200 - (Date.now() - previousRequestAt));
    if (remaining > 0) {
      await delay(remaining);
    }

    const request = {
      searchQuery: item.query,
      queryMode: item.mode ?? 'balanced',
      category: item.category ?? '',
      start: 0,
      maxResults: 50,
      sortBy: 'relevance',
      sortOrder: 'descending'
    };
    const url = buildArxivApiUrl(request);
    const startedAt = Date.now();
    previousRequestAt = startedAt;
    console.log(`[fetch] ${item.id}: ${item.query}`);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'FTranslate/0.1 retrieval-quality-benchmark' },
        signal: AbortSignal.timeout(30_000)
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
      }
      parseArxivSearchResult(text, XmldomParser);
      await fs.writeFile(rawPath, text, 'utf8');
      await fs.writeFile(
        path.join(rawRoot, `${item.id}.meta.json`),
        `${JSON.stringify({
          id: item.id,
          url,
          latencyMs: Date.now() - startedAt,
          fetchedAt: new Date().toISOString()
        }, null, 2)}\n`,
        'utf8'
      );
    } catch (error) {
      await fs.writeFile(
        path.join(rawRoot, `${item.id}.error.json`),
        `${JSON.stringify({
          id: item.id,
          url,
          message: error instanceof Error ? error.message : String(error),
          failedAt: new Date().toISOString()
        }, null, 2)}\n`,
        'utf8'
      );
      console.error(`[failed] ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function buildReport(items) {
  const rows = [];
  for (const item of items) {
    const rawPath = path.join(rawRoot, `${item.id}.xml`);
    if (!(await isUsableFile(rawPath))) {
      rows.push({
        id: item.id,
        query: item.query,
        status: 'not-run',
        humanReviewed: Boolean(item.humanReviewed),
        precisionAt10: null,
        ndcgAt10: null,
        recallAt50: null,
        exactHitPosition: null,
        offTopicRateAt10: null,
        latencyMs: null
      });
      continue;
    }

    try {
      const xml = await fs.readFile(rawPath, 'utf8');
      const parsed = parseArxivSearchResult(xml, XmldomParser);
      const graded = parsed.papers.map((paper) => ({ paper, relevance: gradePaper(paper, item) }));
      const knownRelevantIds = item.knownRelevantIds ?? [];
      const exactHitPosition = findExactHitPosition(parsed.papers, knownRelevantIds);
      const metadata = await readJson(path.join(rawRoot, `${item.id}.meta.json`));
      rows.push({
        id: item.id,
        query: item.query,
        status: 'scored',
        humanReviewed: Boolean(item.humanReviewed),
        resultCount: parsed.papers.length,
        precisionAt10: precisionAt(graded, 10),
        ndcgAt10: ndcgAt(graded, 10),
        recallAt50: knownRelevantIds.length > 0
          ? knownRelevantIds.filter((id) => parsed.papers.some((paper) => paper.stableId === id)).length / knownRelevantIds.length
          : null,
        exactHitPosition,
        offTopicRateAt10: offTopicRateAt(graded, 10),
        latencyMs: metadata?.latencyMs ?? null,
        top10: graded.slice(0, 10).map(({ paper, relevance }, index) => ({
          rank: index + 1,
          stableId: paper.stableId,
          title: paper.title,
          relevance
        }))
      });
    } catch (error) {
      rows.push({
        id: item.id,
        query: item.query,
        status: 'parse-failed',
        error: error instanceof Error ? error.message : String(error),
        humanReviewed: Boolean(item.humanReviewed),
        precisionAt10: null,
        ndcgAt10: null,
        recallAt50: null,
        exactHitPosition: null,
        offTopicRateAt10: null,
        latencyMs: null
      });
    }
  }

  return {
    benchmarkVersion: fixture.version ?? 'unversioned',
    generatedAt: new Date().toISOString(),
    fixturePath,
    outputRoot,
    judgementBasis: 'deterministic concept groups plus forbidden-title and known-ID rules',
    rows,
    aggregate: {
      queryCount: rows.length,
      scoredQueryCount: rows.filter((row) => row.status === 'scored').length,
      humanReviewedQueryCount: rows.filter((row) => row.humanReviewed).length,
      meanPrecisionAt10: mean(rows.map((row) => row.precisionAt10)),
      meanNdcgAt10: mean(rows.map((row) => row.ndcgAt10)),
      meanRecallAt50: mean(rows.map((row) => row.recallAt50)),
      meanOffTopicRateAt10: mean(rows.map((row) => row.offTopicRateAt10)),
      meanLatencyMs: mean(rows.map((row) => row.latencyMs))
    }
  };
}

function gradePaper(paper, item) {
  const title = normalizeText(paper.title);
  const text = `${title} ${normalizeText(paper.summary)}`;
  if ((item.forbiddenTitleTerms ?? []).some((term) => title.includes(normalizeText(term)))) {
    return 0;
  }
  if ((item.knownRelevantIds ?? []).includes(paper.stableId)) {
    return 3;
  }
  const groups = item.requiredConcepts ?? [];
  if (groups.length === 0) {
    return 0;
  }
  const matchedGroups = groups.filter((aliases) => aliases.some((alias) => text.includes(normalizeText(alias)))).length;
  if (matchedGroups === groups.length) {
    return 2;
  }
  return matchedGroups >= Math.max(1, Math.ceil(groups.length * 0.6)) ? 1 : 0;
}

export function precisionAt(items, k) {
  if (items.length === 0 || k <= 0) {
    return null;
  }
  return items.slice(0, k).filter((item) => item.relevance > 0).length / Math.min(k, items.length);
}

export function ndcgAt(items, k) {
  if (items.length === 0 || k <= 0) {
    return null;
  }
  const dcg = items.slice(0, k).reduce(
    (sum, item, index) => sum + (2 ** item.relevance - 1) / Math.log2(index + 2),
    0
  );
  const ideal = [...items].sort((left, right) => right.relevance - left.relevance);
  const idcg = ideal.slice(0, k).reduce(
    (sum, item, index) => sum + (2 ** item.relevance - 1) / Math.log2(index + 2),
    0
  );
  return idcg === 0 ? 0 : dcg / idcg;
}

function offTopicRateAt(items, k) {
  if (items.length === 0 || k <= 0) {
    return null;
  }
  const visible = items.slice(0, k);
  return visible.filter((item) => item.relevance === 0).length / visible.length;
}

function findExactHitPosition(papers, knownRelevantIds) {
  if (knownRelevantIds.length === 0) {
    return null;
  }
  const positions = knownRelevantIds
    .map((id) => papers.findIndex((paper) => paper.stableId === id))
    .filter((index) => index >= 0)
    .map((index) => index + 1);
  return positions.length > 0 ? Math.min(...positions) : null;
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase().replace(/[‐‑‒–—]/gu, '-').replace(/\s+/gu, ' ').trim();
}

function mean(values) {
  const numeric = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (numeric.length === 0) {
    return null;
  }
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function renderMarkdown(report) {
  const format = (value) => typeof value === 'number' ? value.toFixed(3) : '—';
  const lines = [
    `# arXiv Retrieval Benchmark (${report.benchmarkVersion})`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Scored queries: ${report.aggregate.scoredQueryCount}/${report.aggregate.queryCount}; human-reviewed: ${report.aggregate.humanReviewedQueryCount}.`,
    '',
    '| Query | Status | P@10 | nDCG@10 | Recall@50 | Off-topic@10 | Exact rank | Latency |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  report.rows.forEach((row) => {
    lines.push(
      `| ${row.id} | ${row.status} | ${format(row.precisionAt10)} | ${format(row.ndcgAt10)} | ${format(row.recallAt50)} | ${format(row.offTopicRateAt10)} | ${row.exactHitPosition ?? '—'} | ${row.latencyMs ?? '—'} ms |`
    );
  });
  lines.push(
    '',
    '## Aggregate',
    '',
    `- Mean P@10: ${format(report.aggregate.meanPrecisionAt10)}`,
    `- Mean nDCG@10: ${format(report.aggregate.meanNdcgAt10)}`,
    `- Mean Recall@50: ${format(report.aggregate.meanRecallAt50)}`,
    `- Mean off-topic@10: ${format(report.aggregate.meanOffTopicRateAt10)}`,
    `- Mean latency: ${report.aggregate.meanLatencyMs == null ? '—' : `${Math.round(report.aggregate.meanLatencyMs)} ms`}`,
    '',
    '> 未标记 humanReviewed 的行是确定性概念规则评分，不等同于人工相关性标注。'
  );
  return `${lines.join('\n')}\n`;
}

async function isUsableFile(filePath) {
  try {
    return (await fs.stat(filePath)).size > 64;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
