import { parsePdfTranslationProgress } from '../../shared/pdfTranslation';
import type { PdfTranslationProgress } from '../types/electron';

export type PdfBatchTranslationTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cached'
  | 'failed';

export interface PdfBatchTranslationTask {
  paperId: string;
  title: string;
  status: PdfBatchTranslationTaskStatus;
  message: string;
  percent: number | null;
  currentPage: number | null;
  totalPages: number | null;
}

export interface PdfBatchTranslationSummary {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  percent: number;
}

export function createPdfBatchTranslationTasks(
  papers: Array<{ id: string; title: string }>
): PdfBatchTranslationTask[] {
  return papers.map((paper) => ({
    paperId: paper.id,
    title: paper.title,
    status: 'queued',
    message: '等待进入翻译队列',
    percent: 0,
    currentPage: null,
    totalPages: null
  }));
}

export function applyPdfBatchTranslationProgress(
  task: PdfBatchTranslationTask,
  progress: Pick<PdfTranslationProgress, 'status' | 'message'>
): PdfBatchTranslationTask {
  const parsed = parsePdfTranslationProgress(progress.message);
  return {
    ...task,
    status: progress.status === 'completed'
      ? 'completed'
      : progress.status === 'failed'
        ? 'failed'
        : 'running',
    message: parsed.message || progress.message,
    percent: parsed.percent ?? (progress.status === 'completed' ? 100 : task.percent),
    currentPage: parsed.currentPage ?? task.currentPage,
    totalPages: parsed.totalPages ?? task.totalPages
  };
}

export function summarizePdfBatchTranslation(
  tasks: PdfBatchTranslationTask[]
): PdfBatchTranslationSummary {
  const completed = tasks.filter((task) => task.status === 'completed' || task.status === 'cached').length;
  const failed = tasks.filter((task) => task.status === 'failed').length;
  const running = tasks.filter((task) => task.status === 'running').length;
  const queued = tasks.filter((task) => task.status === 'queued').length;
  const progressTotal = tasks.reduce((sum, task) => {
    if (task.status === 'completed' || task.status === 'cached') return sum + 100;
    if (task.status === 'running') return sum + Math.max(2, task.percent ?? 0);
    return sum + (task.percent ?? 0);
  }, 0);

  return {
    total: tasks.length,
    queued,
    running,
    completed,
    failed,
    percent: tasks.length > 0 ? Math.round(progressTotal / tasks.length) : 0
  };
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  requestedConcurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.min(items.length, Math.max(1, Math.floor(requestedConcurrency) || 1));
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
}
