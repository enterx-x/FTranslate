import { describe, expect, it, vi } from 'vitest';
import { EnglishWordDictionaryService } from './wordDictionaryService';

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body)
  } as Response;
}

describe('EnglishWordDictionaryService', () => {
  it('fetches a validated word once and reuses the in-memory result', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => response(200, [{
      word: 'model',
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A representation.' }] }]
    }]));
    const service = new EnglishWordDictionaryService(fetchImpl as typeof fetch);

    await expect(service.lookup('Model')).resolves.toMatchObject({ status: 'found', entry: { word: 'model' } });
    await expect(service.lookup('model')).resolves.toMatchObject({ status: 'found' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/model');
  });

  it('handles invalid, missing and unavailable dictionary entries without throwing', async () => {
    const missing = new EnglishWordDictionaryService(async () => response(404, {}));
    await expect(missing.lookup('unknownword')).resolves.toMatchObject({ status: 'not-found' });

    const unavailable = new EnglishWordDictionaryService(async () => {
      throw new Error('offline');
    });
    await expect(unavailable.lookup('model')).resolves.toMatchObject({ status: 'unavailable' });
    await expect(unavailable.lookup('two words')).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('deduplicates concurrent lookups for the same word', async () => {
    const fetchImpl = vi.fn(async () => response(200, [{
      word: 'policy',
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A rule for choosing actions.' }] }]
    }]));
    const service = new EnglishWordDictionaryService(fetchImpl as typeof fetch);

    const [first, second] = await Promise.all([service.lookup('policy'), service.lookup('Policy')]);
    expect(first.status).toBe('found');
    expect(second.status).toBe('found');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
