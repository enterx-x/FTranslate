# arXiv Official Relevance Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default arXiv search use the official global relevance order, preserve that order through cache and enrichment, and expose a compact structured English query for Chinese scientific input.

**Architecture:** `src/shared/arxiv.ts` owns the normalized request, concept expression, legacy sort migration, and versioned cache identity. `ArxivService` sends that request to the official API and never performs an implicit local reorder. Desktop and mobile renderers use official relevance by default while retaining explicit submitted/updated date modes and the dedicated latest action.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, Vitest, Node SQLite, arXiv Atom API, Node benchmark script.

---

## File structure

- Modify `src/shared/arxiv.ts`: official sort contract, legacy migration, effective expression, `title-abstract-v8` cache identity.
- Modify `src/shared/arxiv.test.ts`: query grouping, sort migration, URL, expression, and cache regressions.
- Modify `src/main/arxivService.ts`: normalize every request and preserve official order for live, fresh-cache, stale-cache, and enrichment paths.
- Modify `src/main/arxivService.test.ts`: exact ID-order and cache-order regressions; remove page-local ranking expectations.
- Modify `src/main/preload.ts` and `src/renderer/types/electron.d.ts`: remove `comprehensive` from current typed requests and expose `effectiveSearchExpression`.
- Modify `src/renderer/components/ArxivSearchPage.tsx`: official relevance default, truthful controls, effective-query status.
- Modify `src/renderer/components/ArxivSearchPage.test.ts`: default/reset/latest request behavior and visible status labels.
- Modify `src/renderer/lib/arxivClient.test.ts`: official URL/cache contract.
- Modify `src/renderer/lib/arxivUi.ts` and `src/renderer/lib/arxivUi.test.ts`: ranking labels without page-local mode.
- Modify `src/renderer/mobile/MobileArxivScreen.tsx`: mobile default and options.
- Create `benchmarks/arxiv-retrieval-v1.json`: 20 versioned English/Chinese research queries and relevance rules.
- Create `scripts/arxiv-retrieval-benchmark.mjs`: rate-limited live benchmark and offline metric report.
- Modify `README.md` and `PLAN.md`: user-visible behavior, benchmark results, verification, and remaining risks.

### Task 1: Replace the current sort contract with official relevance

**Files:**
- Modify: `src/shared/arxiv.ts:1-16,450-481`
- Test: `src/shared/arxiv.test.ts`
- Test: `src/renderer/lib/arxivClient.test.ts`

- [ ] **Step 1: Write failing sort and cache tests**

```ts
import {
  buildArxivApiUrl,
  buildArxivCacheKey,
  normalizeArxivSortBy
} from './arxiv';

it('migrates the legacy page-local sort to official relevance', () => {
  expect(normalizeArxivSortBy('comprehensive')).toBe('relevance');
  expect(normalizeArxivSortBy('submittedDate')).toBe('submittedDate');
  expect(normalizeArxivSortBy('unknown')).toBe('relevance');
});

it('uses official relevance and the v8 request identity', () => {
  const request = {
    searchQuery: 'robot navigation', category: '', start: 0, maxResults: 50,
    sortBy: 'relevance' as const, sortOrder: 'descending' as const
  };
  expect(new URL(buildArxivApiUrl(request)).searchParams.get('sortBy')).toBe('relevance');
  expect(JSON.parse(buildArxivCacheKey(request))).toMatchObject({
    query_version: 'title-abstract-v8',
    sortBy: 'relevance'
  });
});
```

- [ ] **Step 2: Run the tests and verify the expected legacy/v7 failures**

Run: `npx vitest run src/shared/arxiv.test.ts src/renderer/lib/arxivClient.test.ts`

Expected: failures show `comprehensive -> submittedDate` and `title-abstract-v7`.

- [ ] **Step 3: Implement the current sort type and runtime migration**

```ts
export type ArxivSortBy = 'relevance' | 'lastUpdatedDate' | 'submittedDate';

export function normalizeArxivSortBy(value: unknown): ArxivSortBy {
  switch (value) {
    case 'lastUpdatedDate':
    case 'submittedDate':
      return value;
    case 'comprehensive':
    case 'relevance':
    default:
      return 'relevance';
  }
}
```

`buildArxivApiUrl` and `buildArxivCacheKey` use `normalizeArxivSortBy(request.sortBy)` and the cache key advances to `title-abstract-v8`.

- [ ] **Step 4: Run focused tests and commit**

Run: `npx vitest run src/shared/arxiv.test.ts src/renderer/lib/arxivClient.test.ts`

Commit: `fix(arxiv): use official relevance request identity`

### Task 2: Preserve official API order in the main service

**Files:**
- Modify: `src/main/arxivService.ts:97-292,701-817`
- Test: `src/main/arxivService.test.ts:350-540`

- [ ] **Step 1: Replace page-local rerank tests with failing official-order tests**

