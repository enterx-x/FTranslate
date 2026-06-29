# FTranslate UI Foundation Plan

Date: 2026-06-29

## Objective

Move the first screen and global navigation away from the legacy PDF-translator entry page toward the `DESIGN.md` research workbench baseline.

This pass is intentionally wider than a single homepage polish, but still limited to reversible UI foundation work:

- Update `AGENTS.md` so every future project operation reads `DESIGN.md` together with `README.md` and `PLAN.md`.
- Replace the homepage hub with a dense AI research workspace layout:
  - current research objects;
  - Paper-to-Method / Paper-to-Code / experiment / runtime pipeline status;
  - recent papers and next actions;
  - risks and decision queue.
- Align the left navigation with the light workbench direction while keeping it compact.
- Add tests around the homepage overview derivation so the UI status language is backed by existing local data, not hard-coded decoration.
- Update `README.md` and `PLAN.md` with the new verified state and GSAP decision.

## First-Principles Notes

The real user problem is not finding another PDF translation button. The first screen should answer:

1. What research objects exist locally?
2. What part of the research loop is ready, planned, or blocked?
3. What should the user do next?
4. What is missing from the future project-space model?

Current reusable assets:

- existing paper library data;
- knowledge graph stats;
- research sheet / graph / PPT / PDF reader navigation handlers;
- existing status bar and shell.

Current baggage:

- marketing-style hero copy;
- feature-card grid detached from research objects;
- dark/purple side shell that conflicts with `DESIGN.md`;
- duplicated historical CSS sections.

## Implementation Steps

1. Update project governance:
   - `AGENTS.md`: fixed entry must read `README.md`, `PLAN.md`, and `DESIGN.md`.
2. Add tests:
   - `src/renderer/components/HomePage.test.ts`: verify `buildResearchWorkspaceOverview` derives object cards, workflow stages, risks, and next actions from `PaperRecord[]` and graph stats.
   - `src/renderer/components/AppSidebar.test.ts`: verify navigation labels remain research-workflow oriented.
3. Implement homepage foundation:
   - add `buildResearchWorkspaceOverview`;
   - replace the homepage hub markup with a research workspace shell;
   - keep existing library section behavior unchanged.
4. Implement style foundation:
   - append a final scoped workbench baseline to `src/renderer/styles/global.css`;
   - update `src/renderer/styles/components/AppSidebar.module.css` to a light, compact side rail.
5. Update documentation:
   - `README.md`: homepage and design direction now reflect the AI research workbench baseline;
   - `PLAN.md`: record this pass, verification commands, and remaining risks.
6. Verify:
   - `npx vitest run src/renderer/components/HomePage.test.ts src/renderer/components/AppSidebar.test.ts`;
   - `npm run typecheck`;
   - `npm run visual:check`.

## GSAP Decision

Do not introduce GSAP in this pass. The current problem is information architecture and visual density, not timeline choreography. CSS transitions are enough for this baseline and avoid adding dependency, bundle size, and Windows packaging risk.
