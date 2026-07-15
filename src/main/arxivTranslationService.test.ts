import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArxivTranslationService,
  type ArxivTranslationPriority,
  buildArgosCombinedPayload,
  decodeArgosCliOutput,
  resolveArgosChildEnv,
  resolveArgosCliCommand,
  splitArgosCombinedOutput
} from './arxivTranslationService';

function preserveProtectedAcademicMarkers(source: string, translated: string): string {
  const markers = source.match(/\b86753\d{2}901\b/gu) ?? [];
  return `${markers.join(' ')} ${translated}`.trim();
}

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
    let currentTime = 1_764_000_000_000;
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateText: async (text) => {
        calls.push(text);
        currentTime += 125;
        return preserveProtectedAcademicMarkers(
          text,
          text.includes('A Perceptive')
            ? '：感知集成低层控制器'
            : '该摘要完整介绍了机器人导航中的强化学习方法、实验设置与主要研究结论。'
        );
      },
      now: () => currentTime
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
        abstractZh: '该摘要完整介绍了机器人导航中的强化学习方法、实验设置与主要研究结论。',
        engine: 'argos',
        status: 'completed',
        cacheHit: false,
        qualityStatus: 'passed',
        elapsedMs: 250
      });
      expect(first.titleZh).toContain('PILOT');
      expect(first.titleZh).toContain('低层控制器');
      expect(second).toMatchObject({
        titleZh: first.titleZh,
        abstractZh: first.abstractZh,
        engine: 'cache',
        status: 'cached',
        cacheHit: true,
        qualityStatus: 'passed',
        elapsedMs: 0
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
        return texts.map((text) =>
          preserveProtectedAcademicMarkers(text, '这是可用且完整的中文译文，涵盖研究方法、实验设置与主要研究结论。')
        );
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
          summary: 'The policy learns contact-rich manipulation from robot demonstrations with CBF.'
        }
      ];

      const first = await service.translatePapers(requests);
      const second = await service.translatePapers(requests);

      expect(first).toHaveLength(2);
      expect(first.every((item) => item.status === 'completed')).toBe(true);
      expect(second.every((item) => item.status === 'cached')).toBe(true);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(4);
      expect(batches[0]).toContain(requests[0].title);
      expect(batches[0]).toContain(requests[0].summary);
      expect(batches[0].some((text) => text.includes('The policy learns'))).toBe(true);
      expect(batches[0].some((text) => text.includes('CBF'))).toBe(true);
    } finally {
      service.close();
    }
  });

  it('reuses a validated fast title and sends only the abstract to the full translation pass', async () => {
    const batches: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        batches.push(texts);
        return texts.map(() => '这是完整的中文摘要，说明了研究方法、实验设置与主要结论。');
      }
    });

    try {
      const result = await service.translatePaper({
        stableId: '2606.13681',
        title: 'Safe Reinforcement Learning for Robot Navigation',
        summary: 'This study evaluates safe policies across reproducible robot navigation experiments.',
        pretranslatedTitleZh: '用于机器人导航的安全强化学习'
      });

      expect(result).toMatchObject({
        status: 'completed',
        titleZh: '用于机器人导航的安全强化学习'
      });
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
      expect(batches[0][0]).toContain('This study evaluates');
      expect(batches[0]).not.toContain('Safe Reinforcement Learning for Robot Navigation');
    } finally {
      service.close();
    }
  });

  it('runs a queued foreground translation before an earlier queued background translation', async () => {
    const starts: string[] = [];
    let releasePreview!: () => void;
    let markPreviewStarted!: () => void;
    const previewReleased = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    const previewStarted = new Promise<void>((resolve) => {
      markPreviewStarted = resolve;
    });
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        starts.push(texts[0]);
        if (texts[0] === 'Preview title') {
          markPreviewStarted();
          await previewReleased;
        }
        return texts.map(() => '这是可用的中文翻译结果，用于机器人学习研究。');
      }
    });
    const invokeWithPriority = (
      request: { stableId: string; title: string; summary: string },
      priority: ArxivTranslationPriority
    ) => service.translatePaper(request, { priority });

    try {
      const preview = invokeWithPriority(
        {
          stableId: 'preview-paper',
          title: 'Preview title',
          summary: 'Preview summary for the controlled running translation.'
        },
        'preview'
      );
      await previewStarted;

      const background = invokeWithPriority(
        {
          stableId: 'background-paper',
          title: 'Background title',
          summary: 'Background summary queued while preview translation is running.'
        },
        'background'
      );
      const foreground = invokeWithPriority(
        {
          stableId: 'foreground-paper',
          title: 'Foreground title',
          summary: 'Foreground summary queued while preview translation is running.'
        },
        'foreground'
      );

      expect(starts).toEqual(['Preview title']);

      releasePreview();
      await Promise.all([preview, foreground, background]);

      expect(starts).toEqual(['Preview title', 'Foreground title', 'Background title']);
    } finally {
      service.close();
    }
  });

  it('cancels queued preview and background jobs from an older search session', async () => {
    const starts: string[] = [];
    let releaseRunningJob!: () => void;
    let markRunningJobStarted!: () => void;
    const runningJobReleased = new Promise<void>((resolve) => {
      releaseRunningJob = resolve;
    });
    const runningJobStarted = new Promise<void>((resolve) => {
      markRunningJobStarted = resolve;
    });
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        starts.push(texts[0]);
        if (texts[0] === 'Old running title') {
          markRunningJobStarted();
          await runningJobReleased;
        }
        return texts.map(() => '这是可用且完整的中文翻译结果，用于机器人学习与安全控制研究。');
      }
    });

    try {
      const running = service.translatePaper(
        {
          stableId: 'old-running',
          title: 'Old running title',
          summary: 'The old preview job is already running and cannot be interrupted safely.'
        },
        { priority: 'preview', sessionId: 100 }
      );
      await runningJobStarted;

      const staleBackground = service.translatePaper(
        {
          stableId: 'old-background',
          title: 'Old background title',
          summary: 'This queued background job belongs to the superseded search session.'
        },
        { priority: 'background', sessionId: 100 }
      );
      await service.translatePapers([], { priority: 'preview', sessionId: 101 });
      const freshPreview = service.translatePaper(
        {
          stableId: 'new-preview',
          title: 'New preview title',
          summary: 'This preview belongs to the newest search session and should run next.'
        },
        { priority: 'preview', sessionId: 101 }
      );

      const staleResult = await staleBackground;
      expect(staleResult.status).toBe('failed');
      expect(staleResult.message).toContain('会话已更新');

      releaseRunningJob();
      await Promise.all([running, freshPreview]);
      expect(starts).toEqual(['Old running title', 'New preview title']);
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
        return texts.map((text) =>
          preserveProtectedAcademicMarkers(text, '这是完整的中文译文，涵盖研究方法、实验设置与主要研究结论。')
        );
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

  it('splits a long abstract for translation and restores every sentence in order', async () => {
    const batches: string[][] = [];
    const summary = Array.from(
      { length: 18 },
      (_, index) => `Sentence-${String(index).padStart(2, '0')} describes a reproducible experiment with ${'details '.repeat(9)}.`
    ).join(' ');
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        batches.push(texts);
        return texts.map((text) => `这是足够中文的译文：${text}`);
      }
    });

    try {
      const result = await service.translatePaper({
        stableId: 'long-abstract',
        title: 'Long translation title',
        summary
      });
      expect(result.status).toBe('completed');
      expect(batches).toHaveLength(1);
      expect(batches[0].length).toBeGreaterThan(2);
      expect(result.abstractZh).toContain('Sentence-00');
      expect(result.abstractZh).toContain('Sentence-17');
      expect(result.abstractZh.indexOf('Sentence-00')).toBeLessThan(result.abstractZh.indexOf('Sentence-17'));
    } finally {
      service.close();
    }
  });

  it('rejects a translation with missing protected placeholders without caching it', async () => {
    const batches: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        batches.push(texts);
        return texts.map(() => '这是看似可用但丢失保护对象的中文译文。');
      }
    });
    const request = {
      stableId: 'missing-protected-placeholder',
      title: 'PILOT: Safety-Critical Navigation',
      summary: 'We minimize $x^2$ with the CBF-MPC controller [1-3].'
    };

    try {
      const first = await service.translatePaper(request);
      const second = await service.translatePaper(request);

      expect(first.status).toBe('failed');
      expect(second.status).toBe('failed');
      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(false);
      expect(batches).toHaveLength(2);
    } finally {
      service.close();
    }
  });

  it('rejects severe abstract length loss instead of caching a truncated result', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) =>
        texts.map((_, index) => (index === 0 ? '这是标题的完整中文译文。' : '摘要过短。'))
    });
    const request = {
      stableId: 'truncated-abstract',
      title: 'Navigation study',
      summary: Array.from(
        { length: 16 },
        () => `This sentence explains a controlled reproducibility result with ${'important details '.repeat(14)}.`
      ).join(' ')
    };

    try {
      const result = await service.translatePaper(request);

      expect(result.status).toBe('failed');
      expect(result.cacheHit).toBe(false);
    } finally {
      service.close();
    }
  });

  it('rejects a short-but-truncated abstract instead of caching the title alone', async () => {
    const batches: string[][] = [];
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        batches.push(texts);
        return texts.map((_, index) => (index === 0 ? '这是标题的完整中文译文。' : '过短。'));
      }
    });
    const request = {
      stableId: 'short-truncated-abstract',
      title: 'Navigation study',
      summary: `This abstract reports ${'reproducible experimental detail '.repeat(5)}.`
    };

    try {
      const first = await service.translatePaper(request);
      const second = await service.translatePaper(request);

      expect(first.status).toBe('failed');
      expect(second.status).toBe('failed');
      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(false);
      expect(batches).toHaveLength(2);
    } finally {
      service.close();
    }
  });

  it('rejects cross-segment protected markers instead of caching a reordered abstract', async () => {
    const batches: string[][] = [];
    const summary =
      `We optimize $x^2$ with ${'first-phase detail '.repeat(38)}. ` +
      `We validate \\(${ 'E=mc^2' }\\) with ${'second-phase detail '.repeat(38)}.`;
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) => {
        batches.push(texts);
        const markersBySegment = texts.map((text) => text.match(/\b86753\d{2}901\b/gu) ?? []);
        const markedAbstractSegments = markersBySegment
          .map((markers, index) => ({ index, markers }))
          .filter(({ index, markers }) => index > 0 && markers.length > 0);
        const [firstMarkedSegment, secondMarkedSegment] = markedAbstractSegments;
        const translated = texts.map((text) =>
          preserveProtectedAcademicMarkers(text, '这是完整的中文译文，保留对应实验方法与验证细节。')
        );

        if (firstMarkedSegment && secondMarkedSegment) {
          translated[firstMarkedSegment.index] = translated[firstMarkedSegment.index].replace(
            firstMarkedSegment.markers[0],
            secondMarkedSegment.markers[0]
          );
          translated[secondMarkedSegment.index] = translated[secondMarkedSegment.index].replace(
            secondMarkedSegment.markers[0],
            firstMarkedSegment.markers[0]
          );
        }
        return translated;
      }
    });
    const request = {
      stableId: 'cross-segment-protected-marker',
      title: 'Navigation study',
      summary
    };

    try {
      const first = await service.translatePaper(request);
      const second = await service.translatePaper(request);

      expect(first.status).toBe('failed');
      expect(second.status).toBe('failed');
      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(false);
      expect(batches).toHaveLength(2);
      expect(batches[0].length).toBeGreaterThan(2);
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
        texts.map((text, index) =>
          index === 0 ? text : '本文完整研究机器人操作中的触觉感知方法，并报告实验设置、评价指标与主要结论。'
        )
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
      expect(result.abstractZh).toBe(
        '本文完整研究机器人操作中的触觉感知方法，并报告实验设置、评价指标与主要结论。'
      );
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
      translateTexts: async () => [
        '机器人导航与学习动力学旧译文',
        '这是用于初始化缓存的完整旧摘要译文，涵盖研究方法、实验设置与主要研究结论。'
      ]
    });
    try {
      const seeded = await bootstrap.translatePaper(request);
      expect(seeded.status).toBe('completed');
    } finally {
      bootstrap.close();
    }

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
        return [
          '机器人导航与学习动力学',
          '本文完整研究学习动力学下的机器人导航方法，并报告实验设置、评价指标与主要结论。'
        ];
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
          texts: texts.map((text) =>
            preserveProtectedAcademicMarkers(text, '这是NLLB生成的完整中文译文，涵盖研究方法、实验设置与主要研究结论。')
          ),
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
        texts: texts.map((text) =>
          preserveProtectedAcademicMarkers(text, '这是Argos生成的完整中文译文，涵盖研究方法、实验设置与主要研究结论。')
        ),
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
        title: 'Robot control study',
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
      expect(result.qualityStatus).toBe('failed');
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
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
      expect(results.every((item) => item.qualityStatus === 'not-checked')).toBe(true);
      expect(results.every((item) => item.elapsedMs >= 0)).toBe(true);
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
      expect(result.qualityStatus).toBe('failed');
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.titleZh).toBe('');
      expect(result.abstractZh).toBe('');
    } finally {
      service.close();
    }
  });

  it('repairs protected academic terms and repeated tails before caching arXiv translations', async () => {
    const service = new ArxivTranslationService({
      dbPath: path.join(tempDir, 'arxiv-translation.sqlite'),
      translateTexts: async (texts) =>
        texts.map((text, index) =>
          preserveProtectedAcademicMarkers(
            text,
            index === 0 ? '：用于全模态理解的主动感知' : '我们提出一种用于机器人主动感知的代理。代理代理代理代理'
          )
        )
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
      expect(first.titleZh).toContain('OmniAgent');
      expect(first.titleZh).toContain('全模态');
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
      translateText: async (text) =>
        preserveProtectedAcademicMarkers(
          text,
          text.includes('Improved Policy') ? '：改进策略蒸馏' : '提出机器人导航策略蒸馏方法。'
        )
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
        return preserveProtectedAcademicMarkers(
          text,
          text.includes('Improved Policy') ? '：改进策略蒸馏' : '提出机器人导航策略蒸馏方法。'
        );
      }
    });

    try {
      const result = await service.translatePaper(request);

      expect(result.status).toBe('completed');
      expect(result.cacheHit).toBe(false);
      expect(result.titleZh).toContain('MSVIPER');
      expect(result.titleZh).toContain('改进策略蒸馏');
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
      expect(result.qualityStatus).toBe('not-checked');
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.message).toContain('离线翻译未配置');
      expect(result.message).toContain('查看 README');
      expect(result.message).toContain('稍后重试');
    } finally {
      service.close();
    }
  });
});
