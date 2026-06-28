import type { AsyncOrSync, IpcMainLike } from './types';

export interface ArxivIpcHandlerDependencies {
  searchArxiv: (request: any) => AsyncOrSync<unknown>;
  translateArxivPaper: (request: any) => AsyncOrSync<unknown>;
  translateArxivPapers: (request: any) => AsyncOrSync<unknown>;
  downloadArxivPdf: (request: any) => AsyncOrSync<unknown>;
}

export function registerArxivIpcHandlers(ipcMain: IpcMainLike, deps: ArxivIpcHandlerDependencies): void {
  ipcMain.handle('arxiv:search', async (_event, request) => deps.searchArxiv(request));
  ipcMain.handle('arxiv:translate-title-abstract', async (_event, request) =>
    deps.translateArxivPaper(request)
  );
  ipcMain.handle('arxiv:translate-title-abstract-batch', async (_event, request) =>
    deps.translateArxivPapers(request)
  );
  ipcMain.handle('arxiv:download-pdf', async (_event, request) => deps.downloadArxivPdf(request));
}
