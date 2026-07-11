import type { AsyncOrSync, IpcMainLike } from './types';

export interface FileIpcHandlerDependencies {
  openExternalUrl: (url: unknown) => AsyncOrSync<unknown>;
  fileExists: (filePath: unknown) => AsyncOrSync<boolean>;
  saveText: (request: any) => AsyncOrSync<unknown>;
  saveTranslationCache: (request: any) => AsyncOrSync<unknown>;
  exportMarkdown: (request: any) => AsyncOrSync<unknown>;
  exportPptx: (request: any) => AsyncOrSync<unknown>;
  exportResearchWorkbookToExcel: (request: any) => AsyncOrSync<unknown>;
  importResearchWorkbookFromExcel: () => AsyncOrSync<unknown>;
}

export function registerFileIpcHandlers(ipcMain: IpcMainLike, deps: FileIpcHandlerDependencies): void {
  ipcMain.handle('shell:open-external-url', async (_event, url) => deps.openExternalUrl(url));
  ipcMain.handle('file:path-exists', async (_event, filePath) => deps.fileExists(filePath));
  ipcMain.handle('file:save-text', async (_event, request) => deps.saveText(request));
  ipcMain.handle('file:save-translation-cache', async (_event, request) => deps.saveTranslationCache(request));
  ipcMain.handle('file:export-markdown', async (_event, request) => deps.exportMarkdown(request));
  ipcMain.handle('file:export-pptx', async (_event, request) => deps.exportPptx(request));
  ipcMain.handle('research-workbook:export-excel', async (_event, request) =>
    deps.exportResearchWorkbookToExcel(request)
  );
  ipcMain.handle('research-workbook:import-excel', async () => deps.importResearchWorkbookFromExcel());
}
