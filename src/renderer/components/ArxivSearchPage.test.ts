import { describe, expect, it } from 'vitest';
import type { ArxivPaper } from '../lib/arxivClient';
import { buildArxivPaperInsight, type ArxivPaperMeta } from '../lib/arxivUi';
import {
  DEFAULT_ARXIV_SEARCH_QUERY,
  ARXIV_CARD_PRIMARY_ACTIONS,
  buildArxivPreviewTranslationBatches,
  buildArxivQueuedPaper,
  buildAvailableArxivTags,
  buildArxivReadingQueuePreview,
  buildArxivSearchRequestForUi,
  buildLatestArxivSearchRequest,
  buildArxivTranslationBatches,
  buildArxivTranslationBatchRequest,
  buildArxivTranslationMetaPatch,
  buildArxivTranslationUiApplication,
  advanceArxivTranslationQueue,
  canStartArxivManualTranslation,
  getArxivTranslationActionState,
  describeLocalTranslationStatus,
  getArxivCardPreviewText,
  getArxivResultDensityConfig,
  getArxivResultDisplay,
  hasUsableArxivChineseMetadata,
  normalizeArxivResultColumnMode,
  resolveSelectedArxivPaper,
  resolveArxivExecutedQuerySnapshot,
  resolveArxivPaperInsightForExecutedQuery,
  runArxivTranslationBatches,
  shouldQueueArxivMetadataTranslation,
  upsertArxivQueuedPaper
} from './ArxivSearchPage';

const paper: ArxivPaper = {
  id: 'https://arxiv.org/abs/2601.00001v1',
  stableId: '2601.00001',
  title: 'Safe Reinforcement Learning for Robot Navigation',
  authors: ['Ada Lovelace', 'Grace Hopper'],
  summary: 'This paper studies safe reinforcement learning for robot navigation.',
  published: '2026-01-01T00:00:00Z',
  publishedAt: '2026-01-01T00:00:00Z',
  updated: '2026-01-02T00:00:00Z',
  categories: ['cs.RO', 'cs.LG'],
  primaryCategory: 'cs.RO',
  abstractUrl: 'https://arxiv.org/abs/2601.00001v1',
  pdfUrl: 'https://arxiv.org/pdf/2601.00001v1.pdf'
};

