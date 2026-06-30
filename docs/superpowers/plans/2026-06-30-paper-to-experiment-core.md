# Paper-to-Experiment Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the non-UI core for the Paper-to-Experiment workflow: persistent experiment matrix state, safe regeneration merge, Markdown export, workbook export, and a React hook that later UI pages can use.

**Architecture:** This plan keeps the current `MethodCard` and `ExperimentMatrixRow` pure-function core and adds a separate state/export layer. The existing freeform Univer research workbook is not modified; generated experiment matrices remain independent project-scoped objects. UI pages are intentionally excluded from this first plan and will consume this core in a follow-up plan.

**Tech Stack:** Electron + React + TypeScript + Vitest, localStorage persistence, existing `ResearchWorkbook` model for Excel-compatible workbook shape.

---

## Scope Check

The approved Paper-to-Experiment spec spans several subsystems: persistence core, method-card UI, experiment-matrix UI, export, homepage routing, and visual regression. This plan implements the first independently shippable slice:

1. experiment matrix persistence model;
2. regeneration merge without overwriting user edits;
3. Markdown export;
4. workbook export helper;
5. React hook for future UI.

This slice must pass unit tests without requiring UI screenshots. UI implementation must be planned separately after this core lands.

## File Structure

- Modify: `src/renderer/lib/experimentMatrix.ts`
  - Owns `ExperimentMatrixState`, parsing, serialization, row merge, row patching, Markdown export, and workbook export.
- Modify: `src/renderer/lib/experimentMatrix.test.ts`
  - Tests state parsing, regeneration merge, edited-row protection, Markdown export, and workbook export.
- Create: `src/renderer/hooks/useExperimentMatrix.ts`
  - React hook that reads/writes `pdfTranslationReader:experimentMatrices` and exposes project-scoped matrix actions.
- Create: `src/renderer/hooks/useExperimentMatrix.test.ts`
  - Tests hook initialization and localStorage persistence with React test renderer.
- Modify: `README.md`
  - Documents the new non-UI core capability and storage key.
- Modify: `PLAN.md`
  - Records implementation progress, validation results, and remaining UI work.

## Task 1: Experiment Matrix State Model

**Files:**
- Modify: `src/renderer/lib/experimentMatrix.ts`
- Modify: `src/renderer/lib/experimentMatrix.test.ts`

- [ ] **Step 1: Write failing tests for state parsing and serialization**

Add these tests to `src/renderer/lib/experimentMatrix.test.ts`:

```ts
import {
  EXPERIMENT_MATRICES_KEY,
  parseExperimentMatrixStates,
  serializeExperimentMatrixStates
} from './experimentMatrix';

it('parses project-scoped experiment matrix states and ignores invalid records', () => {
  const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
  const rawValue = JSON.stringify([
    {
      projectId: 'local-ai-rd-workspace',
      rows,
      selectedRowId: rows[1].id,
      updatedAt: '2026-06-30T10:00:00.000Z',
      version: 2
    },
    { projectId: '', rows: 'bad' }
  ]);

  expect(EXPERIMENT_MATRICES_KEY).toBe('pdfTranslationReader:experimentMatrices');
  expect(parseExperimentMatrixStates(rawValue)).toEqual([
    {
      projectId: 'local-ai-rd-workspace',
      rows,
      selectedRowId: rows[1].id,
      updatedAt: '2026-06-30T10:00:00.000Z',
      version: 2
    }
  ]);
});

it('serializes experiment matrix states with stable formatting', () => {
  const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
  const states = [
    {
      projectId: 'local-ai-rd-workspace',
      rows,
      selectedRowId: rows[0].id,
      updatedAt: '2026-06-30T10:00:00.000Z',
      version: 1
    }
  ];

  expect(serializeExperimentMatrixStates(states)).toBe(JSON.stringify(states, null, 2));
});
```

- [ ] **Step 2: Run the targeted test and confirm RED**

Run:

```powershell
npm test -- src/renderer/lib/experimentMatrix.test.ts
```

Expected: FAIL because `EXPERIMENT_MATRICES_KEY`, `parseExperimentMatrixStates`, and `serializeExperimentMatrixStates` are not exported yet.

- [ ] **Step 3: Add the state model and parser**

Add to `src/renderer/lib/experimentMatrix.ts`:

```ts
export const EXPERIMENT_MATRICES_KEY = 'pdfTranslationReader:experimentMatrices';

export interface ExperimentMatrixState {
  projectId: string;
  rows: ExperimentMatrixRow[];
  selectedRowId: string | null;
  updatedAt: string;
  version: number;
}

export function parseExperimentMatrixStates(value: string | null): ExperimentMatrixState[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeExperimentMatrixState).filter((state): state is ExperimentMatrixState => Boolean(state));
  } catch {
    return [];
  }
}

export function serializeExperimentMatrixStates(states: ExperimentMatrixState[]): string {
  return JSON.stringify(states, null, 2);
}
```

Also add private normalizers that require a non-empty `projectId`, an array of normalized rows, a string or null `selectedRowId`, a string `updatedAt`, and numeric `version >= 1`.

- [ ] **Step 4: Run the targeted test and confirm GREEN**

Run:

```powershell
npm test -- src/renderer/lib/experimentMatrix.test.ts
```

Expected: PASS for all experiment matrix tests.

- [ ] **Step 5: Commit this task**

```powershell
git add src/renderer/lib/experimentMatrix.ts src/renderer/lib/experimentMatrix.test.ts
git commit -m "feat: add experiment matrix state parser"
```

## Task 2: Safe Regeneration Merge

**Files:**
- Modify: `src/renderer/lib/experimentMatrix.ts`
- Modify: `src/renderer/lib/experimentMatrix.test.ts`

- [ ] **Step 1: Write failing tests for merge behavior**

Add these tests:

```ts
import {
  mergeGeneratedExperimentRows,
  updateExperimentMatrixRow
} from './experimentMatrix';

it('merges generated rows without overwriting user-edited rows', () => {
  const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
  const edited = {
    ...rows[1],
    hypothesis: 'user edited hypothesis',
    status: 'running' as const
  };

  const merged = mergeGeneratedExperimentRows([edited], rows);

  expect(merged.find((row) => row.id === edited.id)).toMatchObject({
    hypothesis: 'user edited hypothesis',
    status: 'running'
  });
  expect(merged.map((row) => row.group)).toEqual(['baseline', 'proposed', 'ablation']);
});

it('patches one experiment matrix row while preserving immutable identifiers', () => {
  const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
  const nextRows = updateExperimentMatrixRow(rows, rows[0].id, {
    status: 'blocked',
    metrics: 'manual metric'
  });

  expect(nextRows[0]).toMatchObject({
    id: rows[0].id,
    projectId: rows[0].projectId,
    paperId: rows[0].paperId,
    status: 'blocked',
    metrics: 'manual metric'
  });
});
```

- [ ] **Step 2: Run the targeted test and confirm RED**

Run:

```powershell
npm test -- src/renderer/lib/experimentMatrix.test.ts
```

Expected: FAIL because merge and patch functions are not exported.

- [ ] **Step 3: Implement merge and patch**

Add exported functions:

```ts
export function mergeGeneratedExperimentRows(
  currentRows: ExperimentMatrixRow[],
  generatedRows: ExperimentMatrixRow[]
): ExperimentMatrixRow[] {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const merged = generatedRows.map((generated) => currentById.get(generated.id) ?? generated);
  const generatedIds = new Set(generatedRows.map((row) => row.id));
  return [...merged, ...currentRows.filter((row) => !generatedIds.has(row.id))];
}

export function updateExperimentMatrixRow(
  rows: ExperimentMatrixRow[],
  rowId: string,
  patch: Partial<Omit<ExperimentMatrixRow, 'id' | 'projectId' | 'paperId' | 'methodCardId'>>
): ExperimentMatrixRow[] {
  return rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
}
```

