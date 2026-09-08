import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArxivPaper, ArxivSearchRequest, ArxivSearchServiceResult } from '../shared/arxiv';
import { createDailyBriefService } from './dailyBriefService';

function makePaper(stableId: string, patch: Partial<ArxivPaper> = {}): ArxivPaper {
  const timestamp = patch.updated ?? patch.publishedAt ?? '2026-09-08T08:00:00.000Z';
  return {
    id: `https://arxiv.org/abs/${stableId}`,
    stableId,
    title: patch.title ?? `Paper ${stableId}`,
    authors: patch.authors ?? ['Author'],
    summary: patch.summary ?? 'A robotics abstract about robot manipulation.',
    published: patch.published ?? timestamp,
    publishedAt: patch.publishedAt ?? timestamp,
    updated: patch.updated ?? timestamp,
    categories: patch.categories ?? ['cs.RO'],
    primaryCategory: patch.primaryCategory ?? 'cs.RO',
    abstractUrl: patch.abstractUrl ?? `https://arxiv.org/abs/${stableId}`,
    pdfUrl: patch.pdfUrl ?? `https://arxiv.org/pdf/${stableId}.pdf`
  };
}

function result(papers: ArxivPaper[], patch: Partial<ArxivSearchServiceResult> = {}): ArxivSearchServiceResult {
  return {
    papers,
    totalResults: papers.length,
    startIndex: 0,
    itemsPerPage: papers.length,
    cacheHit: false,
    cacheStale: false,
    queueSize: 0,
    lastRequestGapMs: 0,
    ...patch
  };
}

async function makeStoragePath(): Promise<{ directory: string; storagePath: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-daily-brief-'));
  return { directory, storagePath: path.join(directory, 'daily-brief.json') };
}

