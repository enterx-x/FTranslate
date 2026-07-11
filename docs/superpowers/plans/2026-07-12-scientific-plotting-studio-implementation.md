# Scientific Plotting Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete local scientific plotting workspace that imports research data, performs explicit traceable statistics, renders with the user-selected JavaScript/Python/R/MATLAB backend, and exports publication assets plus a reproducible `.fplot` package.

**Architecture:** A versioned `ScientificPlotSpec` and normalized `PlotDataTable` are the shared source of truth. Renderer-side pure modules handle data shaping, statistics, themes, and ECharts options; Electron main-process services own filesystem persistence, runtime detection/installation, generated-script execution, job lifecycle, and exports. The React page is a three-column workbench with on-demand import/runtime/export dialogs and no AI path.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, Vitest 4, ExcelJS, Apache ECharts 6.1, ECharts GL 2.1, PapaParse 5.5, simple-statistics 7.9, stdlib distribution CDF packages, fflate 0.8, electron-builder NSIS.

---

## File map

**Shared contracts**

- `src/shared/scientificPlot.ts`: versioned plot/data/stat/runtime/export types and validators.
- `src/shared/scientificPlot.test.ts`: schema normalization, migration, limits, and capability tests.

**Renderer pure logic**

- `src/renderer/lib/plotData.ts`: CSV/paste/workbook normalization, health audit, transformations, and immutable hashes.
- `src/renderer/lib/plotData.test.ts`: import and transformation fixtures.
- `src/renderer/lib/plotStatistics.ts`: explicit analysis execution and annotation provenance.
- `src/renderer/lib/plotStatistics.test.ts`: fixed statistical reference vectors.
- `src/renderer/lib/plotEcharts.ts`: PlotSpec-to-ECharts option compiler and chart compatibility.
- `src/renderer/lib/plotEcharts.test.ts`: option/compiler tests for every chart family.
- `src/renderer/lib/plotThemes.ts`: journal/theme presets and editable lab templates.
- `src/renderer/lib/plotThemes.test.ts`: preset and export-size tests.

**Electron services**

- `src/main/scientificPlotStore.ts`: atomic project folders, snapshots, manifests, `.fplot` import/export.
- `src/main/scientificPlotStore.test.ts`: traversal, atomicity, privacy defaults, and round-trip tests.
- `src/main/plotRuntimeManager.ts`: JS/Python/R/MATLAB detection, installer intent, managed runtime jobs.
- `src/main/plotRuntimeManager.test.ts`: deterministic mocked detection/download/install tests.
- `src/main/plotScriptCompilers.ts`: allowlisted Python/R/MATLAB scripts.
- `src/main/plotScriptCompilers.test.ts`: script snapshots, escaping, and capability coverage.
- `src/main/plotRenderer.ts`: queued child-process execution, cancellation, timeout, cache, stale-preview metadata.
- `src/main/plotRenderer.test.ts`: real Node fixture jobs and mocked external runtimes.
- `src/main/ipc/handlers/scientificPlot.ts`: validated IPC boundary.
- `src/main/ipc/handlers/scientificPlot.test.ts`: channel registration and invalid request tests.
- `assets/plot-runtimes/manifest.json`: pinned official Python/R installer sources and SHA256 hashes.
- `scripts/refresh-plot-runtime-manifest.mjs`: reproducibly refresh the pinned manifest.

**Renderer state/UI**

- `src/renderer/hooks/useScientificPlot.ts`: autosave, import, render polling, cancellation, and stale-result state.
- `src/renderer/hooks/useScientificPlot.test.ts`: reducer/state-machine tests.
- `src/renderer/components/ScientificPlotPage.tsx`: three-column workbench and on-demand dialogs.
- `src/renderer/components/ScientificPlotPage.module.css`: scoped responsive visual system.
- `src/renderer/components/ScientificPlotPage.test.tsx`: source/DOM contract tests.
- `src/renderer/assets/icons/duotone/plot.svg`: sidebar icon matching the existing icon system.

**Integration and packaging**

