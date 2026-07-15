import { describe, expect, it } from 'vitest';
import { buildArxivProxyUpstreamUrl } from './arxivProxy.mjs';

describe('arXiv public proxy validation', () => {
  it('forwards only the supported arXiv parameters', () => {
    const result = new URL(buildArxivProxyUpstreamUrl({
      search_query: 'ti:"safe reinforcement learning"',
      start: '20',
      max_results: '20',
      sortBy: 'relevance',
      sortOrder: 'ascending',
      url: 'https://example.com/private'
    }));

    expect(result.origin).toBe('https://export.arxiv.org');
    expect(result.pathname).toBe('/api/query');
    expect(result.searchParams.get('search_query')).toBe('ti:"safe reinforcement learning"');
    expect(result.searchParams.get('url')).toBeNull();
  });

  it('uses bounded defaults', () => {
    const result = new URL(buildArxivProxyUpstreamUrl({ search_query: 'all:robot' }));
    expect(result.searchParams.get('start')).toBe('0');
    expect(result.searchParams.get('max_results')).toBe('20');
    expect(result.searchParams.get('sortBy')).toBe('submittedDate');
    expect(result.searchParams.get('sortOrder')).toBe('descending');
  });

  it('rejects oversized result requests', () => {
    expect(() => buildArxivProxyUpstreamUrl({
      search_query: 'all:robot',
      max_results: '200'
    })).toThrow('max_results');
  });
});
