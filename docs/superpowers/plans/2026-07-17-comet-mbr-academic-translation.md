# COMET-MBR Academic Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate three paper-level HY-MT2 title/abstract candidates and select the strongest structurally valid bundle with an independent local COMET-MBR evaluator.

**Architecture:** HY-MT2 owns controlled candidate generation with explicit fixed seeds. Pure TypeScript owns hard eligibility, duplicate handling, pair construction, aggregation, degradation, and deterministic selection. A separate Python 3.10 JSONL worker loads pinned `Unbabel/wmt22-comet-da`; the main process controls its lifecycle and never exposes Python directly to the renderer.

**Tech Stack:** Electron 39, TypeScript 5.9, Vitest, Node child processes, Python 3.10, PyTorch CPU, `unbabel-comet==2.2.7`, Hugging Face snapshot `2760a223ac957f30acfb18c8aa649b01cf1d75f2`, SQLite.

---

## File structure

- Create `src/main/cometMbrSelection.ts`: pure candidate, pair, score aggregation, and deterministic selection logic.
- Create `src/main/cometMbrSelection.test.ts`: hard gates, deduplication, aggregation, complete-bundle selection, and degradation tests.
- Create `src/main/cometMbrRuntime.ts`: path resolution, JSONL worker lifecycle, timeout, status, unload, and shutdown.
- Create `src/main/cometMbrRuntime.test.ts`: fake-worker protocol, malformed output, timeout, cancellation, and status tests.
- Create `assets/runtime/comet-mbr/comet_mbr_worker.py`: packaged local scorer.
- Create `scripts/install-comet-mbr.ps1`: isolated verified environment and pinned model snapshot install.
- Create `scripts/benchmark-comet-mbr.ps1`: resource and latency probe without changing application state.
- Modify `src/main/hyMtTranslationService.ts` and `.test.ts`: explicit deterministic generation seed/strict mode.
- Modify `src/main/localTranslationService.ts`: optional generation settings and safe runtime status integration.
- Modify `src/main/arxivTranslationService.ts` and `.test.ts`: three paper bundles, eligibility, COMET selection, v11 cache, progress, fallback.
- Modify `src/shared/arxiv.ts`: selection metadata and progress event types.
- Modify `src/main/main.ts`, `src/main/preload.ts`, and `src/renderer/types/electron.d.ts`: progress event transport and runtime snapshot.
- Modify `src/main/runtimeCenter.ts` and `.test.ts`: `comet-mbr` capability.
- Modify `src/renderer/components/ArxivSearchPage.tsx` and `.test.ts`: real candidate/evaluator stage feedback; remove incompatible fast-title path.
- Modify `src/renderer/lib/arxivUi.ts` and `.test.ts`: concise final quality/degradation label.
- Create `benchmarks/academic-translation-v1.json`: 30 reviewed domain samples and acceptance fields.
- Create `scripts/academic-translation-benchmark.mjs`: baseline/candidate/reference report.
- Modify `README.md` and `PLAN.md`: installation, behavior, verified metrics, and risks.

### Task 1: Build the pure complete-bundle MBR selector

**Files:**
- Create: `src/main/cometMbrSelection.ts`
- Test: `src/main/cometMbrSelection.test.ts`

- [ ] **Step 1: Write failing selection tests**

```ts
import { buildCometPairRequests, selectCometMbrBundle } from './cometMbrSelection';

it('selects one complete title and abstract bundle without cross-seed mixing', () => {
  const bundles = [bundle(42), bundle(3407), bundle(7919)];
  const pairs = buildCometPairRequests(bundles);
  const scores = pairs.map((pair) => ({ ...pair, score: pair.candidateSeed === 3407 ? 0.9 : 0.6 }));
  const selected = selectCometMbrBundle(bundles, scores);
  expect(selected.bundle.seed).toBe(3407);
  expect(selected.bundle.titleZh).toBe(bundles[1].titleZh);
  expect(selected.bundle.abstractZh).toBe(bundles[1].abstractZh);
});

it('never lets a high COMET score rescue an ineligible bundle', () => {
  const selected = selectCometMbrBundle(
    [bundle(42, { eligible: false }), bundle(3407), bundle(7919)],
    [{ candidateSeed: 42, referenceSeed: 3407, segmentIndex: 0, score: 1 }]
  );
  expect(selected.bundle.seed).not.toBe(42);
});
```