- Modify `src/renderer/App.tsx`, `src/renderer/contexts/UiContext.tsx`, `src/renderer/components/AppSidebar.tsx`, `src/renderer/components/AppSidebar.test.ts`, `src/renderer/components/ResearchSheetPage.tsx`.
- Modify `src/main/preload.ts`, `src/main/main.ts`, `src/main/ipc/handlers/index.ts`, `src/renderer/types/electron.d.ts`.
- Create `build/installer.nsh`; modify `package.json`, `package-lock.json`, `scripts/visual-check.mjs`, `README.md`, `PLAN.md`.

## Specification coverage matrix

| Confirmed requirement | Implemented by |
| --- | --- |
| 不使用 AI 绘图、不上传数据、不执行任意用户脚本 | Tasks 1, 7, 9, 11, 14 |
| CSV/TSV/Excel、Univer 当前表格/选区、粘贴数据 | Tasks 2, 9, 10, 11 |
| 不可变原始快照、显式转换、数据健康与大数据缓存 | Tasks 2, 5, 10 |
| JavaScript/ECharts、Python、R、MATLAB 真实预览 | Tasks 4, 6, 7, 8, 11 |
| Python/R 私有环境；MATLAB 仅检测 | Tasks 6, 9, 11, 13 |
| 基础图、统计图、误差/分面/多面板、高级图、3D、Sankey/alluvial | Tasks 1, 4, 7, 11 |
| 显著性检验、多重校正、效应量与来源追溯 | Tasks 3, 7, 11 |
| Nature/Science、IEEE、Elsevier、中文论文与实验室模板 | Tasks 4, 11 |
| PNG、SVG、PDF、TIFF、源代码、统计材料、`.fplot` | Tasks 5, 7, 9, 11, 14 |
| 三栏 UI、数据/运行环境/导出按需弹窗 | Tasks 10, 11, 12 |
| 安装器可选 Python/R 与 MATLAB 检测意向 | Tasks 6, 13 |
| 超时、取消、重试、缓存、旧预览过期且禁止误导出 | Tasks 8, 9, 10, 11 |
| 1366/1440/1920 对抗式审查与新安装包 | Task 14 |

## Task 1: Dependencies and versioned shared contract

- [ ] **Step 1: Write the failing shared-contract tests**

Create `src/shared/scientificPlot.test.ts` with tests that require `normalizeScientificPlotSpec`, `createDefaultScientificPlotSpec`, `getRendererCapability`, and `assertPlotDataTable`. Cover schema migration, unknown chart rejection, 250-column/1,000,000-row limits, renderer capability reasons, and preservation of language-independent mappings.

```ts
expect(normalizeScientificPlotSpec({ schemaVersion: '1', chart: { type: 'line' } }).renderer.language)
  .toBe('javascript');
expect(getRendererCapability('matlab', 'surface3d').supported).toBe(true);
expect(() => assertPlotDataTable({ columns: [], rows: [[1]] })).toThrow(/column/i);
```

- [ ] **Step 2: Verify RED**

Run `npm test -- src/shared/scientificPlot.test.ts`. Expected: FAIL because `scientificPlot.ts` does not exist.

- [ ] **Step 3: Install approved dependencies**

Run:

```powershell
npm install echarts@6.1.0 echarts-gl@2.1.0 papaparse@5.5.4 simple-statistics@7.9.3 fflate@0.8.3 `
  @stdlib/stats-base-dists-t-cdf@0.2.3 @stdlib/stats-base-dists-f-cdf@0.2.3 `
  @stdlib/stats-base-dists-chisquare-cdf@0.3.1 @stdlib/stats-base-dists-normal-cdf@0.3.1
npm install --save-dev @types/papaparse@5.5.2
```

- [ ] **Step 4: Implement the shared contract**

Create `src/shared/scientificPlot.ts` with `PlotRendererLanguage`, `ScientificChartType`, `PlotDataTable`, `AnalysisSpec`, `ScientificPlotSpec`, runtime/job/export contracts, hard limits, default spec, migration, and a capability matrix. Validators must copy accepted values instead of trusting arbitrary objects.