```ts
it('preserves official relevance order for live and cached responses', async () => {
  const officialIds = ['2607.00003', '2607.00001', '2607.00002'];
  const service = new ArxivService({
    dbPath,
    minRequestGapMs: 0,
    fetchImpl: async () => new Response(buildFeed(officialIds), { status: 200 })
  });
  const request = makeRequest({ sortBy: 'relevance' });
  const live = await service.search(request);
  const cached = await service.search(request);
  expect(live.papers.map((paper) => paper.stableId)).toEqual(officialIds);
  expect(cached.papers.map((paper) => paper.stableId)).toEqual(officialIds);
});
```

Add a stale-cache variant and a request using runtime value `comprehensive` that verifies the outgoing URL contains `sortBy=relevance`.

- [ ] **Step 2: Run the service test and confirm it fails because `applyLocalArxivSort` changes order**

Run: `npx vitest run src/main/arxivService.test.ts`

- [ ] **Step 3: Normalize once and remove all implicit local ranking**

```ts
const normalizedRequest: ArxivSearchRequest = {
  ...request,
  sortBy: normalizeArxivSortBy((request as { sortBy?: unknown }).sortBy),
  sortOrder: request.sortOrder === 'ascending' ? 'ascending' : 'descending'
};
```

Use `normalizedRequest` in `resolveSearchRequest`. Return cached and parsed results directly. Delete `applyLocalArxivSort`, `buildRequiredLocalTermGroups`, `matchesRequiredTermGroups`, `tokenizeLocalRankingQuery`, `scoreComprehensivePaper`, and `scoreRecency` after confirming they have no remaining callers.

- [ ] **Step 4: Run service and shared regressions and commit**

Run: `npx vitest run src/main/arxivService.test.ts src/shared/arxiv.test.ts`

Commit: `fix(arxiv): preserve official result order`

### Task 3: Expose the actual structured English query

**Files:**
- Modify: `src/shared/arxiv.ts:33-51,483-535`
- Modify: `src/main/arxivService.ts:42-55,238-293`
- Test: `src/shared/arxiv.test.ts`
- Test: `src/main/arxivService.test.ts`

- [ ] **Step 1: Write failing query-structure tests**

```ts
it('keeps humanoid and tactile as required compact concepts', () => {
  const expression = buildArxivEffectiveSearchExpression({
    searchQuery: '人形触觉', queryMode: 'balanced', category: '', start: 0,
    maxResults: 50, sortBy: 'relevance', sortOrder: 'descending'
  });
  expect(expression).toContain('"humanoid robot"');
  expect(expression).toContain('tactile');
  expect(expression).toMatch(/\) AND \(/u);
  expect(expression).not.toContain('textile');
  expect(expression).not.toContain('ti:touch');
});

it('returns the exact effective expression in search metadata', async () => {
  const result = await service.search(makeRequest({ searchQuery: '人形触觉' }));
  expect(result.effectiveSearchExpression).toContain(' AND ');
  expect(result.effectiveSearchExpression).toContain('humanoid');
});
```

- [ ] **Step 2: Run tests and confirm the missing metadata failure**

Run: `npx vitest run src/shared/arxiv.test.ts src/main/arxivService.test.ts`

- [ ] **Step 3: Export one canonical expression builder and include it in cache identity**

```ts
export function buildArxivEffectiveSearchExpression(request: ArxivSearchRequest): string {
  const queryMode = resolveArxivQueryMode(request.queryMode);
  const normalized = normalizeArxivSearchQuery(request.searchQuery, queryMode);
  return buildArxivSearchExpression(normalized, { ...request, queryMode }, request.searchQuery);
}
```

Add `effectiveSearchExpression?: string` to `ArxivSearchServiceResult` and `ArxivSearchMetadata`. Set it after the final English request is resolved. Store `effective_expression` and `query_builder_version: 'concept-groups-v1'` in the v8 cache key.

- [ ] **Step 4: Bound aliases without broadening conjunctions**

Keep the existing longest Chinese concept matching. For balanced mode, each detected concept produces one bounded alias group and concept groups join only with `AND`; explore remains the only mode allowed to join concepts with `OR`. Remove isolated `touch` and similarly noisy aliases from balanced groups.

- [ ] **Step 5: Run query/service regressions and commit**

Run: `npx vitest run src/shared/arxiv.test.ts src/main/arxivService.test.ts`

Commit: `feat(arxiv): expose structured effective query`

### Task 4: Make desktop and mobile controls truthful

**Files:**
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/components/ArxivSearchPage.tsx:126-145,530-610,840-895,1438-1582,1714-1752`
- Modify: `src/renderer/mobile/MobileArxivScreen.tsx`
- Modify: `src/renderer/lib/arxivUi.ts:61-71`
- Test: `src/renderer/components/ArxivSearchPage.test.ts`
- Test: `src/renderer/lib/arxivUi.test.ts`

- [ ] **Step 1: Write failing default/reset/label tests**

```ts
it('uses official relevance as the normal search default', () => {
  expect(DEFAULT_ARXIV_SORT_BY).toBe('relevance');
  expect(getArxivRankingScopeLabel('relevance')).toBe('arXiv 全局相关性');
});

