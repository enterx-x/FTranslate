# arXiv Official Relevance Search Design

## Objective

Make FTranslate arXiv retrieval reflect global corpus relevance instead of sorting only the current page of newest API results. The default search must delegate ordering to the official arXiv API with `sortBy=relevance`, preserve that response order across pagination, and keep local scientific scores as reading insight rather than a hidden replacement search engine.

The design must also improve Chinese scientific queries by translating them into compact, inspectable English concept groups without broadening a conjunctive request into unrelated single-keyword matches.

## Root cause

The current default UI value is `comprehensive`, but the API request maps that mode to `submittedDate`. After arXiv returns one page, FTranslate applies `applyLocalArxivSort` only to those returned records. Consequently:

- the candidate set is the newest page, not the globally most relevant papers;
- a locally high score cannot recover relevant papers excluded before the page arrived;
- page 2 is another independently fetched time slice, so the visible order is not one stable global relevance ranking;
- labels such as “本页相关排序” accurately describe the implementation but do not satisfy the user's retrieval intent.

The official arXiv API already exposes `sortBy=relevance`, implemented with Apache Lucene's relevance ranking. This must be used before adding another semantic retrieval layer.

## Selected approach

1. Replace the default primary sort with official arXiv `relevance`.
2. Send the effective structured query, filters, page offset, and `sortBy=relevance` directly to the official API.
3. Preserve returned arXiv identifier order exactly through normalization, enrichment, caching, translation, and rendering.
4. Keep the dedicated “最新论文” action on `submittedDate` descending.
5. Remove current-page local relevance sorting from the primary sort control and from automatic post-processing.
6. Show local priority, novelty, method, and experiment signals as non-ordering reading aids.
7. Benchmark this official-first path before considering an optional semantic reranker.

## Query construction

### English input

English queries are normalized without inventing extra concepts. Quoted phrases, explicit field prefixes, parentheses, and Boolean operators that the official API supports are preserved. Plain multi-concept input is converted into the smallest structured form that retains user intent.

Example:

`reinforcement learning robot navigation`

becomes concept groups equivalent to:

`(all:"reinforcement learning") AND (all:"robot navigation")`

High-confidence aliases may be added inside the same concept group only:

`(all:"robot navigation" OR all:"mobile robot navigation")`

Aliases never change an `AND` between distinct concepts into one broad `OR` list.

### Chinese input

Chinese queries are mapped to compact scientific English concepts before the request. The builder uses the versioned scientific terminology layer and, where required, the local translation engine. It must:

- identify distinct concepts and keep `AND` between them;
- place spelling variants, abbreviations, and true synonyms inside the concept's `OR` group;
- prefer domain phrases such as `humanoid robot` and `tactile sensing` over isolated noisy tokens such as `human`, `touch`, or `textile`;
- avoid speculative latent expansions that are not entailed by the user's words;
- retain literal method names, acronyms, quoted phrases, and identifiers;
- cap aliases per concept and the total serialized query length.

For example, `人形触觉` should produce a compact conjunction similar to:

`(all:"humanoid robot" OR all:"humanoid robotics") AND (all:"tactile sensing" OR all:haptics)`

It must not degrade into `humanoid OR tactile OR touch`, which admits papers matching only one weak term.

### Inspectability

The runtime status exposes the effective English query in a compact expandable detail or copy action. Users can therefore distinguish a poor query translation from poor arXiv ranking. The query is not placed in a permanent new card.

## Official ordering and pagination

### Sort mapping

- Default search: `sortBy=relevance`.
- Latest papers: `sortBy=submittedDate&sortOrder=descending`.
- Updated papers, when explicitly selected: `sortBy=lastUpdatedDate&sortOrder=descending`.
- Ascending or descending time order remains available only for date-based sorts.

The old `comprehensive` value is migrated to `relevance`. The primary sort label becomes “相关性（arXiv）”; “本页相关排序” is removed from the default workflow.

### Stable result order

The official response order is captured as an ordinal keyed by canonical arXiv ID. Later enrichment may attach translations, scores, tags, project membership, cached state, and local metadata, but it may not reorder records unless the user explicitly chooses a date sort.

Pagination sends the official `start` and `max_results` values for the same serialized query and sort. The UI total, page number, and IDs therefore describe one official global result sequence rather than separately reranked local pages.

Deduplication of versioned arXiv IDs preserves the first official occurrence. Normalization errors are logged and skipped without compacting records into a new score order.

## Local analysis boundary

