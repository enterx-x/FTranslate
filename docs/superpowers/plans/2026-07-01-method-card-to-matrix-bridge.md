# 2026-07-01 Method Card to Experiment Matrix Bridge

## First-Principles Frame

The product problem is not "add another button". A research team needs a traceable path from paper evidence to executable experiments. If method cards stay isolated from the experiment matrix, the app remains a document organizer instead of a local AI R&D workbench.

Core constraints:

- Experiment rows must originate from method-card fields that have evidence source ids.
- The bridge must be project-scoped; one project's method cards cannot leak into another project's matrix.
- User-edited experiment rows are the source of truth after generation and must not be overwritten by regenerated rows.
- The freeform research sheet remains separate and cannot be treated as the matrix data source.
- This slice should reuse `methodCards`, `experimentMatrix`, and `useExperimentMatrix`; no new dependency is justified.

## Scope

1. Add a small method-card storage hook/helper for local persistence.
2. Add pure bridge helpers for current-project method-card summaries and generated matrix rows.
3. Wire the Experiment Matrix page with:
   - available method-card count;
   - generated experiment-row count;
   - a merge action that uses existing experiment-matrix merge behavior.
4. Keep the UI dense and workstation-like; no marketing hero, no nested cards, no high-saturation status colors.
5. Update visual check so the bridge is visible in the matrix scenario.
6. Update README and PLAN.

## Out of Scope

- Full method-card review UI.
- AI prompt execution for method-card generation.
- Inline editing of every experiment matrix cell.
- File export dialogs beyond the existing Markdown copy action.
- Running real experiments or model training.

## Acceptance Checks

- `npm test -- src/renderer/hooks/useMethodCards.test.ts src/renderer/lib/experimentMatrixBridge.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run visual:check`
- `npm run dist`

## Adversarial Review Targets

- The action must not imply that ungrounded claims can become experiments.
- Empty states must distinguish "no method cards" from "method cards exist but generate no grounded rows".
- Regeneration must preserve edited status, hypothesis, metrics and other user changes.
- The added action area must not wrap, overlap, or create page-level horizontal overflow.
- LocalStorage parsing failures must degrade to an empty list, not crash the renderer.
