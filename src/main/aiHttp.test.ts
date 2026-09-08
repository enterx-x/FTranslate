import { describe, expect, it, vi } from 'vitest';
import { fetchAiText } from './aiHttp';

describe('AI HTTP timeout', () => {
  it('aborts when headers arrive but the body never finishes', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchImpl = vi.fn(async (_url: string | URL, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return {
          ok: true, status: 200,
          text: () => new Promise<string>((_resolve, reject) => {
            signal!.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
          })
        } as Response;
      });
      const request = fetchAiText('https://example.invalid', {}, 1000, fetchImpl as typeof fetch);
      const assertion = expect(request).rejects.toThrow('body aborted');
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('returns HTTP status and body and clears the timer on completion', async () => {
    vi.useFakeTimers();
    try {
      const result = await fetchAiText('https://example.invalid', {}, 1000,
        (async () => new Response('upstream error', { status: 502 })) as typeof fetch);
      expect(result).toEqual({ ok: false, status: 502, text: 'upstream error' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
