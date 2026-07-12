# Focused Research OS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the FTranslate App Shell, home workspace, PDF reader, and AI assistant into a polished light-first Research OS with richer purposeful motion.

**Architecture:** Preserve the existing React state ownership and local persistence contracts. Introduce shared semantic styling and small presentational shell primitives, then migrate each target surface without changing its domain data flow. Keep motion CSS-first and state-driven; use no new runtime dependency unless a verified interaction cannot be expressed safely with existing React and CSS.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, Vite 7, Vitest 4, PDF.js 5, CSS animations.

---

## File map

- Modify `src/renderer/styles/global.css`: semantic Research OS tokens, shared shell/pane/inspector/material/motion rules, and page-specific layout styling.
- Modify `src/renderer/components/AppSidebar.tsx`: grouped Research OS navigation and stable runtime footer.
- Modify `src/renderer/components/AppSidebar.test.ts`: navigation grouping and retained targets.
- Modify `src/renderer/components/HomePage.tsx`: current-task-first hierarchy and progressive research-loop disclosure.
- Modify `src/renderer/components/HomePage.test.ts`: focus, action, metric, and risk contracts.
- Modify `src/renderer/App.tsx`: shared page context classes and PDF workbench composition where the reader is assembled.
- Modify `src/renderer/components/PdfViewer.tsx`: toolbar grouping and reader surface semantics without touching PDF.js rendering behavior.
- Modify `src/renderer/components/AiAssistantPage.tsx`: task conversation and traceable artifact inspector hierarchy.
- Modify `scripts/visual-check.mjs`: assertions and screenshots for redesigned target states.
- Modify `README.md`, `DESIGN.md`, `PLAN.md`: user-facing behavior, design rules, implementation record, verification evidence.

### Task 1: Establish shared Research OS shell and tokens

**Files:**
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/components/AppSidebar.tsx`
- Test: `src/renderer/components/AppSidebar.test.ts`

- [ ] **Step 1: Add failing sidebar contract assertions**

Assert that the sidebar source contains the Research OS groups `项目概览`, `论文与阅读`, `方法与证据`, `实验与运行`, `AI 研究助手`, and `组会与导出`, while retaining each existing navigation callback.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run src/renderer/components/AppSidebar.test.ts`
Expected: FAIL because the new group labels are absent.

- [ ] **Step 3: Implement the grouped sidebar and semantic tokens**

Keep the existing prop interface. Reorder visible entries under group labels, preserve active-section logic, and retain the runtime/settings footer. Add `--ft-os-*` canvas, surface, ink, border, accent, violet, glass, glow, radius, shadow, and motion tokens to `global.css`; add shared `.research-os-*` shell, context bar, pane, inspector, glass-focus, and reduced-motion rules.

- [ ] **Step 4: Verify focused behavior**

Run: `npx vitest run src/renderer/components/AppSidebar.test.ts && npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/AppSidebar.tsx src/renderer/components/AppSidebar.test.ts src/renderer/styles/global.css
git commit -m "feat: establish research os app shell"
```

### Task 2: Recompose the home page around the current task

**Files:**
- Modify: `src/renderer/components/HomePage.tsx`
- Modify: `src/renderer/styles/global.css`
- Test: `src/renderer/components/HomePage.test.ts`

- [ ] **Step 1: Add failing home hierarchy assertions**

Assert that the page contains `当前研究焦点`, `研究闭环进度`, `下一步`, and `检查器`, exposes no more than three primary next-action rows, and retains callbacks for paper import, paper open, experiment matrix, graph, presentation, and research sheet.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run src/renderer/components/HomePage.test.ts`
Expected: FAIL on the new focus and progress labels.

- [ ] **Step 3: Implement current-task-first composition**

Reuse `projectWorkspaceSnapshot` and existing derived workflow data. Render a project context header, one prominent current-focus section, a compact research-loop progress surface with four metrics, up to three ordered actions, and a right inspector with the two highest-priority risks plus recent activity. Move the four workflow objects into a secondary expandable overview while preserving their actions.

- [ ] **Step 4: Add purposeful visual treatment**

Use one violet-blue glass focus surface, a single progress glow, state-based entry classes, and inspector/action stagger. Ensure content is visible without animation and all transitions collapse under reduced motion.

- [ ] **Step 5: Verify home behavior**

Run: `npx vitest run src/renderer/components/HomePage.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/components/HomePage.tsx src/renderer/components/HomePage.test.ts src/renderer/styles/global.css
git commit -m "feat: focus research workspace home"
```

### Task 3: Unify the PDF reading workbench

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/PdfViewer.tsx`
- Modify: `src/renderer/styles/global.css`
- Test: `src/renderer/hooks/useReaderSidePanel.test.ts`
- Test: `src/renderer/components/PdfFigureAssetsPanel.test.ts`

- [ ] **Step 1: Add or extend failing reader layout assertions**

Assert stable semantic regions for document navigation, PDF canvas, evidence/AI inspector, grouped toolbar, and collapsed-inspector rail. Preserve `useReaderSidePanel` expansion semantics and figure asset actions.