Add tests for normalized duplicate bundles, source-token weighting, worst-segment tie-break, fixed-seed tie-break, and three/two/one/zero eligible degradation modes.

- [ ] **Step 2: Run the new test and confirm the missing-module failure**

Run: `npx vitest run src/main/cometMbrSelection.test.ts`

- [ ] **Step 3: Implement explicit domain types and pair construction**

```ts
export interface TranslationCandidateSegment {
  source: string;
  translation: string;
  sourceTokenWeight: number;
  kind: 'title' | 'abstract';
}

export interface TranslationCandidateBundle {
  seed: number;
  titleZh: string;
  abstractZh: string;
  segments: TranslationCandidateSegment[];
  eligible: boolean;
  hardFailures: string[];
  softWarnings: string[];
}

export interface CometPairRequest {
  candidateSeed: number;
  referenceSeed: number;
  segmentIndex: number;
  source: string;
  translation: string;
  reference: string;
  sourceTokenWeight: number;
}
```

Deduplicate only after hard validation, using normalized `titleZh + abstractZh`. Pair only aligned segments with the same kind/index.

- [ ] **Step 4: Implement deterministic aggregation and degradation**

```ts
export type CometMbrSelectionMode =
  | 'comet-mbr'
  | 'two-candidate'
  | 'single-candidate'
  | 'single-unique-candidate'
  | 'no-eligible-candidate'
  | 'evaluator-failed';
```

Aggregate pair scores by candidate. Abstract utility is source-token weighted; the paper-bundle utility is `0.25 * titleUtility + 0.75 * abstractUtility`. Rank by bundle utility, worst title/abstract component, worst segment, warning count, distance from median bundle length, then seed order `42, 3407, 7919`.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run src/main/cometMbrSelection.test.ts`

Commit: `feat(translation): add deterministic comet mbr selector`

### Task 2: Add explicit HY-MT2 candidate seeds

**Files:**
- Modify: `src/main/localTranslationService.ts:32-42`
- Modify: `src/main/hyMtTranslationService.ts:159-205,361-378,470-531`
- Test: `src/main/hyMtTranslationService.test.ts`

- [ ] **Step 1: Write failing generation-profile tests**

```ts
import { buildHyMt2GenerationConfig } from './hyMtTranslationService';

it('uses the requested candidate seed without changing academic decoding', () => {
  expect(buildHyMt2GenerationConfig({ seed: 7919 })).toMatchObject({
    seed: 7919,
    temperature: 0.7,
    top_k: 20,
    top_p: 0.6
  });
});

it('derives a deterministic strict retry seed', () => {
  expect(buildHyMt2GenerationConfig({ seed: 42, strict: true }).seed).toBe(104771);
});
```

- [ ] **Step 2: Run the test and verify the missing export failure**

Run: `npx vitest run src/main/hyMtTranslationService.test.ts`

- [ ] **Step 3: Add generation options and use them in every request**

```ts
export interface LocalTranslationGenerationOptions {
  seed?: number;
  strict?: boolean;
}

