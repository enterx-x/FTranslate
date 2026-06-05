import { describe, expect, it } from 'vitest';
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { buildArxivApiUrl, buildArxivCacheKey, parseArxivFeed } from './arxivClient';

const sampleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2601.17440v1</id>
    <updated>2026-01-24T00:00:00Z</updated>
    <published>2026-01-24T00:00:00Z</published>
    <title>PILOT: A Perceptive Integrated Low-level Controller for Loco-manipulation</title>
    <summary>
      Humanoid robots require perceptive loco-manipulation over unstructured scenes.
    </summary>
    <author><name>Xinru Cui</name></author>
    <author><name>Hesheng Wang</name></author>
    <category term="cs.RO" />
    <link title="pdf" href="http://arxiv.org/pdf/2601.17440v1" rel="related" type="application/pdf" />
  </entry>
</feed>`;

describe('arxivClient', () => {
  it('builds an official arXiv Atom API query without coupling to PPT generation', () => {
    const url = buildArxivApiUrl({
      searchQuery: 'loco manipulation humanoid',
      category: 'cs.RO',
      start: 5,
      maxResults: 12,
      sortBy: 'submittedDate',
      sortOrder: 'descending'
    });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://export.arxiv.org/api/query');
    expect(parsed.searchParams.get('start')).toBe('5');
    expect(parsed.searchParams.get('max_results')).toBe('12');
    expect(parsed.searchParams.get('search_query')).toBe('cat:cs.RO AND all:loco manipulation humanoid');
    expect(url).not.toContain('presentation');
    expect(url).not.toContain('ppt');
  });

  it('parses arXiv Atom feed into local-download-ready records', () => {
    const papers = parseArxivFeed(sampleFeed, XmldomParser as any);

    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      id: 'http://arxiv.org/abs/2601.17440v1',
      stableId: '2601.17440',
      title: 'PILOT: A Perceptive Integrated Low-level Controller for Loco-manipulation',
      authors: ['Xinru Cui', 'Hesheng Wang'],
      categories: ['cs.RO'],
      pdfUrl: 'https://arxiv.org/pdf/2601.17440v1.pdf'
    });
    expect(papers[0].summary).toContain('perceptive loco-manipulation');
  });

  it('uses a stable cache key for throttled repeated searches', () => {
    expect(
      buildArxivCacheKey({
        searchQuery: '  Safe RL  ',
        category: 'cs.RO',
        start: 0,
        maxResults: 10,
        sortBy: 'relevance',
        sortOrder: 'descending'
      })
    ).toBe(
      buildArxivCacheKey({
        searchQuery: 'safe rl',
        category: 'cs.RO',
        start: 0,
        maxResults: 10,
        sortBy: 'relevance',
        sortOrder: 'descending'
      })
    );
  });
});