describe('ArxivSearchPage result display', () => {
  it('uses cached Chinese title and abstract by default when available', () => {
    const meta: ArxivPaperMeta = {
      titleZh: '面向机器人导航的安全强化学习',
      abstractZh: '本文研究机器人导航中的安全强化学习。'
    };

    const display = getArxivResultDisplay(paper, meta);

    expect(display.title).toBe(meta.titleZh);
    expect(display.secondaryTitle).toBe(paper.title);
    expect(display.abstractText).toBe(meta.abstractZh);
    expect(display.abstractMode).toBe('zh');
  });

  it('falls back to English title and abstract when no cached Chinese metadata exists', () => {
    const display = getArxivResultDisplay(paper, {});

    expect(display.title).toBe(paper.title);
    expect(display.secondaryTitle).toBe('');
    expect(display.abstractText).toBe(paper.summary);
    expect(display.abstractMode).toBe('en');
  });

  it('falls back to English title and abstract when cached Chinese metadata is mojibake', () => {
    const display = getArxivResultDisplay(paper, {
      titleZh: '闈㈠悜鏈哄櫒浜哄鑸殑瀹夊叏寮哄寲瀛︿範',
      abstractZh: '鏈枃鐮旂┒鏈哄櫒浜哄鑸腑鐨勫畨鍏ㄥ己鍖栧涔犮€?'
    });

    expect(display.title).toBe(paper.title);
    expect(display.secondaryTitle).toBe('');
    expect(display.abstractText).toBe(paper.summary);
    expect(display.abstractMode).toBe('en');
  });

  it('renders card abstracts as plain preview text without inline math scroll containers', () => {
    expect(getArxivCardPreviewText('We optimize $J(\\theta)$ with $$R_{task} + R_{safe}$$.')).toBe(
      'We optimize J(\\theta) with R_{task} + R_{safe}.'
    );
  });

  it('repairs stale local arXiv translation cache before rendering cards and detail panels', () => {
    const tactilePaper: ArxivPaper = {
      ...paper,
      title: 'TaCauchy: An Extensible FEM Framework for Vision-Based Tactile Simulation',
      summary: 'We introduce TaCauchy for vision-based tactile simulation with FEM.'
    };
    const display = getArxivResultDisplay(tactilePaper, {
      titleZh: '塔科奇: 基于视觉的触觉模拟的可扩展FEM框架',
      abstractZh: '我们介绍了塔科奇用于基于视觉的触觉模拟。'
    });

    expect(display.title).toContain('TaCauchy');
    expect(display.title).toContain('FEM');
    expect(display.title).toContain('Vision-Based');
    expect(display.abstractText).toContain('TaCauchy');
    expect(display.abstractMode).toBe('zh');
  });

  it('does not treat stale mojibake Chinese metadata as usable translation cache', () => {
    const staleBadCache: ArxivPaperMeta = {
      titleZh: '闈㈠悜鏈哄櫒浜哄鑸殑瀹夊叏寮哄寲瀛︿範',
      abstractZh: '鏈枃鐮旂┒鏈哄櫒浜哄鑸腑鐨勫畨鍏ㄥ己鍖栧涔犮€?',
      translatedAt: '2026-06-18T00:00:00.000Z'
    };

    expect(hasUsableArxivChineseMetadata(staleBadCache)).toBe(false);
    expect(shouldQueueArxivMetadataTranslation(staleBadCache)).toBe(true);
  });

  it('starts as a generic search tool instead of pre-filling a research-direction query', () => {
    expect(DEFAULT_ARXIV_SEARCH_QUERY).toBe('');
  });

  it('lets the detail panel stay closed when the current selection is cleared', () => {
    expect(resolveSelectedArxivPaper([paper], null)).toBeNull();
    expect(resolveSelectedArxivPaper([paper], 'missing-id')).toBe(paper);
    expect(resolveSelectedArxivPaper([paper], paper.id)).toBe(paper);
  });

  it('maps result column modes to different result-list density settings', () => {
    expect(getArxivResultDensityConfig('three')).toMatchObject({
      className: 'arxiv-density-compact',
      summaryLines: 2
    });
    expect(getArxivResultDensityConfig('two')).toMatchObject({
      className: 'arxiv-density-standard',
      summaryLines: 3
    });
    expect(getArxivResultDensityConfig('one')).toMatchObject({
      className: 'arxiv-density-wide',
      summaryLines: 4
    });
  });

  it('defaults to a three-column result grid while migrating previous layout values', () => {
    expect(normalizeArxivResultColumnMode(null)).toBe('three');
    expect(normalizeArxivResultColumnMode('three')).toBe('three');
    expect(normalizeArxivResultColumnMode('two')).toBe('two');
    expect(normalizeArxivResultColumnMode('one')).toBe('one');
    expect(normalizeArxivResultColumnMode('compact')).toBe('three');
    expect(normalizeArxivResultColumnMode('standard')).toBe('two');
    expect(normalizeArxivResultColumnMode('wide')).toBe('one');
    expect(normalizeArxivResultColumnMode('unexpected')).toBe('three');
  });

  it('stores arXiv candidate papers without requiring a local PDF path', () => {
    const queued = buildArxivQueuedPaper(
      paper,
      {
        titleZh: '面向机器人导航的安全强化学习',
        abstractZh: '本文研究机器人导航中的安全强化学习。'
      },
      '2026-06-13T00:00:00.000Z'
    );

    expect(queued).toMatchObject({
      stableId: paper.stableId,
      title: paper.title,
      titleZh: '面向机器人导航的安全强化学习',
      abstractZh: '本文研究机器人导航中的安全强化学习。',
      pdfUrl: paper.pdfUrl
    });
    expect(queued).not.toHaveProperty('pdfPath');
  });

  it('builds latest-search requests as live submitted-date descending refreshes', () => {
    const latest = buildLatestArxivSearchRequest(
      {
        searchQuery: 'robot',
        category: '',
        start: 50,
        maxResults: 50,
        sortBy: 'comprehensive',
        sortOrder: 'ascending',
        yearFrom: '',
        yearTo: '',
        forceRefresh: true
      },
      '机器人'
    );

    expect(latest).toMatchObject({
      searchQuery: '机器人',
      start: 0,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      forceRefresh: true
    });
  });

  it('builds UI search requests with an immediate page-size override', () => {
    const request = buildArxivSearchRequestForUi(
      {
        searchQuery: 'robot',
        category: '',
        start: 50,
        maxResults: 50,
        sortBy: 'relevance',
        sortOrder: 'descending'
      },
      '机器人',
      0,
      { maxResults: 200, forceRefresh: true }
    );

    expect(request).toMatchObject({
      searchQuery: '机器人',
      start: 0,
      maxResults: 200,
      forceRefresh: true
    });
  });

  it('builds available tags from papers and cached metadata without requiring the active query', () => {
    const tags = buildAvailableArxivTags(
      [
        {
          ...paper,
          title: 'Safe RL for Robot Navigation',
          summary: 'We study control barrier functions and model predictive control.'
        }
      ],
      {
        [paper.stableId]: {
          insight: {
            totalScore: 90,
            relevance: 90,
            novelty: 80,
            methodClarity: 80,
            experimentQuality: 70,
            codeAvailability: 0,
            topicMatch: {
              rl: 0,
              pinn: 0,
              path_planning: 0,
              robotics: 80,
              embodied_ai: 0,
              world_model: 0
            },
            readingPriority: 'high',
            reasonZh: 'cached',
            tags: ['CBF', 'MPC'],
          }
        }
      }
    );

    expect(tags).toEqual(['CBF', 'MPC']);
  });

  it('describes warmed CUDA, CPU fallback, warming, and failed local translation states', () => {
    const baseStatus = {
      preferredEngine: 'nllb-first' as const,
      nllb: {
        configured: true,
        available: false,
        pythonPath: 'python',
        modelDir: 'model',
        tokenizerDir: 'tokenizer',
        device: 'auto' as const,
        runtimeDevice: 'unknown' as const,
        runtimeState: 'not_checked' as const,
        cudaDllDirs: [],
        lastRuntimeError: '',
        lastFallbackReason: '',
        lastCheckedAt: '',
        warmupMs: 0,
        message: '尚未完成 NLLB 运行检查。'
      },
      fallback: { engine: 'argos' as const, message: 'Argos fallback' },
      worker: { running: false, pending: 0 }
    };

    expect(describeLocalTranslationStatus({ ...baseStatus, nllb: { ...baseStatus.nllb, runtimeState: 'warming' } }))
      .toBe('NLLB 预热中');
    expect(describeLocalTranslationStatus({
      ...baseStatus,
      nllb: { ...baseStatus.nllb, available: true, runtimeState: 'ready', runtimeDevice: 'cuda' }
    })).toBe('NLLB 可用 · CUDA');
    expect(describeLocalTranslationStatus({
      ...baseStatus,
      nllb: { ...baseStatus.nllb, available: true, runtimeState: 'ready', runtimeDevice: 'unknown', device: 'auto' }
    })).toBe('NLLB 可用 · 设备未确认');
    expect(describeLocalTranslationStatus({
      ...baseStatus,
      nllb: {
        ...baseStatus.nllb,
        available: true,
        runtimeState: 'cpu_fallback',
        runtimeDevice: 'cpu',
        lastFallbackReason: 'CUDA DLL 缺失'
      }
    })).toBe('NLLB CPU 回退');
    expect(describeLocalTranslationStatus({
      ...baseStatus,
      nllb: { ...baseStatus.nllb, runtimeState: 'failed', lastRuntimeError: 'No CTranslate2 device available' }
    })).toBe('NLLB 不可用 · Argos fallback');
  });

  it('upserts queued arXiv papers by stable id', () => {
    const first = buildArxivQueuedPaper(paper, {}, '2026-06-13T00:00:00.000Z');
    const updated = buildArxivQueuedPaper(
      {
        ...paper,
        title: 'Updated title'
      },
      {},
      '2026-06-13T00:01:00.000Z'
    );

    const queue = upsertArxivQueuedPaper(upsertArxivQueuedPaper([], first), updated);

    expect(queue).toHaveLength(1);
    expect(queue[0].title).toBe('Updated title');
  });

  it('builds a compact queued-paper preview with an expandable remainder', () => {
    const queue = Array.from({ length: 5 }, (_, index) =>
      buildArxivQueuedPaper(
        {
          ...paper,
          id: `${paper.id}-${index}`,
          stableId: `2601.${String(index).padStart(5, '0')}`,
          title: `Long queued paper title ${index + 1}`
        },
        {},
        `2026-06-13T00:0${index}:00.000Z`
      )
    );

    const preview = buildArxivReadingQueuePreview(queue, 3);

    expect(preview.visible.map((item) => item.title)).toEqual([
      'Long queued paper title 1',
      'Long queued paper title 2',
      'Long queued paper title 3'
    ]);
    expect(preview.hidden).toHaveLength(2);
    expect(preview.hiddenCount).toBe(2);
  });

  it('automatically previews only the first six papers as interruptible jobs', () => {
    const papers = Array.from({ length: 20 }, (_, index) => ({
      ...paper,
      id: `${paper.id}-${index}`,
      stableId: `2601.${String(index).padStart(5, '0')}`
    }));

    expect(buildArxivPreviewTranslationBatches(papers)).toEqual(
      papers.slice(0, 6).map((item) => [item])
    );
  });

  it('binds result helpers to the last executed query instead of an edited input draft', () => {
    const snapshot = resolveArxivExecutedQuerySnapshot({
      originalQuery: '机器人导航',
      effectiveQuery: 'robot navigation robotic navigation',
      queryMode: 'balanced'
    });

    expect(snapshot).toEqual({
      query: 'robot navigation robotic navigation',
      mode: 'balanced'
    });
    expect(snapshot.query).not.toBe('unsubmitted draft');
  });

  it('reuses persisted scoring only when its executed query and mode match', () => {
    const strictInsight = {
      ...buildArxivPaperInsight(paper, 'robot navigation', 'strict'),
      totalScore: 1
    };
    const meta: ArxivPaperMeta = {
      insight: strictInsight,
      insightQuery: 'robot navigation',
      insightQueryMode: 'strict'
    };

    expect(resolveArxivPaperInsightForExecutedQuery(paper, meta, 'robot navigation', 'strict'))
      .toBe(strictInsight);
    expect(resolveArxivPaperInsightForExecutedQuery(paper, meta, 'robot navigation', 'explore'))
      .not.toBe(strictInsight);
  });

  it('never expands preview translation beyond the first six results when those are cached', () => {
    const papers = Array.from({ length: 20 }, (_, index) => ({
      ...paper,
      id: `${paper.id}-${index}`,
      stableId: `2601.${String(index).padStart(5, '0')}`
    }));

    expect(buildArxivPreviewTranslationBatches(papers, (_, index) => index >= 6)).toEqual([]);
    expect(buildArxivPreviewTranslationBatches(papers, (_, index) => index === 5)).toEqual([[papers[5]]]);
  });

  it('splits preview translations into interruptible single-paper jobs', () => {
    const papers = Array.from({ length: 8 }, (_, index) => ({
      ...paper,
      id: `${paper.id}-${index}`,
      stableId: `2601.${String(index).padStart(5, '0')}`
    }));

    expect(buildArxivPreviewTranslationBatches(papers)).toEqual(
      papers.slice(0, 6).map((item) => [item])
    );
  });

  it('blocks manual page and single-paper translations while a search owns the session', () => {
    expect(canStartArxivManualTranslation(true, 7)).toBe(false);
    expect(canStartArxivManualTranslation(false, null)).toBe(false);
    expect(canStartArxivManualTranslation(false, 7)).toBe(true);
  });

  it('keeps background translation clickable so a paper can be promoted to foreground', () => {
    expect(getArxivTranslationActionState(false, false, true)).toEqual({
      disabled: false,
      label: '优先翻译',
      title: '点击后提升为前台优先翻译'
    });
    expect(getArxivTranslationActionState(false, true, true).disabled).toBe(true);
  });

  it('builds explicit preview, page, and foreground IPC request shapes', () => {
    expect(buildArxivTranslationBatchRequest([paper], 'preview', 7)).toMatchObject({
      papers: [expect.objectContaining({ stableId: paper.stableId })],
      priority: 'preview',
      sessionId: 7
    });
    expect(buildArxivTranslationBatchRequest([paper], 'background', 7).priority).toBe('background');
    expect(buildArxivTranslationBatchRequest([paper], 'foreground', 7).priority).toBe('foreground');
  });

  it('does not produce a metadata patch for a stale search translation session', () => {
    const completed = {
      stableId: paper.stableId,
      titleZh: '中文标题',
      abstractZh: '中文摘要',
      engine: 'nllb-ct2-int8' as const,
      status: 'completed' as const,
      cacheHit: false,
      qualityStatus: 'passed' as const,
      elapsedMs: 125,
      message: '完成',
      translatedAt: '2026-07-10T00:00:00.000Z'
    };

    expect(buildArxivTranslationMetaPatch(completed, 6, 7)).toBeNull();
    expect(buildArxivTranslationUiApplication(completed, 6, 7)).toBeNull();
    expect(buildArxivTranslationMetaPatch(completed, 7, 7)).toMatchObject({
      titleZh: '中文标题',
      abstractZh: '中文摘要'
    });
    expect(buildArxivTranslationUiApplication(completed, 7, 7)).toMatchObject({
      shouldShowChinese: true,
      message: '完成',
      patch: {
        titleZh: '中文标题',
        abstractZh: '中文摘要'
      }
    });

    const latestFromUi = buildArxivSearchRequestForUi(
      {
        searchQuery: '',
        category: '',
        start: 0,
        maxResults: 50,
        sortBy: 'relevance',
        sortOrder: 'descending'
      },
      '*',
      0,
      { latest: true, forceRefresh: true }
    );
    expect(latestFromUi.forceRefresh).toBe(true);
  });

  it('drops stale failed results before they can update metadata, view mode, or message', () => {
    const failed = {
      stableId: paper.stableId,
      titleZh: '',
      abstractZh: '',
      engine: 'unavailable' as const,
      status: 'failed' as const,
      cacheHit: false,
      qualityStatus: 'failed' as const,
      elapsedMs: 80,
      message: '质量门禁未通过'
    };

    expect(buildArxivTranslationUiApplication(failed, 8, 9)).toBeNull();
  });

  it('keeps only read, translate, and reading-queue actions primary on result cards', () => {
    expect(ARXIV_CARD_PRIMARY_ACTIONS).toEqual(['查看摘要', '翻译', '加入阅读队列']);
    expect(ARXIV_CARD_PRIMARY_ACTIONS).not.toContain('加入 PPT');
    expect(ARXIV_CARD_PRIMARY_ACTIONS).not.toContain('导出 Markdown');
  });

  it('can still split translation work into fixed-size batches', () => {
    const papers = Array.from({ length: 50 }, (_, index) => ({
      ...paper,
      id: `${paper.id}-${index}`,
      stableId: `2601.${String(index).padStart(5, '0')}`
    }));

    const batches = buildArxivTranslationBatches(papers, 24);

    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.length)).toEqual([24, 24, 2]);
  });

  it('limits background translation workers while still allowing parallel batches', async () => {
    const batches = [[1], [2], [3], [4]];
    const started: number[] = [];
    const completed: number[] = [];
    let active = 0;
    let maxActive = 0;

    await runArxivTranslationBatches(
      batches,
      async (batch) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(batch[0]);
        await Promise.resolve();
        completed.push(batch[0]);
        active -= 1;
      },
      2
    );

    expect(started).toEqual([1, 2, 3, 4]);
    expect(completed).toEqual([1, 2, 3, 4]);
    expect(maxActive).toBe(2);
  });

  it('returns the active translation queue to idle after completion or failure accounting', () => {
    expect(advanceArxivTranslationQueue({ kind: 'preview', completed: 0, total: 6 }, 2)).toEqual({
      kind: 'preview',
      completed: 2,
      total: 6
    });
    expect(advanceArxivTranslationQueue({ kind: 'preview', completed: 2, total: 6 }, 4)).toBeNull();
    expect(advanceArxivTranslationQueue({ kind: 'page', completed: 0, total: 1 }, 1)).toBeNull();
  });
});
