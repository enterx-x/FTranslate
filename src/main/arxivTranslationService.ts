import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TextDecoder } from 'node:util';
import type {
  ArxivTitleAbstractTranslationRequest,
  ArxivTitleAbstractTranslationResult,
  ArxivTranslationPriority
} from '../shared/arxiv';
import { isMojibakeTranslationText } from '../shared/arxiv';
export type { ArxivTranslationPriority } from '../shared/arxiv';
import {
  collapseRepeatedTranslationTail,
  hasSevereAcademicTranslationLengthLoss,
  prepareAcademicTranslation,
  repairAcademicTranslation,
  type PreparedAcademicTranslation,
  type PreparedAcademicTranslationRestoreResult
} from '../shared/academicTranslationQuality';
import {
  type LocalTranslateBatchResult,
  type LocalTranslateDirectionOptions,
  resetNllbRuntime,
  translateTextsWithNllbCTranslate2
} from './localTranslationService';

interface ArxivTranslationServiceOptions {
  dbPath: string;
  translateText?: (text: string) => Promise<string>;
  translateTexts?: (texts: string[]) => Promise<string[]>;
  translateTextsWithEngine?: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  fallbackTranslateTextsWithEngine?: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  now?: () => number;
  timeoutMs?: number;
}

export interface ArxivTranslationOptions {
  priority?: ArxivTranslationPriority;
  sessionId?: number;
}

interface CachedTranslationRow {
  source_title: string;
  source_summary: string;
  title_zh: string;
  abstract_zh: string;
  translated_at: string;
  engine: string;
}

const DEFAULT_TRANSLATION_TIMEOUT_MS = 90_000;
const TRANSLATION_PRIORITY_ORDER: readonly ArxivTranslationPriority[] = [
  'foreground',
  'preview',
  'background'
];
let argosPythonRuntime: ArgosPythonRuntime | null = null;

interface QueuedTranslationJob {
  run: () => Promise<void>;
  cancel: () => void;
  priority: ArxivTranslationPriority;
  sessionId?: number;
}

interface PreparedTranslationBatchItem {
  sourceTitle: string;
  sourceAbstract: string;
  title: PreparedAcademicTranslation;
  abstract: PreparedAcademicTranslation;
}

interface EvaluatedTranslationBatchItem {
  title: PreparedAcademicTranslationRestoreResult;
  abstract: PreparedAcademicTranslationRestoreResult;
  titleZh: string;
  abstractZh: string;
  titleUsable: boolean;
  abstractUsable: boolean;
  hasSevereAbstractLengthLoss: boolean;
}

function normalizeTranslationPriority(priority?: ArxivTranslationPriority): ArxivTranslationPriority {
  switch (priority) {
    case 'preview':
    case 'background':
      return priority;
    case 'foreground':
    default:
      return 'foreground';
  }
}

export class ArxivTranslationService {
  private readonly db: DatabaseSync;
  private readonly translateTextsWithEngine: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  private readonly fallbackTranslateTextsWithEngine?: (texts: string[]) => Promise<LocalTranslateBatchResult>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly translationQueues: Record<ArxivTranslationPriority, QueuedTranslationJob[]> = {
    foreground: [],
    preview: [],
    background: []
  };
  private translationRunning = false;
  private activeSessionId: number | null = null;

  constructor(options: ArxivTranslationServiceOptions) {
    this.db = new DatabaseSync(options.dbPath);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TRANSLATION_TIMEOUT_MS;
    const usesInjectedTranslator = Boolean(
      options.translateText || options.translateTexts || options.translateTextsWithEngine
    );
    this.translateTextsWithEngine =
      options.translateTextsWithEngine ??
      (options.translateTexts
        ? (async (texts) => ({ texts: (await options.translateTexts?.(texts)) ?? [], engine: 'argos' }))
        : options.translateText
          ? (async (texts) => ({
              texts: await Promise.all(texts.map((text) => options.translateText?.(text) ?? '')),
              engine: 'argos'
            }))
          : ((texts) => translateTextsWithArgosEngine(texts, this.timeoutMs)));
    this.fallbackTranslateTextsWithEngine =
      options.fallbackTranslateTextsWithEngine ??
      (options.translateTextsWithEngine
        ? ((texts) => translateTextsWithArgosEngine(texts, this.timeoutMs))
        : !options.translateText && !options.translateTexts
          ? ((texts) => translateTextsWithNllbCTranslate2(texts, this.timeoutMs))
        : undefined);
    this.now = options.now ?? Date.now;
    this.initDatabase();
    if (!usesInjectedTranslator) {
      void warmUpArgosTranslator(Math.min(this.timeoutMs, 30_000));
    }
  }