export interface LocalTranslateDirectionOptions {
  sourceLanguage?: LocalTranslationLanguage;
  targetLanguage?: LocalTranslationLanguage;
  itemContext?: LocalTranslationItemContext;
  itemContexts?: LocalTranslationItemContext[];
  generation?: LocalTranslationGenerationOptions;
}
```

`buildHyMt2GenerationConfig` clamps the seed to a safe integer. `translateOne` uses the requested seed on its first attempt and `seed + 104729` for the one strict structural retry. Existing callers without a generation profile remain seed 42/3407 compatible.

- [ ] **Step 4: Run HY-MT2 regressions and commit**

Run: `npx vitest run src/main/hyMtTranslationService.test.ts src/main/hyMtTranslationService.integration.test.ts`

The real-model test remains opt-in and may skip when its environment flag is absent.

Commit: `feat(translation): support deterministic candidate seeds`

### Task 3: Implement the isolated COMET JSONL worker

**Files:**
- Create: `assets/runtime/comet-mbr/comet_mbr_worker.py`
- Create: `src/main/cometMbrRuntime.ts`
- Test: `src/main/cometMbrRuntime.test.ts`

- [ ] **Step 1: Write failing runtime protocol tests with an injected fake worker**

```ts
it('correlates score responses and reports the pinned model identity', async () => {
  const runtime = new CometMbrRuntime({ pythonPath, workerPath: fakeWorker, modelPath, timeoutMs: 2_000 });
  const probe = await runtime.probe();
  const scores = await runtime.score([
    { source: 'source', translation: '译文甲', reference: '译文乙' }
  ]);
  expect(probe.modelId).toBe('Unbabel/wmt22-comet-da');
  expect(scores).toEqual([0.75]);
  runtime.close();
});
```

Add malformed JSON, wrong score count, timeout, worker exit, unload, and close tests. Tests never import or download COMET.

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npx vitest run src/main/cometMbrRuntime.test.ts`

- [ ] **Step 3: Implement path/status and request correlation**

```ts
export interface CometMbrRuntimeSnapshot {
  configured: boolean;
  available: boolean;
  pythonPath: string;
  workerPath: string;
  modelPath: string;
  modelId: 'Unbabel/wmt22-comet-da';
  modelRevision: '2760a223ac957f30acfb18c8aa649b01cf1d75f2';
  device: 'cpu' | 'cuda' | 'unknown';
  state: 'not_checked' | 'loading' | 'ready' | 'failed';
  lastError: string;
  pending: number;
}
```

Defaults are `E:\FTranslateTools\comet-mbr\.venv\Scripts\python.exe`, the packaged `assets/runtime/comet-mbr/comet_mbr_worker.py`, and `E:\FTranslateTools\comet-mbr\models\wmt22-comet-da\checkpoints\model.ckpt`. Environment variables may override each path.

- [ ] **Step 4: Implement the Python worker with stdout isolation**

```py
def score(payload):
    global model
    if model is None:
        with contextlib.redirect_stdout(sys.stderr):
            model = load_from_checkpoint(payload["model_path"])
    rows = [{"src": item["source"], "mt": item["translation"], "ref": item["reference"]}
            for item in payload["pairs"]]
    with contextlib.redirect_stdout(sys.stderr):
        output = model.predict(rows, batch_size=1, gpus=1 if torch.cuda.is_available() else 0)
    return [float(value) for value in output.scores]
```

The worker accepts JSONL `probe`, `score`, `unload`, and `shutdown` requests, emits one UTF-8 JSON object per request ID, redirects library output to stderr, and never writes source text to disk. It also supports a one-shot `--probe` CLI flag for installation verification without loading the model.

- [ ] **Step 5: Run runtime tests and commit**

Run: `npx vitest run src/main/cometMbrRuntime.test.ts`

Commit: `feat(translation): add isolated comet runtime`

### Task 4: Create a verified external installer and resource benchmark

**Files:**
- Create: `scripts/install-comet-mbr.ps1`
- Create: `scripts/benchmark-comet-mbr.ps1`

- [ ] **Step 1: Implement preflight and isolated environment creation**

```powershell
param(
  [string]$InstallRoot = 'E:\FTranslateTools\comet-mbr',
  [string]$Python = 'E:\python3.10\python.exe'
)
$ErrorActionPreference = 'Stop'
$requiredFreeBytes = 4GB
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($InstallRoot).Substring(0,1))
if ($drive.Free -lt $requiredFreeBytes) { throw 'COMET-MBR 安装至少需要 4 GiB 可用空间。' }
& $Python -m venv --system-site-packages (Join-Path $InstallRoot '.venv')
```

Install `unbabel-comet==2.2.7` with `--no-cache-dir` inside the venv. Verify the environment imports `torch`, `comet`, and `huggingface_hub` without writing to global site-packages.

- [ ] **Step 2: Download the pinned model snapshot and write a manifest**

Use `huggingface_hub.snapshot_download` with repository `Unbabel/wmt22-comet-da`, revision `2760a223ac957f30acfb18c8aa649b01cf1d75f2`, and the install-root model directory. Write Python path, package versions, model revision, checkpoint size/hash, license URL, and installation timestamp to `manifest.json`. Failed downloads clean only the installer's `.staging` directory.