- [ ] **Step 2: Run reader tests and confirm the new assertion fails**

Run: `npx vitest run src/renderer/hooks/useReaderSidePanel.test.ts src/renderer/components/PdfFigureAssetsPanel.test.ts`
Expected: existing tests pass and the new semantic layout assertion fails before implementation.

- [ ] **Step 3: Implement reader composition**

Group document/file actions, reading mode, and page/zoom controls in `PdfViewer.tsx`. In `App.tsx`, add stable Research OS reader classes around the existing original, parallel, translated, figures, and notes modes. Preserve PDF.js lifecycle, document loading, translation, selection, and note callbacks.

- [ ] **Step 4: Implement responsive inspector behavior**

At desktop widths, use 248-280px navigation, minmax canvas, and 300-360px inspector. When collapsed, reduce the inspector to a 54px rail and expand the canvas. Add a short selection-focus glow and glass only to the active evidence/AI inspector.

- [ ] **Step 5: Verify reader regression**

Run: `npx vitest run src/renderer/hooks/useReaderSidePanel.test.ts src/renderer/components/PdfFigureAssetsPanel.test.ts src/renderer/lib/pdf*.test.ts && npm run typecheck`
Expected: PASS without PDF rendering contract changes.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/App.tsx src/renderer/components/PdfViewer.tsx src/renderer/styles/global.css src/renderer/hooks/useReaderSidePanel.test.ts src/renderer/components/PdfFigureAssetsPanel.test.ts
git commit -m "feat: unify pdf research workbench"
```

### Task 4: Reshape the AI assistant as a traceable research workspace

**Files:**
- Modify: `src/renderer/components/AiAssistantPage.tsx`
- Modify: `src/renderer/styles/global.css`
- Test: create `src/renderer/components/AiAssistantPage.test.ts`

- [ ] **Step 1: Write source-contract tests**

Assert that the page contains semantic regions/classes for task sessions, conversation, generation timeline, source coverage, unconfirmed fields, write target, and human confirmation. Assert the existing send, stop, retry, queue, and settings callbacks remain referenced.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run src/renderer/components/AiAssistantPage.test.ts`
Expected: FAIL because traceable artifact regions are absent.

- [ ] **Step 3: Implement the three-region assistant**

Keep current hooks and request flow. Recompose the page into a narrow session/task rail, central conversation with inline generation states and citations, and a right artifact inspector. Classify visible output presentation as explanation, candidate conclusion, or writable artifact without changing the stored message schema.

- [ ] **Step 4: Implement AI motion states**

During actual generation only, animate a violet-blue context-flow layer and current timeline step. On success or failure, settle to static. Provide reduced-motion and solid-surface fallbacks.

- [ ] **Step 5: Verify AI assistant**

Run: `npx vitest run src/renderer/components/AiAssistantPage.test.ts src/renderer/lib/aiMode.test.ts src/renderer/hooks/useAiSettings.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/components/AiAssistantPage.tsx src/renderer/components/AiAssistantPage.test.ts src/renderer/styles/global.css
git commit -m "feat: reshape traceable ai research assistant"
```

### Task 5: Visual regression, documentation, and distributable

**Files:**
- Modify: `scripts/visual-check.mjs`
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `PLAN.md`

- [ ] **Step 1: Extend visual checks before final styling fixes**

Capture and assert the redesigned home, sidebar, PDF standard/parallel/collapsed-inspector states, and AI empty/generating/failure states. Add checks for page overflow, clipped primary actions, collapsed rail width, visible focus heading, glass text contrast hooks, and reduced-motion rules.

- [ ] **Step 2: Run the full source verification**

Run: `npm run build`
Expected: all Vitest files pass, both TypeScript projects typecheck, renderer and Electron builds complete.

- [ ] **Step 3: Run source visual regression**

Run: `npm run visual:check`
Expected: exit 0 and refreshed target PNGs under `.tmp-visual-check/`.

- [ ] **Step 4: Perform adversarial screenshot review and correct findings**

Inspect the target PNGs at original resolution for overlap, clipping, horizontal overflow, excessive glow, low glass contrast, repeated card scaffolding, stale page styles, and action visibility. Patch the relevant component/CSS and rerun Steps 2-3 until no P0/P1 visual issue remains.

- [ ] **Step 5: Update project documentation**

Document the Research OS shell, home focus model, reader inspector, AI artifact inspector, motion/material limits, commands, screenshots, known warnings, and remaining risks in README, DESIGN, and PLAN.

- [ ] **Step 6: Build and inspect the Windows package**

Run: `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dist`
Expected: `dist/PDF Translation Reader Setup 0.1.12.exe` rebuilt successfully.

- [ ] **Step 7: Verify packaged UI**

Run: `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`
Expected: exit 0 and packaged screenshots match the source build.

- [ ] **Step 8: Inspect final diff and commit**

```powershell
git diff --check
git status --short
git add README.md DESIGN.md PLAN.md scripts/visual-check.mjs src/renderer
git commit -m "feat: deliver focused research os redesign"
git push
```
