# Paper-to-Code Mapping MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, non-executing Paper-to-Code mapping layer that scans a selected repository, identifies reproducibility entry points, and links code evidence back to the current research project.

**Architecture:** Keep repository scanning in the Electron main process because it reads arbitrary local folders. Keep interpretation, project linkage and paper-to-method matching in renderer pure helpers so tests can run without touching the filesystem. Do not execute user code; this phase only reads small text files under explicit size and directory limits.

**Tech Stack:** Electron main IPC, Node `fs/promises`, TypeScript, Vitest, existing `ResearchProject.codeRepositoryPaths`, existing `MethodCard` evidence model, no new package dependency for the MVP.

---

## First-Principles Frame

The real product gap is that a user can understand a paper but still not know how to reproduce it. The irreducible next object is a code repository map: dependency manifests, likely entry scripts, config files, smoke-test candidates, train/eval candidates, and risks.

Core constraints:

- Repository scan must be read-only and scoped to a user-selected root.
- Never traverse `.git`, `node_modules`, `dist`, large datasets, checkpoints, model weights or generated artifacts.
- Never run `pip`, `conda`, `npm`, `python train.py`, shell scripts or notebooks in this phase.
- Every mapping row must point to a concrete file path and reason, not an AI guess.
- Project linkage should reuse `ResearchProject.codeRepositoryPaths` before inventing a larger database.

## Open-Source Reuse Decision

For this MVP, do not introduce an AST or repository-analysis dependency. Node `fs/promises` plus conservative text scanning is enough to identify manifests and entry candidates. If later phases require language-aware symbol mapping, evaluate `tree-sitter` and language grammars separately for license, Windows packaging impact and install size.

## Out of Scope

- Running code, installing dependencies or creating conda environments.
- Parsing full Python/TypeScript AST.
- GitHub cloning.
- Notebook execution.
- UI redesign. UI agents can consume the generated records later.

### Task 1: Repository Scan Contract

**Files:**
- Create: `src/main/codeRepositoryScanner.ts`
- Create: `src/main/codeRepositoryScanner.test.ts`

