import type { AsyncOrSync, IpcMainLike } from './types';

export interface PdfIpcHandlerDependencies {
  checkPdfTranslationEngine: () => AsyncOrSync<unknown>;
  translatePdfWithSidecar: (request: any) => AsyncOrSync<unknown>;
  handlePdfTranslationError: (request: any, error: unknown) => void;
  openPdfDialog: () => AsyncOrSync<unknown>;
  openTranslationDialog: () => AsyncOrSync<unknown>;
  openTranslatedPdfDialog: () => AsyncOrSync<unknown>;
  selectDirectoryDialog: (request: any) => AsyncOrSync<unknown>;
  exportPdf: (request: any) => AsyncOrSync<unknown>;
}

export function registerPdfIpcHandlers(ipcMain: IpcMainLike, deps: PdfIpcHandlerDependencies): void {
  ipcMain.handle('pdf-translation:check-engine', async () => deps.checkPdfTranslationEngine());
  ipcMain.handle('pdf-translation:translate', async (_event, request) => {
    try {
      return await deps.translatePdfWithSidecar(request);
    } catch (error) {
      deps.handlePdfTranslationError(request, error);
      throw error;
    }
  });
  ipcMain.handle('dialog:open-pdf', async () => deps.openPdfDialog());
  ipcMain.handle('dialog:open-translation', async () => deps.openTranslationDialog());
  ipcMain.handle('dialog:open-translated-pdf', async () => deps.openTranslatedPdfDialog());
  ipcMain.handle('dialog:select-directory', async (_event, request) => deps.selectDirectoryDialog(request));
  ipcMain.handle('file:export-pdf', async (_event, request) => deps.exportPdf(request));
}
