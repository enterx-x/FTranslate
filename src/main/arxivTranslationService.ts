import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TextDecoder } from 'node:util';
import type {
  ArxivTitleAbstractTranslationRequest,
  ArxivTitleAbstractTranslationResult,
  ArxivTranslationPriority,
  ArxivTranslationProgress,
  ArxivTranslationSelectionMetadata
} from '../shared/arxiv';
import { isMojibakeTranslationText } from '../shared/arxiv';
export type { ArxivTranslationPriority } from '../shared/arxiv';
import {
  collapseRepeatedTranslationTail,
  hasSevereAcademicTranslationLengthLoss,
  prepareAcademicTranslation,
  repairAcademicTranslation,
  splitAcademicTranslationSourceContext,
  type PreparedAcademicTranslation,
  type PreparedAcademicTranslationRestoreResult
} from '../shared/academicTranslationQuality';
import {
  ACADEMIC_TRANSLATION_GLOSSARY_VERSION,
  collectAcademicGlossaryMatches
} from '../shared/academicTranslationGlossary';
import {
  type LocalTranslateBatchResult,
  type LocalTranslateDirectionOptions,
  type LocalTranslationItemContext,
  type LocalTranslationPreference,
  type LocalTranslationRuntimeEngine,
  resetNllbRuntime,
  resolveLocalTranslationPreference,
  translateTextsWithNllbCTranslate2,
  warmUpNllbTranslator
} from './localTranslationService';
import {
  hasConfiguredHyMt2,
  resetHyMt2Runtime,
  resolveHyMt2ModelCacheIdentity,
  translateTextsWithHyMt2,
  warmUpHyMt2Translator
} from './hyMtTranslationService';
import {
  buildCometPairRequests,
  selectCometMbrBundle,
  type CometPairRequest,
  type CometPairScore,
  type CometMbrSelectionResult,
  type TranslationCandidateBundle
} from './cometMbrSelection';
import {
  COMET_MBR_MODEL_ID,
  COMET_MBR_MODEL_REVISION,
  CometMbrRuntime,
  type CometMbrRuntimeSnapshot
} from './cometMbrRuntime';

type TranslationBatchOptions = Pick<LocalTranslateDirectionOptions, 'itemContexts' | 'generation'>;
type TranslationBatchTranslator = (
  texts: string[],
  options?: TranslationBatchOptions
) => Promise<LocalTranslateBatchResult>;
type CandidateTranslationBatchTranslator = (
  texts: string[],
  seed: number,
  options?: TranslationBatchOptions
) => Promise<LocalTranslateBatchResult>;
type CometEvaluator = (pairs: CometPairRequest[]) => Promise<number[]>;

interface ArxivTranslationServiceOptions {
  dbPath: string;
  translateText?: (text: string) => Promise<string>;
  translateTexts?: (texts: string[]) => Promise<string[]>;
  translateTextsWithEngine?: TranslationBatchTranslator;
  candidateTranslateTextsWithEngine?: CandidateTranslationBatchTranslator;
  cometEvaluator?: CometEvaluator;
  resetCandidateRuntime?: () => void;
  unloadCometEvaluator?: () => Promise<void>;
  onProgress?: (progress: ArxivTranslationProgress) => void;
  protectGlossaryTerms?: boolean;
  fallbackTranslateTextsWithEngine?: TranslationBatchTranslator;
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
  selection_json: string | null;
}

const DEFAULT_TRANSLATION_TIMEOUT_MS = 90_000;
const ARXIV_TITLE_CONTEXT_LIMIT = 700;
const ARXIV_ABSTRACT_CONTEXT_LIMIT = 900;
const ARXIV_CONTEXT_PROMPT_VERSION = 'paper-context-v1';
const ARXIV_MBR_SELECTION_VERSION = 'mbr-v1';
const ARXIV_MBR_HARD_GATE_VERSION = 'academic-hard-gates-v1';
const ARXIV_MBR_SEEDS = [42, 3407, 7919] as const;
const ARXIV_MBR_EVALUATOR = COMET_MBR_MODEL_ID;
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
  sourceAbstractSegments: string[];
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

interface MbrTranslationOutcome {
  selection: CometMbrSelectionResult;
  metadata: ArxivTranslationSelectionMetadata;
  engine?: LocalTranslateBatchResult['engine'];
}

