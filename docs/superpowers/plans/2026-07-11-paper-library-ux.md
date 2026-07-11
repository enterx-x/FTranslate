# Paper Library UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a scalable paper-library workbench with tags, projects, smart views, stable sorting, bulk management, reading progress, and a polished list-plus-inspector UI.

**Architecture:** Extend `PaperRecord` through backward-compatible read normalization, keep project membership authoritative in `ResearchProject.paperIds`, and place all search/filter/sort/bulk behavior in a pure `paperLibraryView` module. Extract the library branch from `HomePage.tsx` into a focused `PaperLibraryPage` component with a CSS module, then wire it to existing App callbacks and the PDF reader page-count signal.

**Tech Stack:** Electron, React 19, TypeScript 5.9, Vite 7, Vitest 4, CSS Modules, localStorage, existing CDP visual-check harness.

---

## File map

- Modify `src/renderer/lib/papers.ts`: add normalized library-management and reading-progress fields.
- Modify `src/renderer/lib/papers.test.ts`: cover legacy migration, tag normalization, timestamps, total pages, completion and upsert preservation.
- Modify `src/renderer/lib/researchProjects.ts`: add explicit project-membership updates and stop automatic paper swallowing for existing projects.
- Modify `src/renderer/lib/researchProjects.test.ts`: cover explicit project linking/unlinking and legacy default-project behavior.
- Create `src/renderer/lib/paperLibraryView.ts`: pure search, filter, sort, smart-view, tag catalog, progress, preferences and bulk-update logic.
- Create `src/renderer/lib/paperLibraryView.test.ts`: exhaustive behavior and 1,000-record performance tests.
- Create `src/renderer/components/PaperLibraryPage.tsx`: the complete library workbench and interaction state.
- Create `src/renderer/components/PaperLibraryPage.test.tsx`: server-rendered structural contract tests without a DOM dependency.
- Create `src/renderer/components/PaperLibraryPage.module.css`: isolated high-density A-layout styling and responsive states.
- Modify `src/renderer/components/HomePage.tsx`: delegate the library branch to `PaperLibraryPage` and keep hub-only behavior local.
- Modify `src/renderer/components/HomePage.test.ts`: update fixtures for the expanded normalized record contract.
- Modify `src/renderer/App.tsx`: pass projects and mutation callbacks, and write `totalPages` from the active PDF.
- Modify `src/main/main.ts`: expose a validated read-only file-existence IPC check for Inspector recovery state.
- Modify `src/main/preload.ts`: expose `fileExists` to the renderer.
- Modify `src/renderer/types/electron.d.ts`: type the read-only file-existence API.
- Modify `scripts/visual-check.mjs`: seed multiple edge-case papers, capture dedicated library screenshots, and assert layout/interaction invariants.
- Modify `package.json` and `package-lock.json`: bump application version to `0.1.14`.
- Modify `README.md`: document paper-library search, tags, sorting, bulk operations and reading progress.
- Modify `PLAN.md`: record implementation decisions, adversarial visual review, verification evidence, remaining risks and installer details.

### Task 1: Expand and migrate `PaperRecord`

**Files:**
- Modify: `src/renderer/lib/papers.test.ts`
- Modify: `src/renderer/lib/papers.ts`

- [ ] **Step 1: Add failing migration and update tests**

Add tests that expect legacy records and new records to normalize to the same required management fields:

```ts
it('normalizes legacy management fields without dropping the paper', () => {
  const [paper] = parsePaperLibrary(JSON.stringify([{
    id: 'legacy',
    pdfPath: 'D:/legacy.pdf',
    pdfName: 'legacy.pdf',
    translationPath: '',
    translationName: '',
    chineseTitle: '',
    englishTitle: 'Legacy',
    journal: '',
    authors: '',
    year: '',
    notes: '',
    lastOpenedAt: '2026-01-02T00:00:00.000Z',
    lastPage: 3
  }]));

  expect(paper).toMatchObject({
    tags: [],
    isPinned: false,
    importedAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  });
  expect(paper.totalPages).toBeUndefined();
  expect(paper.completedAt).toBeUndefined();
});

it('normalizes tags, page counts, completion, and actual updates', () => {
  const paper = buildPaperRecord({
    pdfPath: 'D:/paper.pdf', pdfName: 'paper.pdf', translationPath: '', translationName: '',
    document: parseTranslationFile('译文。', '', ''), now: '2026-01-01T00:00:00.000Z'
  });
  const updated = updatePaperRecord(paper, {
    tags: [' CBF ', 'cbf', 'Safe   RL'], totalPages: 20, lastPage: 8,
    completedAt: '2026-01-03T00:00:00.000Z'
  }, '2026-01-04T00:00:00.000Z');

  expect(updated.tags).toEqual(['CBF', 'Safe RL']);
  expect(updated.totalPages).toBe(20);
  expect(updated.lastPage).toBe(8);
  expect(updated.completedAt).toBe('2026-01-03T00:00:00.000Z');
  expect(updated.updatedAt).toBe('2026-01-04T00:00:00.000Z');
});

it('reports malformed storage without inventing a valid empty snapshot', () => {
  expect(parsePaperLibraryResult('{broken')).toEqual({
    papers: [],
    error: '论文库本地数据无法解析，已保留原始内容。'
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
npx vitest run src/renderer/lib/papers.test.ts
```

