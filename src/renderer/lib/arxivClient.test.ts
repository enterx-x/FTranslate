import { describe, expect, it } from 'vitest';
import {
  ARXIV_API_ENDPOINT,
  ARXIV_RATE_LIMIT_COOLDOWN_MS,
  buildArxivApiUrl,
  buildArxivCacheKey,
  buildArxivHttpErrorMessage,
  buildArxivRateLimitMessage,
  isArxivRateLimitStatus,
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

  it('formats arXiv rate-limit failures as a retryable user-facing state', () => {
    const now = Date.parse('2026-06-05T12:00:00.000Z');

    expect(isArxivRateLimitStatus(429)).toBe(true);
    expect(isArxivRateLimitStatus(500)).toBe(false);
    expect(buildArxivRateLimitMessage(now + ARXIV_RATE_LIMIT_COOLDOWN_MS, now)).toContain('90 秒后再试');
    expect(buildArxivHttpErrorMessage(429)).toBe('arXiv 官方 API 正在限流，请稍后再试。');
    expect(buildArxivHttpErrorMessage(503, 'Service Unavailable')).toBe(
      'arXiv API 请求失败：HTTP 503 Service Unavailable'
    );
  });
});
