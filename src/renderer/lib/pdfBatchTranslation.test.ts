import { describe, expect, it } from 'vitest';
import {
  applyPdfBatchTranslationProgress,
  createPdfBatchTranslationTasks,
  runWithConcurrency,
  summarizePdfBatchTranslation
} from './pdfBatchTranslation';

describe('pdfBatchTranslation', () => {
  it('parses per-paper progress and summarizes overall progress', () => {
    const [queued] = createPdfBatchTranslationTasks([{ id: 'paper-1', title: 'Paper 1' }]);
    const running = applyPdfBatchTranslationProgress(queued, {
      status: 'running',
      message: 'PDF 翻译进度：38%，15/39 页'
    });

    expect(running).toMatchObject({ percent: 38, currentPage: 15, totalPages: 39 });
    expect(summarizePdfBatchTranslation([running])).toMatchObject({
      total: 1,
      running: 1,
      percent: 38
    });
  });

  it('never exceeds the requested worker concurrency', async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      completed.push(item);
      active -= 1;
    });

    expect(peak).toBe(2);
    expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