  close(): void {
    this.db.close();
    if (argosPythonRuntime) {
      argosPythonRuntime.close();
      argosPythonRuntime = null;
    }
    resetNllbRuntime();
  }

  async translatePaper(
    request: ArxivTitleAbstractTranslationRequest,
    options?: ArxivTranslationOptions
  ): Promise<ArxivTitleAbstractTranslationResult> {
    const [result] = await this.translatePapers([request], options);
    return result;
  }

  async translatePapers(
    requests: ArxivTitleAbstractTranslationRequest[],
    options?: ArxivTranslationOptions
  ): Promise<ArxivTitleAbstractTranslationResult[]> {
    if (typeof options?.sessionId === 'number' && Number.isSafeInteger(options.sessionId)) {
      this.activateSearchSession(options.sessionId);
    }
    const startedAt = this.now();
    const results = new Array<ArxivTitleAbstractTranslationResult>(requests.length);
    const missing: Array<{
      index: number;
      stableId: string;
      title: string;
      summary: string;
      pretranslatedTitleZh: string;
      cacheKey: string;
    }> = [];

    requests.forEach((request, index) => {
      const stableId = coerceTranslationInput(request.stableId);
      const title = coerceTranslationInput(request.title);
      const summary = coerceTranslationInput(request.summary);
      const pretranslatedTitleZh = coerceTranslationInput(request.pretranslatedTitleZh);

      if (!stableId || !title || !summary) {
        results[index] = buildFailedTranslationResult(
          stableId,
          '缺少 arXiv 标识、标题或摘要，无法翻译。'
        );
        return;
      }

      const cacheKey = buildTranslationCacheKey({ stableId, title, summary });
      const cached = this.readCache(cacheKey);
      if (cached) {
        results[index] = buildCachedTranslationResult(stableId, cached);
        return;
      }

      missing.push({ index, stableId, title, summary, pretranslatedTitleZh, cacheKey });
    });

    if (missing.length === 0) {
      return finalizeTranslationResults(results, startedAt, this.now());
    }

    const buildSupersededResults = (): ArxivTitleAbstractTranslationResult[] => {
      missing.forEach((item) => {
        if (!results[item.index]) {
          results[item.index] = buildFailedTranslationResult(
            item.stableId,
            '搜索会话已更新，已取消旧的后台翻译。'
          );
        }
      });
      return results;
    };
    const queuedResults = await this.enqueue(async () => {
      const remaining: typeof missing = [];
      missing.forEach((item) => {
        const rechecked = this.readCache(item.cacheKey);
        if (rechecked) {
          results[item.index] = buildCachedTranslationResult(item.stableId, rechecked);
          return;
        }
        remaining.push(item);
      });

      if (remaining.length === 0) {
        return results;
      }

      try {
        const preparedItems = remaining.map((item) => ({
          sourceTitle: item.title,
          sourceAbstract: item.summary,
          title: isUsableTranslatedText(item.pretranslatedTitleZh, item.title)
            ? preparePretranslatedAcademicText(item.pretranslatedTitleZh)
            : prepareAcademicTranslation(item.title),
          abstract: prepareAcademicTranslation(item.summary)
        }));
        const texts = preparedItems.flatMap((item) => [...item.title.segments, ...item.abstract.segments]);
        const uniqueBatch = buildUniqueTranslationBatch(texts);
        let translationResult = await this.translateTextsWithFallback(uniqueBatch.texts);
        let translatedTexts = uniqueBatch.indexes.map((index) => translationResult.texts[index] ?? '');
        let evaluatedTranslations = evaluatePreparedTranslations(preparedItems, translatedTexts);
        const primaryQualityProblems = countTranslationQualityProblems(evaluatedTranslations, translationResult.engine);
        const shouldTryFallback = evaluatedTranslations.some(
          (item) => item.hasSevereAbstractLengthLoss || hasSuspiciousRepeatedTranslationTail(item.abstract.text)
        );
        if (shouldTryFallback && primaryQualityProblems > 0 && this.fallbackTranslateTextsWithEngine) {
          try {
            const fallbackResult = await this.fallbackTranslateTextsWithEngine(uniqueBatch.texts);
            const fallbackTranslatedTexts = uniqueBatch.indexes.map((index) => fallbackResult.texts[index] ?? '');
            const fallbackEvaluatedTranslations = evaluatePreparedTranslations(preparedItems, fallbackTranslatedTexts);
            const fallbackQualityProblems = countTranslationQualityProblems(
              fallbackEvaluatedTranslations,
              fallbackResult.engine
            );
            if (fallbackQualityProblems < primaryQualityProblems) {
              translationResult = fallbackResult;
              translatedTexts = fallbackTranslatedTexts;
              evaluatedTranslations = fallbackEvaluatedTranslations;
            }
          } catch {
            // Keep the primary result; the repair layer below still prevents repeated tails from being cached.
          }
        }
        const translatedAt = new Date(this.now()).toISOString();

        remaining.forEach((item, itemIndex) => {
          const evaluated = evaluatedTranslations[itemIndex];
          if (!evaluated.title.ok || !evaluated.abstract.ok || evaluated.hasSevereAbstractLengthLoss) {
            results[item.index] = buildFailedTranslationResult(
              item.stableId,
              '本地翻译损坏了学术公式、代码、引用或术语占位符，或严重截断摘要，已丢弃结果且未写入缓存。',
              'failed'
            );
            return;
          }

          const titleZh = evaluated.titleUsable ? evaluated.titleZh : '';
          const abstractZh = evaluated.abstractUsable ? evaluated.abstractZh : '';
          if (!titleZh && !abstractZh) {
            results[item.index] = buildFailedTranslationResult(
              item.stableId,
              '本地翻译返回了乱码或空结果，已丢弃该缓存并保留英文。',
              'failed'
            );
            return;
          }

          this.writeCache(item.cacheKey, {
            stableId: item.stableId,
            title: item.title,
            summary: item.summary,
            titleZh,
            abstractZh,
            translatedAt,
            engine: translationResult.engine
          });
          results[item.index] = {
            stableId: item.stableId,
            titleZh,
            abstractZh,
            engine: translationResult.engine,
            status: 'completed',
            cacheHit: false,
            qualityStatus: 'passed',
            elapsedMs: 0,
            message: buildCompletedTranslationMessage(translationResult.engine),
            translatedAt
          };
        });
      } catch (error) {
        const isUnavailable = isArgosUnavailableError(error);
        const message = formatTranslationError(error);
        remaining.forEach((item) => {
          results[item.index] = {
            stableId: item.stableId,
            titleZh: '',
            abstractZh: '',
            engine: 'unavailable',
            status: isUnavailable ? 'unavailable' : 'failed',
            cacheHit: false,
            qualityStatus: 'not-checked',
            elapsedMs: 0,
            message
          };
        });
      }
      return results;
    }, options?.priority, options?.sessionId, buildSupersededResults);
    return finalizeTranslationResults(queuedResults, startedAt, this.now());
  }

  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS arxiv_translation_cache (
        cache_key TEXT PRIMARY KEY,
        stable_id TEXT NOT NULL,
        source_title TEXT NOT NULL,
        source_summary TEXT NOT NULL,
        title_zh TEXT NOT NULL,
        abstract_zh TEXT NOT NULL,
        translated_at TEXT NOT NULL,
        engine TEXT NOT NULL
      );
    `);
  }

  private enqueue<T>(
    task: () => Promise<T>,
    priority?: ArxivTranslationPriority,
    sessionId?: number,
    onCancel?: () => T
  ): Promise<T> {
    const normalizedPriority = normalizeTranslationPriority(priority);
    if (typeof sessionId === 'number' && Number.isSafeInteger(sessionId)) {
      this.activateSearchSession(sessionId);
    }
    const queue = this.translationQueues[normalizedPriority];
    return new Promise<T>((resolve, reject) => {
      const job: QueuedTranslationJob = {
        priority: normalizedPriority,
        ...(typeof sessionId === 'number' ? { sessionId } : {}),
        run: async () => {
          try {
            resolve(await task());
          } catch (error) {
            reject(error);
          }
        },
        cancel: () => {
          if (onCancel) {
            resolve(onCancel());
          } else {
            reject(new Error('Translation job was superseded by a newer search session.'));
          }
        }
      };
      if (this.isSupersededLowPriorityJob(job)) {
        job.cancel();
        return;
      }
      queue.push(job);
      this.runNextTranslationJob();
    });
  }

  private activateSearchSession(sessionId: number): void {
    if (this.activeSessionId !== null && sessionId <= this.activeSessionId) {
      return;
    }
    this.activeSessionId = sessionId;
    (['preview', 'background'] as const).forEach((priority) => {
      const retained: QueuedTranslationJob[] = [];
      this.translationQueues[priority].forEach((job) => {
        if (this.isSupersededLowPriorityJob(job)) {
          job.cancel();
        } else {
          retained.push(job);
        }
      });
      this.translationQueues[priority] = retained;
    });
  }

  private isSupersededLowPriorityJob(job: QueuedTranslationJob): boolean {
    return (
      job.priority !== 'foreground' &&
      this.activeSessionId !== null &&
      typeof job.sessionId === 'number' &&
      job.sessionId < this.activeSessionId
    );
  }

  private runNextTranslationJob(): void {
    if (this.translationRunning) {
      return;
    }
    let job: QueuedTranslationJob | undefined;
    for (const priority of TRANSLATION_PRIORITY_ORDER) {
      const candidate = this.translationQueues[priority].shift();
      if (candidate) {
        job = candidate;
        break;
      }
    }
    if (!job) {
      return;
    }
    this.translationRunning = true;
    void job.run().finally(() => {
      this.translationRunning = false;
      this.runNextTranslationJob();
    });
  }

  private readCache(cacheKey: string): CachedTranslationRow | null {
    const row = this.db
      .prepare(
        `SELECT source_title, source_summary, title_zh, abstract_zh, translated_at, engine
         FROM arxiv_translation_cache
         WHERE cache_key = ?`
      )
      .get(cacheKey) as CachedTranslationRow | undefined;
    if (!row) {
      return null;
    }
    const titleZh = repairAcademicTranslation(row.source_title, normalizeTranslatedText(row.title_zh), {
      mode: 'title'
    });
    const abstractZh = repairAcademicTranslation(row.source_summary, normalizeTranslatedText(row.abstract_zh), {
      mode: 'abstract'
    });
    if (!titleZh && !abstractZh) {
      this.db.prepare(`DELETE FROM arxiv_translation_cache WHERE cache_key = ?`).run(cacheKey);
      return null;
    }
    const hasBadTitle = Boolean(titleZh) && !isUsableTranslatedText(titleZh, row.source_title);
    const hasBadAbstract = Boolean(abstractZh) && !isUsableTranslatedText(abstractZh, row.source_summary);
    if (hasBadTitle || hasBadAbstract) {
      this.db.prepare(`DELETE FROM arxiv_translation_cache WHERE cache_key = ?`).run(cacheKey);
      return null;
    }
    return {
      ...row,
      title_zh: titleZh,
      abstract_zh: abstractZh
    };
  }

  private writeCache(
    cacheKey: string,
    value: {
      stableId: string;
      title: string;
      summary: string;
      titleZh: string;
      abstractZh: string;
      translatedAt: string;
      engine: string;
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO arxiv_translation_cache(
          cache_key,
          stable_id,
          source_title,
          source_summary,
          title_zh,
          abstract_zh,
          translated_at,
          engine
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          title_zh = excluded.title_zh,
          abstract_zh = excluded.abstract_zh,
          translated_at = excluded.translated_at,
          engine = excluded.engine`
      )
      .run(
        cacheKey,
        value.stableId,
        value.title,
        value.summary,
        value.titleZh,
        value.abstractZh,
        value.translatedAt,
        value.engine
      );
  }

  private async translateTextsWithFallback(texts: string[]): Promise<LocalTranslateBatchResult> {
    try {
      return await this.translateTextsWithEngine(texts);
    } catch (error) {
      if (!this.fallbackTranslateTextsWithEngine) {
        throw error;
      }
      return this.fallbackTranslateTextsWithEngine(texts);
    }
  }
}

