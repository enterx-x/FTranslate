import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArxivService } from './arxivService';
import { buildArxivCacheKey, type ArxivSearchRequest } from '../shared/arxiv';

const sampleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>245</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>10</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2601.17440v1</id>
    <updated>2026-01-24T00:00:00Z</updated>
    <published>2026-01-24T00:00:00Z</published>
    <title>PILOT: A Perceptive Integrated Low-level Controller for Loco-manipulation</title>
    <summary>Humanoid robots require perceptive loco-manipulation.</summary>
    <author><name>Xinru Cui</name></author>
    <category term="cs.RO" />
    <link title="pdf" href="http://arxiv.org/pdf/2601.17440v1" rel="related" type="application/pdf" />
  </entry>
</feed>`;

const multiPaperFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>2</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>2</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2606.00001v1</id>
    <updated>2026-06-01T00:00:00Z</updated>
    <published>2026-06-01T00:00:00Z</published>
    <title>General Robot Control Notes</title>
    <summary>A short systems note.</summary>
    <author><name>Author A</name></author>
    <category term="cs.RO" />
    <link title="pdf" href="http://arxiv.org/pdf/2606.00001v1" rel="related" type="application/pdf" />
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2201.00002v1</id>
    <updated>2022-01-01T00:00:00Z</updated>
    <published>2022-01-01T00:00:00Z</published>
    <title>Tactile Sensing and Haptic Feedback for Robot Navigation</title>
    <summary>We study tactile perception, haptic force feedback, robot navigation, and contact-rich manipulation experiments.</summary>
    <author><name>Author B</name></author>
    <category term="cs.RO" />
    <link title="pdf" href="http://arxiv.org/pdf/2201.00002v1" rel="related" type="application/pdf" />
  </entry>
</feed>`;

const noisyTactileFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>2</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>2</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2606.99999v1</id>
    <updated>2026-06-16T00:00:00Z</updated>
    <published>2026-06-16T00:00:00Z</published>
    <title>General Robot Policy Optimization</title>
    <summary>This paper studies locomotion control and policy optimization for mobile robots.</summary>
    <author><name>Author Noise</name></author>
    <category term="cs.RO" />
    <link title="pdf" href="http://arxiv.org/pdf/2606.99999v1" rel="related" type="application/pdf" />
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2301.00003v1</id>
    <updated>2023-01-01T00:00:00Z</updated>
    <published>2023-01-01T00:00:00Z</published>
    <title>Tactile Sensing for Contact-Rich Robot Manipulation</title>
    <summary>We study tactile perception and haptic feedback for contact-rich manipulation.</summary>
    <author><name>Author Tactile</name></author>
    <category term="cs.RO" />
    <link title="pdf" href="http://arxiv.org/pdf/2301.00003v1" rel="related" type="application/pdf" />
  </entry>
