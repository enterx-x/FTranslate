import { describe, expect, it, vi } from 'vitest';
import { registerFileIpcHandlers } from './file';

describe('registerFileIpcHandlers', () => {
  it('registers a read-only file existence query and forwards only the request value', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fileExists = vi.fn(async (value: unknown) => value === 'D:/paper.pdf');
    const noop = () => null;

    registerFileIpcHandlers(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        }
      },
      {
        openExternalUrl: noop,
        fileExists,
        saveText: noop,
        saveTranslationCache: noop,
        exportMarkdown: noop,
        exportPptx: noop,
        exportFigureAssets: noop,
        exportResearchWorkbookToExcel: noop,
        importResearchWorkbookFromExcel: noop
      }
    );

    const handler = handlers.get('file:path-exists');
    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, 'D:/paper.pdf')).resolves.toBe(true);
    expect(fileExists).toHaveBeenCalledWith('D:/paper.pdf');
  });
});
