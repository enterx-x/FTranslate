import type { AsyncOrSync, IpcMainLike } from './types';

export interface CodeRepositoryIpcHandlerDependencies {
  selectCodeRepository: () => AsyncOrSync<unknown>;
  scanCodeRepository: (request: unknown) => AsyncOrSync<unknown>;
}

export function registerCodeRepositoryIpcHandlers(
  ipcMain: IpcMainLike,
  deps: CodeRepositoryIpcHandlerDependencies
): void {
  ipcMain.handle('code-repository:select', async () => deps.selectCodeRepository());
  ipcMain.handle('code-repository:scan', async (_event, request) => deps.scanCodeRepository(request));
}
