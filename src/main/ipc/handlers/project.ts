import type { AsyncOrSync, IpcMainLike } from './types';

export interface ProjectIpcHandlerDependencies {
  loadProject: (request: any) => AsyncOrSync<unknown>;
}

export function registerProjectIpcHandlers(ipcMain: IpcMainLike, deps: ProjectIpcHandlerDependencies): void {
  ipcMain.handle('project:load', async (_event, request) => deps.loadProject(request));
}
