# Headless Research Loop Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable non-UI demo that turns a bundled sample paper evidence set into a method card, an experiment matrix, Markdown output, and a localStorage-compatible seed snapshot.

**Architecture:** Keep demo behavior in pure renderer library functions so tests can verify the research loop without launching Electron. Add a thin Node CLI that compiles through `tsc` and writes deterministic artifacts to `demo-output/research-loop/`.

**Tech Stack:** TypeScript, Vitest, existing Paper-to-Method and Experiment Matrix core helpers, Node `fs/promises` for the CLI.

---

### Task 1: Define Demo Contract

**Files:**
- Create: `src/renderer/lib/researchLoopDemo.test.ts`
- Create: `src/renderer/lib/researchLoopDemo.ts`

- [x] Write failing tests for the default demo result:
  - quality gate passes;
  - one method card is generated from sample evidence;
  - baseline / proposed / ablation rows are generated;
  - artifact names are stable.
- [x] Run the test to verify it fails before implementation.
- [x] Implement the pure demo builder and artifact serializer.
- [x] Re-run the tests.

### Task 2: Add Repeatable CLI

**Files:**
- Create: `scripts/research-loop-demo.ts`
- Create: `tsconfig.demo.json`
- Modify: `package.json`
- Modify: `.gitignore`

- [x] Add `npm run demo:research-loop`.
- [x] Compile the TypeScript CLI into `.tmp-demo-build/`.
- [x] Write demo artifacts into `demo-output/research-loop/`.
- [x] Make the CLI exit non-zero if the quality gate fails.

### Task 3: Document Handoff and Verification

**Files:**
- Modify: `README.md`
- Modify: `PLAN.md`

- [x] Record UI work as a handoff plan in `PLAN.md` without changing UI code.
- [x] Document demo command and output files.
- [x] Run `npm run demo:research-loop`, tests, typecheck, build, and dist.