Existing local signals remain useful for deciding what to read:

- research-topic match;
- novelty hints;
- method and experiment tags;
- translation status;
- saved, read, and project state;
- local AI or deterministic priority score.

They may appear as badges, filters, or detail explanations, but they do not modify the official result order in the default relevance mode. A future semantic reranker is permitted only as an explicit optional mode after a labelled benchmark proves that it improves retrieval over official relevance; it cannot silently replace the default.

## Cache and state migration

Advance the arXiv search cache identity to `title-abstract-v8`. The cache key includes:

- normalized original query;
- serialized effective English query and query-builder version;
- category and advanced filters;
- official `sortBy` and `sortOrder`;
- `start`, `max_results`, and result-normalization version.

Cached payloads retain official ID order. Existing translated abstracts may be reused only when their translation cache identity remains valid; search cache migration does not delete favourites, projects, reading queue entries, notes, ratings, or downloaded PDFs.

Old saved preference `comprehensive` is migrated to `relevance` on read and persisted in the new form after the next user change. A cache entry from the previous current-page ranking protocol is never treated as an official-relevance page.

## Failure and recovery behavior

- arXiv timeout, connection reset, rate limit, or malformed Atom response uses the existing bounded retry and cooldown rules; it does not silently switch to local page ranking.
- A failed Chinese query translation keeps the original query visible and reports that official search was not executed, unless a safe deterministic terminology mapping produced a valid query.
- Empty results show the original and effective queries plus active filters, enabling correction without exposing internal stack traces.
- Changing query, category, filter, or sort cancels stale requests. A late response cannot replace a newer search.
- Repeated navigation uses cache only when the full versioned request identity matches.
- Translation and local scoring failures do not remove or reorder successfully retrieved arXiv records.

## UI behavior

The UI change is intentionally small:

- make “相关性（arXiv）” the default sort;
- retain “提交时间” and “更新时间” as explicit alternatives;
- keep “最新论文” as a direct time-sorted action;
- remove the misleading current-page relevance option;
- show the effective English query in existing run-status details;
- keep local score explanations in cards or the detail pane without presenting them as the search rank.

No additional permanent filter row, settings card, or semantic-search toggle is introduced in this phase.

## Verification and acceptance

### Automated tests

- default and migrated sort map to official `relevance`;
- latest and updated actions map to the correct official date sort and direction;
- English Boolean and phrase preservation;
- Chinese concept grouping with `AND` between concepts and bounded `OR` aliases;
- effective-query visibility and stale-request cancellation;
- exact official ID order after normalization, enrichment, translation, and cache read;
- pagination request identity and cache `title-abstract-v8` invalidation;
- local scores cannot reorder default relevance results;
- arXiv error, cooldown, empty-result, and late-response handling.

### Retrieval benchmark

Build a versioned benchmark of 20 research queries covering RL, PINN, CBF/MPC, path planning, robot navigation, tactile sensing, humanoid manipulation, dynamics, exact method names, abbreviations, and mixed Chinese/English input. At least half of the queries are Chinese or contain Chinese concepts. Domain judgements label relevance within the top 50 candidates.

Report:

- Precision@10;
- nDCG@10;
- Recall@50;
- exact-title or exact-method hit position;
- zero-result and obviously off-topic rates;
- request latency and cache-hit latency.

Acceptance requires:

1. English direct queries preserve the official arXiv API ID order exactly for the same request;
2. default search no longer fetches a submitted-date page before applying local relevance;
3. “最新论文” remains correctly ordered by submitted time;
4. Chinese queries expose their effective English structure and preserve conjunctive intent;
5. Precision@10, nDCG@10, and Recall@50 do not regress against the current implementation, with the official-relevance path expected to improve the labelled set;
6. representative exact method-name queries return the known paper in a reviewable top position;
7. no local enrichment stage changes official pagination order.

If official relevance fails to improve the labelled benchmark, the failure is documented before an explicit semantic reranker is designed. A reranker is not added merely because one anecdotal query remains weak.

## Scope exclusions

- No vector database or embedding reranker in this phase.
- No scraping of the arXiv website search page.
- No hidden local reordering of official relevance results.
- No broad synonym expansion generated without a bounded concept model.
- No claim that the API ordering is byte-for-byte identical to every arXiv website search mode; the supported contract is the official API request and response order.

## Primary reference

- arXiv API User's Manual, query syntax, paging, and `sortBy=relevance`: <https://info.arxiv.org/help/api/user-manual.html>
