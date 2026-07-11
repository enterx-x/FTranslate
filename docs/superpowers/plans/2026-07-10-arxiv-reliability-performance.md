# arXiv Reliability and Translation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make arXiv discovery race-safe, rate-limit compliant, fast to browse, foreground-responsive to translate, and explicit about ranking and translation quality.

**Architecture:** The renderer owns a monotonic search session and accepts only current-session results. The main process owns one serialized local translation engine behind a priority queue; foreground jobs run before queued preview/background work. Translation text is protected, sentence-packed, restored, and quality-checked before it reaches the existing SQLite cache.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, Vitest, Node SQLite, NLLB CTranslate2, Argos fallback.

## Execution status (2026-07-10)

- Tasks 1-6 are implemented and independently reviewed: search-session ownership, priority translation queue, academic placeholder/length quality gates, typed IPC validation, query modes and bounded translation workflow, and compact responsive UI.
- arXiv upstream requests remain serialized behind the existing 3.2-second minimum gap; perceived speed improvements come from cache-first retrieval, six-paper previews, explicit page translation, and foreground priority rather than non-compliant concurrency.
- Renderer and service regression coverage includes stale search/translation results, strict/balanced/explore cache isolation, invalid IPC items, preview-first bounds, quality rejection, query snapshots, and 1366/1440/1920 visual geometry.
- Task 7 packaging and packaged visual verification completed for version 0.1.13; `PLAN.md` records the 506-test result, source and packaged visual gates, installer path/size/hash, and remaining build warnings. Final documentation commit and branch push complete the handoff.

---

## File structure

- Create `src/renderer/lib/arxivSearchSession.ts`: immutable session IDs and stale-result acceptance.
- Create `src/renderer/lib/arxivSearchSession.test.ts`: deterministic session guards.
- Modify `src/main/arxivTranslationService.ts`: priority queue, protected-span translation, quality metadata.
- Modify `src/main/arxivTranslationService.test.ts`: priority, segmentation, protection, and cache tests.
- Modify `src/main/ipc/handlers/types.ts`, `src/main/ipc/handlers/arxiv.ts`, `src/main/preload.ts`, `src/renderer/types/electron.d.ts`: typed translation priority and quality metadata through IPC.
- Modify `src/renderer/components/ArxivSearchPage.tsx`: session guard, bounded preview translation, explicit page translation, truthful controls.
- Modify `src/renderer/components/ArxivSearchPage.test.ts`: request-session and queue behaviour.
- Modify `src/renderer/lib/arxivUi.ts`, `src/renderer/lib/arxivUi.test.ts`, `src/shared/arxiv.ts`, `src/shared/arxiv.test.ts`: ranking scope and query-mode semantics.
- Modify `src/renderer/styles/global.css`: compact status row, explicit translation actions, reduced card-action density.
- Modify `README.md` and `PLAN.md`: user-facing workflow, verification record, remaining constraints.

### Task 1: Add renderer search-session ownership

**Files:**
- Create: `src/renderer/lib/arxivSearchSession.ts`
- Test: `src/renderer/lib/arxivSearchSession.test.ts`
- Modify: `src/renderer/components/ArxivSearchPage.tsx:331-580`

- [ ] **Step 1: Write failing session tests**

```ts
import { createArxivSearchSessionController } from './arxivSearchSession';

it('accepts only the newest search session', () => {
  const controller = createArxivSearchSessionController();
  const first = controller.begin();
  const second = controller.begin();
  expect(controller.isCurrent(first)).toBe(false);
  expect(controller.isCurrent(second)).toBe(true);
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npx vitest run src/renderer/lib/arxivSearchSession.test.ts`

- [ ] **Step 3: Implement the minimal controller**

```ts
export interface ArxivSearchSessionController {
  begin(): number;
  current(): number;
  isCurrent(sessionId: number): boolean;
}

export function createArxivSearchSessionController(): ArxivSearchSessionController {
  let currentSession = 0;
  return {
    begin: () => ++currentSession,
    current: () => currentSession,
    isCurrent: (sessionId) => sessionId === currentSession
  };
}
```

- [ ] **Step 4: Guard every `handleSearch` state write with its session ID and disable page-jump Enter while searching**

```ts
const searchSessionRef = useRef(createArxivSearchSessionController());
const sessionId = searchSessionRef.current.begin();
const result = await window.electronAPI.searchArxiv(nextRequest);
if (!searchSessionRef.current.isCurrent(sessionId)) return;
```

- [ ] **Step 5: Run focused renderer tests**