- [ ] **Step 4: Run the targeted test and confirm GREEN**

Run:

```powershell
npm test -- src/renderer/lib/experimentMatrix.test.ts
```

Expected: PASS for all experiment matrix tests.

- [ ] **Step 5: Commit this task**

```powershell
git add src/renderer/lib/experimentMatrix.ts src/renderer/lib/experimentMatrix.test.ts
git commit -m "feat: protect edited experiment rows"
```

## Task 3: Markdown and Workbook Export Helpers

**Files:**
- Modify: `src/renderer/lib/experimentMatrix.ts`
- Modify: `src/renderer/lib/experimentMatrix.test.ts`

- [ ] **Step 1: Write failing export tests**

Add these tests:

```ts
import {
  buildExperimentMatrixWorkbookFromRows,
  exportExperimentMatrixMarkdown
} from './experimentMatrix';

it('exports experiment matrix rows to evidence-preserving markdown', () => {
  const rows = buildExperimentMatrixRowsFromMethodCard(makeCard());
  const markdown = exportExperimentMatrixMarkdown(rows);

  expect(markdown).toContain('# 实验矩阵');
  expect(markdown).toContain('| 论文 | 实验组 | 假设 | Baseline | Proposed Method | Ablation | 控制变量 | Seeds | 指标 | 预期结果 | 状态 | 证据 |');
  expect(markdown).toContain('Safe RL for Robot Navigation');
  expect(markdown).toContain('p. 7 · Results');
});

it('builds an experiment matrix workbook from edited rows', () => {
  const rows = updateExperimentMatrixRow(buildExperimentMatrixRowsFromMethodCard(makeCard()), 'missing', {});
  const workbook = buildExperimentMatrixWorkbookFromRows(rows);

  expect(workbook.sheetName).toBe('实验矩阵');
  expect(workbook.rows).toHaveLength(rows.length + 1);
  expect(workbook.rows[1].id).toBe(rows[0].id);
});
```

- [ ] **Step 2: Run the targeted test and confirm RED**

Run:

```powershell
npm test -- src/renderer/lib/experimentMatrix.test.ts
```

Expected: FAIL because export helpers are not exported.

- [ ] **Step 3: Implement export helpers**

Add:

```ts
export function buildExperimentMatrixWorkbookFromRows(rows: ExperimentMatrixRow[]): ResearchWorkbook {
  return {
    id: 'experiment-matrix-workbook',
    sheetName: '实验矩阵',
    freeze: { ySplit: 1, xSplit: 0 },
    columns: EXPERIMENT_MATRIX_COLUMNS,
    rows: [buildHeaderRow(), ...rows.map(toResearchRow)]
  };
}

export function exportExperimentMatrixMarkdown(rows: ExperimentMatrixRow[]): string {
  const header = EXPERIMENT_MATRIX_COLUMNS.map((column) => column.label);
  const bodyRows = rows.map((row) =>
    EXPERIMENT_MATRIX_COLUMNS.map((column) => escapeMarkdownCell(toCellValue(row, column.key as ExperimentMatrixColumnKey)))
  );

  return [
    '# 实验矩阵',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...bodyRows.map((cells) => `| ${cells.join(' | ')} |`)
  ].join('\n');
}
```

Change `buildExperimentMatrixWorkbookFromMethodCards` to delegate to `buildExperimentMatrixWorkbookFromRows`.

- [ ] **Step 4: Run the targeted test and confirm GREEN**

Run:

```powershell
npm test -- src/renderer/lib/experimentMatrix.test.ts
```

Expected: PASS for all experiment matrix tests.

- [ ] **Step 5: Commit this task**

```powershell
git add src/renderer/lib/experimentMatrix.ts src/renderer/lib/experimentMatrix.test.ts
git commit -m "feat: export experiment matrix core"
```

