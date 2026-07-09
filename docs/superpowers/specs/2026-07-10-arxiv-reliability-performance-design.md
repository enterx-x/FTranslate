# arXiv reliability, translation performance, and UI design

## Decision

Implement a session-aware arXiv discovery workflow. Search remains rate-limit compliant and cache-first; translation becomes foreground-prioritized, bounded, and explicitly controllable. The scope applies to all academic subjects, not a fixed robotics or RL profile.

## Problem

The current page starts background translation for every result after every search. A 50-paper result page creates three renderer batches, while the main-process translation service serializes them behind one engine queue. A user-selected paper can therefore wait behind invisible work. The page also has no search-session guard, so a late response can overwrite a newer intent. Finally, the UI calls its local, page-sized rerank a comprehensive sort without describing that scope.

## Alternatives considered

1. Increase NLLB/Argos worker concurrency. Rejected: one local model process already batches efficiently; competing workers consume memory and reduce stability on CPU or GPU machines.
2. Disable all automatic translation. Rejected: it makes Chinese-first discovery slower for users who want a quick preview.
3. Session-aware, foreground-prioritized translation with a small preview batch. Chosen: it preserves fast Chinese discovery while bounding background work and keeping manual actions responsive.

## User flow

1. User submits a search. The renderer creates a monotonically increasing search session.
2. Only the current session may update papers, selection, messages, or translation state. Older responses are ignored.
3. Results render immediately. The selected paper and a small visible preview batch are eligible for low-cost automatic translation.
4. The user can explicitly translate the full visible page. That work is background priority and is discarded if its session is no longer current.
5. A manual translation request has foreground priority. It runs after any already-running job but before queued preview and background jobs.
6. Every translated record records engine, cache status, elapsed time, and quality-check result.

## Data and IPC boundaries

- Add a renderer `ArxivSearchSession` helper that owns current session IDs and stale-response checks.
- Extend title/abstract batch translation requests with optional `priority` (`foreground`, `preview`, `background`) and `sessionId`.
- Replace the translation promise tail with a priority queue. It remains single-engine execution; only the queue order changes.
- Keep SQLite translation caches keyed by source text. Do not cache text failing the quality gate.
- Keep arXiv search requests serialized at the existing compliant minimum gap. The UI should optimize cache hits and perceived latency, not send parallel upstream requests.

## Translation quality gate

Before translation, protect formulas, inline code, URLs, DOI/arXiv identifiers, citation ranges, and configured glossary terms. Split long abstracts on sentence boundaries and pack segments under a character budget. After translation, restore protected spans and reject cache writes when the output has malformed placeholders, lost protected spans, repeated tails, obvious English echoes, or a severe source/target length mismatch. Existing NLLB-to-Argos fallback remains available for engine failure and repeated-tail repair.

## Search and ranking semantics

- Rename the renderer-only comprehensive mode to `本页相关排序` in user-facing UI.
- Show a compact ranking scope label and explain that arXiv API order is global while local relevance scoring applies only to the downloaded page.
- Keep Chinese query expansion generic. Show the normalized English terms used for the request and allow a strict/balanced/explore mode in the search controls; these modes determine whether generic expansion alternatives are included.

## UI

- Keep the three-column research layout, but reduce card actions to read, translate, and add-to-reading-queue.
- Move PPT and export actions to the detail inspector.
- Keep advanced filters collapsed by default.
- Show a compact status row: cache/fresh result, arXiv wait state, active translation queue, engine, and quality result.
- Add explicit actions for `翻译选中论文` and `翻译本页`; automatic preview translation is visibly limited.

## Testing and acceptance criteria

- A late search response cannot overwrite a newer session.
- Enter on page jump cannot issue a concurrent request while searching.
- A manual translation job is scheduled before queued preview/background jobs.
- Stale background results do not update the current page state.
- Long abstracts preserve protected spans and pass sentence-batch reconstruction tests.
- The UI labels page-local ranking truthfully and exposes explicit full-page translation.
- Existing arXiv service, translation, UI, typecheck, build, visual regression, and packaged visual regression checks pass.