Run: `npx vitest run src/renderer/lib/arxivSearchSession.test.ts src/renderer/components/ArxivSearchPage.test.ts`

### Task 2: Make main-process translation priority-aware

**Files:**
- Modify: `src/main/arxivTranslationService.ts:19-270`
- Test: `src/main/arxivTranslationService.test.ts`

- [ ] **Step 1: Write failing priority-order tests**

```ts
it('runs a foreground job before queued background work', async () => {
  const started: string[] = [];
  const service = new ArxivTranslationService({ dbPath, translateTexts: async (texts) => {
    started.push(texts[0]);
    return texts.map((text) => `ZH:${text}`);
  }});
  const background = service.translatePapers([backgroundPaper], { priority: 'background' });
  const foreground = service.translatePapers([foregroundPaper], { priority: 'foreground' });
  await Promise.all([background, foreground]);
  expect(started).toEqual(['background title', 'foreground title']);
});
```

- [ ] **Step 2: Implement a non-preemptive priority queue**

```ts
export type ArxivTranslationPriority = 'foreground' | 'preview' | 'background';

interface QueuedTranslationJob<T> {
  priority: ArxivTranslationPriority;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}
```

The currently running job continues; pending jobs sort foreground, preview, background, then FIFO within a priority.

- [ ] **Step 3: Keep cache lookups outside the queue and enqueue only missing work**

```ts
async translatePapers(
  requests: ArxivTitleAbstractTranslationRequest[],
  options: { priority?: ArxivTranslationPriority } = {}
): Promise<ArxivTitleAbstractTranslationResult[]> {
  // Preserve current cache semantics, then queue the uncached remainder.
}
```

- [ ] **Step 4: Run priority and existing translation tests**

Run: `npx vitest run src/main/arxivTranslationService.test.ts`

### Task 3: Protect and validate academic translation content

**Files:**
- Modify: `src/shared/academicTranslationQuality.ts`
- Modify: `src/main/arxivTranslationService.ts:140-250`
- Test: `src/shared/academicTranslationQuality.test.ts`
- Test: `src/main/arxivTranslationService.test.ts`

- [ ] **Step 1: Add failing protected-span round-trip tests**

```ts
expect(roundTripProtectedAcademicText(
  'We optimize $L = L_data + lambda L_phys$ (Smith et al., 2024), DOI:10.1000/example.'
)).toContain('DOI:10.1000/example');
```

- [ ] **Step 2: Add sentence-pack tests for a long abstract**

```ts
const batches = packAcademicTranslationSegments(longAbstract, 900);
expect(batches.every((batch) => batch.source.length <= 900)).toBe(true);
expect(reassembleAcademicTranslationSegments(batches)).toContain('Results');
```

- [ ] **Step 3: Implement placeholder protection and sentence-budget packing**

```ts
export interface ProtectedAcademicText {
  text: string;
  placeholders: Array<{ token: string; value: string }>;
}
```

Protect formula delimiters, inline code, URLs, DOI/arXiv IDs, citation ranges, and configured glossary terms; restore exact source spans after translating each packed segment.

- [ ] **Step 4: Reject unusable translated output before caching**

```ts
const quality = assessAcademicTranslationQuality(source, restoredText);
if (!quality.usable) return '';
```

The assessment must include existing mojibake, repeated-tail, and English-echo checks plus missing-placeholder and severe-length-loss checks.

- [ ] **Step 5: Run translation quality tests**

Run: `npx vitest run src/shared/academicTranslationQuality.test.ts src/main/arxivTranslationService.test.ts`

### Task 4: Carry priority and quality metadata through IPC

