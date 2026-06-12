import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArxivTranslationService } from './arxivTranslationService';

describe('ArxivTranslationService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-arxiv-translation-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('translates title and abstract once, then serves the same paper from SQLite cache', async () => {
    const calls: string[] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateText: async (text) => {
        calls.push(text);
        return text.startsWith('PILOT') ? 'PILOT：感知集成低层控制器' : '该摘要介绍了机器人导航中的强化学习方法。';
      },
      now: () => 1_764_000_000_000
    });

    try {
      const request = {
        stableId: '2601.17440',
        title: 'PILOT: A Perceptive Integrated Low-level Controller',
        summary: 'This abstract introduces reinforcement learning for robot navigation.'
      };
      const first = await service.translatePaper(request);
      const second = await service.translatePaper(request);

      expect(first).toMatchObject({
        stableId: '2601.17440',
        titleZh: 'PILOT：感知集成低层控制器',
        abstractZh: '该摘要介绍了机器人导航中的强化学习方法。',
        engine: 'argos',
        status: 'completed',
        cacheHit: false
      });
      expect(second).toMatchObject({
        titleZh: first.titleZh,
        abstractZh: first.abstractZh,
        engine: 'cache',
        status: 'cached',
        cacheHit: true
      });
      expect(calls).toHaveLength(2);
    } finally {
      service.close();
    }
  });

  it('returns an unavailable result without throwing when the local translator is missing', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateText: async () => {
        const error = new Error('spawn argos-translate ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
    });

    try {
      const result = await service.translatePaper({
        stableId: 'missing-engine',
        title: 'Robot Navigation',
        summary: 'Navigation with reinforcement learning.'
      });

      expect(result.status).toBe('unavailable');
      expect(result.engine).toBe('unavailable');
      expect(result.cacheHit).toBe(false);
      expect(result.message).toContain('离线翻译未配置');
      expect(result.message).toContain('查看 README');
      expect(result.message).toContain('稍后重试');
    } finally {
      service.close();
    }
  });
});
