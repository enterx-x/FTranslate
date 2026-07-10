import type { AsyncOrSync, IpcMainLike } from './types';
import type {
  ArxivTitleAbstractTranslationRequest,
  ArxivTranslationBatchRequest,
  ArxivTranslationPriority
} from '../../../shared/arxiv';

export interface ArxivIpcHandlerDependencies {
  searchArxiv: (request: any) => AsyncOrSync<unknown>;
  translateArxivPaper: (request: any) => AsyncOrSync<unknown>;
  translateArxivPapers: (request: ArxivTranslationBatchRequest) => AsyncOrSync<unknown>;
  downloadArxivPdf: (request: any) => AsyncOrSync<unknown>;
}

const ARXIV_TRANSLATION_BATCH_LIMIT = 100;

function normalizeArxivTranslationPriority(value: unknown): ArxivTranslationPriority {
  switch (value) {
    case 'foreground':
    case 'background':
    case 'preview':
      return value;
    default:
      return 'preview';
  }
}

export function parseArxivTranslationBatchRequest(
  request: unknown
): ArxivTranslationBatchRequest {
  const rawPapers = Array.isArray(request)
    ? request
    : request && typeof request === 'object' && Array.isArray((request as { papers?: unknown }).papers)
      ? (request as { papers: unknown[] }).papers
      : [];
  const parsed: ArxivTranslationBatchRequest = {
    papers: rawPapers.slice(0, ARXIV_TRANSLATION_BATCH_LIMIT) as ArxivTitleAbstractTranslationRequest[],
    priority: normalizeArxivTranslationPriority(
      Array.isArray(request) || !request || typeof request !== 'object'
        ? undefined
        : (request as { priority?: unknown }).priority
    )
  };
  const sessionId =
    Array.isArray(request) || !request || typeof request !== 'object'
      ? undefined
      : (request as { sessionId?: unknown }).sessionId;
  if (typeof sessionId === 'number' && Number.isSafeInteger(sessionId) && sessionId >= 0) {
    parsed.sessionId = sessionId;
  }
  return parsed;
}

export function registerArxivIpcHandlers(ipcMain: IpcMainLike, deps: ArxivIpcHandlerDependencies): void {
  ipcMain.handle('arxiv:search', async (_event, request) => deps.searchArxiv(request));
  ipcMain.handle('arxiv:translate-title-abstract', async (_event, request) =>
    deps.translateArxivPaper(request)
  );
  ipcMain.handle('arxiv:translate-title-abstract-batch', async (_event, request) =>
    deps.translateArxivPapers(parseArxivTranslationBatchRequest(request))
  );
  ipcMain.handle('arxiv:download-pdf', async (_event, request) => deps.downloadArxivPdf(request));
}