**Files:**
- Modify: `src/main/ipc/handlers/types.ts`
- Modify: `src/main/ipc/handlers/arxiv.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Test: `src/main/ipc/handlers/index.test.ts`

- [ ] **Step 1: Add failing IPC shape tests**

```ts
expect(parseArxivTranslationBatchRequest({
  papers: [paper],
  priority: 'preview',
  sessionId: 7
})).toMatchObject({ priority: 'preview', sessionId: 7 });
```

- [ ] **Step 2: Add typed request and result fields**

```ts
interface ArxivTranslationBatchRequest {
  papers: ArxivTitleAbstractTranslationRequest[];
  priority?: ArxivTranslationPriority;
  sessionId?: number;
}
```

- [ ] **Step 3: Clamp IPC batch size and validate priority/session values**

Accept at most 100 papers, valid priority strings, and non-negative safe integer session IDs; invalid optional values fall back to preview priority and no session.

- [ ] **Step 4: Run IPC and type tests**

Run: `npx vitest run src/main/ipc/handlers/index.test.ts src/main/ipc/handlers/arxiv.test.ts`

### Task 5: Redesign search-page translation controls and ranking semantics

**Files:**
- Modify: `src/renderer/components/ArxivSearchPage.tsx:89-1700`
- Modify: `src/renderer/components/ArxivSearchPage.test.ts`
- Modify: `src/renderer/lib/arxivUi.ts`
- Modify: `src/renderer/lib/arxivUi.test.ts`
- Modify: `src/shared/arxiv.ts`
- Modify: `src/shared/arxiv.test.ts`

- [ ] **Step 1: Write failing UI helper tests**

```ts
expect(getArxivRankingScopeLabel('comprehensive')).toBe('本页相关排序');
expect(buildArxivPreviewTranslationBatches(papers)).toEqual([papers.slice(0, 6)]);
```

- [ ] **Step 2: Replace automatic whole-page translation with a six-paper preview batch**

```ts
void queuePreviewTranslations(result.papers.slice(0, 6), sessionId);
```

Manual selected-paper requests use `foreground`; `翻译本页` uses `background` and only current-session results may update metadata.

- [ ] **Step 3: Add strict, balanced, and explore query modes**

```ts
export type ArxivQueryMode = 'strict' | 'balanced' | 'explore';
```

Strict preserves query phrases, balanced uses the existing normalized expansion, and explore keeps the broader semantic synonym alternatives. The selected mode is included in the cache key and shown beside the normalized English query.

- [ ] **Step 4: Move secondary PPT/export operations into the detail inspector and retain only Read, Translate, and Add-to-queue on cards**

The detail inspector remains the source for PPT inclusion and export actions, so discovery cards are scannable at 20, 50, 100, and 200 results per page.

- [ ] **Step 5: Run renderer and shared arXiv tests**

Run: `npx vitest run src/renderer/components/ArxivSearchPage.test.ts src/renderer/lib/arxivUi.test.ts src/shared/arxiv.test.ts`

### Task 6: Finish compact UI styling and accessibility

**Files:**
- Modify: `src/renderer/styles/global.css:arxiv selectors`
- Modify: `scripts/visual-check.mjs`

- [ ] **Step 1: Add compact status and queue styling**

```css
.arxiv-runtime-status { display: flex; gap: 8px; flex-wrap: wrap; }
.arxiv-card-actions--primary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
```

- [ ] **Step 2: Preserve responsive three/two/one-column modes and reduced-motion behaviour**

Cards must retain `content-visibility: auto`, keyboard-visible focus, and no horizontal overflow at 1366px, 1440px, and 1920px.

- [ ] **Step 3: Expand visual assertions**

The visual script must assert ranking scope text, translation actions, collapsed advanced filters, disabled page-jump controls while searching, and absence of legacy card-level PPT/export controls.

- [ ] **Step 4: Run build and visual check**

Run: `npm run build && npm run visual:check`

### Task 7: Update project records, package, and handoff evidence

**Files:**
- Modify: `README.md`
- Modify: `PLAN.md`
- Modify: `docs/superpowers/specs/2026-07-10-arxiv-reliability-performance-design.md`
- Modify: `docs/superpowers/plans/2026-07-10-arxiv-reliability-performance.md`

- [ ] **Step 1: Document current search, translation, ranking, and fallback behaviour**

Record that arXiv requests use cache-first retrieval and a compliant request gap; explain preview versus explicit page translation, queue priority, quality checks, and page-local reranking.

- [ ] **Step 2: Record verification and remaining external constraints in PLAN.md**

Record test, typecheck, build, visual-check, installer build, packaged visual-check commands and their outcomes. State that arXiv API availability and local NLLB GPU throughput are external-machine constraints.

- [ ] **Step 3: Verify full application and package**

Run: `npm test && npm run typecheck && npm run build && npm run visual:check && npm run dist`

Run: `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`

- [ ] **Step 4: Inspect diff, commit, and push**

Run: `git diff --check`, `git status --short`, then commit only intended sources, tests, docs, and configuration. Push the current feature branch and record any remote failure in PLAN.md.

## Plan self-review

- Spec coverage: Tasks 1-2 implement session and priority scheduling; Task 3 implements quality protection; Task 4 keeps IPC boundaries typed; Task 5 implements ranking and discovery controls; Task 6 covers visual design; Task 7 records and verifies delivery.
- Consistency: `ArxivTranslationPriority`, `sessionId`, and the search-session controller are defined before consumer tasks.
- Scope: No upstream arXiv concurrency increase, cloud-only dependency, broad app refactor, or unrelated project-space change is included.