- [ ] **Step 3: Implement the benchmark script**

The benchmark records probe/load/score/unload duration, peak worker working set, free memory before/after, torch/CUDA identity, and repeated three-candidate pair scoring. It stops HY-MT2 before COMET measurement and never assumes both models can remain resident.

Run: `powershell -ExecutionPolicy Bypass -File .\scripts\benchmark-comet-mbr.ps1`

Expected: a JSON report under `.tmp-comet-benchmark/` and no orphan Python process.

- [ ] **Step 4: Install and verify on the current machine**

Run: `powershell -ExecutionPolicy Bypass -File .\scripts\install-comet-mbr.ps1`

Run: `E:\FTranslateTools\comet-mbr\.venv\Scripts\python.exe assets\runtime\comet-mbr\comet_mbr_worker.py --probe`

Record actual disk footprint and whether CPU scoring is safe. The existing Python 3.10 torch is `2.8.0+cpu`; GPU mode is not claimed unless the isolated environment independently reports CUDA available.

Commit: `build(translation): add verified comet installer`

### Task 5: Integrate three paper-level candidates and cache v11

**Files:**
- Modify: `src/main/arxivTranslationService.ts`
- Test: `src/main/arxivTranslationService.test.ts`
- Modify: `src/shared/arxiv.ts:53-89`

- [ ] **Step 1: Write failing service tests for full candidate bundles**

```ts
it('generates three seeds and caches only the selected complete paper bundle', async () => {
  const generatedSeeds: number[] = [];
  const service = new ArxivTranslationService({
    dbPath,
    candidateTranslateTextsWithEngine: async (texts, seed) => {
      generatedSeeds.push(seed);
      return fakeCandidateBatch(texts, seed);
    },
    cometEvaluator: fakeCometEvaluatorFavoring(3407)
  });
  const result = await service.translatePaper(paper);
  expect(generatedSeeds).toEqual([42, 3407, 7919]);
  expect(result).toMatchObject({ selectionMode: 'comet-mbr', selectedSeed: 3407, candidateCount: 3 });
  expect(await service.translatePaper(paper)).toMatchObject({ cacheHit: true, selectedSeed: 3407 });
});
```

Add tests for one invalid bundle, normalized duplicate bundles, evaluator crash, no eligible bundles, cancellation, and the rule that title/abstract always share one seed.

- [ ] **Step 2: Run the service test and confirm the missing option/result failures**

Run: `npx vitest run src/main/arxivTranslationService.test.ts`

- [ ] **Step 3: Add result/progress metadata**

```ts
export interface ArxivTranslationSelectionMetadata {
  selectionMode: CometMbrSelectionMode;
  candidateCount: number;
  eligibleCandidateCount: number;
  selectedSeed?: number;
  evaluator?: string;
  degradationReason?: string;
}

export type ArxivTranslationProgressStage =
  | 'candidate-generating'
  | 'candidate-validating'
  | 'quality-evaluating'
  | 'completed'
  | 'degraded'
  | 'failed';
```

`ArxivTitleAbstractTranslationResult` extends the selection metadata. Progress includes stable ID, optional session ID, candidate index/total, stage, and message.

- [ ] **Step 4: Generate, validate, and select complete bundles**

Prepare source segments once. Use a HY-MT2-specific segment budget that keeps an abstract whole when the estimated 4,096-token prompt/output budget and four-marker safety limit permit; otherwise retain sentence/paragraph boundary splitting. Generate the same unique batch with seeds `42`, `3407`, and `7919`. Restore and hard-check each title/abstract pair. Build scoring segments from the aligned prepared source and raw translated segments, then call COMET only for eligible unique bundles. Select and cache exactly one complete bundle.

After every candidate has been generated, call `resetHyMt2Runtime()` before loading/scoring COMET on this 15 GB RAM machine. After scoring, issue COMET `unload`; HY-MT2 is restarted only when another queued translation needs it. If an externally managed HY-MT2 endpoint cannot be unloaded, the resource probe must approve concurrent CPU scoring or COMET degrades explicitly.

