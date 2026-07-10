import { describe, expect, it, vi } from 'vitest';
import type { ArxivTitleAbstractTranslationRequest } from '../../../shared/arxiv';
import {
  parseArxivTranslationBatchRequest,
  registerArxivIpcHandlers
} from './arxiv';

const paper: ArxivTitleAbstractTranslationRequest = {
  stableId: '2401.00001',
  title: 'Safe reinforcement learning',
  summary: 'A safety-constrained reinforcement-learning method.',
  targetLanguage: 'zh'
};

describe('parseArxivTranslationBatchRequest', () => {
  it('keeps valid priority and session metadata on object requests', () => {
    expect(
      parseArxivTranslationBatchRequest({
        papers: [paper],
        priority: 'preview',
        sessionId: 7
      })
    ).toEqual({ papers: [paper], priority: 'preview', sessionId: 7 });
  });

  it('keeps legacy raw-array requests compatible and clamps batches to 100 papers', () => {
    const papers = Array.from({ length: 105 }, (_, index) => ({
      ...paper,
      stableId: `2401.${String(index).padStart(5, '0')}`
    }));

    const parsed = parseArxivTranslationBatchRequest(papers);

    expect(parsed.papers).toHaveLength(100);
    expect(parsed.priority).toBe('preview');
    expect(parsed.sessionId).toBeUndefined();
  });

  it.each([
    ['object request', (papers: unknown[]) => ({ papers })],
    ['legacy array', (papers: unknown[]) => papers]
  ])('filters invalid paper entries from a mixed %s without throwing', (_label, buildRequest) => {
    const request = buildRequest([null, 1, {}, [], paper]);

    expect(() => parseArxivTranslationBatchRequest(request)).not.toThrow();
    expect(parseArxivTranslationBatchRequest(request).papers).toEqual([paper]);
  });

  it('collects at most the first 100 valid papers instead of letting invalid entries consume the limit', () => {
    const validPapers = Array.from({ length: 105 }, (_, index) => ({
      ...paper,
      stableId: `valid-${index}`
    }));
    const parsed = parseArxivTranslationBatchRequest({
      papers: [...Array.from({ length: 120 }, () => null), ...validPapers]
    });

    expect(parsed.papers).toHaveLength(100);
    expect(parsed.papers[0]?.stableId).toBe('valid-0');
    expect(parsed.papers[99]?.stableId).toBe('valid-99');
  });

  it.each([
    null,
    undefined,
    'papers',
    1,
    {},
    { papers: null },
    { papers: 'not-an-array' }
  ])('safely normalizes invalid paper payloads %#', (request) => {
    expect(parseArxivTranslationBatchRequest(request)).toEqual({
      papers: [],
      priority: 'preview'
    });
  });

  it.each(['urgent', '', 1, null])('defaults invalid priority %p to preview', (priority) => {
    expect(parseArxivTranslationBatchRequest({ papers: [paper], priority }).priority).toBe(
      'preview'
    );
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '7', null])(
    'removes invalid session ID %p',
    (sessionId) => {
      expect(
        parseArxivTranslationBatchRequest({ papers: [paper], sessionId }).sessionId
      ).toBeUndefined();
    }
  );
});

describe('registerArxivIpcHandlers', () => {
  it('passes normalized batch metadata through the IPC dependency boundary', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    const translateArxivPapers = vi.fn(async () => ['translated']);
    registerArxivIpcHandlers(
      {
        handle(channel, listener) {
          listeners.set(channel, listener);
        }
      },
      {
        searchArxiv: vi.fn(),
        translateArxivPaper: vi.fn(),
        translateArxivPapers,
        downloadArxivPdf: vi.fn()
      }
    );

    const result = await listeners.get('arxiv:translate-title-abstract-batch')?.(
      {},
      { papers: [paper], priority: 'foreground', sessionId: 12 }
    );

    expect(translateArxivPapers).toHaveBeenCalledWith({
      papers: [paper],
      priority: 'foreground',
      sessionId: 12
    });
    expect(result).toEqual(['translated']);
  });

  it('normalizes a legacy raw-array request before forwarding it', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    const translateArxivPapers = vi.fn(async () => []);
    registerArxivIpcHandlers(
      {
        handle(channel, listener) {
          listeners.set(channel, listener);
        }
      },
      {
        searchArxiv: vi.fn(),
        translateArxivPaper: vi.fn(),
        translateArxivPapers,
        downloadArxivPdf: vi.fn()
      }
    );

    await listeners.get('arxiv:translate-title-abstract-batch')?.({}, [paper]);

    expect(translateArxivPapers).toHaveBeenCalledWith({
      papers: [paper],
      priority: 'preview'
    });
  });
});
