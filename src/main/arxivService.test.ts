import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArxivService } from './arxivService';
import type { ArxivSearchRequest } from '../shared/arxiv';

const sampleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
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
      expect(second.papers).toHaveLength(1);
      expect(fetchCount).toBe(1);
      expect(service.getRecentLogs(2)[0]).toMatchObject({ source: 'test-search', cache_hit: 1, status: 'cache-hit' });
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

  it('opens a local circuit breaker after 429 and does not access arXiv during cooldown', async () => {
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
      await expect(service.search(request, 'limited')).rejects.toThrow(/HTTP 429/);
      now += 1000;
      await expect(service.search({ ...request, start: 20 }, 'cooldown')).rejects.toThrow(/冷却/);

      expect(fetchCount).toBe(1);
      expect(service.getRecentLogs(2).map((log) => log.status)).toContain('circuit-open-local');
    } finally {
      service.close();
    }
  });
});