If COMET is unavailable or fails, select the best hard-valid bundle with deterministic soft-gate ordering and set `selectionMode: 'evaluator-failed'`; do not report COMET success.

- [ ] **Step 5: Upgrade the cache schema and key**

`buildTranslationCacheKey` advances to version `11` and includes `selection: 'mbr-v1'`, seed set, hard-gate version, HY model identity, COMET model/revision, context prompt, and glossary version. Add a nullable/defaulted `selection_json` SQLite column using a guarded `PRAGMA table_info` migration. Cached results restore selection metadata.

- [ ] **Step 6: Run service/quality tests and commit**

Run: `npx vitest run src/main/arxivTranslationService.test.ts src/main/cometMbrSelection.test.ts src/shared/academicTranslationQuality.test.ts`

Commit: `feat(translation): select paper bundles with comet mbr`

### Task 6: Transport real progress and remove the incompatible fast-title path

**Files:**
- Modify: `src/main/main.ts:1454,3218-3236`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/components/ArxivSearchPage.tsx:53-62,383-405,1019-1145,1880-1935`
- Test: `src/renderer/components/ArxivSearchPage.test.ts`

- [ ] **Step 1: Write failing progress-label tests**

```ts
it.each([
  ['candidate-generating', '正在生成候选 2/3'],
  ['candidate-validating', '正在校验候选译文'],
  ['quality-evaluating', '正在独立评估翻译质量'],
  ['degraded', '质量评估降级']
] as const)('renders %s truthfully', (phase, label) => {
  expect(getArxivTranslationFeedbackText({
    paperId: 'p', phase, startedAt: 0, candidateIndex: 2, candidateTotal: 3
  }, 1_000).label).toContain(label);
});
```

- [ ] **Step 2: Run renderer tests and verify the new phases fail**

Run: `npx vitest run src/renderer/components/ArxivSearchPage.test.ts`

- [ ] **Step 3: Send progress through one typed preload subscription**

```ts
onArxivTranslationProgress: (callback) => {
  const listener = (_event: Electron.IpcRendererEvent, progress: ArxivTranslationProgress) => callback(progress);
  ipcRenderer.on('arxiv:translation-progress', listener);
  return () => ipcRenderer.removeListener('arxiv:translation-progress', listener);
}
```

The service callback in `main.ts` sends only typed progress through `mainWindow?.webContents.send`. Renderer filters by stable ID and search session ID.

- [ ] **Step 4: Remove the separate single-candidate fast-title request**

Manual arXiv translation immediately enters `candidate-generating` and calls the full metadata service once. The title appears only after a complete bundle has passed selection, so it cannot disagree with the abstract. Existing cached translations remain instant.

- [ ] **Step 5: Render concise final selection/degradation metadata**

Cards retain one compact attached status strip. Runtime details may show evaluator/model and degradation reason. No new permanent settings row or card is added to search results.

- [ ] **Step 6: Run renderer/type tests and commit**

Run: `npx vitest run src/renderer/components/ArxivSearchPage.test.ts src/renderer/lib/arxivUi.test.ts`

Run: `npm run typecheck`

Commit: `feat(translation): show real candidate selection progress`

### Task 7: Add COMET-MBR to Runtime Center

**Files:**
- Modify: `src/main/runtimeCenter.ts`
- Test: `src/main/runtimeCenter.test.ts`
- Modify: `src/main/main.ts:3218-3236`
- Modify: `src/renderer/lib/runtimeCenter.ts`
- Modify: `src/renderer/types/electron.d.ts`

- [ ] **Step 1: Write a failing capability test**

```ts
expect(snapshot.capabilities.find((item) => item.id === 'comet-mbr')).toMatchObject({
  label: 'COMET-MBR',
  status: 'ready',
  runtimeDevice: 'cpu'
});
```

- [ ] **Step 2: Run the runtime test and confirm the missing capability failure**

Run: `npx vitest run src/main/runtimeCenter.test.ts src/renderer/lib/runtimeCenter.test.ts`

- [ ] **Step 3: Add the capability without exposing source text**

Extend the capability ID union with `comet-mbr`. `BuildRuntimeCenterSnapshotInput` receives `CometMbrRuntimeSnapshot`. Map configured/available/loading/failed states, model revision, device, pending count, and install path. The action text points to the packaged/external install command when unavailable.

- [ ] **Step 4: Run runtime tests and commit**

Run: `npx vitest run src/main/runtimeCenter.test.ts src/renderer/lib/runtimeCenter.test.ts`

Commit: `feat(runtime): expose comet mbr capability`

### Task 8: Add the 30-sample translation benchmark

**Files:**
- Create: `benchmarks/academic-translation-v1.json`
- Create: `scripts/academic-translation-benchmark.mjs`

- [ ] **Step 1: Create reviewed benchmark records**

```json
{
  "id": "rl-safe-navigation-01",
  "domain": "safe-rl",
  "title": "Safe Reinforcement Learning for Contact-Rich Robot Navigation",
  "abstract": "We enforce control barrier function constraints while preserving sample efficiency.",
  "referenceTitleZh": "面向接触丰富机器人导航的安全强化学习",
  "referenceAbstractZh": "我们在保持样本效率的同时施加控制屏障函数约束。",
  "protectedLiterals": ["control barrier function"],
  "requiredTerms": ["安全强化学习", "控制屏障函数", "样本效率"],
  "forbiddenTerms": ["政策", "培训"]
}
```

Create 30 concrete records across the domains in the approved design. References are human-reviewed before being used as acceptance evidence.

- [ ] **Step 2: Implement baseline/new/reference reporting**

The script runs the current single-seed baseline and new three-candidate selector, checks protected/required/forbidden terms, calls COMET with the human reference for offline evaluation, and emits blinded A/B Markdown for human scoring. It records p50/p95 latency and peak resource data from the runtime benchmark.

- [ ] **Step 3: Run and review the benchmark**

Run: `node scripts/academic-translation-benchmark.mjs --fixture benchmarks/academic-translation-v1.json`

Acceptance is blocked unless protected literals pass 100%, mean reference COMET does not regress, and blinded human win/tie reaches 90%. Incomplete human review is reported as incomplete, not converted into a passing score.

Commit: `test(translation): add academic quality benchmark`

### Task 9: Complete release verification and packaging

**Files:**
- Modify: `README.md`
- Modify: `PLAN.md`
- Modify: `package.json` version for the release

- [ ] **Step 1: Run focused real and fake-runtime gates**

Run: `npx vitest run src/main/cometMbrSelection.test.ts src/main/cometMbrRuntime.test.ts src/main/hyMtTranslationService.test.ts src/main/arxivTranslationService.test.ts src/main/runtimeCenter.test.ts src/renderer/components/ArxivSearchPage.test.ts src/renderer/lib/arxivUi.test.ts`

Run the opt-in real worker probe and one three-candidate paper only after the model manifest is verified.

- [ ] **Step 2: Run complete build and visual checks**

Run: `npm run build`

Run: `npm run visual:check`

Inspect source screenshots for arXiv result cards, runtime details, Settings, and Runtime Center at 1366px and wider. Confirm stage text does not shift card layout, degradation is visible, controls remain uncluttered, and no overflow/overlap appears.

- [ ] **Step 3: Update documentation with measured facts**

Document external install size, CPU/CUDA reality, model revision/hash, cold/warm and p50/p95 timing, quality benchmark status, cache v11 migration, explicit degradation, and commands. Avoid a fixed one-second claim for three-candidate COMET selection.

- [ ] **Step 4: Inspect other worktrees before packaging**

List active worktrees and branches. Because this branch is not the user-designated 13 branch, do not merge the plotting worktree. Preserve the two protected untracked brainstorming directories.

- [ ] **Step 5: Build and verify the Windows installer**

Run: `npm run dist`

Run: `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`

Inspect packaged screenshots, compute installer SHA-256, retain only the newest verified installer/blockmap, and start a visible isolated hot preview from the new `dist/win-unpacked` with a unique profile and CDP port.

- [ ] **Step 6: Commit and push the complete release**

Run `git diff --check`, inspect `git diff`, stage only intended files, commit, push, and verify local/upstream SHA equality.

Commit: `feat(translation): ship comet mbr quality selection`
