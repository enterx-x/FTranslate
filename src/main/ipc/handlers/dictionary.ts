import type { AsyncOrSync, IpcMainLike } from './types';

export interface DictionaryIpcHandlerDependencies {
  lookupEnglishWord: (word: string) => AsyncOrSync<unknown>;
}

export function registerDictionaryIpcHandlers(
  ipcMain: IpcMainLike,
  deps: DictionaryIpcHandlerDependencies
): void {
  ipcMain.handle('dictionary:lookup-english', async (_event, value) =>
    deps.lookupEnglishWord(typeof value === 'string' && value.length <= 64 ? value : '')
  );
}
