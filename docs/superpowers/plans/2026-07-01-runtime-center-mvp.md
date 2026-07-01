# Runtime Center MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testable local AI Runtime Center data layer that reports NLLB, Argos, pdf2zh, AI provider, cache and task state without requiring a UI rewrite.

**Architecture:** Reuse existing main-process runtime functions instead of adding new dependencies. Add a small runtime snapshot aggregator, expose it through a dedicated IPC handler, normalize it in renderer pure helpers, and leave the visual Runtime Center page as a UI handoff that consumes the same snapshot contract.

**Tech Stack:** Electron main IPC, TypeScript, Vitest, existing `localTranslationService`, existing `pdfTranslation` helpers, existing AI settings handlers, no new package dependency.

---

## First-Principles Frame

The real user problem is not "show more settings". A local AI research workbench must tell the user whether the machine can actually run the promised local capabilities, what is currently queued, what fell back to CPU or Argos, and what command or path should be fixed next.

Core constraints:

- Never expose API keys, full prompts, or private cache contents in a runtime snapshot.
- Runtime checks must be cheap by default; expensive warmup remains an explicit action.
- The snapshot must be useful without UI: tests and future agents should be able to inspect one JSON object.
- The first slice must reuse `getLocalTranslationStatus`, `checkLocalTranslationInstall`, `checkPdfTranslationEngine`, AI settings and existing progress channels.
- UI agents should consume the snapshot; they should not invent their own runtime state.

## Out of Scope

- Training, fine-tuning, LoRA, embedding index execution.
- New model download or installer automation.
- GPU benchmarking.
- Replacing the existing NLLB worker.
- Redesigning Settings or App Shell UI in this phase.

### Task 1: Runtime Snapshot Contract

**Files:**
- Create: `src/main/runtimeCenter.ts`
- Create: `src/main/runtimeCenter.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Add tests that verify snapshot aggregation, redaction and severity derivation.

```ts
import { describe, expect, it } from 'vitest';
import { buildRuntimeCenterSnapshot } from './runtimeCenter';