describe('createDailyBriefService', () => {
  it('persists preferences and creates one honest abstract-only brief with stable deduplication', async () => {
    const { directory, storagePath } = await makeStoragePath();
    const now = new Date('2026-09-08T12:00:00.000Z');
    const papers = [
      makePaper('1234.00001v1', { updated: '2026-09-08T09:00:00.000Z', title: 'Robot manipulation with tactile control' }),
      makePaper('1234.00001v2', { updated: '2026-09-08T10:00:00.000Z', title: 'Robot manipulation with tactile control, revised' }),
      makePaper('1234.00002', { title: 'Unrelated astronomy result', summary: 'Stars and galaxies only.' })
    ];
    const requests: ArxivSearchRequest[] = [];
    const service = createDailyBriefService({
      storagePath,
      now: () => now,
      search: async (request) => {
        requests.push(request);
        return result(papers);
      }
    });

    try {
      await service.savePreferences({
        enabled: true,
        time: '08:30',
        interests: 'robot manipulation tactile',
        excludeTerms: '',
        maxPapers: 5,
        useAi: false
      });
      const snapshot = await service.run();
      const brief = snapshot.briefs[0];

      expect(requests).toHaveLength(1);
      expect(requests[0].sortBy).toBe('submittedDate');
      expect(requests[0].sortOrder).toBe('descending');
      expect(requests[0].forceRefresh).toBe(true);
      expect(requests[0].maxResults).toBeLessThanOrEqual(50);
      expect(brief.mode).toBe('rules');
      expect(brief.items.map((item) => item.paper.stableId)).toEqual(['1234.00001v2']);
      expect(brief.items[0].summary).toBe(papers[1].summary);
      expect(brief.items[0].evidenceLevel).toBe('abstract');
      expect(brief.items[0].reason).toContain('匹配关键词');
      expect(brief.items[0].summary).not.toContain('中文');

      const reloaded = createDailyBriefService({ storagePath, now: () => now, search: async () => result([]) });
      await expect(reloaded.getSnapshot()).resolves.toMatchObject({
        preferences: { interests: 'robot manipulation tactile' },
        briefs: [{ id: brief.id }]
      });
      reloaded.dispose();
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('does not replace history with stale search results and retries through tick after backoff', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let now = new Date('2026-09-08T08:30:00.000Z');
    let searchCount = 0;
    const service = createDailyBriefService({
      storagePath,
      now: () => now,
      search: async () => {
        searchCount += 1;
        if (searchCount === 1) return result([makePaper('1234.00003')]);
        if (searchCount === 2) return result([makePaper('1234.00004')], { cacheHit: true, cacheStale: true, warning: 'stale cache' });
        return result([makePaper('1234.00005')]);
      }
    });

    try {
      await service.savePreferences({ enabled: true, time: '08:30', interests: 'robot', excludeTerms: '', maxPapers: 3, useAi: false });
      const first = await service.run();
      expect(first.briefs[0].items[0].paper.stableId).toBe('1234.00003');

      now = new Date('2026-09-09T08:30:00.000Z');
      const failed = await service.run();
      expect(failed.briefs).toHaveLength(1);
      expect(failed.briefs[0].items[0].paper.stableId).toBe('1234.00003');
      expect(failed.lastError).toMatch(/stale/i);

      now = new Date('2026-09-09T08:36:00.000Z');
      const beforeBackoff = await service.tick();
      expect(searchCount).toBe(2);
      expect(beforeBackoff.briefs[0].items[0].paper.stableId).toBe('1234.00003');

      now = new Date('2026-09-09T08:46:00.000Z');
      const retried = await service.tick();
      expect(searchCount).toBe(3);
      expect(retried.briefs[0].items[0].paper.stableId).toBe('1234.00005');
      expect(retried.lastError).toBeNull();
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('single-flights concurrent runs and bounds AI planning/ranking to two completions and three searches', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
    let searchCount = 0;
    let completeCount = 0;
    const service = createDailyBriefService({
      storagePath,
      now: () => new Date('2026-09-08T12:00:00.000Z'),
      search: async () => {
        searchCount += 1;
        await searchGate;
        return result([makePaper(`1234.0000${searchCount}`, { title: 'Robot manipulation' })]);
      },
      complete: async ({ userPrompt }) => {
        completeCount += 1;
        if (completeCount === 1) return '{"queries":["robot manipulation","tactile robot","embodied robot","ignored fourth"]}';
        expect(userPrompt).toContain('untrusted');
        return '{"items":[{"id":"1234.00001","score":0.9,"summary":"Grounded abstract summary","reason":"The abstract matches the interest.","readingHint":"Check the task and evaluation."},{"id":"not-supplied","score":1,"summary":"invented"}]}';
      }
    });

    try {
      await service.savePreferences({ enabled: false, time: '08:30', interests: '机器人操作', excludeTerms: '', maxPapers: 3, useAi: true });
      const first = service.run();
      const second = service.run();
      releaseSearch();
      const [left, right] = await Promise.all([first, second]);
      expect(left).toEqual(right);
      expect(searchCount).toBeLessThanOrEqual(3);
      expect(completeCount).toBeLessThanOrEqual(2);
      expect(left.briefs[0].items.every((item) => item.paper.stableId !== 'not-supplied')).toBe(true);
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('runs only at the saved local time, records zero-result days, and catches up once after midnight', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let now = new Date(2026, 8, 8, 8, 29, 0);
    let searchCount = 0;
    const service = createDailyBriefService({
      storagePath,
      now: () => now,
      search: async () => {
        searchCount += 1;
        return result([]);
      }
    });

    try {
      await service.savePreferences({ enabled: true, time: '08:30', interests: 'robot', excludeTerms: '', maxPapers: 3, useAi: false });
      await service.tick();
      expect(searchCount).toBe(0);

      now = new Date(2026, 8, 8, 8, 30, 0);
      const due = await service.tick();
      expect(searchCount).toBe(1);
      expect(due.briefs).toHaveLength(1);
      expect(due.briefs[0].items).toHaveLength(0);
      expect((await service.tick()).briefs).toHaveLength(1);
      expect(searchCount).toBe(1);

      now = new Date(2026, 8, 9, 8, 29, 0);
      await service.tick();
      expect(searchCount).toBe(1);
      now = new Date(2026, 8, 9, 8, 30, 0);
      await service.tick();
      expect(searchCount).toBe(2);
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('persists a failed attempt and respects the retry backoff after a service restart', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let now = new Date(2026, 8, 8, 8, 30, 0);
    let firstSearchCount = 0;
    const firstService = createDailyBriefService({
      storagePath,
      now: () => now,
      search: async () => {
        firstSearchCount += 1;
        throw new Error('upstream unavailable');
      }
    });

    try {
      await firstService.savePreferences({ enabled: true, time: '08:30', interests: 'robot', excludeTerms: '', maxPapers: 2, useAi: false });
      const failed = await firstService.tick();
      expect(firstSearchCount).toBe(1);
      expect(failed.briefs).toHaveLength(0);
      firstService.dispose();

      let restartedSearchCount = 0;
      const restarted = createDailyBriefService({
        storagePath,
        now: () => now,
        search: async () => {
          restartedSearchCount += 1;
          return result([makePaper('1234.00009')]);
        }
      });
      now = new Date(2026, 8, 8, 8, 44, 0);
      await restarted.tick();
      expect(restartedSearchCount).toBe(0);
      now = new Date(2026, 8, 8, 8, 45, 0);
      const retry = await restarted.tick();
      expect(restartedSearchCount).toBe(1);
      expect(retry.briefs).toHaveLength(1);
      restarted.dispose();
    } finally {
      firstService.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('backs up malformed storage before the first repair write and surfaces the recovery state', async () => {
    const { directory, storagePath } = await makeStoragePath();
    const corruptContent = '{ definitely not valid json';
    await fs.writeFile(storagePath, corruptContent, 'utf8');
    const service = createDailyBriefService({ storagePath, search: async () => result([]) });

    try {
      const loaded = await service.getSnapshot();
      expect(loaded.preferences.enabled).toBe(false);
      expect(loaded.lastError).toMatch(/存储|文件|无效|读取/u);
      await service.savePreferences({ enabled: false, time: '08:30', interests: 'robot', excludeTerms: '', maxPapers: 1, useAi: false });
      const files = await fs.readdir(directory);
      const backups = files.filter((file) => file.includes('.corrupt-') && file.endsWith('.bak'));
      expect(backups).toHaveLength(1);
      expect(await fs.readFile(path.join(directory, backups[0]), 'utf8')).toBe(corruptContent);
      expect(JSON.parse(await fs.readFile(storagePath, 'utf8')).preferences.interests).toBe('robot');
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('hard-filters exclusions, applies bounded positive feedback, and lets dismissed feedback be undone', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let now = new Date('2026-09-08T12:00:00.000Z');
    const excluded = makePaper('1234.00010', { title: 'Robot tactile exclusion', summary: 'Robot tactile manipulation.' });
    const preferred = makePaper('1234.00011', { title: 'Robot manipulation planning', summary: 'Robot manipulation planning.' });
    const dismissable = makePaper('1234.00014', { title: 'Robot planning alternative', summary: 'Robot planning alternative.' });
    const service = createDailyBriefService({
      storagePath,
      now: () => now,
      search: async () => result([excluded, preferred, dismissable])
    });

    try {
      await service.savePreferences({ enabled: false, time: '08:30', interests: 'robot manipulation tactile', excludeTerms: 'irrelevant、exclusion', maxPapers: 3, useAi: false });
      await service.setFeedback({ paperId: preferred.stableId, kind: 'interested', title: preferred.title, topics: ['cs.RO'] });
      await service.setFeedback({ paperId: dismissable.stableId, kind: 'dismissed', title: dismissable.title, topics: [] });
      const first = await service.run();
      expect(first.briefs[0].items.map((item) => item.paper.stableId)).toEqual([preferred.stableId]);
      expect(first.briefs[0].items[0].reason).toContain('加 8 分');
      expect(first.feedback[0].paperId).toBe('1234.00011');

      now = new Date('2026-09-09T12:00:00.000Z');
      const dismissed = await service.run();
      expect(dismissed.briefs[0].items).toHaveLength(0);
      const restoredFeedback = await service.removeFeedback(dismissable.stableId);
      expect(restoredFeedback.feedback.some((item) => item.paperId === '1234.00014')).toBe(false);
      now = new Date('2026-09-10T12:00:00.000Z');
      const restored = await service.run();
      expect(restored.briefs[0].items.map((item) => item.paper.stableId)).toEqual([dismissable.stableId]);
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('does not commit a generated brief when the final disk write fails, then retries after recovery', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let now = new Date('2026-09-08T12:00:00.000Z');
    let searchCount = 0;
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
    let resolveSearchStarted!: () => void;
    const searchStarted = new Promise<void>((resolve) => { resolveSearchStarted = resolve; });
    const service = createDailyBriefService({
      storagePath,
      now: () => now,
      search: async () => {
        searchCount += 1;
        resolveSearchStarted();
        await searchGate;
        return result([makePaper(`1234.0001${searchCount}`)]);
      }
    });

    try {
      await service.savePreferences({ enabled: true, time: '08:30', interests: 'robot', excludeTerms: '', maxPapers: 2, useAi: false });
      const running = service.run();
      await searchStarted;
      await fs.rm(storagePath);
      await fs.mkdir(storagePath);
      releaseSearch();
      const failed = await running;
      expect(searchCount).toBe(1);
      expect(failed.briefs).toHaveLength(0);
      expect(failed.lastError).toMatch(/持久化|目录|EISDIR|文件/u);

      await fs.rm(storagePath, { recursive: true, force: true });
      now = new Date('2026-09-08T12:16:00.000Z');
      const recovered = await service.tick();
      expect(searchCount).toBe(2);
      expect(recovered.briefs).toHaveLength(1);
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps malformed AI output honest and never accepts unknown paper IDs', async () => {
    const { directory, storagePath } = await makeStoragePath();
    const paper = makePaper('1234.00012', { title: 'Robot manipulation' });
    let completeCount = 0;
    const service = createDailyBriefService({
      storagePath,
      now: () => new Date('2026-09-08T12:00:00.000Z'),
      search: async () => result([paper]),
      complete: async () => {
        completeCount += 1;
        return completeCount === 1 ? '{"queries":["robot manipulation"]}' : '{"items":[{"id":"invented-id","score":99,"summary":"invented"}]';
      }
    });

    try {
      await service.savePreferences({ enabled: false, time: '08:30', interests: '机器人操作', excludeTerms: '', maxPapers: 2, useAi: true });
      const snapshot = await service.run();
      expect(completeCount).toBe(2);
      expect(snapshot.briefs[0].mode).toBe('rules');
      expect(snapshot.briefs[0].warning).toContain('候选论文 ID');
      expect(snapshot.briefs[0].items.map((item) => item.paper.stableId)).toEqual([paper.stableId]);
      expect(snapshot.briefs[0].items[0].summary).toBe(paper.summary);
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects preference changes during a run and preserves the run configuration', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let releaseSearch!: () => void;
    const gate = new Promise<void>((resolve) => { releaseSearch = resolve; });
    const service = createDailyBriefService({
      storagePath,
      now: () => new Date('2026-09-08T12:00:00.000Z'),
      search: async () => {
        await gate;
        return result([makePaper('1234.00013', { title: 'Robot manipulation' })]);
      }
    });

    try {
      await service.savePreferences({ enabled: false, time: '08:30', interests: 'robot', excludeTerms: '', maxPapers: 2, useAi: false });
      const running = service.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect(service.savePreferences({ enabled: false, time: '09:00', interests: 'tactile', excludeTerms: '', maxPapers: 2, useAi: false })).rejects.toThrow(/运行|修改/u);
      releaseSearch();
      const snapshot = await running;
      expect(snapshot.preferences.interests).toBe('robot');
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('waits for an in-flight run before committing feedback, so the run snapshot stays unchanged', async () => {
    const { directory, storagePath } = await makeStoragePath();
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
    let resolveSearchStarted!: () => void;
    const searchStarted = new Promise<void>((resolve) => { resolveSearchStarted = resolve; });
    const paper = makePaper('1234.00015', { title: 'Robot manipulation' });
    const service = createDailyBriefService({
      storagePath,
      now: () => new Date('2026-09-08T12:00:00.000Z'),
      search: async () => {
        resolveSearchStarted();
        await searchGate;
        return result([paper]);
      }
    });

    try {
      await service.savePreferences({ enabled: false, time: '08:30', interests: 'robot', excludeTerms: '', maxPapers: 2, useAi: false });
      const run = service.run();
      await searchStarted;
      let feedbackSettled = false;
      const feedback = service.setFeedback({ paperId: `${paper.stableId}v2`, kind: 'interested', title: paper.title, topics: ['cs.RO'] })
        .then((snapshot) => {
          feedbackSettled = true;
          return snapshot;
        });
      await Promise.resolve();
      expect(feedbackSettled).toBe(false);

      releaseSearch();
      const runSnapshot = await run;
      expect(runSnapshot.feedback).toHaveLength(0);
      const afterFeedback = await feedback;
      expect(afterFeedback.feedback).toHaveLength(1);
      expect(afterFeedback.feedback[0].paperId).toBe('1234.00015');
    } finally {
      service.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
