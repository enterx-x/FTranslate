import { describe, expect, it, vi } from 'vitest';
import { registerDictionaryIpcHandlers } from './dictionary';

describe('registerDictionaryIpcHandlers', () => {
  it('registers a bounded read-only word lookup channel', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const lookupEnglishWord = vi.fn(async (word: string) => ({ word }));
    registerDictionaryIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { lookupEnglishWord }
    );

    await handlers.get('dictionary:lookup-english')?.({}, 'model');
    await handlers.get('dictionary:lookup-english')?.({}, 'x'.repeat(65));

    expect(lookupEnglishWord).toHaveBeenNthCalledWith(1, 'model');
    expect(lookupEnglishWord).toHaveBeenNthCalledWith(2, '');
  });
});
