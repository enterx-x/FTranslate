import { describe, expect, it } from 'vitest';
import type { ArxivPaper } from '../lib/arxivClient';
import type { ArxivPaperMeta } from '../lib/arxivUi';
import {
  buildArxivQueuedPaper,
  getArxivResultDensityConfig,
  getArxivResultDisplay,
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

  it('maps layout modes to different result-list density settings', () => {
    expect(getArxivResultDensityConfig('compact')).toMatchObject({
      className: 'arxiv-density-compact',
      summaryLines: 2
    });
    expect(getArxivResultDensityConfig('standard')).toMatchObject({
      className: 'arxiv-density-standard',
      summaryLines: 3
    });
    expect(getArxivResultDensityConfig('wide')).toMatchObject({
      className: 'arxiv-density-wide',
      summaryLines: 4
    });
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
});