interface SingleCandidateTranslationOutcome {
  evaluated?: EvaluatedTranslationBatchItem;
  engine?: LocalTranslateBatchResult['engine'];
  error?: unknown;
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

export function resolveArxivTranslationEngineOrder(
  preference: LocalTranslationPreference
): LocalTranslationRuntimeEngine[] {
  switch (preference) {
    case 'hy-mt-first':
      return ['hy-mt2', 'nllb-ct2', 'argos'];
    case 'hy-mt-only':
      return ['hy-mt2'];
    case 'argos-first':
      return ['argos', 'nllb-ct2'];
    case 'nllb-only':
      return ['nllb-ct2'];
    case 'argos-only':
      return ['argos'];
    case 'nllb-first':
    default:
      return ['nllb-ct2', 'argos'];
  }
}

const FALLBACK_GLOSSARY_MARKER_PATTERN = /\b97531\d{3}809\b/gu;

export async function translateTextsWithProtectedAcademicGlossary(
  texts: string[],
  translator: TranslationBatchTranslator,
  options?: TranslationBatchOptions
): Promise<LocalTranslateBatchResult> {
  const prepared = texts.map(prepareFallbackGlossaryText);
  const result = await translator(prepared.map((item) => item.text), options);
  if (result.texts.length !== prepared.length) {
    throw new Error('后备翻译引擎返回的文本数量与请求不一致。');
  }
  return {
    ...result,
    texts: result.texts.map((text, index) => prepared[index]?.restore(text) ?? text)
  };
}

function prepareFallbackGlossaryText(source: string): {
  text: string;
  restore: (translated: string) => string;
} {
  const matches = collectAcademicGlossaryMatches(source).slice(0, 999);
  if (matches.length === 0) {
    return { text: source, restore: (translated) => translated };
  }

  const spans = matches.map((match, index) => ({
    ...match,
    marker: `97531${String(index).padStart(3, '0')}809`
  }));
  let cursor = 0;
  let protectedText = '';
  spans.forEach((span) => {
    protectedText += `${source.slice(cursor, span.start)}${span.marker}`;
    cursor = span.end;
  });
  protectedText += source.slice(cursor);

  return {
    text: protectedText,
    restore: (translated) => {
      const actualMarkers = translated.match(FALLBACK_GLOSSARY_MARKER_PATTERN) ?? [];
      const expectedMarkers = spans.map((span) => span.marker);
      if (
        actualMarkers.length !== expectedMarkers.length ||
        expectedMarkers.some((marker) => actualMarkers.filter((item) => item === marker).length !== 1)
      ) {
        throw new Error('后备翻译引擎损坏了学术术语占位符。');
      }
      return spans.reduce(
        (restored, span) => restored.replace(span.marker, () => span.target),
        translated
      );
    }
  };
}

export class ArxivTranslationService {
  private readonly db: DatabaseSync;
  private readonly translateTextsWithEngine: TranslationBatchTranslator;
  private readonly fallbackTranslateTextsWithEngine?: TranslationBatchTranslator;
  private readonly candidateTranslateTextsWithEngine?: CandidateTranslationBatchTranslator;
  private readonly cometEvaluator?: CometEvaluator;
  private readonly resetCandidateRuntime: () => void;
  private readonly unloadCometEvaluator: () => Promise<void>;
  private readonly cometRuntime?: CometMbrRuntime;
  private readonly onProgress?: (progress: ArxivTranslationProgress) => void;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly protectGlossaryTerms: boolean;
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
      options.translateText ||
      options.translateTexts ||
      options.translateTextsWithEngine ||
      options.candidateTranslateTextsWithEngine
    );
    const defaultEngineOrder = usesInjectedTranslator
      ? []
      : resolveArxivTranslationEngineOrder(resolveLocalTranslationPreference());
    this.protectGlossaryTerms = options.protectGlossaryTerms ?? !(
      !usesInjectedTranslator &&
      defaultEngineOrder[0] === 'hy-mt2' &&
      hasConfiguredHyMt2()
    );
    const createTranslator = (
      engine: LocalTranslationRuntimeEngine
    ): TranslationBatchTranslator => {
      const translator: TranslationBatchTranslator = engine === 'hy-mt2'
        ? ((texts, batchOptions) => translateTextsWithHyMt2(texts, this.timeoutMs, {
            itemContexts: batchOptions?.itemContexts,
            generation: batchOptions?.generation
          }))
        : engine === 'nllb-ct2'
        ? ((texts) => translateTextsWithNllbCTranslate2(texts, this.timeoutMs))
        : ((texts) => translateTextsWithArgosEngine(texts, this.timeoutMs));
      return engine !== 'hy-mt2' && !this.protectGlossaryTerms
        ? ((texts, batchOptions) =>
            translateTextsWithProtectedAcademicGlossary(texts, translator, batchOptions))
        : translator;
    };
    const createTranslatorChain = (
      engines: LocalTranslationRuntimeEngine[],
      startIndex: number,
      onResolved?: (index: number) => void
    ): TranslationBatchTranslator => async (texts, batchOptions) => {
      let lastError: unknown = new Error('没有可用的本地翻译引擎。');
      for (let index = 0; index < engines.length; index += 1) {
        try {
          const result = await createTranslator(engines[index] as LocalTranslationRuntimeEngine)(
            texts,
            batchOptions
          );
          onResolved?.(startIndex + index);
          return result;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    };
    if (options.translateTextsWithEngine) {
      this.translateTextsWithEngine = options.translateTextsWithEngine;
      this.fallbackTranslateTextsWithEngine =
        options.fallbackTranslateTextsWithEngine ?? createTranslator('argos');
    } else if (options.translateTexts) {
      this.translateTextsWithEngine = async (texts) => ({
        texts: (await options.translateTexts?.(texts)) ?? [],
        engine: 'argos'
      });
      this.fallbackTranslateTextsWithEngine = options.fallbackTranslateTextsWithEngine;
    } else if (options.translateText) {
      this.translateTextsWithEngine = async (texts) => ({
        texts: await Promise.all(texts.map((text) => options.translateText?.(text) ?? '')),
        engine: 'argos'
      });
      this.fallbackTranslateTextsWithEngine = options.fallbackTranslateTextsWithEngine;
    } else {
      let resolvedPrimaryIndex = 0;
      this.translateTextsWithEngine = createTranslatorChain(
        defaultEngineOrder.length > 0 ? defaultEngineOrder : ['nllb-ct2'],
        0,
        (index) => {
          resolvedPrimaryIndex = index;
        }
      );
      this.fallbackTranslateTextsWithEngine = options.fallbackTranslateTextsWithEngine ?? (async (texts) => {
        const fallbackEngines = defaultEngineOrder.slice(resolvedPrimaryIndex + 1);
        if (fallbackEngines.length === 0) {
          throw new Error('没有可用的后备本地翻译引擎。');
        }
        return createTranslatorChain(fallbackEngines, resolvedPrimaryIndex + 1)(texts);
      });
    }
    let candidateTranslator = options.candidateTranslateTextsWithEngine;
    let cometEvaluator = options.cometEvaluator;
    let unloadCometEvaluator = options.unloadCometEvaluator;
    let cometRuntime: CometMbrRuntime | undefined;
    const canOwnHyMt2Process = !process.env.FTRANSLATE_HYMT_BASE_URL?.trim();
    if (
      !usesInjectedTranslator &&
      defaultEngineOrder[0] === 'hy-mt2' &&
      hasConfiguredHyMt2() &&
      canOwnHyMt2Process
    ) {
      const runtime = new CometMbrRuntime();
      if (runtime.snapshot().configured) {
        cometRuntime = runtime;
        candidateTranslator = (texts, seed, batchOptions) =>
          translateTextsWithHyMt2(texts, this.timeoutMs, {
            itemContexts: batchOptions?.itemContexts,
            generation: { seed, strict: true }
          });
        cometEvaluator = (pairs) => runtime.score(pairs);
        unloadCometEvaluator = () => runtime.unload();
      }
    }
    this.candidateTranslateTextsWithEngine = candidateTranslator;
    this.cometEvaluator = cometEvaluator;
    this.resetCandidateRuntime = options.resetCandidateRuntime ?? resetHyMt2Runtime;
    this.unloadCometEvaluator = unloadCometEvaluator ?? (async () => undefined);
    this.cometRuntime = cometRuntime;
    this.onProgress = options.onProgress;
    this.now = options.now ?? Date.now;
    this.initDatabase();
    if (!usesInjectedTranslator) {
      if (defaultEngineOrder[0] === 'hy-mt2') {
        void warmUpHyMt2Translator(Math.min(this.timeoutMs, 60_000));
      } else if (defaultEngineOrder[0] === 'argos') {
        void warmUpArgosTranslator(Math.min(this.timeoutMs, 30_000));
      } else {
        void warmUpNllbTranslator(Math.min(this.timeoutMs, 45_000));
      }
    }
  }

  close(): void {
    this.db.close();
    if (argosPythonRuntime) {
      argosPythonRuntime.close();
      argosPythonRuntime = null;
    }
    resetNllbRuntime();
    resetHyMt2Runtime();
    this.cometRuntime?.close();
  }

  getCometMbrRuntimeSnapshot(): CometMbrRuntimeSnapshot {
    return (this.cometRuntime ?? new CometMbrRuntime()).snapshot();
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
        results[index] = buildCachedTranslationResult(
          stableId,
          this.upgradeCachedTitle(cacheKey, cached, {
            stableId,
            title,
            summary,
            pretranslatedTitleZh
          })
        );
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
          results[item.index] = buildCachedTranslationResult(
            item.stableId,
            this.upgradeCachedTitle(item.cacheKey, rechecked, item)
          );
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
          sourceAbstractSegments: splitAcademicTranslationSourceContext(item.summary),
          title: !(this.candidateTranslateTextsWithEngine && this.cometEvaluator) &&
            isUsableTranslatedText(item.pretranslatedTitleZh, item.title)
            ? preparePretranslatedAcademicText(item.pretranslatedTitleZh)
            : prepareAcademicTranslation(item.title, undefined, {
                protectGlossary: this.protectGlossaryTerms
              }),
          abstract: prepareAcademicTranslation(item.summary, undefined, {
            protectGlossary: this.protectGlossaryTerms
          })
        }));
        const translationRequests = preparedItems.flatMap(buildPaperTranslationRequests);
        const uniqueBatch = buildUniqueTranslationBatch(translationRequests);
        const batchOptions = { itemContexts: uniqueBatch.itemContexts };
        const translatedAt = new Date(this.now()).toISOString();

        if (this.candidateTranslateTextsWithEngine && this.cometEvaluator) {
          const outcomes = await this.translatePreparedItemsWithMbr(
            preparedItems,
            uniqueBatch,
            batchOptions,
            remaining.map((item) => item.stableId),
            normalizeTranslationPriority(options?.priority),
            options?.sessionId
          );
          await this.applyFallbackToNoEligibleOutcomes(preparedItems, outcomes);
          remaining.forEach((item, itemIndex) => {
            const outcome = outcomes[itemIndex];
            const selected = outcome?.selection.bundle;
            if (!selected || !outcome.engine) {
              results[item.index] = {
                ...buildFailedTranslationResult(
                  item.stableId,
                  outcome?.selection.degradationReason ??
                    '三份本地候选均未通过学术结构与完整性检查，已丢弃且未写入缓存。',
                  'failed'
                ),
                ...(outcome?.metadata ?? buildNoEligibleSelectionMetadata(ARXIV_MBR_SEEDS.length))
              };
              return;
            }

            this.writeCache(item.cacheKey, {
              stableId: item.stableId,
              title: item.title,
              summary: item.summary,
              titleZh: selected.titleZh,
              abstractZh: selected.abstractZh,
              translatedAt,
              engine: outcome.engine,
              selection: outcome.metadata
            });
            results[item.index] = {
              stableId: item.stableId,
              titleZh: selected.titleZh,
              abstractZh: selected.abstractZh,
              engine: outcome.engine,
              status: 'completed',
              cacheHit: false,
              qualityStatus: 'passed',
              elapsedMs: 0,
              message: buildMbrCompletedTranslationMessage(outcome.metadata),
              translatedAt,
              ...outcome.metadata
            };
          });
        } else {
          const singleOutcomes = await this.translatePreparedItemsWithoutMbr(
            preparedItems,
            uniqueBatch,
            batchOptions
          );

          remaining.forEach((item, itemIndex) => {
            const outcome = singleOutcomes[itemIndex];
            if (!outcome || outcome.error || !outcome.evaluated || !outcome.engine) {
              const error = outcome?.error ?? new Error('本地翻译未返回当前论文的结果。');
              const isUnavailable = isArgosUnavailableError(error);
              results[item.index] = {
                stableId: item.stableId,
                titleZh: '',
                abstractZh: '',
                engine: 'unavailable',
                status: isUnavailable ? 'unavailable' : 'failed',
                cacheHit: false,
                qualityStatus: 'not-checked',
                elapsedMs: 0,
                message: formatTranslationError(error),
                ...buildNoEligibleSelectionMetadata(0)
              };
              return;
            }
            const evaluated = outcome.evaluated;
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
            if (!abstractZh) {
              results[item.index] = {
                ...buildFailedTranslationResult(
                  item.stableId,
                  '本地翻译未生成可用的中文摘要，已保留快速标题但未写入缓存，可重新翻译。',
                  'failed'
                ),
                titleZh
              };
              return;
            }

            const selection = buildSingleCandidateSelectionMetadata();
            this.writeCache(item.cacheKey, {
              stableId: item.stableId,
              title: item.title,
              summary: item.summary,
              titleZh,
              abstractZh,
              translatedAt,
              engine: outcome.engine,
              selection
            });
            results[item.index] = {
              stableId: item.stableId,
              titleZh,
              abstractZh,
              engine: outcome.engine,
              status: 'completed',
              cacheHit: false,
              qualityStatus: 'passed',
              elapsedMs: 0,
              message: buildCompletedTranslationMessage(outcome.engine),
              translatedAt,
              ...selection
            };
          });
        }
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
            message,
            ...buildNoEligibleSelectionMetadata(0)
          };
        });
      }
      return results;
    }, options?.priority, options?.sessionId, buildSupersededResults);
    return finalizeTranslationResults(queuedResults, startedAt, this.now());
  }

  private async translatePreparedItemsWithMbr(
    preparedItems: PreparedTranslationBatchItem[],
    uniqueBatch: ReturnType<typeof buildUniqueTranslationBatch>,
    batchOptions: TranslationBatchOptions,
    stableIds: string[],
    priority: ArxivTranslationPriority,
    sessionId?: number
  ): Promise<MbrTranslationOutcome[]> {
    const candidateTranslator = this.candidateTranslateTextsWithEngine as CandidateTranslationBatchTranslator;
    const evaluator = this.cometEvaluator as CometEvaluator;
    const bundlesByItem = preparedItems.map(() => [] as TranslationCandidateBundle[]);
    const engineBySeed = new Map<number, LocalTranslateBatchResult['engine']>();

    for (const seed of ARXIV_MBR_SEEDS) {
      this.emitTranslationProgress(stableIds, priority, sessionId, 'candidate-generating', {
        candidateIndex: ARXIV_MBR_SEEDS.indexOf(seed) + 1,
        candidateTotal: ARXIV_MBR_SEEDS.length
      });
      try {
        const generated = await candidateTranslator(uniqueBatch.texts, seed, {
          ...batchOptions,
          generation: { seed, strict: true }
        });
        if (generated.texts.length !== uniqueBatch.texts.length) {
          throw new Error(
            `候选 ${seed} 返回 ${generated.texts.length} 段，预期 ${uniqueBatch.texts.length} 段。`
          );
        }
        engineBySeed.set(seed, generated.engine);
        const translatedTexts = uniqueBatch.indexes.map((index) => generated.texts[index] ?? '');
        const evaluated = evaluatePreparedTranslations(preparedItems, translatedTexts);
        preparedItems.forEach((prepared, itemIndex) => {
          bundlesByItem[itemIndex]?.push(
            buildTranslationCandidateBundle(seed, prepared, evaluated[itemIndex])
          );
        });
      } catch (error) {
        for (let itemIndex = 0; itemIndex < preparedItems.length; itemIndex += 1) {
          const prepared = preparedItems[itemIndex] as PreparedTranslationBatchItem;
          const itemRequests = buildPaperTranslationRequests(prepared);
          const itemBatch = buildUniqueTranslationBatch(itemRequests);
          try {
            const generated = await candidateTranslator(itemBatch.texts, seed, {
              ...batchOptions,
              itemContexts: itemBatch.itemContexts,
              generation: { seed, strict: true }
            });
            if (generated.texts.length !== itemBatch.texts.length) {
              throw new Error('candidate-segment-count-mismatch');
            }
            engineBySeed.set(seed, generated.engine);
            const translatedTexts = itemBatch.indexes.map((index) => generated.texts[index] ?? '');
            const [evaluated] = evaluatePreparedTranslations([prepared], translatedTexts);
            bundlesByItem[itemIndex]?.push(
              buildTranslationCandidateBundle(seed, prepared, evaluated)
            );
          } catch {
            bundlesByItem[itemIndex]?.push(
              buildUnavailableCandidateBundle(seed, 'candidate-generation-failed')
            );
          }
        }
      }
    }

    this.emitTranslationProgress(stableIds, priority, sessionId, 'candidate-validating', {
      candidateTotal: ARXIV_MBR_SEEDS.length
    });

    let evaluatorFailed = false;
    try {
      this.resetCandidateRuntime();
    } catch {
      evaluatorFailed = true;
    }

    const pairRequestsByItem = bundlesByItem.map((bundles) => buildCometPairRequests(bundles));
    const allPairRequests = pairRequestsByItem.flat();
    let allScores: number[] = [];
    if (allPairRequests.length > 0 && !evaluatorFailed) {
      this.emitTranslationProgress(stableIds, priority, sessionId, 'quality-evaluating', {
        candidateTotal: ARXIV_MBR_SEEDS.length
      });
      try {
        allScores = await evaluator(allPairRequests);
        if (
          allScores.length !== allPairRequests.length ||
          allScores.some((score) => !Number.isFinite(score))
        ) {
          throw new Error(
            `COMET 返回 ${allScores.length} 个分数，预期 ${allPairRequests.length} 个有限分数。`
          );
        }
      } catch {
        evaluatorFailed = true;
        allScores = [];
      } finally {
        try {
          await this.unloadCometEvaluator();
        } catch {
          // Scoring already finished. Runtime cleanup is retried when the service closes.
        }
      }
    }

    let scoreCursor = 0;
    return bundlesByItem.map((bundles, itemIndex) => {
      const pairRequests = pairRequestsByItem[itemIndex] ?? [];
      const pairScores: CometPairScore[] = evaluatorFailed
        ? []
        : pairRequests.map((pair, pairIndex) => ({
            ...pair,
            score: allScores[scoreCursor + pairIndex] as number
          }));
      scoreCursor += pairRequests.length;
      let selection = selectCometMbrBundle(bundles, pairScores, {
        evaluatorFailed: evaluatorFailed && pairRequests.length > 0
      });
      if (selection.mode === 'no-eligible-candidate') {
        const failureTypes = summarizeCandidateFailureTypes(bundles);
        if (failureTypes) {
          selection = {
            ...selection,
            degradationReason: `${selection.degradationReason ?? '候选未通过硬门禁'} 失败类型：${failureTypes}。`
          };
        }
      }
      const selectedSeed = selection.bundle?.seed;
      const metadata: ArxivTranslationSelectionMetadata = {
        selectionMode: selection.mode,
        candidateCount: ARXIV_MBR_SEEDS.length,
        eligibleCandidateCount: selection.eligibleCandidateCount,
        ...(selectedSeed !== undefined ? { selectedSeed } : {}),
        ...(selection.mode === 'comet-mbr' || selection.mode === 'two-candidate'
          ? { evaluator: ARXIV_MBR_EVALUATOR }
          : {}),
        ...(selection.degradationReason ? { degradationReason: selection.degradationReason } : {})
      };
      if (selection.degradationReason) {
        this.emitTranslationProgress(
          [stableIds[itemIndex] ?? ''],
          priority,
          sessionId,
          'degraded',
          { detail: selection.degradationReason, candidateTotal: ARXIV_MBR_SEEDS.length }
        );
      }
      return {
        selection,
        metadata,
        ...(selectedSeed !== undefined && engineBySeed.has(selectedSeed)
          ? { engine: engineBySeed.get(selectedSeed) as LocalTranslateBatchResult['engine'] }
          : {})
      };
    });
  }

  private async translatePreparedItemsWithoutMbr(
    preparedItems: PreparedTranslationBatchItem[],
    uniqueBatch: ReturnType<typeof buildUniqueTranslationBatch>,
    batchOptions: TranslationBatchOptions
  ): Promise<SingleCandidateTranslationOutcome[]> {
    const evaluateBatch = async (
      items: PreparedTranslationBatchItem[],
      batch: ReturnType<typeof buildUniqueTranslationBatch>,
      options: TranslationBatchOptions,
      initialResult: LocalTranslateBatchResult
    ): Promise<SingleCandidateTranslationOutcome[]> => {
      if (initialResult.texts.length !== batch.texts.length) {
        throw new Error(
          `本地翻译返回 ${initialResult.texts.length} 段，预期 ${batch.texts.length} 段。`
        );
      }
      let translationResult = initialResult;
      let translatedTexts = batch.indexes.map((index) => translationResult.texts[index] ?? '');
      let evaluatedTranslations = evaluatePreparedTranslations(items, translatedTexts);
      const primaryQualityProblems = countTranslationQualityProblems(
        evaluatedTranslations,
        translationResult.engine
      );
      const shouldTryFallback = evaluatedTranslations.some(
        (item) => item.hasSevereAbstractLengthLoss || hasSuspiciousRepeatedTranslationTail(item.abstract.text)
      );
      if (shouldTryFallback && primaryQualityProblems > 0 && this.fallbackTranslateTextsWithEngine) {
        try {
          const fallbackResult = await this.fallbackTranslateTextsWithEngine(batch.texts, options);
          if (fallbackResult.texts.length === batch.texts.length) {
            const fallbackTranslatedTexts = batch.indexes.map(
              (index) => fallbackResult.texts[index] ?? ''
            );
            const fallbackEvaluatedTranslations = evaluatePreparedTranslations(
              items,
              fallbackTranslatedTexts
            );
            const fallbackQualityProblems = countTranslationQualityProblems(
              fallbackEvaluatedTranslations,
              fallbackResult.engine
            );
            if (fallbackQualityProblems < primaryQualityProblems) {
              translationResult = fallbackResult;
              translatedTexts = fallbackTranslatedTexts;
              evaluatedTranslations = fallbackEvaluatedTranslations;
            }
          }
        } catch {
          // Keep the primary result; the hard gate below still rejects damaged output.
        }
      }
      return evaluatedTranslations.map((evaluated) => ({
        evaluated,
        engine: translationResult.engine
      }));
    };

    try {
      // Prefer one fast batch. If any segment aborts that request, retry each
      // paper independently so one malformed document cannot fail its peers.
      const primaryResult = await this.translateTextsWithEngine(uniqueBatch.texts, batchOptions);
      return await evaluateBatch(preparedItems, uniqueBatch, batchOptions, primaryResult);
    } catch {
      const outcomes: SingleCandidateTranslationOutcome[] = [];
      for (const prepared of preparedItems) {
        const requests = buildPaperTranslationRequests(prepared);
        const batch = buildUniqueTranslationBatch(requests);
        const options = { itemContexts: batch.itemContexts };
        try {
          const result = await this.translateTextsWithFallback(batch.texts, options);
          const [outcome] = await evaluateBatch([prepared], batch, options, result);
          outcomes.push(outcome ?? { error: new Error('本地翻译未返回当前论文的结果。') });
        } catch (error) {
          outcomes.push({ error });
        }
      }
      return outcomes;
    }
  }

  private emitTranslationProgress(
    stableIds: string[],
    priority: ArxivTranslationPriority,
    sessionId: number | undefined,
    phase: ArxivTranslationProgress['phase'],
    detail: Pick<ArxivTranslationProgress, 'candidateIndex' | 'candidateTotal' | 'detail'> = {}
  ): void {
    if (!this.onProgress) {
      return;
    }
    stableIds.filter(Boolean).forEach((stableId) => {
      try {
        this.onProgress?.({
          stableId,
          phase,
          priority,
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(detail.candidateIndex !== undefined ? { candidateIndex: detail.candidateIndex } : {}),
          ...(detail.candidateTotal !== undefined ? { candidateTotal: detail.candidateTotal } : {}),
          ...(detail.detail ? { detail: detail.detail } : {})
        });
      } catch {
        // Progress observers must never interrupt translation or cache writes.
      }
    });
  }

  private async applyFallbackToNoEligibleOutcomes(
    preparedItems: PreparedTranslationBatchItem[],
    outcomes: MbrTranslationOutcome[]
  ): Promise<void> {
    if (!this.fallbackTranslateTextsWithEngine) {
      return;
    }
    const failedIndexes = outcomes.flatMap((outcome, index) =>
      outcome.selection.bundle ? [] : [index]
    );
    if (failedIndexes.length === 0) {
      return;
    }
    const failedPreparedItems = failedIndexes.map((index) => preparedItems[index] as PreparedTranslationBatchItem);
    const fallbackRequests = failedPreparedItems.flatMap(buildPaperTranslationRequests);
    const fallbackBatch = buildUniqueTranslationBatch(fallbackRequests);
    const applyFallbackResult = (
      originalIndexes: number[],
      items: PreparedTranslationBatchItem[],
      batch: ReturnType<typeof buildUniqueTranslationBatch>,
      fallbackResult: LocalTranslateBatchResult
    ): void => {
      if (fallbackResult.texts.length !== batch.texts.length) {
        throw new Error('后备翻译引擎返回的文本数量与请求不一致。');
      }
      const translatedTexts = batch.indexes.map((index) => fallbackResult.texts[index] ?? '');
      const evaluatedItems = evaluatePreparedTranslations(items, translatedTexts);
      originalIndexes.forEach((originalIndex, fallbackIndex) => {
        const prepared = items[fallbackIndex];
        const evaluated = evaluatedItems[fallbackIndex];
        const bundle = buildTranslationCandidateBundle(0, prepared, evaluated);
        if (!bundle.eligible) {
          return;
        }
        const outcome = outcomes[originalIndex];
        if (!outcome) {
          return;
        }
        const degradationReason =
          '三份 HY-MT2 候选均未通过硬门禁，已使用经过同一结构校验的 NLLB/Argos 后备译文。';
        outcome.selection = {
          ...outcome.selection,
          bundle,
          degradationReason
        };
        outcome.metadata = {
          selectionMode: 'fallback-engine',
          candidateCount: ARXIV_MBR_SEEDS.length,
          eligibleCandidateCount: 0,
          degradationReason
        };
        outcome.engine = fallbackResult.engine;
      });
    };
    try {
      const fallbackResult = await this.fallbackTranslateTextsWithEngine(
        fallbackBatch.texts,
        { itemContexts: fallbackBatch.itemContexts }
      );
      applyFallbackResult(failedIndexes, failedPreparedItems, fallbackBatch, fallbackResult);
    } catch {
      for (let fallbackIndex = 0; fallbackIndex < failedPreparedItems.length; fallbackIndex += 1) {
        const prepared = failedPreparedItems[fallbackIndex] as PreparedTranslationBatchItem;
        const originalIndex = failedIndexes[fallbackIndex] as number;
        const requests = buildPaperTranslationRequests(prepared);
        const batch = buildUniqueTranslationBatch(requests);
        try {
          const fallbackResult = await this.fallbackTranslateTextsWithEngine(
            batch.texts,
            { itemContexts: batch.itemContexts }
          );
          applyFallbackResult([originalIndex], [prepared], batch, fallbackResult);
        } catch {
          // Keep this paper's explicit no-eligible result when its own fallback is unavailable.
        }
      }
    }
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
        engine TEXT NOT NULL,
        selection_json TEXT
      );
    `);
    const columns = this.db
      .prepare(`PRAGMA table_info(arxiv_translation_cache)`)
      .all() as Array<{ name?: string }>;
    if (!columns.some((column) => column.name === 'selection_json')) {
      this.db.exec(`ALTER TABLE arxiv_translation_cache ADD COLUMN selection_json TEXT`);
    }
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
        `SELECT source_title, source_summary, title_zh, abstract_zh, translated_at, engine, selection_json
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
    // A cached title without a usable abstract traps every later click in a permanent
    // cache hit. Keep abstract-only rows because the fast title path can upgrade them,
    // but evict legacy title-only rows so the full translation can be retried.
    if (!abstractZh) {
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

  private upgradeCachedTitle(
    cacheKey: string,
    cached: CachedTranslationRow,
    value: {
      stableId: string;
      title: string;
      summary: string;
      pretranslatedTitleZh: string;
    }
  ): CachedTranslationRow {
    if (cached.title_zh || !value.pretranslatedTitleZh) {
      return cached;
    }
    const titleZh = repairAcademicTranslation(
      value.title,
      normalizeTranslatedText(value.pretranslatedTitleZh),
      { mode: 'title' }
    );
    if (!isUsableTranslatedText(titleZh, value.title)) {
      return cached;
    }
    const translatedAt = new Date(this.now()).toISOString();
    this.writeCache(cacheKey, {
      stableId: value.stableId,
      title: value.title,
      summary: value.summary,
      titleZh,
      abstractZh: cached.abstract_zh,
      translatedAt,
      engine: cached.engine,
      selection: parseCachedSelectionMetadata(cached.selection_json)
    });
    return {
      ...cached,
      title_zh: titleZh,
      translated_at: translatedAt
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
      selection?: ArxivTranslationSelectionMetadata;
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
          engine,
          selection_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          title_zh = excluded.title_zh,
          abstract_zh = excluded.abstract_zh,
          translated_at = excluded.translated_at,
          engine = excluded.engine,
          selection_json = excluded.selection_json`
      )
      .run(
        cacheKey,
        value.stableId,
        value.title,
        value.summary,
        value.titleZh,
        value.abstractZh,
        value.translatedAt,
        value.engine,
        JSON.stringify(value.selection ?? buildSingleCandidateSelectionMetadata())
      );
  }

  private async translateTextsWithFallback(
    texts: string[],
    options?: TranslationBatchOptions
  ): Promise<LocalTranslateBatchResult> {
    try {
      return await this.translateTextsWithEngine(texts, options);
    } catch (error) {
      if (!this.fallbackTranslateTextsWithEngine) {
        throw error;
      }
      return this.fallbackTranslateTextsWithEngine(texts, options);
    }
  }
}

interface TranslationBatchRequest {
  text: string;
  itemContext: LocalTranslationItemContext;
}

function buildPaperTranslationRequests(item: PreparedTranslationBatchItem): TranslationBatchRequest[] {
  const titleContext = truncateContextStart(
    `Abstract context: ${item.sourceAbstract}`,
    ARXIV_TITLE_CONTEXT_LIMIT
  );
  const titleRequests = item.title.segments.map((text) => ({
    text,
    itemContext: { context: titleContext, style: 'academic-paper' as const }
  }));
  const abstractRequests = item.abstract.segments.map((text, index) => ({
    text,
    itemContext: {
      context: buildAbstractSegmentContext(
        item.sourceTitle,
        item.sourceAbstractSegments.slice(0, Math.min(index, item.sourceAbstractSegments.length))
      ),
      style: 'academic-paper' as const
    }
  }));
  return [...titleRequests, ...abstractRequests];
}

function buildAbstractSegmentContext(title: string, previousSegments: string[]): string {
  const titleLine = truncateContextStart(`Paper title: ${title}`, ARXIV_ABSTRACT_CONTEXT_LIMIT);
  if (previousSegments.length === 0) {
    return titleLine;
  }
  const prefix = `${titleLine}\nPrevious source: `;
  const remaining = Math.max(0, ARXIV_ABSTRACT_CONTEXT_LIMIT - prefix.length);
  return `${prefix}${truncateContextEnd(previousSegments.join(' '), remaining)}`.slice(
    0,
    ARXIV_ABSTRACT_CONTEXT_LIMIT
  );
}

function truncateContextStart(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= limit ? normalized : normalized.slice(0, limit).trimEnd();
}

function truncateContextEnd(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= limit ? normalized : normalized.slice(normalized.length - limit).trimStart();
}

function buildUniqueTranslationBatch(requests: TranslationBatchRequest[]): {
  texts: string[];
  itemContexts: LocalTranslationItemContext[];
  indexes: number[];
} {
  const indexes: number[] = [];
  const uniqueTexts: string[] = [];
  const itemContexts: LocalTranslationItemContext[] = [];
  const seen = new Map<string, number>();
  requests.forEach(({ text, itemContext }) => {
    const key = JSON.stringify({
      text: normalizeTranslatedText(text),
      context: normalizeTranslatedText(itemContext.context ?? ''),
      style: itemContext.style ?? ''
    });
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      indexes.push(existingIndex);
      return;
    }
    const nextIndex = uniqueTexts.length;
    seen.set(key, nextIndex);
    uniqueTexts.push(text);
    itemContexts.push(itemContext);
    indexes.push(nextIndex);
  });
  return { texts: uniqueTexts, itemContexts, indexes };
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

function buildTranslationCandidateBundle(
  seed: number,
  prepared: PreparedTranslationBatchItem,
  evaluated: EvaluatedTranslationBatchItem | undefined
): TranslationCandidateBundle {
  if (!evaluated) {
    return buildUnavailableCandidateBundle(seed, 'candidate-evaluation-missing');
  }
  const hardFailures: string[] = [];
  if (!evaluated.title.ok) {
    hardFailures.push(`title-structure:${evaluated.title.reason ?? 'invalid'}`);
  }
  if (!evaluated.abstract.ok) {
    hardFailures.push(`abstract-structure:${evaluated.abstract.reason ?? 'invalid'}`);
  }
  if (!evaluated.titleUsable) {
    hardFailures.push('title-unusable');
  }
  if (!evaluated.abstractUsable) {
    hardFailures.push('abstract-unusable');
  }
  if (evaluated.hasSevereAbstractLengthLoss) {
    hardFailures.push('abstract-severely-truncated');
  }
  const softWarnings = [
    ...(hasSuspiciousRepeatedTranslationTail(evaluated.titleZh) ? ['title-repeated-tail'] : []),
    ...(hasSuspiciousRepeatedTranslationTail(evaluated.abstractZh) ? ['abstract-repeated-tail'] : [])
  ];
  return {
    seed,
    titleZh: evaluated.titleUsable ? evaluated.titleZh : '',
    abstractZh: evaluated.abstractUsable ? evaluated.abstractZh : '',
    segments: [
      {
        source: prepared.sourceTitle,
        translation: evaluated.titleZh,
        sourceTokenWeight: estimateSourceTokenWeight(prepared.sourceTitle),
        kind: 'title'
      },
      {
        source: prepared.sourceAbstract,
        translation: evaluated.abstractZh,
        sourceTokenWeight: estimateSourceTokenWeight(prepared.sourceAbstract),
        kind: 'abstract'
      }
    ],
    eligible: hardFailures.length === 0,
    hardFailures,
    softWarnings
  };
}

function buildUnavailableCandidateBundle(seed: number, reason: string): TranslationCandidateBundle {
  return {
    seed,
    titleZh: '',
    abstractZh: '',
    segments: [],
    eligible: false,
    hardFailures: [reason],
    softWarnings: []
  };
}

function summarizeCandidateFailureTypes(bundles: TranslationCandidateBundle[]): string {
  return [...new Set(
    bundles.flatMap((bundle) => bundle.hardFailures.map((failure) => failure.split(':')[0] ?? failure))
  )].sort().join('、');
}

function estimateSourceTokenWeight(source: string): number {
  return Math.max(
    1,
    source.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  );
}

export function buildTranslationCacheKey(input: { stableId: string; title: string; summary: string }): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        version: 11,
        selection: ARXIV_MBR_SELECTION_VERSION,
        seeds: ARXIV_MBR_SEEDS,
        hardGate: ARXIV_MBR_HARD_GATE_VERSION,
        evaluator: {
          model: COMET_MBR_MODEL_ID,
          revision: COMET_MBR_MODEL_REVISION
        },
        contextPrompt: ARXIV_CONTEXT_PROMPT_VERSION,
        glossary: ACADEMIC_TRANSLATION_GLOSSARY_VERSION,
        hyMt2Model: resolveHyMt2ModelCacheIdentity(),
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
  const translatedTokens = new Set(translated.split(/\s+/u).filter((token) => token.length >= 4));
  const originalTokens = original.split(/\s+/u).filter((token) => token.length >= 4);
  if (translatedTokens.size === 0 || originalTokens.length === 0) {
    return false;
  }
  const overlap = originalTokens.filter((token) => translatedTokens.has(token)).length / originalTokens.length;
  if (overlap < 0.6) {
    return false;
  }

  // Academic titles often retain model, benchmark, and dataset names. Treat a
  // high Latin-token overlap as an echo only when the Chinese contribution is
  // too small to be a substantive translation. This keeps titles such as
  // "RoboMamba：在 RoboCasa、ManiSkill 与 MetaWorld 上进行基准评测" while
  // still rejecting outputs that merely prepend "中文：" to the source.
  const cjkCount = value.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const translatedLatinCount = value.match(/[A-Za-z]/gu)?.length ?? 0;
  const sourceLatinCount = source.match(/[A-Za-z]/gu)?.length ?? 0;
  const chineseToSourceRatio = cjkCount / Math.max(1, sourceLatinCount);
  const chineseOutputShare = cjkCount / Math.max(1, cjkCount + translatedLatinCount);
  const hasSubstantiveChinese =
    cjkCount >= 6 && chineseToSourceRatio >= 0.12 && chineseOutputShare >= 0.12;

  return !hasSubstantiveChinese;
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function buildCompletedTranslationMessage(engine: LocalTranslateBatchResult['engine']): string {
  if (engine === 'hy-mt2-q4') {
    return '已使用本地 HY-MT2 专用翻译模型批量翻译并写入 SQLite 缓存。';
  }
  if (engine === 'nllb-ct2-int8') {
    return '已使用本地 NLLB CTranslate2 int8 批量翻译并写入 SQLite 缓存。';
  }
  return '已使用本地 Argos 批量翻译并写入 SQLite 缓存。';
}

function buildMbrCompletedTranslationMessage(metadata: ArxivTranslationSelectionMetadata): string {
  switch (metadata.selectionMode) {
    case 'comet-mbr':
      return '已生成 3 份完整 HY-MT2 候选，并由本地 COMET 独立互评后整篇选优并写入缓存。';
    case 'two-candidate':
      return '两份完整候选通过硬门禁，已由本地 COMET 互评后整篇选优并写入缓存。';
    case 'single-unique-candidate':
      return '候选归一化后只有一份独立完整译文，已通过硬门禁并写入缓存。';
    case 'single-candidate':
      return '只有一份完整候选通过硬门禁，已确定性选用并写入缓存。';
    case 'evaluator-failed':
      return '本地 COMET 评估不可用，已按硬门禁、质量警告与固定顺序降级选择完整译文并写入缓存。';
    case 'fallback-engine':
      return '三份 HY-MT2 候选均未通过硬门禁，已使用通过结构校验的 NLLB/Argos 后备译文并写入缓存。';
    case 'no-eligible-candidate':
    default:
      return '没有候选通过完整性检查，未写入缓存。';
  }
}

const ARXIV_TRANSLATION_SELECTION_MODES = new Set<ArxivTranslationSelectionMetadata['selectionMode']>([
  'comet-mbr',
  'two-candidate',
  'single-candidate',
  'single-unique-candidate',
  'no-eligible-candidate',
  'fallback-engine',
  'evaluator-failed'
]);

function buildSingleCandidateSelectionMetadata(): ArxivTranslationSelectionMetadata {
  return {
    selectionMode: 'single-candidate',
    candidateCount: 1,
    eligibleCandidateCount: 1
  };
}

function buildNoEligibleSelectionMetadata(candidateCount: number): ArxivTranslationSelectionMetadata {
  return {
    selectionMode: 'no-eligible-candidate',
    candidateCount: Math.max(0, Math.trunc(candidateCount)),
    eligibleCandidateCount: 0
  };
}

function parseCachedSelectionMetadata(value: string | null): ArxivTranslationSelectionMetadata {
  if (!value) {
    return buildSingleCandidateSelectionMetadata();
  }
  try {
    const parsed = JSON.parse(value) as Partial<ArxivTranslationSelectionMetadata>;
    if (
      !ARXIV_TRANSLATION_SELECTION_MODES.has(
        parsed.selectionMode as ArxivTranslationSelectionMetadata['selectionMode']
      ) ||
      !Number.isSafeInteger(parsed.candidateCount) ||
      (parsed.candidateCount as number) < 0 ||
      !Number.isSafeInteger(parsed.eligibleCandidateCount) ||
      (parsed.eligibleCandidateCount as number) < 0
    ) {
      return buildSingleCandidateSelectionMetadata();
    }
    return {
      selectionMode: parsed.selectionMode as ArxivTranslationSelectionMetadata['selectionMode'],
      candidateCount: parsed.candidateCount as number,
      eligibleCandidateCount: parsed.eligibleCandidateCount as number,
      ...(Number.isSafeInteger(parsed.selectedSeed) ? { selectedSeed: parsed.selectedSeed as number } : {}),
      ...(typeof parsed.evaluator === 'string' && parsed.evaluator.trim()
        ? { evaluator: parsed.evaluator }
        : {}),
      ...(typeof parsed.degradationReason === 'string' && parsed.degradationReason.trim()
        ? { degradationReason: parsed.degradationReason }
        : {})
    };
  } catch {
    return buildSingleCandidateSelectionMetadata();
  }
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
    translatedAt: cached.translated_at,
    ...parseCachedSelectionMetadata(cached.selection_json)
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
    message,
    ...buildNoEligibleSelectionMetadata(0)
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
