import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArxivTranslationService,
  buildArgosCombinedPayload,
  decodeArgosCliOutput,
  resolveArgosChildEnv,
  resolveArgosCliCommand,
  splitArgosCombinedOutput
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

  it('prefers GB18030 when GB bytes are also syntactically valid UTF-8', () => {
    expect(decodeArgosCliOutput(Buffer.from([0xd2, 0xbb]))).toBe('一');
  });

  it('keeps valid UTF-8 output even when it contains non-ASCII Latin characters', () => {
    const bytes = Buffer.from('保留 Ñ 与 Â 标识', 'utf8');

    expect(decodeArgosCliOutput(bytes)).toBe('保留 Ñ 与 Â 标识');
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

  it('translates multiple uncached papers through one batch translator call', async () => {
    const batches: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        batches.push(texts);
        return texts.map((text) => `ZH:${text.slice(0, 18)}`);
      },
      now: () => 1_764_000_000_000
    });

    try {
      const requests = [
        {
          stableId: '2606.13679',
          title: 'Robot tactile navigation with haptic sensing',
          summary: 'We use tactile sensing and haptic feedback for robot navigation.'
        },
        {
          stableId: '2606.13680',
          title: 'Contact-rich manipulation with reinforcement learning',
          summary: 'The policy learns contact-rich manipulation from robot demonstrations.'
        }
      ];

      const first = await service.translatePapers(requests);
      const second = await service.translatePapers(requests);

      expect(first).toHaveLength(2);
      expect(first.every((item) => item.status === 'completed')).toBe(true);
      expect(second.every((item) => item.status === 'cached')).toBe(true);
      expect(batches).toEqual([
        [
          requests[0].title,
          requests[0].summary,
          requests[1].title,
          requests[1].summary
        ]
      ]);
    } finally {
      service.close();
    }
  });

  it('deduplicates repeated texts before sending a batch to the local translator', async () => {
    const batches: string[][] = [];
    const sharedSummary = 'This shared abstract studies safe robot navigation and obstacle avoidance.';
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        batches.push(texts);
        return texts.map((text) => `ZH:${text.slice(0, 18)}`);
      },
      now: () => 1_764_000_000_000
    });

    try {
      const requests = [
        {
          stableId: '2606.13679',
          title: 'Safe Robot Navigation',
          summary: sharedSummary
        },
        {
          stableId: '2606.13680',
          title: 'Obstacle Avoidance for Mobile Robots',
          summary: sharedSummary
        }
      ];

      const results = await service.translatePapers(requests);

      expect(results.every((item) => item.status === 'completed')).toBe(true);
      expect(batches).toEqual([
        [
          requests[0].title,
          sharedSummary,
          requests[1].title
        ]
      ]);
      expect(results[0].abstractZh).toBe(results[1].abstractZh);
    } finally {
      service.close();
    }
  });

  it('rejects untranslated English echo output instead of caching it', async () => {
    const calls: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        calls.push(texts);
        return texts;
      }
    });

    try {
      const request = {
        stableId: 'echo-output',
        title: 'Tactile Sensing for Robot Manipulation',
        summary: 'This paper studies tactile sensing and robot manipulation.'
      };
      const first = await service.translatePaper(request);
      const second = await service.translatePaper(request);

      expect(first.status).toBe('failed');
      expect(first.cacheHit).toBe(false);
      expect(second.status).toBe('failed');
      expect(second.cacheHit).toBe(false);
      expect(calls).toHaveLength(2);
    } finally {
      service.close();
    }
  });

  it('keeps a translated abstract when the local translator only echoes the title', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) =>
        texts.map((text, index) => (index === 0 ? text : '本文研究机器人操作中的触觉感知方法。'))
    });

    try {
      const result = await service.translatePaper({
        stableId: 'partial-title-echo',
        title: 'TACTO: A Benchmark for Tactile Robot Manipulation',
        summary: 'This paper studies tactile perception for robot manipulation.'
      });
      const cached = await service.translatePaper({
        stableId: 'partial-title-echo',
        title: 'TACTO: A Benchmark for Tactile Robot Manipulation',
        summary: 'This paper studies tactile perception for robot manipulation.'
      });

      expect(result.status).toBe('completed');
      expect(result.titleZh).toBe('');
      expect(result.abstractZh).toBe('本文研究机器人操作中的触觉感知方法。');
      expect(cached.status).toBe('cached');
      expect(cached.abstractZh).toBe(result.abstractZh);
    } finally {
      service.close();
    }
  });

  it('drops cached English echo rows and retranslates them on manual retry', async () => {
    const dbPath = path.join(tempDir, 'arxiv-translation.sqlite');
    const request = {
      stableId: 'old-echo-cache',
      title: 'Robot Navigation with Learned Dynamics',
      summary: 'This paper studies robot navigation with learned dynamics.'
    };
    const bootstrap = new ArxivTranslationService({
      dbPath,
      translateTexts: async () => ['机器人导航与学习动力学旧译文', '旧摘要译文。']
    });
    const seeded = await bootstrap.translatePaper(request);
    expect(seeded.status).toBe('completed');
    bootstrap.close();

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        `UPDATE arxiv_translation_cache
         SET stable_id = ?,
             source_title = ?,
             source_summary = ?,
             title_zh = ?,
             abstract_zh = ?,
             translated_at = ?,
             engine = ?`
      ).run(
        request.stableId,
        request.title,
        request.summary,
        request.title,
        request.summary,
        '2026-06-18T00:00:00.000Z',
        'nllb-ct2-int8'
      );
    } finally {
      db.close();
    }

    const calls: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath,
      translateTexts: async (texts) => {
        calls.push(texts);
        return ['机器人导航与学习动力学', '本文研究学习动力学下的机器人导航。'];
      }
    });

    try {
      const result = await service.translatePaper(request);

      expect(result.status).toBe('completed');
      expect(result.cacheHit).toBe(false);
      expect(result.titleZh).toBe('机器人导航与学习动力学');
      expect(calls).toHaveLength(1);
    } finally {
      service.close();
    }
  });

  it('stores the concrete NLLB engine name when the NLLB translator succeeds', async () => {
    const batches: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTextsWithEngine: async (texts) => {
        batches.push(texts);
        return {
          texts: texts.map((text) => `NLLB:${text.slice(0, 16)}`),
          engine: 'nllb-ct2-int8'
        };
      },
      now: () => 1_764_000_000_000
    });

    try {
      const request = {
        stableId: '2606.13679',
        title: 'Robot tactile navigation with haptic sensing',
        summary: 'We use tactile sensing and haptic feedback for robot navigation.'
      };
      const first = await service.translatePaper(request);
      const second = await service.translatePaper(request);

      expect(first).toMatchObject({
        stableId: '2606.13679',
        engine: 'nllb-ct2-int8',
        status: 'completed',
        cacheHit: false
      });
      expect(second).toMatchObject({
        engine: 'cache',
        status: 'cached',
        cacheHit: true
      });
      expect(batches).toEqual([[request.title, request.summary]]);
    } finally {
      service.close();
    }
  });

  it('falls back to Argos when the preferred NLLB translator fails', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTextsWithEngine: async () => {
        throw new Error('NLLB worker unavailable');
      },
      fallbackTranslateTextsWithEngine: async (texts) => ({
        texts: texts.map((text) => `ARGOS:${text.slice(0, 16)}`),
        engine: 'argos'
      }),
      now: () => 1_764_000_000_000
    });

    try {
      const result = await service.translatePaper({
        stableId: 'fallback-paper',
        title: 'Reinforcement learning robot navigation',
        summary: 'The paper studies robot navigation with reinforcement learning.'
      });

      expect(result.status).toBe('completed');
      expect(result.engine).toBe('argos');
      expect(result.message).toContain('Argos');
    } finally {
      service.close();
    }
  });

  it('falls back to Argos before caching when NLLB returns a repeated abstract tail', async () => {
    const primaryCalls: string[][] = [];
    const fallbackCalls: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTextsWithEngine: async (texts) => {
        primaryCalls.push(texts);
        return {
          texts: [
            '触觉机器人控制',
            '我们提出一种触觉机器人控制方法。该系统显著提高了闭环控制稳定性，该系统显著提高了闭环控制稳定性。'
          ],
          engine: 'nllb-ct2-int8'
        };
      },
      fallbackTranslateTextsWithEngine: async (texts) => {
        fallbackCalls.push(texts);
        return {
          texts: ['触觉机器人控制', '我们提出一种触觉机器人控制方法，并显著提高了闭环控制稳定性。'],
          engine: 'argos'
        };
      }
    });

    try {
      const request = {
        stableId: 'repeated-nllb-tail',
        title: 'Tactile Robot Control',
        summary: 'We propose a tactile robot control method that improves control stability.'
      };
      const result = await service.translatePaper(request);
      const cached = await service.translatePaper(request);

      expect(result.status).toBe('completed');
      expect(result.engine).toBe('argos');
      expect(result.abstractZh).toBe('我们提出一种触觉机器人控制方法，并显著提高了闭环控制稳定性。');
      expect(cached.status).toBe('cached');
      expect(cached.abstractZh).toBe(result.abstractZh);
      expect(primaryCalls).toHaveLength(1);
      expect(fallbackCalls).toHaveLength(1);
    } finally {
      service.close();
    }
  });

  it('rejects mojibake returned by NLLB instead of caching it', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTextsWithEngine: async () => ({
        texts: [
          '锟斤拷锟斤拷锟斤拷锟斤拷',
          '锟斤拷锟斤拷锟斤拷锟斤拷锟斤拷锟斤拷锟斤拷'
        ],
        engine: 'nllb-ct2-int8'
      })
    });

    try {
      const result = await service.translatePaper({
        stableId: 'bad-nllb',
        title: 'Robot navigation',
        summary: 'The paper studies robot navigation.'
      });

      expect(result.status).toBe('failed');
      expect(result.cacheHit).toBe(false);
      expect(result.engine).toBe('unavailable');
    } finally {
      service.close();
    }
  });

  it('returns failed rows instead of throwing for malformed batch items', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async () => {
        throw new Error('translator should not be called for invalid items');
      }
    });

    try {
      const results = await service.translatePapers([
        { stableId: '2606.00001', title: 'Robot Navigation', summary: '' },
        { stableId: null, title: 42, summary: undefined } as unknown as {
          stableId: string;
          title: string;
          summary: string;
        }
      ]);

      expect(results).toHaveLength(2);
      expect(results.every((item) => item.status === 'failed')).toBe(true);
      expect(results[0].message).toContain('缺少');
    } finally {
      service.close();
    }
  });

  it('rejects repetitive low-quality Argos output instead of caching it', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async () => ['互出互出互出互出', '互出互出互出互出互出互出']
    });

    try {
      const [result] = await service.translatePapers([
        {
          stableId: 'bad-translation',
          title: 'Interleaved robotic generation',
          summary: 'The paper studies robot navigation and embodied interaction.'
        }
      ]);

      expect(result.status).toBe('failed');
      expect(result.cacheHit).toBe(false);
      expect(result.titleZh).toBe('');
      expect(result.abstractZh).toBe('');
    } finally {
      service.close();
    }
  });

  it('repairs protected academic terms and repeated tails before caching arXiv translations', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async () => [
        '奥姆尼代理：用于全模态理解的主动感知',
        '我们提出一种用于机器人主动感知的代理。代理代理代理代理'
      ]
    });

    try {
      const request = {
        stableId: 'protected-term-repair',
        title: 'OmniAgent: Native Active Perception as Reasoning for Omni-Modal Understanding',
        summary: 'We introduce OmniAgent for robot active perception and Sim-to-Real transfer.'
      };
      const first = await service.translatePaper(request);
      const cached = await service.translatePaper(request);

      expect(first.status).toBe('completed');
      expect(first.titleZh).toBe('OmniAgent：用于全模态理解的主动感知');
      expect(first.abstractZh).toContain('OmniAgent');
      expect(first.abstractZh).toContain('Sim-to-Real');
      expect(first.abstractZh.endsWith('代理代理代理代理')).toBe(false);
      expect(cached.status).toBe('cached');
      expect(cached.titleZh).toBe(first.titleZh);
      expect(cached.abstractZh).toBe(first.abstractZh);
    } finally {
      service.close();
    }
  });

  it('combines Argos inputs into one inference and restores every translated segment', () => {
    const payload = buildArgosCombinedPayload([
      'Tactile sensing for robot manipulation',
      'We study tactile perception for dexterous robots.',
      'Reinforcement learning for robot navigation'
    ]);
    const translated = [
      '用于机器人操纵的触觉传感',
      `${payload.markers[0]} (中文(简体) ).`,
      '我们研究灵巧机器人的触觉感知。',
      `${payload.markers[1]} (英语).`,
      '机器人导航强化学习'
    ].join('\n\n');

    expect(splitArgosCombinedOutput(translated, payload.markers, 3)).toEqual([
      '用于机器人操纵的触觉传感',
      '我们研究灵巧机器人的触觉感知。',
      '机器人导航强化学习'
    ]);
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
