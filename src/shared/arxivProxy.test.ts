import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { parseArxivSearchResult } from './arxiv';
import {
  buildArxivHtmlFallbackUrl,
  buildArxivProxyUpstreamUrl,
  convertArxivSearchHtmlToAtom
} from './arxivProxy.mjs';

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

  it('builds a bounded official HTML-search fallback without forwarding arbitrary URLs', () => {
    const result = new URL(buildArxivHtmlFallbackUrl({
      fallback_query: 'safe reinforcement learning',
      fallback_category: 'cs.LG',
      sortBy: 'relevance',
      sortOrder: 'descending',
      url: 'https://example.com/private'
    }));
    expect(result.origin).toBe('https://arxiv.org');
    expect(result.pathname).toBe('/search/advanced');
    expect(result.searchParams.get('terms-0-term')).toBe('safe reinforcement learning');
    expect(result.searchParams.get('classification-computer_science')).toBe('y');
    expect(result.searchParams.get('order')).toBe('');
    expect(result.searchParams.get('url')).toBeNull();
  });

  it('converts official arXiv HTML results into the Atom shape used by the mobile reader', () => {
    const html = `
      <li class="arxiv-result">
        <p class="list-title"><a href="https://arxiv.org/abs/1910.00399">arXiv:1910.00399</a>
          <span>[<a href="https://arxiv.org/pdf/1910.00399">pdf</a>]</span>
        </p>
        <div class="tags"><span class="tag is-small">cs.LG</span></div>
        <p class="title is-5 mathjax">A <span class="search-hit">Review</span> of Safe RL</p>
        <p class="authors"><span>Authors:</span><a>Ada Lovelace</a>, <a>Alan Turing</a></p>
        <p class="abstract mathjax">
          <span class="abstract-full has-text-grey-dark mathjax"><span class="search-hit">A safe</span> learning <span class="search-hit">abstract</span>.</span>
        </p>
        <p class="is-size-7"><span>Submitted</span> 3 October, 2019;</p>
      </li>`;
    const atom = convertArxivSearchHtmlToAtom(html, { category: 'cs.LG', start: 0 });
    const parsed = parseArxivSearchResult(atom, DOMParser);
    expect(parsed.papers).toHaveLength(1);
    expect(parsed.papers[0]).toMatchObject({
      stableId: '1910.00399',
      title: 'A Review of Safe RL',
      authors: ['Ada Lovelace', 'Alan Turing'],
      summary: 'A safe learning abstract.',
      primaryCategory: 'cs.LG',
      pdfUrl: 'https://arxiv.org/pdf/1910.00399.pdf'
    });
  });
});