- [ ] **Step 1: Write failing scanner tests**

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCodeRepository } from './codeRepositoryScanner';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-code-repo-'));
  await fs.writeFile(path.join(root, 'README.md'), '# Safe RL\n\nRun `python train.py --config configs/nav.yaml`.', 'utf8');
  await fs.writeFile(path.join(root, 'requirements.txt'), 'torch==2.2.0\ngymnasium==0.29.1\n', 'utf8');
  await fs.writeFile(path.join(root, 'train.py'), 'import argparse\nprint("train")\n', 'utf8');
  await fs.mkdir(path.join(root, 'configs'));
  await fs.writeFile(path.join(root, 'configs', 'nav.yaml'), 'env: Navigation-v0\n', 'utf8');
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'ignored', 'utf8');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('scanCodeRepository', () => {
  it('detects manifests, entry candidates and ignores generated folders', async () => {
    const result = await scanCodeRepository({ rootPath: root, now: '2026-07-01T00:00:00.000Z' });

    expect(result.rootPath).toBe(root);
    expect(result.manifests.map((item) => item.fileName)).toEqual(['requirements.txt']);
    expect(result.entryPoints.map((item) => item.filePath.replace(/\\/g, '/'))).toContain('train.py');
    expect(result.configFiles.map((item) => item.filePath.replace(/\\/g, '/'))).toContain('configs/nav.yaml');
    expect(result.files.some((item) => item.filePath.includes('node_modules'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing scanner test**

Run:

```bash
npm test -- src/main/codeRepositoryScanner.test.ts
```

Expected: fail because `scanCodeRepository` does not exist.

- [ ] **Step 3: Implement scanner types and safe traversal**

Create `src/main/codeRepositoryScanner.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';

export interface CodeRepositoryScanRequest {
  rootPath: string;
  now: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
}

export interface CodeRepositoryFileSummary {
  filePath: string;
  fileName: string;
  extension: string;
  bytes: number;
  role: 'readme' | 'manifest' | 'entry' | 'config' | 'script' | 'source' | 'other';
  excerpt: string;
}

export interface CodeRepositoryManifest {
  filePath: string;
  fileName: string;
  kind: 'requirements' | 'environment' | 'pyproject' | 'package-json' | 'setup-py' | 'dockerfile' | 'makefile';
  dependencies: string[];
}

export interface CodeRepositoryEntryPoint {
  filePath: string;
  kind: 'train' | 'eval' | 'test' | 'main' | 'script' | 'notebook';
  commandCandidate: string;
  reason: string;
}

export interface CodeRepositoryScanResult {
  id: string;
  rootPath: string;
  scannedAt: string;
  files: CodeRepositoryFileSummary[];
  manifests: CodeRepositoryManifest[];
  entryPoints: CodeRepositoryEntryPoint[];
  configFiles: CodeRepositoryFileSummary[];
  risks: string[];
}
```

Implement traversal with these rules:

```ts
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.venv', 'venv', '__pycache__', 'checkpoints', 'datasets', 'data', 'models', 'logs']);
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.py', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.sh', '.ps1']);
const MANIFEST_NAMES = new Set(['requirements.txt', 'environment.yml', 'environment.yaml', 'pyproject.toml', 'setup.py', 'package.json', 'Dockerfile', 'Makefile']);
```

Resolve every child path and reject any path that escapes `rootPath`:

```ts
function assertInsideRoot(rootPath: string, childPath: string): void {
  const relative = path.relative(rootPath, childPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to scan outside repository root: ${childPath}`);
  }
}
```

- [ ] **Step 4: Run scanner tests**

```bash
npm test -- src/main/codeRepositoryScanner.test.ts
```

Expected: pass.

### Task 2: Paper-to-Code Data Model

**Files:**
- Create: `src/renderer/lib/codeRepositories.ts`
- Create: `src/renderer/lib/codeRepositories.test.ts`
- Create: `src/renderer/hooks/useCodeRepositories.ts`

- [ ] **Step 1: Write failing serialization tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseCodeRepositories, serializeCodeRepositories } from './codeRepositories';

describe('codeRepositories storage', () => {
  it('round-trips repository records and drops invalid entries', () => {
    const serialized = serializeCodeRepositories([
      {
        id: 'repo-1',
        projectId: 'local-ai-rd-workspace',
        rootPath: 'D:\\repo',
        scannedAt: '2026-07-01T00:00:00.000Z',
        techStack: ['python', 'pytorch'],
        manifests: [],
        entryPoints: [],
        configFiles: [],
        risks: []
      }
    ]);

    expect(parseCodeRepositories(serialized)).toHaveLength(1);
    expect(parseCodeRepositories('[{"id":""}]')).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement storage model**

Create `src/renderer/lib/codeRepositories.ts`:

```ts
export const CODE_REPOSITORIES_KEY = 'pdfTranslationReader:codeRepositories';

export interface CodeRepositoryRecord {
  id: string;
  projectId: string;
  rootPath: string;
  scannedAt: string;
  techStack: string[];
  manifests: Array<{ filePath: string; fileName: string; kind: string; dependencies: string[] }>;
  entryPoints: Array<{ filePath: string; kind: string; commandCandidate: string; reason: string }>;
  configFiles: Array<{ filePath: string; role: string; excerpt: string }>;
  risks: string[];
}

export function serializeCodeRepositories(records: CodeRepositoryRecord[]): string {
  return JSON.stringify(records);
}

export function parseCodeRepositories(value: string | null): CodeRepositoryRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(normalizeCodeRepository).filter(Boolean) as CodeRepositoryRecord[] : [];
  } catch {
    return [];
  }
}
```

Implement `normalizeCodeRepository` with required `id`, `projectId`, `rootPath` and `scannedAt`. Read array fields defensively; invalid arrays become empty arrays.

- [ ] **Step 3: Add hook boundary**

Create `src/renderer/hooks/useCodeRepositories.ts` using the same localStorage pattern as `useMethodCards`:

```ts
import { useCallback, useMemo, useState } from 'react';
import {
  CODE_REPOSITORIES_KEY,
  parseCodeRepositories,
  serializeCodeRepositories,
  type CodeRepositoryRecord
} from '../lib/codeRepositories';

export function useCodeRepositories(projectId: string) {
  const [records, setRecords] = useState<CodeRepositoryRecord[]>(() =>
    parseCodeRepositories(window.localStorage.getItem(CODE_REPOSITORIES_KEY))
  );

  const projectRecords = useMemo(
    () => records.filter((record) => record.projectId === projectId),
    [projectId, records]
  );

  const saveRecords = useCallback((next: CodeRepositoryRecord[]) => {
    setRecords(next);
    window.localStorage.setItem(CODE_REPOSITORIES_KEY, serializeCodeRepositories(next));
  }, []);

  const upsertRepository = useCallback((record: CodeRepositoryRecord) => {
    saveRecords([...records.filter((item) => item.id !== record.id), record]);
  }, [records, saveRecords]);

  return { records: projectRecords, allRecords: records, upsertRepository };
}
```

- [ ] **Step 4: Run storage tests**

```bash
npm test -- src/renderer/lib/codeRepositories.test.ts
```

Expected: pass.

### Task 3: Code Repository IPC

**Files:**
- Create: `src/main/ipc/handlers/codeRepository.ts`
- Create: `src/main/ipc/handlers/codeRepository.test.ts`
- Modify: `src/main/ipc/handlers/index.ts`
- Modify: `src/main/ipc/handlers/index.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Write failing IPC tests**

```ts
import { describe, expect, it } from 'vitest';
import { registerCodeRepositoryIpcHandlers } from './codeRepository';

describe('registerCodeRepositoryIpcHandlers', () => {
  it('registers repository selection and scan channels', () => {
    const channels: string[] = [];
    registerCodeRepositoryIpcHandlers(
      { handle: (channel: string) => channels.push(channel) },
      {
        selectCodeRepository: () => null,
        scanCodeRepository: () => null
      }
    );

    expect(channels).toEqual(['code-repository:select', 'code-repository:scan']);
  });
});
```

- [ ] **Step 2: Implement handler**

Create:

```ts
import type { AsyncOrSync, IpcMainLike } from './types';

export interface CodeRepositoryIpcHandlerDependencies {
  selectCodeRepository: () => AsyncOrSync<unknown>;
  scanCodeRepository: (request: unknown) => AsyncOrSync<unknown>;
}

export function registerCodeRepositoryIpcHandlers(
  ipcMain: IpcMainLike,
  deps: CodeRepositoryIpcHandlerDependencies
): void {
  ipcMain.handle('code-repository:select', async () => deps.selectCodeRepository());
  ipcMain.handle('code-repository:scan', async (_event, request) => deps.scanCodeRepository(request));
}
```

- [ ] **Step 3: Wire app handler registration**

Add `codeRepository: CodeRepositoryIpcHandlerDependencies` to `AppIpcHandlerDependencies`, call `registerCodeRepositoryIpcHandlers`, and add expected channels to `index.test.ts`.

- [ ] **Step 4: Add main-process dependencies**

In `src/main/main.ts`:

```ts
async function selectCodeRepositoryForIpc() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '选择代码仓库',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return { rootPath: result.filePaths[0] };
}

async function scanCodeRepositoryForIpc(request: unknown) {
  if (!request || typeof request !== 'object' || typeof (request as { rootPath?: unknown }).rootPath !== 'string') {
    throw new Error('Invalid code repository scan request.');
  }
  return scanCodeRepository({
    rootPath: (request as { rootPath: string }).rootPath,
    now: new Date().toISOString()
  });
}
```

- [ ] **Step 5: Expose preload API**

Add:

```ts
selectCodeRepository: () => ipcRenderer.invoke('code-repository:select'),
scanCodeRepository: (request: { rootPath: string }) => ipcRenderer.invoke('code-repository:scan', request),
```

- [ ] **Step 6: Run IPC tests**

```bash
npm test -- src/main/ipc/handlers/codeRepository.test.ts src/main/ipc/handlers/index.test.ts
```

Expected: pass.

### Task 4: Method Card to Code Mapping

**Files:**
- Create: `src/renderer/lib/paperToCodeMapping.ts`
- Create: `src/renderer/lib/paperToCodeMapping.test.ts`

- [ ] **Step 1: Write failing mapping tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildPaperToCodeMapping } from './paperToCodeMapping';

describe('buildPaperToCodeMapping', () => {
  it('maps method-card concepts to repository evidence candidates', () => {
    const mapping = buildPaperToCodeMapping({
      methodCard: {
        id: 'method-1',
        projectId: 'local-ai-rd-workspace',
        paperId: 'paper-1',
        title: 'Safe RL',
        status: 'needs-review',
        version: 1,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        evidenceSources: [],
        fields: [
          { id: 'f1', key: 'baseline', label: 'Baseline', value: 'PPO baseline', confidence: 0.8, evidenceSourceIds: ['e1'], status: 'extracted' },
          { id: 'f2', key: 'constraints', label: 'Constraints', value: 'CBF safety constraints', confidence: 0.8, evidenceSourceIds: ['e2'], status: 'extracted' }
        ]
      },
      repository: {
        id: 'repo-1',
        projectId: 'local-ai-rd-workspace',
        rootPath: 'D:\\repo',
        scannedAt: '2026-07-01T00:00:00.000Z',
        techStack: ['python'],
        manifests: [],
        entryPoints: [
          { filePath: 'train_ppo.py', kind: 'train', commandCandidate: 'python train_ppo.py', reason: 'train script' }
        ],
        configFiles: [
          { filePath: 'configs/cbf.yaml', role: 'config', excerpt: 'cbf: true' }
        ],
        risks: []
      }
    });

    expect(mapping.rows.map((row) => row.concept)).toContain('PPO baseline');
    expect(mapping.rows.some((row) => row.codeEvidencePath === 'train_ppo.py')).toBe(true);
    expect(mapping.coverage.mappedConceptCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement mapping helpers**

Create:

```ts
export interface PaperToCodeMappingRow {
  id: string;
  concept: string;
  methodFieldKey: string;
  codeEvidencePath: string;
  evidenceType: 'entry' | 'config' | 'manifest';
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PaperToCodeMappingResult {
  methodCardId: string;
  repositoryId: string;
  rows: PaperToCodeMappingRow[];
  coverage: {
    methodConceptCount: number;
    mappedConceptCount: number;
  };
  risks: string[];
}
```

Use deterministic keyword matching:

- tokenize method field values by English words, Chinese runs and known uppercase acronyms;
- compare against entry file names, command candidates, config paths and excerpts;
- prefer entry points over config files when both match;
- only map fields with at least one `evidenceSourceIds` entry.

- [ ] **Step 3: Run mapping tests**

```bash
npm test -- src/renderer/lib/paperToCodeMapping.test.ts
```

Expected: pass.

### Task 5: Project-Space Linkage

**Files:**
- Modify: `src/renderer/lib/researchProjects.ts`
- Modify: `src/renderer/lib/researchProjects.test.ts`
- Modify: `PLAN.md`

- [ ] **Step 1: Write failing project linkage test**

Add to `src/renderer/lib/researchProjects.test.ts`:

```ts
it('merges code repository paths into the active project without duplicates', () => {
  const project = buildDefaultResearchProject([], Date.parse('2026-07-01T00:00:00.000Z'));
  const next = linkCodeRepositoryPath(project, 'D:\\repo');

  expect(next.codeRepositoryPaths).toEqual(['D:\\repo']);
  expect(linkCodeRepositoryPath(next, 'D:\\repo').codeRepositoryPaths).toEqual(['D:\\repo']);
});
```

- [ ] **Step 2: Implement linkage helper**

Add:

```ts
export function linkCodeRepositoryPath(
  project: ResearchProject,
  repoPath: string,
  now = new Date().toISOString()
): ResearchProject {
  const normalizedPath = repoPath.trim();
  if (!normalizedPath) {
    return project;
  }
  const codeRepositoryPaths = mergeUniqueValues([...project.codeRepositoryPaths, normalizedPath]);
  return {
    ...project,
    codeRepositoryPaths,
    updatedAt: now
  };
}
```

The test should call `linkCodeRepositoryPath(project, 'D:\\repo', '2026-07-01T00:00:00.000Z')` when asserting `updatedAt`.

- [ ] **Step 3: Run project tests**

```bash
npm test -- src/renderer/lib/researchProjects.test.ts
```

Expected: pass.

### Task 6: Headless Repository Demo

**Files:**
- Create: `scripts/code-repo-demo.ts`
- Modify: `tsconfig.demo.json`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add a repeatable fixture demo**

Create a script that writes a temporary fixture under `.tmp-code-repo-demo/fixture`, scans it, builds one repository record and writes artifacts to `demo-output/code-repository/`.

Artifacts:

- `repository-scan.json`
- `repository-summary.md`
- `paper-to-code-mapping.json`

- [ ] **Step 2: Add command**

```json
"demo:code-repo": "tsc -p tsconfig.demo.json && node .tmp-demo-build/scripts/code-repo-demo.js"
```

- [ ] **Step 3: Add output ignore**

`demo-output/` is already ignored. `.tmp-code-repo-demo/` is covered by the existing `.tmp*/` ignore rule, so no new ignore entry is needed for that directory.

- [ ] **Step 4: Run demo**

```bash
npm run demo:code-repo
```

Expected: command writes the three artifacts and exits zero.

### Task 7: UI Handoff Contract

**Files:**
- Modify: `PLAN.md`
- Modify: `README.md`

- [ ] **Step 1: Document UI handoff**

Add to `PLAN.md`:

```md
- UI handoff: Paper-to-Code 页面由 UI 代理接入 `selectCodeRepository`、`scanCodeRepository`、`useCodeRepositories` 和 `buildPaperToCodeMapping`。页面必须显示文件树摘要、manifest、entry command、smoke-test candidate、method-to-code mapping 和风险；不得自动执行仓库代码。
```

- [ ] **Step 2: Document commands**

Add to `README.md`:

```md
Paper-to-Code 数据层完成后，可通过 `npm run demo:code-repo` 生成本地代码仓库扫描样例，验证仓库扫描、入口识别和方法卡到代码证据映射。
```

### Task 8: Verification and Commit

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- src/main/codeRepositoryScanner.test.ts src/main/ipc/handlers/codeRepository.test.ts src/main/ipc/handlers/index.test.ts src/renderer/lib/codeRepositories.test.ts src/renderer/lib/paperToCodeMapping.test.ts src/renderer/lib/researchProjects.test.ts
```

- [ ] **Step 2: Run demo**

```bash
npm run demo:code-repo
```

- [ ] **Step 3: Run typecheck and build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 4: Rebuild installer**

```bash
npm run dist
```

- [ ] **Step 5: Visual check only if UI changed**

If no UI component, layout, style or visual script changed, record in `PLAN.md` that `npm run visual:check` was not run for this slice.

- [ ] **Step 6: Review staged diff**

```bash
git diff --check
git diff --stat
git status --short --branch
```

Confirm no selected repository contents, large data files, checkpoints, logs, private paths beyond explicit demo fixtures, generated installers or unrelated UI changes are staged.

- [ ] **Step 7: Commit and push**

```bash
git add README.md PLAN.md package.json tsconfig.demo.json scripts/code-repo-demo.ts src/main/codeRepositoryScanner.ts src/main/codeRepositoryScanner.test.ts src/main/ipc/handlers/codeRepository.ts src/main/ipc/handlers/codeRepository.test.ts src/main/ipc/handlers/index.ts src/main/ipc/handlers/index.test.ts src/main/main.ts src/main/preload.ts src/renderer/lib/codeRepositories.ts src/renderer/lib/codeRepositories.test.ts src/renderer/hooks/useCodeRepositories.ts src/renderer/lib/paperToCodeMapping.ts src/renderer/lib/paperToCodeMapping.test.ts src/renderer/lib/researchProjects.ts src/renderer/lib/researchProjects.test.ts
git commit -m "feat: add paper to code mapping core"
git push
```