Expected: FAIL because `tags`, `isPinned`, `importedAt`, `updatedAt`, `totalPages`, `completedAt`, and the explicit update timestamp are not implemented.

- [ ] **Step 3: Implement the normalized record contract**

Extend the interface and update input types:

```ts
export interface PaperRecord extends PdfTranslationRecordFields {
  tags: string[];
  isPinned: boolean;
  importedAt: string;
  updatedAt: string;
  totalPages?: number;
  completedAt?: string;
}

export function normalizePaperTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags.reduce<string[]>((result, tag) => {
    const display = tag.trim().replace(/\s+/gu, ' ').slice(0, 32);
    const key = display.toLocaleLowerCase();
    if (display && !seen.has(key)) {
      seen.add(key);
      result.push(display);
    }
    return result;
  }, []);
}
```

`buildPaperRecord` sets empty tags, unpinned state, and both timestamps to `now`. `normalizePaperRecord` falls back to `lastOpenedAt` before current time. `updatePaperRecord` accepts an optional `now` argument, clamps `lastPage` and `totalPages`, and normalizes tags. Changes limited to `lastPage`, `lastOpenedAt`, or `totalPages` are reading activity and must not change `updatedAt`; metadata, tags, assets, notes, pinning, or completion changes use the supplied `now`.

Add `parsePaperLibraryResult(value)` returning `{ papers, error? }`. Keep `parsePaperLibrary(value)` as the compatibility wrapper returning `.papers`. A JSON syntax error reports the fixed Chinese warning above; an absent value remains a valid empty library without a warning.

Preserve `tags`, `isPinned`, `importedAt`, `updatedAt`, `totalPages`, and `completedAt` in `upsertPaperRecord` so re-import never destroys user organization.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```powershell
npx vitest run src/renderer/lib/papers.test.ts
```

Expected: all `papers.test.ts` tests pass.

- [ ] **Step 5: Commit the domain-model change**

```powershell
git add src/renderer/lib/papers.ts src/renderer/lib/papers.test.ts
git commit -m "feat: extend paper library records"
```

### Task 2: Make project membership explicit and testable

**Files:**
- Modify: `src/renderer/lib/researchProjects.test.ts`
- Modify: `src/renderer/lib/researchProjects.ts`

- [ ] **Step 1: Add failing project-membership tests**

```ts
it('does not silently add every paper to an existing project', () => {
  const project = makeProject({ paperIds: ['paper-1'] });
  const papers = [makePaper('paper-1'), makePaper('paper-2')];
  expect(ensureResearchProjects([project], papers)[0].paperIds).toEqual(['paper-1']);
});

it('adds and removes selected papers from one project', () => {
  const projects = [makeProject({ id: 'project-a', paperIds: ['paper-1'] })];
  expect(updateProjectPaperMembership(projects, 'project-a', ['paper-2'], 'add', '2026-01-02T00:00:00.000Z')[0])
    .toMatchObject({ paperIds: ['paper-1', 'paper-2'], updatedAt: '2026-01-02T00:00:00.000Z' });
  expect(updateProjectPaperMembership(projects, 'project-a', ['paper-1'], 'remove')[0].paperIds).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
npx vitest run src/renderer/lib/researchProjects.test.ts
```

Expected: FAIL because existing projects still absorb all papers and `updateProjectPaperMembership` does not exist.

- [ ] **Step 3: Implement explicit membership updates**

```ts
export function updateProjectPaperMembership(
  projects: ResearchProject[],
  projectId: string,
  paperIds: readonly string[],
  mode: 'add' | 'remove',
  now = new Date().toISOString()
): ResearchProject[] {
  const selected = new Set(paperIds.filter(Boolean));
  return projects.map((project) => {
    if (project.id !== projectId || selected.size === 0) return project;
    const nextPaperIds = mode === 'add'
      ? mergeUniqueValues([...project.paperIds, ...selected])
      : project.paperIds.filter((id) => !selected.has(id));
    return nextPaperIds.length === project.paperIds.length && nextPaperIds.every((id, index) => id === project.paperIds[index])
      ? project
      : { ...project, paperIds: nextPaperIds, updatedAt: now };
  });
}
```

Keep `buildDefaultResearchProject(papers)` for first-run compatibility, but change `ensureResearchProjects` so a non-empty project collection is normalized without auto-merging new paper IDs.

- [ ] **Step 4: Run focused tests and confirm GREEN**

```powershell
npx vitest run src/renderer/lib/researchProjects.test.ts
```