function buildUniqueTranslationBatch(texts: string[]): { texts: string[]; indexes: number[] } {
  const indexes: number[] = [];
  const uniqueTexts: string[] = [];
  const seen = new Map<string, number>();
  texts.forEach((text) => {
    const key = normalizeTranslatedText(text);
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      indexes.push(existingIndex);
      return;
    }
    const nextIndex = uniqueTexts.length;
    seen.set(key, nextIndex);
    uniqueTexts.push(text);
    indexes.push(nextIndex);
  });
  return { texts: uniqueTexts, indexes };
}

function preparePretranslatedAcademicText(text: string): PreparedAcademicTranslation {
  return {
    segments: [],
    restore: (translatedSegments) =>
      translatedSegments.length === 0
        ? { ok: true, text }
        : { ok: false, text: '', reason: 'segment-count-mismatch' }
  };
}

function evaluatePreparedTranslations(
  preparedItems: PreparedTranslationBatchItem[],
  translatedTexts: string[]
): EvaluatedTranslationBatchItem[] {
  let cursor = 0;
  return preparedItems.map((item) => {
    const titleSegments = translatedTexts.slice(cursor, cursor + item.title.segments.length);
    cursor += item.title.segments.length;
    const abstractSegments = translatedTexts.slice(cursor, cursor + item.abstract.segments.length);
    cursor += item.abstract.segments.length;
    const title = item.title.restore(titleSegments);
    const abstract = item.abstract.restore(abstractSegments);
    const titleZh = title.ok
      ? repairAcademicTranslation(item.sourceTitle, normalizeTranslatedText(title.text), { mode: 'title' })
      : '';
    const abstractZh = abstract.ok
      ? repairAcademicTranslation(item.sourceAbstract, normalizeTranslatedText(abstract.text), { mode: 'abstract' })
      : '';
    const hasSevereAbstractLengthLoss =
      abstract.ok && hasSevereAcademicTranslationLengthLoss(item.sourceAbstract, abstractZh, 'abstract');

    return {
      title,
      abstract,
      titleZh,
      abstractZh,
      titleUsable: title.ok && isUsableTranslatedText(titleZh, item.sourceTitle),
      abstractUsable:
        abstract.ok &&
        !hasSevereAbstractLengthLoss &&
        isUsableTranslatedText(abstractZh, item.sourceAbstract),
      hasSevereAbstractLengthLoss
    };
  });
}