describe('buildRuntimeCenterSnapshot', () => {
  it('builds a safe local runtime snapshot', () => {
    const snapshot = buildRuntimeCenterSnapshot({
      now: '2026-07-01T00:00:00.000Z',
      localTranslationStatus: {
        preferredEngine: 'nllb-first',
        nllb: {
          configured: true,
          available: true,
          pythonPath: 'E:\\FTranslateTools\\nllb-ctranslate2\\Scripts\\python.exe',
          modelDir: 'E:\\FTranslateTools\\models\\nllb-200-distilled-600M-ct2-int8',
          tokenizerDir: 'E:\\FTranslateTools\\hf-cache\\nllb-200-distilled-600M-snapshot',
          device: 'auto',
          runtimeDevice: 'cuda',
          runtimeState: 'ready',
          cudaDllDirs: ['E:\\FTranslateTools\\cuda-runtime\\nvidia\\cublas\\bin'],
          lastRuntimeError: '',
          lastFallbackReason: '',
          lastCheckedAt: '2026-07-01T00:00:00.000Z',
          warmupMs: 1234,
          message: 'NLLB worker ready'
        },
        fallback: { engine: 'argos', message: 'Argos fallback retained' },
        worker: { running: true, pending: 0 }
      },
      pdfTranslationEngine: {
        status: 'available',
        command: 'pdf2zh',
        message: 'pdf2zh available',
        installCommand: 'pip install pdf2zh'
      },
      aiProvider: {
        provider: 'kimi',
        baseURL: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.5',
        hasApiKey: true
      },
      queue: [
        { id: 'nllb-worker', kind: 'local-translation', status: 'idle', label: 'NLLB worker' }
      ]
    });

    expect(snapshot.overallStatus).toBe('ready');
    expect(snapshot.capabilities.map((item) => item.id)).toEqual([
      'nllb',
      'argos',
      'pdf2zh',
      'ai-provider'
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('sk-');
    expect(snapshot.queue.pendingCount).toBe(0);
  });

  it('marks runtime degraded when NLLB falls back to CPU', () => {
    const snapshot = buildRuntimeCenterSnapshot({
      now: '2026-07-01T00:00:00.000Z',
      localTranslationStatus: {
        preferredEngine: 'nllb-first',
        nllb: {
          configured: true,
          available: true,
          pythonPath: 'python',
          modelDir: 'E:\\models\\nllb',
          tokenizerDir: 'E:\\models\\tokenizer',
          device: 'auto',
          runtimeDevice: 'cpu',
          runtimeState: 'cpu_fallback',
          cudaDllDirs: [],
          lastRuntimeError: '',
          lastFallbackReason: 'CUDA DLL missing',
          lastCheckedAt: '2026-07-01T00:00:00.000Z',
          warmupMs: 5000,
          message: 'CPU fallback'
        },
        fallback: { engine: 'argos', message: 'Argos fallback retained' },
        worker: { running: true, pending: 2 }
      },
      pdfTranslationEngine: { status: 'available', command: 'pdf2zh', message: 'ok', installCommand: '' },
      aiProvider: { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', hasApiKey: false },
      queue: []
    });

    expect(snapshot.overallStatus).toBe('degraded');
    expect(snapshot.capabilities.find((item) => item.id === 'nllb')?.status).toBe('degraded');
    expect(snapshot.actions.some((action) => action.includes('CUDA'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/main/runtimeCenter.test.ts
```

Expected: fail because `src/main/runtimeCenter.ts` does not exist.

- [ ] **Step 3: Implement the snapshot types and builder**

Create `src/main/runtimeCenter.ts` with this shape:

```ts
import type { LocalTranslationStatus } from './localTranslationService';

export type RuntimeCapabilityStatus = 'ready' | 'degraded' | 'unavailable' | 'unknown';
export type RuntimeOverallStatus = RuntimeCapabilityStatus;
export type RuntimeTaskStatus = 'idle' | 'running' | 'queued' | 'failed';
export type RuntimeTaskKind = 'local-translation' | 'pdf-translation' | 'ai-provider' | 'cache';

export interface RuntimeCapabilitySnapshot {
  id: 'nllb' | 'argos' | 'pdf2zh' | 'ai-provider';
  label: string;
  status: RuntimeCapabilityStatus;
  message: string;
  details: Record<string, string | number | boolean | string[]>;
}

export interface RuntimeTaskSnapshot {
  id: string;
  kind: RuntimeTaskKind;
  status: RuntimeTaskStatus;
  label: string;
  message?: string;
}

export interface RuntimeCenterSnapshotInput {
  now: string;
  localTranslationStatus: LocalTranslationStatus;
  pdfTranslationEngine: {
    status: 'available' | 'unavailable' | 'unknown';
    command?: string;
    message: string;
    installCommand?: string;
  };
  aiProvider: {
    provider: string;
    baseURL: string;
    model: string;
    hasApiKey: boolean;
  };
  queue: RuntimeTaskSnapshot[];
}

export interface RuntimeCenterSnapshot {
  generatedAt: string;
  overallStatus: RuntimeOverallStatus;
  capabilities: RuntimeCapabilitySnapshot[];
  queue: {
    items: RuntimeTaskSnapshot[];
    pendingCount: number;
    runningCount: number;
    failedCount: number;
  };
  actions: string[];
}

export function buildRuntimeCenterSnapshot(input: RuntimeCenterSnapshotInput): RuntimeCenterSnapshot {
  const capabilities = [
    buildNllbCapability(input.localTranslationStatus),
    buildArgosCapability(input.localTranslationStatus),
    buildPdf2zhCapability(input.pdfTranslationEngine),
    buildAiProviderCapability(input.aiProvider)
  ];
  const queue = {
    items: input.queue,
    pendingCount: input.queue.filter((item) => item.status === 'queued').length + input.localTranslationStatus.worker.pending,
    runningCount: input.queue.filter((item) => item.status === 'running').length,
    failedCount: input.queue.filter((item) => item.status === 'failed').length
  };

  return {
    generatedAt: input.now,
    overallStatus: summarizeOverallStatus(capabilities),
    capabilities,
    queue,
    actions: buildRuntimeActions(capabilities)
  };
}
```

Implement helper functions in the same file. Keep each helper pure and deterministic.

- [ ] **Step 4: Run the contract tests**

Run:

```bash
npm test -- src/main/runtimeCenter.test.ts
```

Expected: pass.

### Task 2: Main-Process Runtime IPC

**Files:**
- Create: `src/main/ipc/handlers/runtime.ts`
- Create: `src/main/ipc/handlers/runtime.test.ts`
- Modify: `src/main/ipc/handlers/index.ts`
- Modify: `src/main/ipc/handlers/index.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Write failing IPC handler tests**

```ts
import { describe, expect, it } from 'vitest';
import { registerRuntimeIpcHandlers } from './runtime';

describe('registerRuntimeIpcHandlers', () => {
  it('registers runtime snapshot and check channels', () => {
    const channels: string[] = [];
    registerRuntimeIpcHandlers(
      { handle: (channel: string) => channels.push(channel) },
      {
        getRuntimeCenterSnapshot: () => ({ ok: true }),
        checkRuntimeCenter: () => ({ ok: true })
      }
    );

    expect(channels).toEqual(['runtime-center:snapshot', 'runtime-center:check']);
  });
});
```

- [ ] **Step 2: Run the failing IPC test**

Run:

```bash
npm test -- src/main/ipc/handlers/runtime.test.ts
```

Expected: fail because the runtime handler file does not exist.

- [ ] **Step 3: Implement runtime IPC handler**

Create `src/main/ipc/handlers/runtime.ts`:

```ts
import type { AsyncOrSync, IpcMainLike } from './types';

export interface RuntimeIpcHandlerDependencies {
  getRuntimeCenterSnapshot: () => AsyncOrSync<unknown>;
  checkRuntimeCenter: () => AsyncOrSync<unknown>;
}

export function registerRuntimeIpcHandlers(
  ipcMain: IpcMainLike,
  deps: RuntimeIpcHandlerDependencies
): void {
  ipcMain.handle('runtime-center:snapshot', async () => deps.getRuntimeCenterSnapshot());
  ipcMain.handle('runtime-center:check', async () => deps.checkRuntimeCenter());
}
```

- [ ] **Step 4: Wire handler registration**

Modify `src/main/ipc/handlers/index.ts`:

```ts
import { registerRuntimeIpcHandlers, type RuntimeIpcHandlerDependencies } from './runtime';

export interface AppIpcHandlerDependencies {
  ai: AiIpcHandlerDependencies;
  pdf: PdfIpcHandlerDependencies;
  arxiv: ArxivIpcHandlerDependencies;
  file: FileIpcHandlerDependencies;
  project: ProjectIpcHandlerDependencies;
  runtime: RuntimeIpcHandlerDependencies;
}

export function registerAppIpcHandlers(ipcMain: IpcMainLike, deps: AppIpcHandlerDependencies): void {
  registerAiIpcHandlers(ipcMain, deps.ai);
  registerPdfIpcHandlers(ipcMain, deps.pdf);
  registerProjectIpcHandlers(ipcMain, deps.project);
  registerFileIpcHandlers(ipcMain, deps.file);
  registerArxivIpcHandlers(ipcMain, deps.arxiv);
  registerRuntimeIpcHandlers(ipcMain, deps.runtime);
}
```

Update `src/main/ipc/handlers/index.test.ts` expected channel list by appending:

```ts
'runtime-center:snapshot',
'runtime-center:check'
```

- [ ] **Step 5: Implement main dependencies**

In `src/main/main.ts`, add:

```ts
function getRuntimeCenterSnapshot() {
  return buildRuntimeCenterSnapshot({
    now: new Date().toISOString(),
    localTranslationStatus: getLocalTranslationStatus(),
    pdfTranslationEngine: checkPdfTranslationEngine(),
    aiProvider: buildSafeAiProviderRuntimeSummary(),
    queue: []
  });
}

async function checkRuntimeCenter() {
  const localTranslationStatus = await checkLocalTranslationInstall();
  return buildRuntimeCenterSnapshot({
    now: new Date().toISOString(),
    localTranslationStatus,
    pdfTranslationEngine: checkPdfTranslationEngine(),
    aiProvider: buildSafeAiProviderRuntimeSummary(),
    queue: []
  });
}
```

Add a helper that reads current AI settings but returns only provider, baseURL, model and `hasApiKey`. Do not return the API key.

- [ ] **Step 6: Expose preload API**

Add to `src/main/preload.ts`:

```ts
getRuntimeCenterSnapshot: () => ipcRenderer.invoke('runtime-center:snapshot'),
checkRuntimeCenter: () => ipcRenderer.invoke('runtime-center:check'),
```

- [ ] **Step 7: Run IPC tests**

Run:

```bash
npm test -- src/main/ipc/handlers/runtime.test.ts src/main/ipc/handlers/index.test.ts
```

Expected: pass.

### Task 3: Renderer Snapshot Normalization

**Files:**
- Create: `src/renderer/lib/runtimeCenter.ts`
- Create: `src/renderer/lib/runtimeCenter.test.ts`
- Create: `src/renderer/hooks/useRuntimeCenter.ts`

- [ ] **Step 1: Write failing renderer tests**

```ts
import { describe, expect, it } from 'vitest';
import { summarizeRuntimeCenter, selectRuntimeActionLabel } from './runtimeCenter';

describe('runtimeCenter renderer helpers', () => {
  it('summarizes capability counts and next action', () => {
    const summary = summarizeRuntimeCenter({
      generatedAt: '2026-07-01T00:00:00.000Z',
      overallStatus: 'degraded',
      capabilities: [
        { id: 'nllb', label: 'NLLB', status: 'degraded', message: 'CPU fallback', details: {} },
        { id: 'argos', label: 'Argos', status: 'ready', message: 'fallback', details: {} },
        { id: 'pdf2zh', label: 'pdf2zh', status: 'ready', message: 'ok', details: {} },
        { id: 'ai-provider', label: 'AI provider', status: 'unavailable', message: 'missing key', details: {} }
      ],
      queue: { items: [], pendingCount: 0, runningCount: 0, failedCount: 0 },
      actions: ['配置 AI API Key', '检查 CUDA DLL 路径']
    });

    expect(summary.readyCount).toBe(2);
    expect(summary.degradedCount).toBe(1);
    expect(summary.unavailableCount).toBe(1);
    expect(selectRuntimeActionLabel(summary)).toBe('配置 AI API Key');
  });
});
```

- [ ] **Step 2: Implement pure helpers**

Create `src/renderer/lib/runtimeCenter.ts` with:

```ts
export interface RuntimeCenterViewSummary {
  readyCount: number;
  degradedCount: number;
  unavailableCount: number;
  unknownCount: number;
  nextActions: string[];
}

export function summarizeRuntimeCenter(snapshot: RuntimeCenterSnapshotLike): RuntimeCenterViewSummary {
  return {
    readyCount: countByStatus(snapshot, 'ready'),
    degradedCount: countByStatus(snapshot, 'degraded'),
    unavailableCount: countByStatus(snapshot, 'unavailable'),
    unknownCount: countByStatus(snapshot, 'unknown'),
    nextActions: snapshot.actions
  };
}

export function selectRuntimeActionLabel(summary: RuntimeCenterViewSummary): string {
  return summary.nextActions[0] ?? '刷新运行时状态';
}
```

Define `RuntimeCenterSnapshotLike` locally or import a shared type if Task 1 moves the type to `src/shared`.

- [ ] **Step 3: Add hook boundary**

Create `src/renderer/hooks/useRuntimeCenter.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { summarizeRuntimeCenter } from '../lib/runtimeCenter';

export function useRuntimeCenter() {
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    const next = await window.electronAPI.getRuntimeCenterSnapshot();
    setSnapshot(next);
  }, []);

  const check = useCallback(async () => {
    setIsChecking(true);
    setError('');
    try {
      setSnapshot(await window.electronAPI.checkRuntimeCenter());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(
    () => ({ snapshot, summary: snapshot ? summarizeRuntimeCenter(snapshot as any) : null, isChecking, error, refresh, check }),
    [check, error, isChecking, refresh, snapshot]
  );
}
```

Keep this hook thin. UI agents can replace `any` with a shared type when they connect the page.

- [ ] **Step 4: Run renderer helper tests**

Run:

```bash
npm test -- src/renderer/lib/runtimeCenter.test.ts
```

Expected: pass.

### Task 4: UI Handoff Contract

**Files:**
- Modify: `PLAN.md`
- Modify: `README.md`

- [ ] **Step 1: Document the UI contract**

Update `PLAN.md` with a Runtime Center UI handoff note:

```md
- UI handoff: Runtime Center 页面由 UI 代理接入 `useRuntimeCenter`，主区域展示 capability table、task queue 和 next actions，右侧 Inspector 展示故障详情与可复制修复命令。UI 不得重新调用 NLLB/pdf2zh 检查函数，也不得显示 API key。
```

- [ ] **Step 2: Document the developer command**

Update `README.md` with:

```md
Runtime Center 数据层完成后，可通过 `window.electronAPI.getRuntimeCenterSnapshot()` 获取本机 AI 运行时快照，UI 只消费该快照，不自行探测环境。
```

### Task 5: Verification and Commit

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- src/main/runtimeCenter.test.ts src/main/ipc/handlers/runtime.test.ts src/main/ipc/handlers/index.test.ts src/renderer/lib/runtimeCenter.test.ts
```

- [ ] **Step 2: Run typecheck and build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 3: Rebuild installer**

```bash
npm run dist
```

- [ ] **Step 4: Visual check only if UI changed**

If this task only adds data, IPC, hooks and docs, record in `PLAN.md` that `npm run visual:check` was not run because no UI component, layout, style or visual script changed.

- [ ] **Step 5: Review staged diff**

```bash
git diff --check
git diff --stat
git status --short --branch
```

Confirm no API key, model file, cache file, generated installer or unrelated UI change is staged.

- [ ] **Step 6: Commit and push**

```bash
git add README.md PLAN.md src/main/runtimeCenter.ts src/main/runtimeCenter.test.ts src/main/ipc/handlers/runtime.ts src/main/ipc/handlers/runtime.test.ts src/main/ipc/handlers/index.ts src/main/ipc/handlers/index.test.ts src/main/main.ts src/main/preload.ts src/renderer/lib/runtimeCenter.ts src/renderer/lib/runtimeCenter.test.ts src/renderer/hooks/useRuntimeCenter.ts
git commit -m "feat: add runtime center snapshot"
git push
```
