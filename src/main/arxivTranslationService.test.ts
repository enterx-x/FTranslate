import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArxivTranslationService,
  decodeArgosCliOutput,
  resolveArgosChildEnv,
  resolveArgosCliCommand
} from './arxivTranslationService';

describe('ArxivTranslationService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-arxiv-translation-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses FTRANSLATE_ARGOS_CLI before falling back to PATH lookup', () => {
    const previous = process.env.FTRANSLATE_ARGOS_CLI;

    try {
      process.env.FTRANSLATE_ARGOS_CLI = 'E:\\FTranslateTools\\argos-conda\\Scripts\\argos-translate.exe';
      expect(resolveArgosCliCommand()).toBe('E:\\FTranslateTools\\argos-conda\\Scripts\\argos-translate.exe');

      delete process.env.FTRANSLATE_ARGOS_CLI;
      expect(resolveArgosCliCommand()).toBe('argos-translate');
    } finally {
      if (previous === undefined) {
        delete process.env.FTRANSLATE_ARGOS_CLI;
      } else {
        process.env.FTRANSLATE_ARGOS_CLI = previous;
      }
    }
  });

  it('maps the FTranslate Argos package directory to Argos native environment variables', () => {
    const previous = process.env.FTRANSLATE_ARGOS_PACKAGES_DIR;

    try {
      process.env.FTRANSLATE_ARGOS_PACKAGES_DIR = 'E:\\FTranslateTools\\argos-data\\packages';
      const env = resolveArgosChildEnv();

      expect(env.ARGOS_PACKAGES_DIR).toBe('E:\\FTranslateTools\\argos-data\\packages');
      expect(env.ARGOS_TRANSLATE_PACKAGE_DIR).toBe('E:\\FTranslateTools\\argos-data\\packages');
    } finally {
      if (previous === undefined) {
        delete process.env.FTRANSLATE_ARGOS_PACKAGES_DIR;
      } else {
        process.env.FTRANSLATE_ARGOS_PACKAGES_DIR = previous;
      }
    }
  });

  it('decodes Windows Argos CLI output encoded as GB18030 without mojibake', () => {
    const bytes = Buffer.from([
      0xbb, 0xfa, 0xc6, 0xf7, 0xc8, 0xcb, 0xb5, 0xbc, 0xba, 0xbd, 0xb0, 0xb2, 0xc8, 0xab, 0xc7, 0xbf,
      0xbb, 0xaf, 0xd1, 0xa7, 0xcf, 0xb0
    ]);

    expect(decodeArgosCliOutput(bytes)).toBe('机器人导航安全强化学习');
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

  it('ignores mojibake rows already stored in SQLite cache and retranslates them', async () => {
    const dbPath = path.join(tempDir, 'arxiv-translation.sqlite');
    const request = {
      stableId: '2209.09079',
      title: 'MSVIPER: Improved Policy Distillation for Reinforcement-Learning-Based Robot Navigation',
      summary: 'We present policy distillation for robot navigation.'
    };
    const bootstrap = new ArxivTranslationService({
      dbPath,
      translateText: async (text) => (text.startsWith('MSVIPER') ? 'MSVIPER：改进策略蒸馏' : '提出机器人导航策略蒸馏方法。')
    });
    await bootstrap.translatePaper(request);
    bootstrap.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(
      `UPDATE arxiv_translation_cache
       SET title_zh = ?, abstract_zh = ?`
    ).run(
      'MSVIPER:��ǿ-ѧϰ-�����˵����Ľ����ߵ���',
      '���ǽ���ͨ��������ȡ(MSVIPER)���п���֤��ǿ��ѧϰ�Ķ������'
    );
    db.close();

    const calls: string[] = [];
    const service = new ArxivTranslationService({
      dbPath,
      translateText: async (text) => {
        calls.push(text);
        return text.startsWith('MSVIPER') ? 'MSVIPER：改进策略蒸馏' : '提出机器人导航策略蒸馏方法。';
      }
    });

    try {
      const result = await service.translatePaper(request);

      expect(result.status).toBe('completed');
      expect(result.cacheHit).toBe(false);
      expect(result.titleZh).toBe('MSVIPER：改进策略蒸馏');
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
