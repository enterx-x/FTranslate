import type { AsyncOrSync, IpcMainLike } from './types';

export interface RuntimeIpcHandlerDependencies {
  getRuntimeCenterSnapshot: () => AsyncOrSync<unknown>;
  checkRuntimeCenter: () => AsyncOrSync<unknown>;
}

export function registerRuntimeIpcHandlers(ipcMain: IpcMainLike, deps: RuntimeIpcHandlerDependencies): void {
  ipcMain.handle('runtime-center:snapshot', async () => deps.getRuntimeCenterSnapshot());
  ipcMain.handle('runtime-center:check', async () => deps.checkRuntimeCenter());
}