## Task 4: useExperimentMatrix Hook

**Files:**
- Create: `src/renderer/hooks/useExperimentMatrix.ts`
- Create: `src/renderer/hooks/useExperimentMatrix.test.ts`

- [ ] **Step 1: Write failing hook tests**

Create `src/renderer/hooks/useExperimentMatrix.test.ts`:

```ts
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';
import { EXPERIMENT_MATRICES_KEY, type ExperimentMatrixState } from '../lib/experimentMatrix';
import { useExperimentMatrix } from './useExperimentMatrix';

function HookProbe({ projectId }: { projectId: string }) {
  const matrix = useExperimentMatrix(projectId);
  (globalThis as typeof globalThis & { __matrix?: ReturnType<typeof useExperimentMatrix> }).__matrix = matrix;
  return null;
}

describe('useExperimentMatrix', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (globalThis as typeof globalThis & { __matrix?: ReturnType<typeof useExperimentMatrix> }).__matrix;
  });

  it('initializes a project-scoped matrix state from localStorage', () => {
    const state: ExperimentMatrixState = {
      projectId: 'project-a',
      rows: [],
      selectedRowId: null,
      updatedAt: '2026-06-30T10:00:00.000Z',
      version: 3
    };
    localStorage.setItem(EXPERIMENT_MATRICES_KEY, JSON.stringify([state]));

    act(() => {
      create(<HookProbe projectId="project-a" />);
    });

    expect((globalThis as typeof globalThis & { __matrix?: ReturnType<typeof useExperimentMatrix> }).__matrix?.matrixState).toEqual(state);
  });

  it('persists row edits for the selected project only', () => {
    act(() => {
      create(<HookProbe projectId="project-a" />);
    });

    act(() => {
      (globalThis as typeof globalThis & { __matrix?: ReturnType<typeof useExperimentMatrix> }).__matrix?.setRows([]);
    });

    const saved = JSON.parse(localStorage.getItem(EXPERIMENT_MATRICES_KEY) ?? '[]') as ExperimentMatrixState[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ projectId: 'project-a', rows: [], version: 1 });
  });
});
```

- [ ] **Step 2: Run the hook test and confirm RED**

Run:

```powershell
npm test -- src/renderer/hooks/useExperimentMatrix.test.ts
```

Expected: FAIL because `useExperimentMatrix` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/renderer/hooks/useExperimentMatrix.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import {
  EXPERIMENT_MATRICES_KEY,
  mergeGeneratedExperimentRows,
  parseExperimentMatrixStates,
  serializeExperimentMatrixStates,
  updateExperimentMatrixRow,
  type ExperimentMatrixRow,
  type ExperimentMatrixState
} from '../lib/experimentMatrix';

function createEmptyState(projectId: string): ExperimentMatrixState {
  return {
    projectId,
    rows: [],
    selectedRowId: null,
    updatedAt: new Date().toISOString(),
    version: 1
  };
}