function buildTranslationCacheKey(input: { stableId: string; title: string; summary: string }): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        version: 6,
        target: 'zh',
        stableId: input.stableId,
        title: input.title,
        summary: input.summary
      })
    )
    .digest('hex');
}

function normalizeTranslatedText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isUsableTranslatedText(value: string, source = ''): boolean {
  return (
    Boolean(value.trim()) &&
    !isMojibakeTranslationText(value) &&
    !isDegenerateTranslationText(value) &&
    !isProbablyUntranslatedText(value, source)
  );
}

function countTranslationQualityProblems(
  items: EvaluatedTranslationBatchItem[],
  engine: string
): number {
  return items.reduce((count, item) => {
    const hasInvalidProtectedSpan = !item.title.ok || !item.abstract.ok;
    const hasUnusableOutput = !item.titleUsable && !item.abstractUsable;
    const hasRepeatedTail = engine.toLowerCase().includes('nllb') && hasSuspiciousRepeatedTranslationTail(item.abstract.text);
    return count + Number(hasInvalidProtectedSpan || item.hasSevereAbstractLengthLoss || hasUnusableOutput || hasRepeatedTail);
  }, 0);
}

function hasSuspiciousRepeatedTranslationTail(value: string): boolean {
  const normalized = normalizeTranslatedText(value);
  if (normalized.length < 36) {
    return false;
  }

  const cjkCount = normalized.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  if (cjkCount < 12) {
    return false;
  }

  const collapsed = collapseRepeatedTranslationTail(normalized);
  const removedLength = normalized.length - collapsed.length;
  return removedLength >= 8 && removedLength / normalized.length >= 0.12;
}

