import { describe, expect, it } from 'vitest';
import { buildMobileWebArxivSearchUrl, buildMobileWebPdfUrl } from './mobileWeb';

describe('mobile web proxy URLs', () => {
  it('routes arXiv API query parameters through the local web origin', () => {
    const result = buildMobileWebArxivSearchUrl(
      'https://export.arxiv.org/api/query?search_query=all%3Arobot&start=0&max_results=20',
      'http://192.168.1.23:4174/'
    );

    expect(result).toBe(
      'http://192.168.1.23:4174/api/arxiv?search_query=all%3Arobot&start=0&max_results=20'
    );
  });

  it('adds a plain-language query and category for the official HTML fallback', () => {
    const result = new URL(buildMobileWebArxivSearchUrl(
      'https://export.arxiv.org/api/query?search_query=ti%3Arobot&start=0&max_results=20',
      'https://ftranslate-mobile.vercel.app/',
      { query: 'robot navigation', category: 'cs.RO' }
    ));
    expect(result.searchParams.get('fallback_query')).toBe('robot navigation');
    expect(result.searchParams.get('fallback_category')).toBe('cs.RO');
  });

  it('routes arXiv PDFs through the current web origin so Safari never depends on upstream CORS', () => {
    expect(
      buildMobileWebPdfUrl('https://arxiv.org/pdf/1706.03762.pdf', 'http://192.168.1.23:4174/')
    ).toBe('http://192.168.1.23:4174/api/arxiv-pdf/1706.03762');

    expect(
      buildMobileWebPdfUrl('https://arxiv.org/pdf/hep-th/9901001.pdf', 'https://ftranslate-mobile.vercel.app/')
    ).toBe('https://ftranslate-mobile.vercel.app/api/arxiv-pdf/hep-th/9901001');
  });

  it('does not proxy unrelated PDF hosts', () => {
    expect(
      buildMobileWebPdfUrl('https://papers.example.org/paper.pdf', 'http://192.168.1.23:4174/')
    ).toBe('https://papers.example.org/paper.pdf');
  });
});
