import { describe, expect, it } from 'vitest';
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { buildArxivApiUrl, buildArxivCacheKey, parseArxivFeed, parseArxivSearchResult } from './arxivClient';

const sampleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>3456</opensearch:totalResults>
  <opensearch:startIndex>50</opensearch:startIndex>
  <opensearch:itemsPerPage>50</opensearch:itemsPerPage>
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
    const searchQuery = parsed.searchParams.get('search_query') ?? '';
    expect(searchQuery).toContain('cat:cs.RO AND');
    expect(searchQuery).toContain('ti:loco');
    expect(searchQuery).toContain('abs:humanoid');
    expect(url).not.toContain('presentation');
    expect(url).not.toContain('ppt');
  });

  it('builds a broad title and abstract query for multi-keyword searches', () => {
    const url = buildArxivApiUrl({
      searchQuery: 'reinforcement learning robot navigation',
      category: '',
      start: 0,
      maxResults: 50,
      sortBy: 'relevance',
      sortOrder: 'descending'
    });
    const parsed = new URL(url);
    const searchQuery = parsed.searchParams.get('search_query') ?? '';

    expect(searchQuery).not.toBe('all:reinforcement learning robot navigation');
    expect(searchQuery).toContain('ti:"reinforcement learning"');
    expect(searchQuery).toContain('abs:"reinforcement learning"');
    expect(searchQuery).toContain('ti:robot');
    expect(searchQuery).toContain('abs:navigation');
    expect(searchQuery).toContain(' OR ');
  });

  it('adds submittedDate range to the arXiv query and cache key when years are provided', () => {
    const request = {
      searchQuery: 'robot navigation',
      category: 'cs.RO',
      start: 0,
      maxResults: 50,
      sortBy: 'submittedDate' as const,
      sortOrder: 'descending' as const,
      yearFrom: '2020',
      yearTo: '2026'
    };
    const url = buildArxivApiUrl(request);
    const parsed = new URL(url);
    const searchQuery = parsed.searchParams.get('search_query') ?? '';
    const cacheKey = buildArxivCacheKey(request);

    expect(searchQuery).toContain('submittedDate:[202001010000 TO 202612312359]');
    expect(cacheKey).toContain('2020');
    expect(cacheKey).toContain('2026');
  });

  it('expands common Chinese research terms before building an arXiv query', () => {
    const url = buildArxivApiUrl({
      searchQuery: '无人机避障 强化学习',
      category: 'cs.RO',
      start: 0,
      maxResults: 50,
      sortBy: 'relevance',
      sortOrder: 'descending'
    });
    const parsed = new URL(url);
    const searchQuery = parsed.searchParams.get('search_query') ?? '';

    expect(searchQuery).not.toContain('强化学习');
    expect(searchQuery).not.toContain('无人机');
    expect(searchQuery).not.toContain('避障');
    expect(searchQuery).toContain('reinforcement learning');
    expect(searchQuery).toContain('ti:uav');
    expect(searchQuery).toContain('abs:drone');
    expect(searchQuery).toContain('obstacle');
    expect(searchQuery).toContain('abs:avoidance');
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

  it('parses total result count from arXiv OpenSearch metadata', () => {
    const result = parseArxivSearchResult(sampleFeed, XmldomParser as any);

    expect(result.totalResults).toBe(3456);
    expect(result.startIndex).toBe(50);
    expect(result.itemsPerPage).toBe(50);
    expect(result.papers).toHaveLength(1);
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