Expected: all project tests pass.

- [ ] **Step 5: Commit project membership behavior**

```powershell
git add src/renderer/lib/researchProjects.ts src/renderer/lib/researchProjects.test.ts
git commit -m "feat: manage explicit paper project links"
```

### Task 3: Build pure library view and bulk-operation logic

**Files:**
- Create: `src/renderer/lib/paperLibraryView.test.ts`
- Create: `src/renderer/lib/paperLibraryView.ts`

- [ ] **Step 1: Write failing view-model tests**

Cover the complete public contract:

```ts
import { describe, expect, it } from 'vitest';
import type { PaperRecord } from './papers';
import {
  DEFAULT_PAPER_LIBRARY_PREFERENCES,
  DEFAULT_PAPER_LIBRARY_QUERY,
  applyPaperBulkAction,
  buildPaperLibraryView,
  buildPaperTagCatalog,
  deleteTagAcrossLibrary,
  getSelectionSummary,
  parsePaperLibraryViewPreferences,
  serializePaperLibraryViewPreferences,
  sortPapers,
  renameTagAcrossLibrary
} from './paperLibraryView';

function makePaper(id: string, overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id,
    pdfPath: `D:/${id}.pdf`,
    pdfName: `${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: '',
    englishTitle: id,
    journal: '',
    authors: '',
    year: '',
    notes: '',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    lastPage: 1,
    tags: [],
    isPinned: false,
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('paper library view', () => {
  it('uses AND semantics for normalized search tokens', () => {
    const papers = [
      makePaper('a', { englishTitle: 'Control Barrier Functions', authors: 'Ames', tags: ['Safe RL'] }),
      makePaper('b', { englishTitle: 'Control Barrier Functions', authors: 'Other', tags: ['Safe RL'] })
    ];
    expect(buildPaperLibraryView(papers, [], { ...DEFAULT_PAPER_LIBRARY_QUERY, search: 'Barrier Ames' }).items.map((p) => p.id))
      .toEqual(['a']);
  });

  it('filters multiple tags with AND semantics and unknown values last', () => {
    const papers = [
      makePaper('a', { tags: ['CBF', 'Safe RL'], year: '2025' }),
      makePaper('b', { tags: ['CBF'], year: '' })
    ];
    const result = buildPaperLibraryView(papers, [], {
      ...DEFAULT_PAPER_LIBRARY_QUERY,
      activeTags: ['cbf', 'safe rl'], sortKey: 'year', sortDirection: 'desc'
    });
    expect(result.items.map((paper) => paper.id)).toEqual(['a']);
  });

  it('sorts recent activity by max timestamp and keeps pinned papers first', () => {
    const result = sortPapers([
      makePaper('old-pinned', { isPinned: true, updatedAt: '2026-01-01T00:00:00.000Z' }),
      makePaper('new', { updatedAt: '2026-02-01T00:00:00.000Z' })
    ], 'recentActivity', 'desc');
    expect(result.map((paper) => paper.id)).toEqual(['old-pinned', 'new']);
  });

  it('round-trips preferences and rejects invalid persisted values', () => {
    expect(parsePaperLibraryViewPreferences('{"sortKey":"bad"}')).toEqual(DEFAULT_PAPER_LIBRARY_PREFERENCES);
    expect(parsePaperLibraryViewPreferences(serializePaperLibraryViewPreferences({
      ...DEFAULT_PAPER_LIBRARY_PREFERENCES, density: 'comfortable'
    })).density).toBe('comfortable');
  });

  it('applies bulk tags, pinning and completion without mutating input', () => {
    const source = [makePaper('a'), makePaper('b')];
    const next = applyPaperBulkAction(source, new Set(['a']), { type: 'addTags', tags: ['CBF'] }, '2026-03-01T00:00:00.000Z');
    expect(next[0].tags).toEqual(['CBF']);
    expect(next[1]).toBe(source[1]);
    expect(source[0].tags).toEqual([]);
  });

  it.each([
    ['recent', makePaper('recent', { lastOpenedAt: '2026-04-01T00:00:00.000Z' })],
    ['needsOrganizing', makePaper('needs', { englishTitle: '', authors: '', year: '', tags: [] })],
    ['pinned', makePaper('pinned', { isPinned: true })],
    ['completed', makePaper('completed', { completedAt: '2026-04-01T00:00:00.000Z' })]
  ] as const)('supports the %s smart view', (smartView, expectedPaper) => {
    const other = makePaper('other', { authors: 'Author', year: '2026', tags: ['Tag'] });
    const result = buildPaperLibraryView([other, expectedPaper], [], {
      ...DEFAULT_PAPER_LIBRARY_QUERY,
      smartView
    });
    expect(result.items.map((paper) => paper.id)).toContain(expectedPaper.id);
  });

  it.each(['recentActivity', 'title', 'year', 'importedAt', 'lastOpenedAt', 'progress'] as const)(
    'sorts %s in both directions while keeping unknown values last',
    (sortKey) => {
      const knownA = makePaper('a', { englishTitle: 'A', year: '2024', importedAt: '2026-01-01T00:00:00.000Z', totalPages: 10, lastPage: 2 });
      const knownB = makePaper('b', { englishTitle: 'B', year: '2025', importedAt: '2026-02-01T00:00:00.000Z', totalPages: 10, lastPage: 8 });
      const unknown = makePaper('unknown', { pdfName: '', englishTitle: '', year: '', importedAt: '', updatedAt: '', lastOpenedAt: '' });
      expect(sortPapers([unknown, knownB, knownA], sortKey, 'asc').at(-1)?.id).toBe('unknown');
      expect(sortPapers([unknown, knownA, knownB], sortKey, 'desc').at(-1)?.id).toBe('unknown');
    }
  );

  it('builds tag counts and reports hidden selections', () => {
    const papers = [makePaper('a', { tags: ['CBF'] }), makePaper('b', { tags: ['CBF', 'Safe RL'] })];
    expect(buildPaperTagCatalog(papers)).toEqual([
      { key: 'cbf', label: 'CBF', count: 2 },
      { key: 'safe rl', label: 'Safe RL', count: 1 }
    ]);
    expect(getSelectionSummary(new Set(['a', 'b']), [papers[0]])).toEqual({ total: 2, visible: 1, hidden: 1 });
  });

  it('renames and deletes a tag across the library with normalized matching', () => {
    const papers = [makePaper('a', { tags: ['CBF', 'Safe RL'] }), makePaper('b', { tags: ['cbf'] })];
    const renamed = renameTagAcrossLibrary(papers, 'cbf', 'Control Barrier', '2026-03-01T00:00:00.000Z');
    expect(renamed.map((paper) => paper.tags)).toEqual([['Control Barrier', 'Safe RL'], ['Control Barrier']]);
    expect(deleteTagAcrossLibrary(renamed, 'control barrier').map((paper) => paper.tags)).toEqual([['Safe RL'], []]);
  });

  it('keeps the input order when sort values are equal', () => {
    const first = makePaper('first', { year: '2026' });
    const second = makePaper('second', { year: '2026' });
    expect(sortPapers([first, second], 'year', 'desc').map((paper) => paper.id)).toEqual(['first', 'second']);
  });

  it('derives 1,000 records within the agreed local performance budget', () => {
    const papers = Array.from({ length: 1_000 }, (_, index) => makePaper(String(index), {
      englishTitle: `Paper ${index} Control`, authors: `Author ${index}`, tags: index % 2 ? ['CBF'] : ['Safe RL']
    }));
    const startedAt = performance.now();
    const result = buildPaperLibraryView(papers, [], {
      ...DEFAULT_PAPER_LIBRARY_QUERY, search: 'Control', sortKey: 'title'
    });
    expect(result.items).toHaveLength(1_000);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run the new test and confirm RED**

```powershell
npx vitest run src/renderer/lib/paperLibraryView.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the public view-model types and defaults**

```ts
export type PaperLibrarySortKey = 'recentActivity' | 'title' | 'year' | 'importedAt' | 'lastOpenedAt' | 'progress';
export type PaperLibrarySortDirection = 'asc' | 'desc';
export type PaperLibrarySmartView = 'recent' | 'needsOrganizing' | 'pinned' | 'completed' | null;

export interface PaperLibraryQuery {
  search: string;
  activeTags: string[];
  smartView: PaperLibrarySmartView;
  projectId: string | null;
  sortKey: PaperLibrarySortKey;
  sortDirection: PaperLibrarySortDirection;
}

export const DEFAULT_PAPER_LIBRARY_PREFERENCES = {
  sortKey: 'recentActivity', sortDirection: 'desc', density: 'compact', inspectorCollapsed: false
} as const;
```

- [ ] **Step 4: Implement search, filters, sorting, progress, tags, preferences and bulk reducers**

Use `Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })`, stable original-index tie breaking, pinned grouping before direction handling, unknown-value buckets that always remain last, and project membership derived from `ResearchProject.paperIds`.

Export these focused functions:

```ts
getPaperDisplayTitle
getPaperProgress
getPaperActivityTime
buildPaperSearchText
buildPaperTagCatalog
buildPaperLibraryView
sortPapers
applyPaperBulkAction
renameTagAcrossLibrary
deleteTagAcrossLibrary
parsePaperLibraryViewPreferences
serializePaperLibraryViewPreferences
getSelectionSummary
```

Do not mutate input arrays or records.

- [ ] **Step 5: Run view-model tests and confirm GREEN**

```powershell
npx vitest run src/renderer/lib/paperLibraryView.test.ts
```

Expected: all view-model tests pass, including the 1,000-record performance assertion.

- [ ] **Step 6: Run the full unit suite for regression coverage**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit the pure library behavior**

```powershell
git add src/renderer/lib/paperLibraryView.ts src/renderer/lib/paperLibraryView.test.ts
git commit -m "feat: add paper library view model"
```

### Task 4: Build the A-layout paper library workbench

**Files:**
- Create: `src/renderer/components/PaperLibraryPage.tsx`
- Create: `src/renderer/components/PaperLibraryPage.test.tsx`
- Create: `src/renderer/components/PaperLibraryPage.module.css`
- Modify: `src/renderer/components/HomePage.tsx`
- Modify: `src/renderer/components/HomePage.test.ts`

- [ ] **Step 1: Add failing component structure and fixture-contract tests**

Create `PaperLibraryPage.test.tsx` with a real server-rendered contract:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PaperLibraryPage } from './PaperLibraryPage';
import type { PaperRecord } from '../lib/papers';

function makePaper(id: string, overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id,
    pdfName: `${id}.pdf`,
    pdfPath: `C:/papers/${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: '',
    englishTitle: id,
    authors: '',
    journal: '',
    year: '',
    notes: '',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    lastPage: 1,
    tags: [],
    isPinned: false,
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

it('renders the scalable library layout with visible sorting and inspector', () => {
  const paper = makePaper('paper-1', {
    englishTitle: 'Control Barrier Functions', totalPages: 20, lastPage: 8, tags: ['CBF']
  });
  const html = renderToStaticMarkup(<PaperLibraryPage
    papers={[paper]}
    projects={[]}
    onNewProject={vi.fn()}
    onOpenPaper={vi.fn()}
    onOpenResearchSheet={vi.fn()}
    onUpdatePapers={vi.fn()}
    onRemovePapers={vi.fn()}
    onProjectsChange={vi.fn()}
  />);

  expect(html).toContain('data-paper-library-page');
  expect(html).toContain('data-paper-library-navigator');
  expect(html).toContain('data-paper-library-sort');
  expect(html).toContain('最近活动');
  expect(html).toContain('data-paper-library-inspector');
  expect(html).toContain('data-paper-library-resume');
});
```

Update `makePaper` in `HomePage.test.ts` to use the required normalized defaults and add an assertion that the hub's latest-paper calculation still uses `lastOpenedAt`, not library view order:

```ts
const base: PaperRecord = {
  id,
  pdfName: `${id}.pdf`,
  pdfPath: `C:/papers/${id}.pdf`,
  translationPath: '',
  translationName: '',
  chineseTitle: '',
  englishTitle: id,
  authors: '',
  journal: '',
  year: '',
  notes: '',
  lastOpenedAt: '',
  lastPage: 1,
  tags: [], isPinned: false,
  importedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

it('keeps hub latest reading independent from library sorting', () => {
  const opened = makePaper('opened', { lastOpenedAt: '2026-04-01T00:00:00.000Z' });
  const edited = makePaper('edited', { lastOpenedAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' });
  expect(buildHomePageMetrics([edited, opened]).latestPaper?.id).toBe('opened');
});
```

- [ ] **Step 2: Run the focused test and confirm RED if fixtures are incomplete**

```powershell
npx vitest run src/renderer/components/PaperLibraryPage.test.tsx
npx vitest run src/renderer/components/HomePage.test.ts
```

Expected: `PaperLibraryPage.test.tsx` fails because the component does not exist. After the component is created, both test files pass and existing hub metric behavior remains green.

- [ ] **Step 3: Create the `PaperLibraryPage` component contract**

```ts
export interface PaperLibraryPageProps {
  papers: PaperRecord[];
  projects: ResearchProject[];
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onOpenResearchSheet: (paper?: PaperRecord) => void;
  onUpdatePapers: (papers: PaperRecord[]) => void;
  onRemovePapers: (paperIds: string[]) => void;
  onProjectsChange: (projects: ResearchProject[]) => void;
}
```

State must include search, active tags, smart view, project filter, selected paper ID, batch-selected IDs, preferences, tag editor, metadata editor, and destructive confirmation state. Derived rows must use `useMemo(buildPaperLibraryView)`.

- [ ] **Step 4: Implement toolbar, navigator, list and Inspector interactions**

Required interaction details:

- 120ms debounced search, `Escape` clear, visible search state.
- Sort menu with six fields and explicit direction toggle.
- Tag and smart-view filters with counts.
- Project filter derived from project membership.
- Single row selection updates Inspector; checkbox selection does not.
- `Enter` or double-click opens the paper.
- Missing PDF disables resume and exposes a re-import/new-project recovery path.
- Inspector tabs: overview, notes, relations.
- Metadata edit preserves existing fields and updates through `updatePaperRecord`.
- Tag entry supports Enter and comma, normalization and existing-tag suggestions.
- A tag-management menu renames or deletes a tag across the library, shows the affected-paper count, and requires confirmation before applying the pure global tag reducers.
- Batch bar reports hidden selections and supports clear/retain-current.
- Dangerous removal uses an explicit confirmation and states that files are not deleted.
- View preferences persist under `pdfTranslationReader:paperLibraryView`; transient query/selection does not persist.

- [ ] **Step 5: Implement the isolated CSS module**

Use these layout constraints:

```css
.page { min-height: 0; height: 100%; display: flex; flex-direction: column; background: #f4f6f8; }
.workspace { min-height: 0; flex: 1; display: grid; grid-template-columns: 196px minmax(430px, 1fr) 320px; }
.navigator { min-width: 0; border-right: 1px solid var(--ui-border); background: #fafbfc; }
.list { min-width: 0; overflow: auto; content-visibility: auto; }
.inspector { min-width: 0; border-left: 1px solid var(--ui-border); background: #fbfcfd; }
@media (max-width: 1280px) {
  .workspace { grid-template-columns: 176px minmax(0, 1fr); }
  .inspector { position: absolute; inset: 0 0 0 auto; width: min(360px, 42vw); }
}
```

Use the approved graphite shell, cool-white workspace, muted gray-blue selected state, stable low-saturation tag palette, 6-9px radii, 1px borders, restrained shadows and `prefers-reduced-motion` overrides. Do not add gradients, glass effects, marketing hero copy, or high-saturation status blocks.

- [ ] **Step 6: Replace the old HomePage library branch**

When `activeSection === 'library'`, return `PaperLibraryPage`. Delete the old `paper-library-row` branch and its local edit state from `HomePage.tsx`; leave the research hub unchanged.

- [ ] **Step 7: Run focused tests and typecheck**

```powershell
npx vitest run src/renderer/components/PaperLibraryPage.test.tsx
npx vitest run src/renderer/components/HomePage.test.ts
npm run typecheck
```

Expected: all focused tests and both TypeScript projects pass.

- [ ] **Step 8: Commit the workbench UI**

```powershell
git add src/renderer/components/PaperLibraryPage.tsx src/renderer/components/PaperLibraryPage.test.tsx src/renderer/components/PaperLibraryPage.module.css src/renderer/components/HomePage.tsx src/renderer/components/HomePage.test.ts
git commit -m "feat: redesign paper library workbench"
```

### Task 5: Wire App mutations, projects and PDF page counts

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/hooks/usePaperLibrary.test.ts`
- Modify: `src/renderer/hooks/usePaperLibrary.ts`

- [ ] **Step 1: Add failing library batch-state tests**

```ts
it('replaces a batch by id without reordering untouched papers', () => {
  const source = [makePaper('a'), makePaper('b'), makePaper('c')];
  const next = replacePapersInLibrary(source, [makePaper('b', { tags: ['CBF'] }), makePaper('a', { isPinned: true })]);
  expect(next.map((paper) => paper.id)).toEqual(['a', 'b', 'c']);
  expect(next[0].isPinned).toBe(true);
  expect(next[1].tags).toEqual(['CBF']);
});

it('removes a batch of ids without touching files', () => {
  expect(removePapersFromLibrary([makePaper('a'), makePaper('b')], ['a']).map((paper) => paper.id)).toEqual(['b']);
});

it('keeps malformed source storage protected until the user changes the library', () => {
  const snapshot = createPaperLibraryState('{broken');
  expect(snapshot).toMatchObject({ papers: [], persistenceBlocked: true });
  expect(markPaperLibraryChanged(snapshot).persistenceBlocked).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npx vitest run src/renderer/hooks/usePaperLibrary.test.ts
```

Expected: FAIL because the batch helpers do not exist.

- [ ] **Step 3: Implement batch helpers and callbacks**

Export `replacePapersInLibrary`, `removePapersFromLibrary`, `createPaperLibraryState`, and `markPaperLibraryChanged`, then expose memoized `updatePapers(papers)` and `removePapers(ids)` callbacks from `usePaperLibrary`. Persist once per batch through the existing effect. If initial parsing failed, return the fixed warning to App immediately and skip automatic persistence so the malformed raw value is not overwritten; the first explicit user mutation only unblocks future persistence.

- [ ] **Step 4: Wire the page to App state**

Pass `researchProjects`, `setResearchProjects`, `updatePapers`, and `removePapers` through `HomePage` to `PaperLibraryPage`. Project actions call `updateProjectPaperMembership` and then `setResearchProjects` exactly once.

Update the active record when the source PDF reports its page count:

```ts
const handleSourceDocumentLoad = useCallback((nextPageCount: number) => {
  const sourcePdf = sourcePdfRef.current;
  if (sourcePdf && activePdfPathRef.current !== sourcePdf.filePath) {
    return;
  }
  setPageCount(nextPageCount);
  setCurrentPage((page) => Math.min(Math.max(1, page), nextPageCount));
  setPaperLibrary((library) => library.map((paper) =>
    paper.id === activePaperId
      ? updatePaperRecord(paper, { totalPages: nextPageCount })
      : paper
  ));
}, [activePaperId, setCurrentPage, setPageCount, setPaperLibrary]);
```

Avoid updating `updatedAt` on every page navigation. `lastPage` and `lastOpenedAt` represent reading activity; metadata `updatedAt` is reserved for organizational changes.

Add a read-only existence channel in `main.ts`, preload, and renderer types:

```ts
// main.ts
ipcMain.handle('file:path-exists', async (_event, candidate: unknown) => {
  const filePath = typeof candidate === 'string' ? candidate.trim() : '';
  return filePath ? pathExists(filePath) : false;
});

// preload.ts
fileExists: (filePath: string) => ipcRenderer.invoke('file:path-exists', filePath),

// electron.d.ts
fileExists: (filePath: string) => Promise<boolean>;
```

`PaperLibraryPage` checks only the selected paper path, cancels stale async results with an effect-local flag, disables resume when false, and shows the existing import/new-project callback as recovery. The channel returns only a boolean and never exposes file contents.

- [ ] **Step 5: Run hook tests and typecheck**

```powershell
npx vitest run src/renderer/hooks/usePaperLibrary.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit App integration**

```powershell
git add src/renderer/App.tsx src/main/main.ts src/main/preload.ts src/renderer/types/electron.d.ts src/renderer/hooks/usePaperLibrary.ts src/renderer/hooks/usePaperLibrary.test.ts
git commit -m "feat: connect paper library management state"
```

### Task 6: Extend the visual regression harness and adversarial states

**Files:**
- Modify: `scripts/visual-check.mjs`
- Modify: `src/renderer/components/PaperLibraryPage.module.css`
- Modify: `src/renderer/components/PaperLibraryPage.tsx`

- [ ] **Step 1: Seed realistic and adversarial paper records**

Change `loadPaperRecord` to derive eight records from the existing valid visual paper and persist matching projects/preferences:

```js
const makeVisualPaper = (id, overrides = {}) => ({
  ...paper,
  id,
  pdfName: `${id}.pdf`,
  englishTitle: `Visual Paper ${id}`,
  tags: [],
  isPinned: false,
  importedAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
  totalPages: 24,
  ...overrides
});
const visualPapers = [
  makeVisualPaper('visual-selected', { chineseTitle: '控制屏障函数与安全强化学习：面向复杂动态障碍环境的移动机器人安全导航方法研究', tags: ['CBF', 'Safe RL', '控制理论'], lastPage: 18, isPinned: true }),
  makeVisualPaper('visual-long-en', { englishTitle: 'A Very Long English Paper Title for Stress Testing Dense Scientific Library Layouts Across Desktop Window Sizes', authors: 'Author One, Author Two, Author Three, Author Four' }),
  makeVisualPaper('visual-pinn', { englishTitle: 'Physics-Informed Neural Networks', tags: ['PINN'], lastPage: 7 }),
  makeVisualPaper('visual-complete', { englishTitle: 'Model Predictive Path Integral Control', tags: ['MPC'], completedAt: '2026-07-08T00:00:00.000Z', lastPage: 24 }),
  makeVisualPaper('visual-missing', { englishTitle: 'Missing Local PDF Recovery', pdfPath: 'Z:/missing/paper.pdf', tags: ['待修复'] }),
  makeVisualPaper('visual-unknown-pages', { englishTitle: 'Unknown Page Count Paper', totalPages: undefined, lastPage: 11 }),
  makeVisualPaper('visual-unread', { englishTitle: 'Unread Safe Reinforcement Learning', tags: ['Safe RL'], lastPage: 1 }),
  makeVisualPaper('visual-planning', { englishTitle: 'Learning Sampling Distributions for Motion Planning', tags: ['路径规划'], lastPage: 10 })
];
const visualProjects = [{
  id: 'visual-project', name: '移动机器人安全导航', description: '', status: 'active',
  paperIds: ['visual-selected', 'visual-complete'], codeRepositoryPaths: [], experimentIds: [],
  runtimeTaskIds: [], decisionLog: [], createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z'
}];
localStorage.setItem('pdfTranslationReader:paperLibrary', JSON.stringify(visualPapers));
localStorage.setItem('pdfTranslationReader:researchProjects', JSON.stringify(visualProjects));
localStorage.setItem('pdfTranslationReader:paperLibraryView', JSON.stringify({
  sortKey: 'recentActivity', sortDirection: 'desc', density: 'compact', inspectorCollapsed: false
}));
```

- [ ] **Step 2: Add dedicated library assertions and screenshots**

For 1366, 1440 and 1920 widths, assert:

```js
{
  hasLibraryPage: Boolean(document.querySelector('[data-paper-library-page]')),
  hasNavigator: Boolean(document.querySelector('[data-paper-library-navigator]')),
  hasInspector: Boolean(document.querySelector('[data-paper-library-inspector]')),
  rowCount: document.querySelectorAll('[data-paper-library-row]').length,
  sortText: document.querySelector('[data-paper-library-sort]')?.textContent?.trim(),
  hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
  resumeVisible: Boolean(document.querySelector('[data-paper-library-resume]')),
  clippedControls: [...document.querySelectorAll('button')].filter((button) => button.scrollWidth > button.clientWidth + 2).length
}
```

Write `paper-library-1366.png`, `paper-library-1440.png`, and `paper-library-1920.png`. Also capture no-results, batch-selection and collapsed-inspector states.

- [ ] **Step 3: Build before running visual checks**

```powershell
npm run build
npm run visual:check
```

Expected: build and visual script pass and produce dedicated paper-library screenshots.

- [ ] **Step 4: Inspect every relevant screenshot adversarially**

Open the images in `.tmp-visual-check/` and check:

- no overlap, clipping, horizontal scroll or exposed internal scrollbar;
- long titles and tags do not change row height unexpectedly;
- 1366px keeps sorting, at least five rows and resume action visible;
- inspector collapse expands the list instead of leaving a blank rail;
- batch bar does not cover the final list row;
- no high-saturation blue/green/yellow/purple status regression;
- no marketing hero or nested-card clutter.

- [ ] **Step 5: Fix all visible defects and rerun until clean**

Use CSS-only corrections where possible. If semantics or focus order is wrong, change the component and rerun focused tests, typecheck, build, and visual check.

- [ ] **Step 6: Commit visual hardening**

```powershell
git add scripts/visual-check.mjs src/renderer/components/PaperLibraryPage.tsx src/renderer/components/PaperLibraryPage.module.css
git commit -m "test: harden paper library visual states"
```

### Task 7: Update version and user-facing documentation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `PLAN.md`

- [ ] **Step 1: Bump the application version**

```powershell
npm version 0.1.14 --no-git-tag-version
```

Expected: both package files report `0.1.14`.

- [ ] **Step 2: Update README**

Document the new paper-library workflow:

```text
标签/项目/智能视图 -> 搜索和稳定排序 -> 右侧 Inspector -> 继续阅读 -> 批量整理
```

Include the view-preference storage key and clarify that library removal never deletes local files.

- [ ] **Step 3: Update PLAN with implementation and verification evidence**

Add a dated section recording:

- first-principles problem and selected A layout;
- data migration and project-membership decision;
- implemented search/filter/sort/bulk/progress behavior;
- visual adversarial findings and fixes;
- exact test/build/visual/dist results;
- installer path, file size and SHA256;
- remaining risk: no virtualization until real libraries exceed the 1,000-record target.

- [ ] **Step 4: Check documentation diff and commit**

```powershell
git diff --check
git add package.json package-lock.json README.md PLAN.md
git commit -m "docs: record paper library release"
```

### Task 8: Full verification, packaged visual check, installer and push

**Files:**
- Verification only, except fixes discovered by the gates.

- [ ] **Step 1: Run the complete source verification sequence**

```powershell
npm test
npm run typecheck
npm run build
npm run visual:check
```

Expected: all commands pass; record exact Vitest file/test counts and known non-blocking warnings.

- [ ] **Step 2: Build the Windows installer**

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
npm run dist
```

Expected: `dist/PDF Translation Reader Setup 0.1.14.exe` and `dist/win-unpacked/PDF Translation Reader.exe` are created.

- [ ] **Step 3: Run the packaged visual check**

```powershell
$env:VISUAL_CHECK_PACKAGED='1'
npm run visual:check
```

Expected: packaged app passes the same library layout and interaction assertions.

- [ ] **Step 4: Inspect packaged screenshots and installer metadata**

```powershell
$installer = 'dist\PDF Translation Reader Setup 0.1.14.exe'
Get-Item $installer | Select-Object FullName,Length,LastWriteTime
Get-FileHash $installer -Algorithm SHA256
```

Manually inspect the packaged paper-library screenshots at all target widths.

- [ ] **Step 5: Run adversarial git review**

```powershell
git status --short
git diff --check HEAD~1..HEAD
git diff --stat origin/codex/arxiv-session-translation...HEAD
git diff origin/codex/arxiv-session-translation...HEAD -- README.md PLAN.md package.json src/renderer scripts/visual-check.mjs
```

Confirm no `.superpowers/brainstorm`, screenshots, `.tmp-visual-check`, installer binaries, secrets, unrelated files or user changes are staged.

- [ ] **Step 6: Commit any verification-only fixes**

If verification found defects, commit only the relevant fixes:

```powershell
git add src/renderer/lib/papers.ts src/renderer/lib/paperLibraryView.ts src/renderer/components/PaperLibraryPage.tsx src/renderer/components/PaperLibraryPage.module.css scripts/visual-check.mjs README.md PLAN.md
git commit -m "fix: complete paper library release checks"
```

If no defect was found, do not create an empty commit.

- [ ] **Step 7: Push the feature branch**

```powershell
git push -u origin codex/paper-library-ux
```

Expected: local HEAD equals `@{u}` and the remote branch is available.
