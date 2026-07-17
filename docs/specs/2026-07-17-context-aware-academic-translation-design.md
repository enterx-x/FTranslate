# Context-aware Academic Translation Design

## Objective

Upgrade FTranslate 0.1.37 from isolated-segment translation to paper-aware academic translation. The default engine remains the locally installed HY-MT2 7B quality profile. The change must improve terminology consistency, referent resolution, academic register, and protected-content reliability without adding cloud AI calls or a machine-translation-then-AI-polish stage.

## First-principles constraints

1. The translated segment is the only content that may appear in the output. Paper title and previous source text are background only.
2. Formulas, code, citations, URLs, DOI values, arXiv identifiers, and deterministic placeholders must remain reversible and occur exactly once.
3. Terminology constraints must be derived from the current source segment. Context may disambiguate meaning but must not force unrelated terms into the output.
4. Quality takes priority over the 0.1.36 warm latency baseline. Context must nevertheless be bounded so the 4,096-token local runtime remains stable on the RTX 4060 Laptop GPU.
5. NLLB and Argos remain explicit failure fallbacks. They do not pretend to support document context and continue to use reversible terminology placeholders.
6. No new permanent settings panel or toolbar control is introduced. Existing runtime diagnostics may state that paper context is active.

## Selected approach

Use HY-MT2's official contextual translation, terminology intervention, style instruction, and delimiter-preservation capabilities in one bounded prompt.

Alternatives rejected:

- Expanding only the static glossary cannot resolve pronouns, polysemy, or cross-sentence terminology and becomes a brittle sentence-patch system.
- Generating two complete candidates and asking the same local model to choose doubles latency and does not provide a trustworthy independent judge.

## Architecture

### Per-item translation metadata

Each batch item can carry:

- `context`: bounded source-language paper background;
- `style`: the fixed `academic-paper` profile;
- `strictPlaceholderPreservation`: enabled when protected markers are present.

The metadata is optional so NLLB, Argos, PDF word lookup, and Chinese-to-English translation remain backward compatible.

### Paper context construction

- Title translation receives the opening of the abstract as background, capped at 700 characters.
- Each abstract segment receives the full source title plus the nearest preceding source segments, with a combined cap of 900 characters.
- Context contains source text, not previously translated Chinese, so segments can still use the existing two-slot parallel runtime without data races.
- The current segment is never duplicated inside its context.

### Prompt construction

For English-to-Chinese academic text, the prompt is assembled in this order:

1. terminology references matched in the current source segment;
2. bounded paper background, when available;
3. academic-paper style: faithful, accurate, natural, concise, and no added claims;
4. exact placeholder-count and placeholder-position instruction when markers are present;
5. the source segment and an explicit translation-only output instruction.

Chinese-to-English selection translation retains the generic direction prompt and does not reverse-guess the Chinese glossary.

### Batch identity and concurrency

Batch deduplication keys include normalized source text, context, and style. Identical sentences from different papers therefore cannot silently share the wrong context. Parallelism remains two to fit the current 8 GB GPU envelope.

### Selective retry and fallback

HY-MT2 validates protected-marker sequence before accepting a segment. A damaged sequence triggers one local retry of only that segment with the strict preservation prompt. A second failure is surfaced to the existing arXiv quality pipeline, which may use NLLB or Argos. Semantic output is never post-edited by a chat model.

### Cache migration

The arXiv title/abstract cache identity advances from version 9 to version 10 and includes the context-prompt version. Only translated title/abstract data is invalidated; favourites, read state, reading queue, projects, and notes remain unchanged.

## Failure handling

- Missing context falls back to ordinary HY-MT2 academic translation, not a failed request.
- Context is truncated at source boundaries and never allowed to consume the output budget.
- Context-only text appearing in the output is rejected as leakage and is not cached.
- Placeholder damage, segment-count mismatch, severe truncation, mojibake, repeated tails, and English echo remain hard cache gates.
- Runtime errors remain visible through the existing HY-MT2/NLLB/Argos diagnostics.

## Quality regression corpus

The opt-in real-model suite covers representative RL, PINN, robotics, tactile sensing, CBF/MPC, dynamics, and mixed method-name samples. Each case declares:

- required Chinese terminology;
- forbidden known mistranslations;
- protected literals that must survive;
- context-only phrases that must not leak;
- minimum completeness and Chinese-content thresholds.

Unit tests cover prompt composition, context bounds, batch identity, placeholder retry, and cache versioning. The real-model suite records cold and warm timings separately but does not trade correctness for a fixed one-second claim.

## Acceptance criteria

1. Abstract segment requests carry the correct title and nearest preceding source context.
2. Context-only sentences never appear in translated output.
3. Every protected marker is preserved exactly once, including after the bounded retry path.
4. The real HY-MT2 7B CUDA benchmark passes all required/forbidden terminology checks.
5. Existing NLLB/Argos fallbacks, PDF selection translation, and cache-state preservation continue to pass.
6. Full build, required Settings/arXiv visual checks, Windows packaging, packaged checks, and isolated hot preview complete before release.