</feed>`;

const request: ArxivSearchRequest = {
  searchQuery: 'loco manipulation',
  category: 'cs.RO',
  start: 0,
  maxResults: 10,
  sortBy: 'relevance',
  sortOrder: 'descending'
};

describe('ArxivService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-arxiv-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses SQLite cache for identical searches instead of hitting arXiv again', async () => {
    let fetchCount = 0;
    const service = new ArxivService({
      dbPath: path.join(tempDir, 'arxiv.sqlite'),
      minRequestGapMs: 0,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(sampleFeed, { status: 200 });
      }
    });

    try {
      const first = await service.search(request, 'test-search');
      const second = await service.search(request, 'test-search');

      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(true);
      expect(first.totalResults).toBe(245);
      expect(second.totalResults).toBe(245);
      expect(second.papers).toHaveLength(1);
      expect(fetchCount).toBe(1);
      expect(service.getRecentLogs(2)[0]).toMatchObject({ source: 'test-search', cache_hit: 1, status: 'cache-hit' });
    } finally {
      service.close();
    }
  });

  it('bypasses SQLite cache when an explicit force refresh is requested', async () => {
    let fetchCount = 0;
    const service = new ArxivService({
      dbPath: path.join(tempDir, 'arxiv.sqlite'),
      minRequestGapMs: 0,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(sampleFeed, { status: 200 });
      }
    });

    try {
      const first = await service.search(request, 'test-search');
      const refreshed = await service.search({ ...request, forceRefresh: true }, 'test-search');

      expect(first.cacheHit).toBe(false);
      expect(refreshed.cacheHit).toBe(false);
      expect(fetchCount).toBe(2);
    } finally {
      service.close();
    }
  });

  it('re-ranks comprehensive searches by title and abstract relevance after fetching by date', async () => {
    const service = new ArxivService({
      dbPath: path.join(tempDir, 'arxiv.sqlite'),
      minRequestGapMs: 0,
      fetchImpl: async () => new Response(multiPaperFeed, { status: 200 })
    });

    try {
      const result = await service.search(
        {
          searchQuery: 'tactile robot navigation',
          category: '',
          start: 0,
          maxResults: 2,
          sortBy: 'comprehensive',
          sortOrder: 'descending'
        },
        'comprehensive-rank'
      );

      expect(result.papers.map((paper) => paper.stableId)).toEqual(['2201.00002', '2606.00001']);
    } finally {
      service.close();
    }
  });

  it('does not let category and recency outrank papers that do not match the current query text', async () => {
    const service = new ArxivService({
      dbPath: path.join(tempDir, 'arxiv.sqlite'),
      minRequestGapMs: 0,
      fetchImpl: async () => new Response(noisyTactileFeed, { status: 200 })
    });

    try {
      const result = await service.search(
        {
          searchQuery: '触觉',
          category: 'cs.RO',
          start: 0,
          maxResults: 2,
          sortBy: 'comprehensive',
          sortOrder: 'descending'
        },
        'tactile-rank'
      );

      expect(result.papers.map((paper) => paper.stableId)).toEqual(['2301.00003']);
    } finally {
      service.close();
    }
  });

  it('keeps reading legacy array-shaped cache entries', async () => {
    const dbPath = path.join(tempDir, 'arxiv.sqlite');
    const bootstrap = new ArxivService({
      dbPath,
      minRequestGapMs: 0,
      fetchImpl: async () => new Response(sampleFeed, { status: 200 })
    });
    bootstrap.close();

    const db = new DatabaseSync(dbPath);
    try {
      const cacheKey = buildArxivCacheKey(request);
      db.prepare(
        `INSERT INTO arxiv_cache(cache_key, created_at, response_json)
         VALUES (?, ?, ?)`
      ).run(
        cacheKey,
        Date.now(),
        JSON.stringify([
          {
            id: 'http://arxiv.org/abs/legacyv1',
            stableId: 'legacy',
            title: 'Legacy cached paper',
            authors: [],
            summary: 'Cached before totalResults existed.',
            published: '',
            publishedAt: '',
            updated: '',
            categories: [],
            primaryCategory: '',
            abstractUrl: 'http://arxiv.org/abs/legacyv1',
            pdfUrl: 'https://arxiv.org/pdf/legacyv1.pdf'
          }
        ])
      );
    } finally {
      db.close();
    }

    let fetchCount = 0;
    const service = new ArxivService({
      dbPath,
      minRequestGapMs: 0,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(sampleFeed, { status: 200 });
      }
    });

    try {
      const result = await service.search(request, 'legacy-cache');

      expect(result.cacheHit).toBe(true);
      expect(result.totalResults).toBe(1);
      expect(result.papers[0].title).toBe('Legacy cached paper');
      expect(fetchCount).toBe(0);
    } finally {
      service.close();
    }
  });

  it('serializes real requests and enforces the configured request gap', async () => {
    let now = 100;
    const sleeps: number[] = [];
    const service = new ArxivService({
      dbPath: path.join(tempDir, 'arxiv.sqlite'),
      minRequestGapMs: 3200,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetchImpl: async () => new Response(sampleFeed, { status: 200 })
    });

    try {
      await service.search(request, 'first');
      await service.search({ ...request, start: 10 }, 'second');

      expect(sleeps).toContain(3200);
      expect(service.getRecentLogs(2).map((log) => log.source)).toContain('second');
    } finally {
      service.close();
    }
  });

  it('opens a local circuit breaker after 429 and returns an empty warning result during cooldown', async () => {
    let fetchCount = 0;
    let now = 1000;
    const service = new ArxivService({
      dbPath: path.join(tempDir, 'arxiv.sqlite'),
      minRequestGapMs: 0,
      firstCooldownMs: 10 * 60 * 1000,
      now: () => now,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response('', { status: 429 });
      }
    });

    try {
      const limited = await service.search(request, 'limited');
      now += 1000;
      const cooldown = await service.search({ ...request, start: 20 }, 'cooldown');

      expect(fetchCount).toBe(1);
      expect(limited.papers).toEqual([]);
      expect(limited.warning).toContain('arXiv');
      expect(cooldown.papers).toEqual([]);
      expect(cooldown.warning).toContain('arXiv');
      expect(service.getRecentLogs(2).map((log) => log.status)).toContain('cooldown-empty');
    } finally {
      service.close();
    }
  });

  it('uses a short default first cooldown so the user is not blocked for ten minutes after one 429', async () => {
    let fetchCount = 0;
    let now = 1000;
    const service = new ArxivService({
      dbPath: path.join(tempDir, 'arxiv.sqlite'),
      minRequestGapMs: 0,
      now: () => now,
      fetchImpl: async () => {
        fetchCount += 1;
        return fetchCount === 1 ? new Response('', { status: 429 }) : new Response(sampleFeed, { status: 200 });
      }
    });

    try {
      const limited = await service.search(request, 'limited');
      expect(limited.papers).toEqual([]);
      expect(limited.warning).toContain('arXiv');
      now += 2 * 60 * 1000 + 1;

      const result = await service.search({ ...request, start: 20 }, 'after-short-cooldown');

      expect(fetchCount).toBe(2);
      expect(result.papers).toHaveLength(1);
      expect(result.cacheHit).toBe(false);
    } finally {
      service.close();
    }
  });

  it('returns stale SQLite cache during cooldown instead of blocking the page', async () => {
    let now = 1000;
    const dbPath = path.join(tempDir, 'arxiv.sqlite');
    const bootstrap = new ArxivService({
      dbPath,
      cacheTtlMs: 1,
      minRequestGapMs: 0,
      now: () => now,
      fetchImpl: async () => new Response(sampleFeed, { status: 200 })
    });
    bootstrap.close();

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        `INSERT INTO arxiv_cache(cache_key, created_at, response_json)
         VALUES (?, ?, ?)`
      ).run(buildArxivCacheKey(request), now - 60_000, JSON.stringify({
        papers: [
          {
            id: 'http://arxiv.org/abs/stalev1',
            stableId: 'stale',
            title: 'Stale cached paper',
            authors: [],
            summary: 'Cached while arXiv is cooling down.',
            published: '',
            publishedAt: '',
            updated: '',
            categories: [],
            primaryCategory: '',
            abstractUrl: 'http://arxiv.org/abs/stalev1',
            pdfUrl: 'https://arxiv.org/pdf/stalev1.pdf'
          }
        ],
        totalResults: 1,
        startIndex: 0,
        itemsPerPage: 1
      }));
      db.prepare(
        `INSERT INTO arxiv_state(key, value)
         VALUES ('cooldown_until', ?)`
      ).run(String(now + 60_000));
    } finally {
      db.close();
    }

    let fetchCount = 0;
    const service = new ArxivService({
      dbPath,
      cacheTtlMs: 1,
      minRequestGapMs: 0,
      now: () => now,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response('', { status: 500 });
      }
    });

    try {
      const result = await service.search(request, 'cooldown-stale-cache');

      expect(fetchCount).toBe(0);
      expect(result.cacheHit).toBe(true);
      expect(result.cacheStale).toBe(true);
      expect(result.papers[0].title).toBe('Stale cached paper');
      expect(service.getRecentLogs(1)[0]).toMatchObject({ status: 'stale-cache-cooldown', cache_hit: 1 });
    } finally {
      service.close();
    }
  });
});
