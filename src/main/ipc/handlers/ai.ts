import type { AsyncOrSync, IpcMainLike } from './types';

export interface AiIpcHandlerDependencies {
  loadAiSettings: () => AsyncOrSync<unknown>;
  saveAiSettings: (request: any) => AsyncOrSync<unknown>;
  translateWithAi: (request: any) => AsyncOrSync<unknown>;
  completeWithAi: (request: any) => AsyncOrSync<unknown>;
  fillSheetCellWithAi: (request: any) => AsyncOrSync<unknown>;
  fillSheetCellsWithAi: (request: any) => AsyncOrSync<unknown>;
  analyzeLiteratureWithAi: (request: any) => AsyncOrSync<unknown>;
  testAiConnection: () => AsyncOrSync<unknown>;
  getAiBalance: () => AsyncOrSync<unknown>;
  getAiModels: () => AsyncOrSync<unknown>;
  getLocalTranslationStatus: () => AsyncOrSync<unknown>;
  checkLocalTranslationInstall: () => AsyncOrSync<unknown>;
  warmUpNllbTranslator: () => AsyncOrSync<unknown>;
  translateWithLocalEngine: (request: any) => AsyncOrSync<unknown>;
}

export function registerAiIpcHandlers(ipcMain: IpcMainLike, deps: AiIpcHandlerDependencies): void {
  ipcMain.handle('ai-settings:load', async () => deps.loadAiSettings());
  ipcMain.handle('ai-settings:save', async (_event, request) => deps.saveAiSettings(request));
  ipcMain.handle('ai:translate', async (_event, request) => deps.translateWithAi(request));
  ipcMain.handle('ai:complete', async (_event, request) => deps.completeWithAi(request));
  ipcMain.handle('ai:fill-sheet-cell', async (_event, request) => deps.fillSheetCellWithAi(request));
  ipcMain.handle('ai:fill-sheet-cells', async (_event, request) => deps.fillSheetCellsWithAi(request));
  ipcMain.handle('ai:analyze-literature', async (_event, request) => deps.analyzeLiteratureWithAi(request));
  ipcMain.handle('ai:test-connection', async () => deps.testAiConnection());
  ipcMain.handle('ai:balance', async () => deps.getAiBalance());
  ipcMain.handle('ai:models', async () => deps.getAiModels());
  ipcMain.handle('local-translation:status', async () => deps.getLocalTranslationStatus());
  ipcMain.handle('local-translation:install-check', async () => deps.checkLocalTranslationInstall());
  ipcMain.handle('local-translation:warmup', async () => deps.warmUpNllbTranslator());
  ipcMain.handle('local-translation:translate-batch', async (_event, request) =>
    deps.translateWithLocalEngine(request)
  );
}