function isDegenerateTranslationText(value: string): boolean {
  const normalized = value.replace(/\s+/gu, '').trim();
  if (!normalized) {
    return true;
  }

  const cjkCount = normalized.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const latinCount = normalized.match(/[A-Za-z]/gu)?.length ?? 0;
  if (cjkCount > 0 && cjkCount < 4 && latinCount === 0) {
    return true;
  }

  for (let unitLength = 1; unitLength <= Math.min(8, Math.floor(normalized.length / 3)); unitLength += 1) {
    if (normalized.length % unitLength !== 0) {
      continue;
    }
    const unit = normalized.slice(0, unitLength);
    if (unit.repeat(normalized.length / unitLength) === normalized) {
      return true;
    }
  }

  return false;
}

function isProbablyUntranslatedText(value: string, source: string): boolean {
  const translated = normalizeComparableText(value);
  const original = normalizeComparableText(source);
  if (!translated || !original) {
    return false;
  }
  if (translated === original) {
    return true;
  }
  const cjkCount = value.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  if (cjkCount >= 4) {
    return false;
  }
  const translatedTokens = new Set(translated.split(/\s+/u).filter((token) => token.length >= 4));
  const originalTokens = original.split(/\s+/u).filter((token) => token.length >= 4);
  if (translatedTokens.size === 0 || originalTokens.length === 0) {
    return false;
  }
  const overlap = originalTokens.filter((token) => translatedTokens.has(token)).length / originalTokens.length;
  return overlap >= 0.75;
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function buildCompletedTranslationMessage(engine: LocalTranslateBatchResult['engine']): string {
  return engine === 'nllb-ct2-int8'
    ? '已使用本地 NLLB CTranslate2 int8 批量翻译并写入 SQLite 缓存。'
    : '已使用本地 Argos 批量翻译并写入 SQLite 缓存。';
}

function buildCachedTranslationResult(
  stableId: string,
  cached: CachedTranslationRow
): ArxivTitleAbstractTranslationResult {
  return {
    stableId,
    titleZh: cached.title_zh,
    abstractZh: cached.abstract_zh,
    engine: 'cache',
    status: 'cached',
    cacheHit: true,
    qualityStatus: 'passed',
    elapsedMs: 0,
    message: '已命中本地 SQLite 翻译缓存。',
    translatedAt: cached.translated_at
  };
}

function buildFailedTranslationResult(
  stableId: string,
  message: string,
  qualityStatus: ArxivTitleAbstractTranslationResult['qualityStatus'] = 'not-checked'
): ArxivTitleAbstractTranslationResult {
  return {
    stableId,
    titleZh: '',
    abstractZh: '',
    engine: 'unavailable',
    status: 'failed',
    cacheHit: false,
    qualityStatus,
    elapsedMs: 0,
    message
  };
}

function finalizeTranslationResults(
  results: ArxivTitleAbstractTranslationResult[],
  startedAt: number,
  finishedAt: number
): ArxivTitleAbstractTranslationResult[] {
  const elapsedMs = Math.max(0, Math.round(finishedAt - startedAt));
  return results.map((result) => ({ ...result, elapsedMs }));
}

function coerceTranslationInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function translateTextsWithArgosEngine(
  texts: string[],
  timeoutMs: number,
  options: LocalTranslateDirectionOptions = {}
): Promise<LocalTranslateBatchResult> {
  return {
    texts: await translateTextsWithArgos(texts, timeoutMs, options),
    engine: 'argos'
  };
}

async function translateTextsWithArgos(
  texts: string[],
  timeoutMs: number,
  options: LocalTranslateDirectionOptions = {}
): Promise<string[]> {
  if (texts.length === 0) {
    return [];
  }
  try {
    return await translateTextsWithArgosPython(texts, Math.max(timeoutMs, texts.length * 3_000), options);
  } catch (error) {
    if (texts.length > 1) {
      const payload = buildArgosCombinedPayload(texts);
      try {
        const combinedOutput = await translateWithArgosCli(
          payload.text,
          Math.max(timeoutMs, texts.length * 3_000),
          options
        );
        const splitOutput = splitArgosCombinedOutput(combinedOutput, payload.markers, texts.length);
        if (splitOutput) {
          return splitOutput;
        }
      } catch {
        // Fall through to per-text CLI calls below.
      }
    }
    const results: string[] = [];
    for (const text of texts) {
      results.push(await translateWithArgosCli(text, timeoutMs, options));
    }
    return results;
  }
}

function translateTextsWithArgosPython(
  texts: string[],
  timeoutMs: number,
  options: LocalTranslateDirectionOptions = {}
): Promise<string[]> {
  const runtime = getArgosPythonRuntime();
  return runtime.translate(texts, timeoutMs, options).catch(async (error) => {
    resetArgosPythonRuntime();
    try {
      return await translateTextsWithArgosPythonOnce(texts, timeoutMs, options);
    } catch {
      throw error;
    }
  });
}

function translateTextsWithArgosPythonOnce(
  texts: string[],
  timeoutMs: number,
  options: LocalTranslateDirectionOptions = {}
): Promise<string[]> {
  const script = [
    'import json, sys',
    'from argostranslate import translate',
    'payload = json.load(sys.stdin)',
    'texts = payload.get("texts", [])',
    'source_language = payload.get("sourceLanguage", "en")',
    'target_language = payload.get("targetLanguage", "zh")',
    'out = [translate.translate(item, source_language, target_language) if item else "" for item in texts]',
    'sys.stdout.write(json.dumps({"texts": out}, ensure_ascii=False))'
  ].join('\n');

  return new Promise((resolve, reject) => {
    const child = spawn(resolveArgosPythonCommand(), ['-c', script], {
      env: resolveArgosChildEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Argos 批量翻译超时：${Math.round(timeoutMs / 1000)} 秒`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = decodeArgosCliOutput(Buffer.concat(stdoutChunks));
      if (code === 0 && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout) as { texts?: unknown };
          if (Array.isArray(parsed.texts) && parsed.texts.every((item) => typeof item === 'string')) {
            const restored = parsed.texts.map((item) => normalizeTranslatedText(item));
            if (restored.length === texts.length && restored.every(Boolean)) {
              resolve(restored);
              return;
            }
          }
        } catch {
          // Fall through to a readable error below.
        }
      }
      const stderr = decodeArgosCliOutput(Buffer.concat(stderrChunks));
      reject(new Error(`Argos 批量翻译失败：${stderr.trim() || stdout.trim() || `exit ${code}`}`));
    });
    child.stdin.end(JSON.stringify({
      texts,
      sourceLanguage: options.sourceLanguage ?? 'en',
      targetLanguage: options.targetLanguage ?? 'zh'
    }));
  });
}

function getArgosPythonRuntime(): ArgosPythonRuntime {
  if (!argosPythonRuntime || argosPythonRuntime.isClosed()) {
    argosPythonRuntime = new ArgosPythonRuntime();
  }
  return argosPythonRuntime;
}

function resetArgosPythonRuntime(): void {
  if (argosPythonRuntime) {
    argosPythonRuntime.close();
    argosPythonRuntime = null;
  }
}

async function warmUpArgosTranslator(timeoutMs: number): Promise<void> {
  try {
    await translateTextsWithArgosPython(['warm up'], timeoutMs);
  } catch {
    resetArgosPythonRuntime();
  }
}

class ArgosPythonRuntime {
  private readonly child = spawn(resolveArgosPythonCommand(), ['-u', '-c', buildArgosWorkerScript()], {
    env: resolveArgosChildEnv(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  private readonly pending = new Map<
    string,
    {
      resolve: (value: string[]) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private nextId = 1;
  private closed = false;

  constructor() {
    this.child.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuffer += decodeArgosCliOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.drainStdout();
    });
    this.child.stderr.on('data', (chunk: Buffer | string) => {
      this.stderrBuffer += decodeArgosCliOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    this.child.on('error', (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.child.on('close', (code) => {
      this.closed = true;
      this.failAll(new Error(`Argos worker 已退出：${this.stderrBuffer.trim() || `exit ${code}`}`));
    });
  }

  isClosed(): boolean {
    return this.closed || this.child.killed;
  }

  translate(
    texts: string[],
    timeoutMs: number,
    options: LocalTranslateDirectionOptions = {}
  ): Promise<string[]> {
    if (this.isClosed()) {
      return Promise.reject(new Error('Argos worker 不可用。'));
    }
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Argos 批量翻译超时：${Math.round(timeoutMs / 1000)} 秒`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        `${JSON.stringify({
          id,
          texts,
          sourceLanguage: options.sourceLanguage ?? 'en',
          targetLanguage: options.targetLanguage ?? 'zh'
        })}\n`,
        'utf8',
        (error) => {
          if (!error) {
            return;
          }
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      );
    });
  }

  close(): void {
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private drainStdout(): void {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    let message: { id?: unknown; texts?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as { id?: unknown; texts?: unknown; error?: unknown };
    } catch {
      return;
    }
    const id = typeof message.id === 'string' ? message.id : '';
    const entry = this.pending.get(id);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (typeof message.error === 'string' && message.error) {
      entry.reject(new Error(message.error));
      return;
    }
    if (!Array.isArray(message.texts) || !message.texts.every((item) => typeof item === 'string')) {
      entry.reject(new Error('Argos worker 返回格式无效。'));
      return;
    }
    entry.resolve(message.texts.map((item) => normalizeTranslatedText(item)));
  }

  private failAll(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

function buildArgosWorkerScript(): string {
  return [
    'import json, sys, traceback',
    'from argostranslate import translate',
    'for line in sys.stdin:',
    '    if not line.strip():',
    '        continue',
    '    req_id = None',
    '    try:',
    '        payload = json.loads(line)',
    '        req_id = payload.get("id")',
    '        texts = payload.get("texts", [])',
    '        source_language = payload.get("sourceLanguage", "en")',
    '        target_language = payload.get("targetLanguage", "zh")',
    '        out = [translate.translate(item, source_language, target_language) if item else "" for item in texts]',
    '        sys.stdout.write(json.dumps({"id": req_id, "texts": out}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()',
    '    except Exception as exc:',
    '        sys.stdout.write(json.dumps({"id": req_id, "error": str(exc)}, ensure_ascii=False) + "\\n")',
    '        sys.stdout.flush()'
  ].join('\n');
}

export function buildArgosCombinedPayload(texts: string[]): { text: string; markers: string[] } {
  const markers = texts.slice(1).map((_, index) => {
    const digest = crypto.createHash('sha1').update(`ftranslate-segment-${index}`).digest('hex').slice(0, 16);
    return String((BigInt(`0x${digest}`) % 9_000_000_000n) + 1_000_000_000n);
  });
  let text = texts[0] ?? '';
  markers.forEach((marker, index) => {
    text += `\n\n${marker}\n\n${texts[index + 1] ?? ''}`;
  });
  return { text, markers };
}

export function splitArgosCombinedOutput(
  output: string,
  markers: string[],
  expectedCount: number
): string[] | null {
  if (expectedCount === 0) {
    return [];
  }
  const segments: string[] = [];
  let cursor = 0;
  for (const marker of markers) {
    const markerIndex = output.indexOf(marker, cursor);
    if (markerIndex < 0) {
      return null;
    }
    segments.push(output.slice(cursor, markerIndex).trim());
    cursor = markerIndex + marker.length;
    const boundarySuffix = output
      .slice(cursor)
      .match(/^\s*(?:[（(][^\r\n]{0,64}[)）]\s*[。.．]?)?\s*/u)?.[0];
    cursor += boundarySuffix?.length ?? 0;
  }
  segments.push(output.slice(cursor).trim());
  return segments.length === expectedCount && segments.every(Boolean) ? segments : null;
}

function translateWithArgosCli(
  text: string,
  timeoutMs: number,
  options: LocalTranslateDirectionOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveArgosCliCommand(), [
      '--from-lang',
      options.sourceLanguage ?? 'en',
      '--to-lang',
      options.targetLanguage ?? 'zh'
    ], {
      env: resolveArgosChildEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Argos 本地翻译超时：${Math.round(timeoutMs / 1000)} 秒`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = decodeArgosCliOutput(Buffer.concat(stdoutChunks));
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      const stderr = decodeArgosCliOutput(Buffer.concat(stderrChunks));
      reject(new Error(`Argos 本地翻译失败：${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.end(text);
  });
}

export function resolveArgosCliCommand(): string {
  return process.env.FTRANSLATE_ARGOS_CLI?.trim() || 'argos-translate';
}

export function resolveArgosPythonCommand(): string {
  const configured = process.env.FTRANSLATE_ARGOS_PYTHON?.trim();
  if (configured) {
    return configured;
  }
  const cliCommand = process.env.FTRANSLATE_ARGOS_CLI?.trim();
  if (cliCommand && /[\\/]Scripts[\\/]argos-translate(?:\.exe)?$/iu.test(cliCommand)) {
    return path.join(path.dirname(cliCommand), '..', 'python.exe');
  }
  return 'python';
}

export function resolveArgosChildEnv(): NodeJS.ProcessEnv {
  const packagesDir = process.env.FTRANSLATE_ARGOS_PACKAGES_DIR?.trim();
  return {
    ...process.env,
    ...(packagesDir
      ? {
          ARGOS_PACKAGES_DIR: packagesDir,
          ARGOS_TRANSLATE_PACKAGE_DIR: packagesDir
        }
      : {}),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  };
}

export function decodeArgosCliOutput(buffer: Buffer): string {
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const gb18030Text = new TextDecoder('gb18030').decode(buffer);
    return scoreDecodedArgosText(gb18030Text) < scoreDecodedArgosText(utf8Text)
      ? gb18030Text
      : utf8Text;
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

function scoreDecodedArgosText(text: string): number {
  const replacementCount = text.match(/\uFFFD/gu)?.length ?? 0;
  const privateUseCount = text.match(/[\uE000-\uF8FF]/gu)?.length ?? 0;
  const cyrillicCount = text.match(/[\u0400-\u04FF]/gu)?.length ?? 0;
  const mojibakePenalty = isMojibakeTranslationText(text) ? 20 : 0;
  return replacementCount * 10 + privateUseCount * 8 + cyrillicCount * 3 + mojibakePenalty;
}

function formatTranslationError(error: unknown): string {
  if (isArgosUnavailableError(error)) {
    return [
      '离线翻译未配置：当前没有可用的 Argos Translate CLI 或 en→zh 模型，已保留英文标题和摘要。',
      '查看 README 的“arXiv 离线翻译配置”安装说明后，回到本页点击“稍后重试”。',
      'arXiv 检索页不会自动调用 AI 翻译。'
    ].join(' ');
  }
  const message = error instanceof Error ? error.message : String(error);
  return `本地 arXiv 标题/摘要翻译失败：${message}`;
}

function isArgosUnavailableError(error: unknown): boolean {
  if (isMissingArgosError(error)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /translation package|no package|not installed|from[-_ ]?lang|to[-_ ]?lang|language pair/iu.test(message);
}

function isMissingArgosError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