```ts
export const SCIENTIFIC_PLOT_SCHEMA_VERSION = '1.0';
export type PlotRendererLanguage = 'javascript' | 'python' | 'r' | 'matlab';
export const PLOT_DATA_LIMITS = { maxColumns: 250, maxRows: 1_000_000, maxCellChars: 100_000 } as const;
```

- [ ] **Step 5: Verify GREEN and commit**

Run `npm test -- src/shared/scientificPlot.test.ts` and `npm run typecheck`. Expected: all target tests pass and typecheck exits 0. Commit as `feat: define scientific plot contract`.

## Task 2: Data import, health audit, and reversible transformations

- [ ] **Step 1: Write failing data tests**

Create `src/renderer/lib/plotData.test.ts`. Include quoted CSV, UTF-8 BOM, TSV, pasted Excel data, duplicate headers, missing values, numeric/category detection, whole `ResearchWorkbook`, selected ranges, wide-to-long, filter, group aggregate, unit formula, and an unchanged raw snapshot assertion.

```ts
const table = parseDelimitedPlotData('algorithm,score\n"CBF, RL",0.91', { sourceName: 'x.csv' });
expect(table.rows[0]).toEqual(['CBF, RL', 0.91]);
expect(auditPlotData(table).missingCellCount).toBe(0);
```

- [ ] **Step 2: Verify RED**

Run `npm test -- src/renderer/lib/plotData.test.ts`. Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement data functions**

Create `plotData.ts` using PapaParse for delimited input and pure adapters for paste/ResearchWorkbook. Implement `auditPlotData`, `applyPlotTransforms`, stable header normalization, explicit type overrides, and `hashPlotDataTable` using deterministic JSON plus Web Crypto when available and a deterministic fallback in tests.

- [ ] **Step 4: Verify GREEN and commit**

Run the target test and `npm test -- src/renderer/lib/researchWorkbook.test.ts`. Commit as `feat: add traceable plot data pipeline`.

## Task 3: Explicit statistical engine and provenance

- [ ] **Step 1: Write failing statistical reference tests**