it('keeps the latest action submitted-date descending', () => {
  const latest = buildLatestArxivSearchRequest(baseRequest, '*');
  expect(latest).toMatchObject({ sortBy: 'submittedDate', sortOrder: 'descending' });
});
```

- [ ] **Step 2: Run renderer tests and verify the `comprehensive` defaults fail**

Run: `npx vitest run src/renderer/components/ArxivSearchPage.test.ts src/renderer/lib/arxivUi.test.ts`

- [ ] **Step 3: Implement the minimal UI changes**

```ts
export const DEFAULT_ARXIV_SORT_BY: ArxivSortBy = 'relevance';

const SORT_OPTIONS = [
  { value: 'relevance', label: '相关性（arXiv）' },
  { value: 'submittedDate', label: '提交时间' },
  { value: 'lastUpdatedDate', label: '更新时间' }
] satisfies Array<{ value: ArxivSortBy; label: string }>;
```

Use the constant for initial state, filter reset, desktop, and mobile. Hide the ascending/descending control when `sortBy === 'relevance'`; date sorts retain it. Change runtime query text from `规范化` to `实际查询` and display `effectiveSearchExpression` with the full value in `title`.

- [ ] **Step 4: Update current request/result types**

Remove `comprehensive` from new preload/renderer unions and add `effectiveSearchExpression?: string`. Runtime migration remains in main/shared code for old callers.

- [ ] **Step 5: Run renderer/type tests and commit**

Run: `npx vitest run src/renderer/components/ArxivSearchPage.test.ts src/renderer/lib/arxivUi.test.ts src/renderer/lib/arxivClient.test.ts`

Run: `npm run typecheck`

Commit: `feat(arxiv): make official relevance the default`

### Task 5: Add the 20-query retrieval benchmark

**Files:**
- Create: `benchmarks/arxiv-retrieval-v1.json`
- Create: `scripts/arxiv-retrieval-benchmark.mjs`

- [ ] **Step 1: Create the versioned query corpus**

Each of 20 entries contains concrete fields:

```json
{
  "id": "zh-humanoid-tactile",
  "query": "人形触觉",
  "mode": "balanced",
  "category": "cs.RO",
  "requiredConcepts": [["humanoid", "humanoid robot"], ["tactile", "haptic", "visuotactile"]],
  "forbiddenTitleTerms": ["textile", "knitting"],
  "knownRelevantIds": []
}
```

The corpus covers RL, PINN, CBF/MPC, path planning, navigation, tactile sensing, humanoid manipulation, dynamics, exact method names, and mixed Chinese/English queries. At least 10 entries contain Chinese.

- [ ] **Step 2: Implement deterministic metrics and compliant request pacing**

```js
export function precisionAt(items, k) {
  return items.slice(0, k).filter((item) => item.relevance > 0).length / k;
}

export function ndcgAt(items, k) {
  const dcg = items.slice(0, k).reduce((sum, item, index) =>
    sum + (2 ** item.relevance - 1) / Math.log2(index + 2), 0);
  const ideal = [...items].sort((a, b) => b.relevance - a.relevance);
  const idcg = ideal.slice(0, k).reduce((sum, item, index) =>
    sum + (2 ** item.relevance - 1) / Math.log2(index + 2), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}
```

The live runner waits at least 3.2 seconds between requests, stores raw Atom responses under `.tmp-arxiv-benchmark/`, resumes completed queries, and never runs from ordinary `npm test`.

- [ ] **Step 3: Add an offline report mode and verify it**

Run: `node scripts/arxiv-retrieval-benchmark.mjs --fixture benchmarks/arxiv-retrieval-v1.json --offline`

Expected: one JSON and one Markdown report with 20 query rows and aggregate metric fields; missing human judgements are reported explicitly rather than scored as success.

- [ ] **Step 4: Run the live benchmark with resumable pacing**

Run: `node scripts/arxiv-retrieval-benchmark.mjs --fixture benchmarks/arxiv-retrieval-v1.json --live`

Review the top 50 titles/abstracts, populate relevance judgements, rerun offline metrics, and record Precision@10, nDCG@10, Recall@50, exact hit position, off-topic rate, and latency.

Commit: `test(arxiv): add retrieval quality benchmark`

### Task 6: Verify search behavior, visuals, and documentation

**Files:**
- Modify: `README.md`
- Modify: `PLAN.md`

- [ ] **Step 1: Run the focused and complete code gates**

Run: `npx vitest run src/shared/arxiv.test.ts src/main/arxivService.test.ts src/renderer/lib/arxivClient.test.ts src/renderer/lib/arxivUi.test.ts src/renderer/components/ArxivSearchPage.test.ts`

Run: `npm run build`

- [ ] **Step 2: Run and inspect the UI visual gate**

Run: `npm run visual:check`

Inspect `.tmp-visual-check/arxiv-search-results-1366.png` and relevant wider screenshots. Confirm no overlap, horizontal overflow, hidden controls, clipped effective query, or reintroduced page-local ranking text.

- [ ] **Step 3: Update user and execution documentation**

Record official relevance behavior, v8 cache migration, effective query, benchmark metrics, exact validation commands, API instability observed during live tests, and remaining limitations. Do not claim equivalence with every arXiv website search mode.

- [ ] **Step 4: Commit the independently working search feature**

Commit: `feat(arxiv): ship official relevance search`
