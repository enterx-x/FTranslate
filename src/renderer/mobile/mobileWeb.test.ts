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

  it('routes arXiv PDFs through the fixed local proxy', () => {
    expect(
      buildMobileWebPdfUrl('https://arxiv.org/pdf/1706.03762.pdf', 'http://192.168.1.23:4174/')
    ).toBe('http://192.168.1.23:4174/api/arxiv-pdf/pdf/1706.03762');
  });

  it('does not proxy unrelated PDF hosts', () => {
    expect(
      buildMobileWebPdfUrl('https://papers.example.org/paper.pdf', 'http://192.168.1.23:4174/')
    ).toBe('https://papers.example.org/paper.pdf');
  });
});