Create `src/renderer/lib/plotStatistics.test.ts` with fixed vectors for mean/median/SD/SEM/CI, linear regression, independent/paired t, one-way ANOVA, Mann-Whitney, Wilcoxon signed-rank, Kruskal-Wallis, Friedman, Holm/Bonferroni/BH correction, Cohen's d, Hedges' g, eta squared, and rank-biserial effect size. Require invalid paired designs and empty groups to return structured errors rather than p-values.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/renderer/lib/plotStatistics.test.ts`. Expected: FAIL because the engine is missing.

- [ ] **Step 3: Implement the statistical engine**

Create `plotStatistics.ts`. Use simple-statistics for descriptive/regression primitives and stdlib CDFs for p-values. Every result must include `analysisId`, `method`, `sampleSizes`, `statistic`, raw/corrected p, effect size, CI where applicable, input hash, engine/version, and warnings.

```ts
export interface TraceableAnalysisResult {
  analysisId: string;
  method: string;
  sampleSizes: Record<string, number>;
  statistic: number;
  pValue?: number;
  adjustedPValue?: number;
  provenance: { engine: 'javascript'; inputHash: string; generatedAt: string };
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run target tests twice to detect accidental state, then run `npm test -- src/shared/scientificPlot.test.ts src/renderer/lib/plotData.test.ts`. Commit as `feat: add traceable plot statistics`.

## Task 4: Themes and ECharts true rendering compiler

- [ ] **Step 1: Write failing theme/compiler tests**

Create `plotThemes.test.ts` and `plotEcharts.test.ts`. Require generic, Nature/Science, IEEE, Elsevier, Chinese thesis, and lab-copy presets. For every chart type, assert either a valid ECharts series or an explicit unsupported reason; cover CI bands, box/violin/raincloud, heatmaps, contour, 3D, Sankey/alluvial, survival, forest, volcano, facets, and annotations.

- [ ] **Step 2: Verify RED**

Run both target tests. Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement themes and modular ECharts compiler**

Create `plotThemes.ts` and `plotEcharts.ts`. Import ECharts modules from `echarts/core`, register only used components/charts, and load `echarts-gl` only for 3D. Use custom series where ECharts lacks a direct primitive. Return `{ option, warnings, dataPointCount }`; never mutate the PlotSpec.

- [ ] **Step 4: Verify GREEN and commit**

Run target tests and `npm run typecheck`. Commit as `feat: add scientific themes and echarts compiler`.

## Task 5: Atomic project store and `.fplot` packages

- [ ] **Step 1: Write failing store tests**

Create `src/main/scientificPlotStore.test.ts` with a temporary root. Test create/list/load/save, atomic temp-file replacement, snapshot immutability, invalid project IDs, traversal attempts, deduplicated artifacts, `.fplot` round-trip, schema rejection, and privacy defaults excluding raw/derived data.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/main/scientificPlotStore.test.ts`. Expected: FAIL because the store is missing.

- [ ] **Step 3: Implement store and package format**

Create `scientificPlotStore.ts` using `fs/promises`, `crypto`, and fflate. Resolve every path beneath a validated root, write JSON atomically, and make imported packages create a new ID on collision. `.fplot` must include `manifest.json`, `plot-spec.json`, scripts, themes, analyses, selected renders, and data only when the request has explicit include flags.

- [ ] **Step 4: Verify GREEN and commit**

Run target test and `npm run typecheck`. Commit as `feat: persist reproducible plot projects`.

## Task 6: Runtime detection, installer intent, and managed installation

- [ ] **Step 1: Write failing runtime tests**

Create `plotRuntimeManager.test.ts`. Inject filesystem, command runner, fetch, hash, and clock dependencies. Test JS ready, system/private Python, Rscript versus PowerShell `r` alias, MATLAB registry/path and toolbox results, installer INI intent, download hash mismatch, cancellation, safe install arguments, and refusal to delete non-managed paths.

- [ ] **Step 2: Verify RED**

Run the target test. Expected: FAIL because the manager is missing.

- [ ] **Step 3: Add reproducible runtime manifest tooling**

Create `scripts/refresh-plot-runtime-manifest.mjs` with pinned official URLs for Python 3.12 x64 and R 4.5 Windows. The script downloads to OS temp, computes SHA256, writes `assets/plot-runtimes/manifest.json`, and removes only its own temp files. Run it once and inspect URLs/hashes.

- [ ] **Step 4: Implement runtime manager**

Create `plotRuntimeManager.ts` with `detectPlotRuntimes`, `installManagedRuntime`, `cancelRuntimeJob`, `readInstallerIntent`, and `removeManagedRuntime`. Use `spawn(executable, args, { shell: false })`; Python uses the official installer with an explicit private `TargetDir`, R uses its documented silent private directory, and MATLAB has no installation path.

- [ ] **Step 5: Verify GREEN and commit**

Run target tests and typecheck. Commit as `feat: manage scientific plotting runtimes`.

## Task 7: Allowlisted Python/R/MATLAB compilers

- [ ] **Step 1: Write failing compiler tests**

Create `plotScriptCompilers.test.ts`. For each language and chart family, require a script that reads only `plot-spec.json`/`data.json`, writes only the output directory, records versions, and contains no user-provided executable fragments. Include malicious titles/labels to prove safe JSON separation.

- [ ] **Step 2: Verify RED**

Run target tests. Expected: FAIL because compilers are absent.

- [ ] **Step 3: Implement compiler templates**

Create `plotScriptCompilers.ts`. Python uses pandas/matplotlib/seaborn/plotly/scipy/statsmodels; R uses jsonlite/ggplot2/patchwork/ComplexHeatmap/ggalluvial; MATLAB uses built-ins plus detected Statistics Toolbox. Generated scripts consume data/spec files and implement the declared capability matrix, emitting SVG/PNG/HTML, `analysis-results.json`, and `render-manifest.json`.

- [ ] **Step 4: Verify GREEN and commit**

Run compiler tests and shared capability tests. Commit as `feat: generate allowlisted plot scripts`.

## Task 8: Render queue, cancellation, cache, and stale-preview rules

- [ ] **Step 1: Write failing job tests**

Create `plotRenderer.test.ts`. Test queued/running/succeeded/failed/cancelled/timed-out transitions, latest-pending coalescing, cache hits, non-zero exits, missing output, log truncation/redaction, MATLAB manual mode, and preservation of the last successful artifact as `stale` after a failed newer spec.

- [ ] **Step 2: Verify RED**

Run target tests. Expected: FAIL because renderer is missing.

- [ ] **Step 3: Implement `PlotRendererService`**

Create `plotRenderer.ts` with injected runtime manager/store/spawn. Do not use a shell. Validate output manifests and hashes before success. Expose `submit`, `getJob`, `cancel`, `getLastSuccessfulPreview`, and `dispose`.

- [ ] **Step 4: Verify GREEN and commit**

Run target tests and runtime/compiler tests. Commit as `feat: execute plot rendering jobs safely`.

## Task 9: IPC surface and preload types

- [ ] **Step 1: Write failing IPC tests**

Create `src/main/ipc/handlers/scientificPlot.test.ts`. Require channels for project list/load/save, file import, runtime status/install/cancel, render submit/status/cancel, export, and `.fplot` import. Invalid IDs, oversized tables, arbitrary executable paths, and unsupported extensions must reject before dependencies run.

- [ ] **Step 2: Verify RED**

Run target tests. Expected: FAIL because handler is missing.

- [ ] **Step 3: Implement and register IPC**

Create the handler and modify `handlers/index.ts`, `main.ts`, `preload.ts`, and `electron.d.ts`. Reuse shared request/result types rather than duplicate anonymous shapes. Runtime/render progress uses job polling so preload does not leak event listeners.

- [ ] **Step 4: Verify GREEN and commit**

Run IPC tests, `src/main/ipc/handlers/index.test.ts`, and typecheck. Commit as `feat: expose scientific plotting ipc`.

## Task 10: Renderer state machine and Research Sheet bridge

- [ ] **Step 1: Write failing state/bridge tests**

Create `useScientificPlot.test.ts` and extend Research Sheet tests. Cover new project, import source selection, raw snapshot preservation, autosave debounce, render polling, cancellation, stale preview, renderer switching without mapping loss, and selected Univer range conversion.

- [ ] **Step 2: Verify RED**

Run target tests. Expected: FAIL for missing hook/bridge.

- [ ] **Step 3: Implement state and selection bridge**

Create `useScientificPlot.ts`. Modify `ResearchSheetPage.tsx` to emit a serializable selection snapshot through a new callback; keep the latest snapshot in `App.tsx` and pass it to the plotting page. The hook owns reducer state and calls only validated preload APIs.

- [ ] **Step 4: Verify GREEN and commit**

Run target tests plus existing Research Sheet tests. Commit as `feat: connect plot state to research sheets`.

## Task 11: Three-column plotting UI and on-demand dialogs

- [ ] **Step 1: Write failing page contract tests**

Create `ScientificPlotPage.test.tsx`. Assert the persistent UI contains one import button, compact renderer selector/status/manage button, canvas, and Inspector tabs; runtime/import/export are dialogs hidden until requested. Verify no AI controls/text, missing runtimes disable rendering with a repair action, and stale preview blocks current export.

- [ ] **Step 2: Verify RED**

Run target test. Expected: FAIL because page/CSS are absent.

- [ ] **Step 3: Implement UI**

Create the page and CSS module. Implement data/field/transform left rail, real ECharts SVG component or external-render artifact canvas, chart gallery, mappings, layers, statistics design, themes, annotations, runtime manager, script viewer, export dialog, keyboard/Esc/focus behavior, and 1280px Inspector drawer.

- [ ] **Step 4: Verify GREEN and commit**

Run target test, typecheck, and existing component tests. Commit as `feat: build scientific plotting workbench`.

## Task 12: App navigation and project links

- [ ] **Step 1: Extend failing navigation tests**

Update `AppSidebar.test.ts` to require a `plot` section, icon, handler, and label “科研绘图”. Add an App source contract assertion for lazy loading and `AppView='scientificPlot'`.

- [ ] **Step 2: Verify RED**

Run sidebar/App target tests. Expected: FAIL because navigation is not wired.

- [ ] **Step 3: Integrate the page**

Modify `UiContext.tsx`, `AppSidebar.tsx`, and `App.tsx`. Add lazy loading, active-section mapping, selection bridge, project/paper/experiment link props, ErrorBoundary/Suspense, and the existing ConnectedStatusBar.

- [ ] **Step 4: Verify GREEN and commit**

Run sidebar/page tests and typecheck. Commit as `feat: integrate scientific plotting navigation`.

## Task 13: NSIS runtime-intent page and packaging contract

- [ ] **Step 1: Write a failing static packaging test**

Create `src/main/plotInstallerIntent.test.ts`. Read `package.json` and `build/installer.nsh`; require assisted NSIS, custom include, Python/R checkboxes, MATLAB detect-only wording, update skip, and writes beneath `$APPDATA\FTranslate`.

- [ ] **Step 2: Verify RED**

Run target test. Expected: FAIL because the include script/config is absent.

- [ ] **Step 3: Implement installer page**

Create `build/installer.nsh` using `nsDialogs` and electron-builder `customHeader`/custom page hooks. Record only intent to INI; do not download runtimes in NSIS. Modify `package.json` build config to include the script and bump the app version for the new installer.

- [ ] **Step 4: Verify GREEN and commit**

Run packaging test and typecheck. Commit as `build: add plotting runtime installer choices`.

## Task 14: Visual adversarial review, documentation, full verification, and release artifact

- [ ] **Step 1: Add plotting visual scenario before styling fixes**

Extend `scripts/visual-check.mjs` with `runScientificPlotScenario`: navigate to `plot`, import deterministic fixture data, capture empty/imported/runtime-dialog/stale/export states at 1366/1440/1920, and assert no overlaps, clipping, document/page horizontal overflow, persistent runtime panel, missing dialog focus, or AI wording.

- [ ] **Step 2: Run build and source visual check**

Run `npm run build`, then `npm run visual:check`. Expected: build succeeds and the new scenario produces screenshots under `.tmp-visual-check/`. If geometry assertions fail, fix CSS/structure and rerun both commands.

- [ ] **Step 3: Perform manual screenshot review**

Open every new scientific-plot screenshot and check long fields, long Chinese/English titles, dialog edges, scroll ownership, chart readability, stale overlay, and 1366px density. Record found defects and fixes in `PLAN.md`.

- [ ] **Step 4: Update user documentation**

Update `README.md` with import sources, language behavior, environment setup, no-AI/no-upload boundary, export formats, `.fplot`, commands, and troubleshooting. Update `PLAN.md` with implemented scope, TDD evidence, visual findings, known external runtime limitations, and artifact paths.

- [ ] **Step 5: Run fresh full verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run visual:check
$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dist
$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check
```

Expected: all tests pass, both TypeScript projects report zero errors, source and packaged visual checks pass, and a versioned Windows installer plus `win-unpacked` executable exist.

- [ ] **Step 6: Inspect artifacts and Git diff**

Calculate installer size/SHA256, inspect `git diff --check`, confirm no runtime installers, private data, temporary downloads, generated plot projects, or `.superpowers/brainstorm` files are staged. Commit docs/visual/release changes as `release: verify scientific plotting studio` and push `codex/paper-library-ux`.

## Execution checkpoints

- Checkpoint A after Task 4: shared contract, import, statistics, themes, and ECharts compiler are green.
- Checkpoint B after Task 9: persistence, runtimes, scripts, render queue, and IPC are green.
- Checkpoint C after Task 13: full UI/navigation/installer integration is green.
- Final checkpoint after Task 14: source build, source visuals, installer, and packaged visuals are freshly verified.