export function useExperimentMatrix(projectId: string) {
  const [states, setStates] = useState<ExperimentMatrixState[]>(() =>
    parseExperimentMatrixStates(localStorage.getItem(EXPERIMENT_MATRICES_KEY))
  );
  const matrixState = useMemo(
    () => states.find((state) => state.projectId === projectId) ?? createEmptyState(projectId),
    [projectId, states]
  );

  useEffect(() => {
    localStorage.setItem(EXPERIMENT_MATRICES_KEY, serializeExperimentMatrixStates(states));
  }, [states]);

  const saveState = (nextState: ExperimentMatrixState) => {
    setStates((current) => [nextState, ...current.filter((state) => state.projectId !== nextState.projectId)]);
  };

  const setRows = (rows: ExperimentMatrixRow[]) => {
    saveState({
      ...matrixState,
      rows,
      updatedAt: new Date().toISOString(),
      version: Math.max(1, matrixState.version)
    });
  };

  const mergeGeneratedRows = (rows: ExperimentMatrixRow[]) => {
    setRows(mergeGeneratedExperimentRows(matrixState.rows, rows));
  };

  const patchRow = (rowId: string, patch: Parameters<typeof updateExperimentMatrixRow>[2]) => {
    setRows(updateExperimentMatrixRow(matrixState.rows, rowId, patch));
  };

  const selectRow = (rowId: string | null) => {
    saveState({
      ...matrixState,
      selectedRowId: rowId,
      updatedAt: new Date().toISOString()
    });
  };

  return {
    matrixState,
    setRows,
    mergeGeneratedRows,
    patchRow,
    selectRow
  };
}
```

- [ ] **Step 4: Run the hook test and confirm GREEN**

Run:

```powershell
npm test -- src/renderer/hooks/useExperimentMatrix.test.ts
```

Expected: PASS for the hook tests.

- [ ] **Step 5: Commit this task**

```powershell
git add src/renderer/hooks/useExperimentMatrix.ts src/renderer/hooks/useExperimentMatrix.test.ts
git commit -m "feat: add experiment matrix hook"
```

## Task 5: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `PLAN.md`

- [ ] **Step 1: Update README**

Update the Experiment Matrix section to mention:

```markdown
- 新增 `pdfTranslationReader:experimentMatrices` 持久化键，按 projectId 保存用户确认和编辑后的实验矩阵；
- 提供安全合并逻辑，重新从方法卡生成时不会静默覆盖用户已编辑行；
- 提供 Markdown 导出和 `ResearchWorkbook` workbook 导出核心，后续 UI 可直接调用。
```

- [ ] **Step 2: Update PLAN**

Record:

```markdown
- 2026-06-30 已完成 Paper-to-Experiment 第一批核心能力：实验矩阵项目级持久化、重新生成安全合并、行编辑、Markdown 导出和 workbook 导出；尚未接入 UI 页面。
```

Add validation record with the exact commands run in this task.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm test -- src/renderer/lib/experimentMatrix.test.ts src/renderer/hooks/useExperimentMatrix.test.ts
npm run typecheck
npm run dist
git diff --check -- README.md PLAN.md src/renderer/lib/experimentMatrix.ts src/renderer/lib/experimentMatrix.test.ts src/renderer/hooks/useExperimentMatrix.ts src/renderer/hooks/useExperimentMatrix.test.ts
```

Expected:

- experiment matrix and hook tests pass;
- typecheck passes;
- dist rebuilds `dist/PDF Translation Reader Setup 0.1.12.exe`;
- diff check has exit code 0.

- [ ] **Step 4: Commit and push**

Stage only files touched by this plan:

```powershell
git add README.md PLAN.md src/renderer/lib/experimentMatrix.ts src/renderer/lib/experimentMatrix.test.ts src/renderer/hooks/useExperimentMatrix.ts src/renderer/hooks/useExperimentMatrix.test.ts
git commit -m "feat: add experiment matrix persistence core"
git push
```

## Self-Review

Spec coverage:

- Persistence model: Task 1 and Task 4.
- Regeneration without overwriting user edits: Task 2.
- Markdown and workbook export: Task 3.
- Project-scoped hook for UI: Task 4.
- README/PLAN and verification: Task 5.
- UI pages, homepage actions, visual regression, and Excel file writing are intentionally excluded from this first core plan and remain for the next implementation plan.

Placeholder scan:

- This plan uses no placeholder requirements and every behavior task contains concrete tests, commands, and implementation snippets.

Type consistency:

- The plan consistently uses `ExperimentMatrixState`, `ExperimentMatrixRow`, `EXPERIMENT_MATRICES_KEY`, `parseExperimentMatrixStates`, `serializeExperimentMatrixStates`, `mergeGeneratedExperimentRows`, `updateExperimentMatrixRow`, `buildExperimentMatrixWorkbookFromRows`, `exportExperimentMatrixMarkdown`, and `useExperimentMatrix`.
