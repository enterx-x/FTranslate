import { describe, expect, it } from 'vitest';
import {
  ARXIV_API_ENDPOINT,
  buildArxivApiUrl,
  buildArxivCacheKey,
  parseArxivAtomFeed
} from './arxivClient';

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
      query: 'loco manipulation humanoid',
      category: 'cs.RO',
      start: 5,
      maxResults: 200,
      sortBy: 'submittedDate',
      sortOrder: 'descending'
    });
    const params = new URL(url).searchParams;

    expect(url.startsWith(ARXIV_API_ENDPOINT)).toBe(true);
    expect(url).toContain('start=5');
    expect(url).toContain('max_results=50');
    expect(params.get('search_query')).toBe('all:"loco manipulation humanoid" AND cat:cs.RO');
    expect(url).not.toContain('presentation');
    expect(url).not.toContain('ppt');
  });

  it('parses arXiv Atom feed into local-download-ready records', () => {
    const papers = parseArxivAtomFeed(sampleFeed);

    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      id: '2601.17440v1',
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
        query: '  Safe RL  ',
        category: 'cs.RO',
        maxResults: 10,
        sortBy: 'relevance',
        sortOrder: 'descending'
      })
    ).toBe(
      buildArxivCacheKey({
        query: 'safe rl',
        category: 'cs.RO',
        maxResults: 10,
        sortBy: 'relevance',
        sortOrder: 'descending'
      })
    );
  });
});
