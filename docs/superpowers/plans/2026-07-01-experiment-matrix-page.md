# 2026-07-01 Experiment Matrix Page Plan

## First-Principles Frame

The real product problem is not "rename the research sheet to experiment matrix". A research team needs a structured layer that turns grounded method claims into executable experiments, while still keeping the freeform Univer sheet for ad hoc notes.

Core constraints:

- Experiment rows must be project-scoped and traceable to method-card evidence.
- The matrix must be readable as a dense engineering table, not a card gallery.
- User edits and local persisted rows must remain the source of truth.
- The old freeform research sheet must stay reachable and must not be overwritten.
- This slice should reuse the existing `experimentMatrix` core and `useExperimentMatrix` hook; no new dependency is justified.

## Scope

Build an independent Experiment Matrix view:

1. Add a distinct `experimentMatrix` app view and sidebar target.
2. Rename the old Univer entry to `研究表格` so users can still open the freeform sheet.
3. Add a dense `ExperimentMatrixPage` with:
   - project summary;
   - group/status/search filters;
   - high-density table;
   - right-side selected row evidence/detail panel;
   - Markdown export/copy action using existing core helpers.
4. Add pure view-model helpers and tests before wiring the React page.
5. Update visual check to open the independent matrix page and assert no obvious empty-shell regression.
6. Update README and PLAN.

## Out of Scope

- AI generation from method cards in UI.
- Editing every matrix cell inline.
- Excel file write/export dialog.
- Method-card review UI.
- Runtime execution of experiments.

## Acceptance Checks

- `npm test -- src/renderer/lib/experimentMatrixView.test.ts src/renderer/components/AppSidebar.test.ts`
- `npm test -- src/renderer/lib/experimentMatrix.test.ts src/renderer/hooks/useExperimentMatrix.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run visual:check`
- `npm run dist`

## Adversarial Review Targets

- Sidebar must not make users think the old research sheet is the experiment matrix.
- Empty matrix state must tell the truth: it cannot pretend experiments exist before method cards or manual rows.
- Detail panel must not show unsupported claims without evidence locators.
- Table must avoid horizontal page overflow; overflow should stay inside the table viewport.
- Home-page visual adjustments already in the working tree must not be overwritten.
