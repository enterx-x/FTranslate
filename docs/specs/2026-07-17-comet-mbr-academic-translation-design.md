# COMET-MBR Academic Translation Selection Design

## Objective

Upgrade FTranslate's arXiv title and abstract translation from one accepted HY-MT2 output to quality-aware multi-candidate selection. The runtime must generate three faithful academic candidates, reject structurally unsafe outputs, and use an independent COMET-MBR evaluator to select the strongest complete translation. The design optimizes for the largest reliable quality gain on the current machine, not for the shortest implementation time or the previous one-second warm latency target.

This phase applies only to arXiv titles and abstracts. PDF word selection, dictionary-style word explanations, and other interactive short-text translation retain their existing low-latency path.

## First-principles constraints

1. A quality selector cannot recover information that no candidate contains. Candidate diversity must come from controlled HY-MT2 decoding, not cosmetic post-editing.
2. The evaluator must be independent of the HY-MT2 generator. Asking the same generative model to judge its own outputs is not accepted as a quality signal.
3. Formulas, code, citations, URLs, DOI values, arXiv identifiers, model names, numbers, and protected placeholders must survive exactly. A semantically attractive candidate that breaks protected content is ineligible.
4. The selected abstract must remain internally consistent. Selection happens at complete-title or complete-abstract level; the system does not splice the highest-scoring sentence from different candidates.
5. Quality degradation must be visible. Missing models, insufficient resources, evaluator failures, and one-candidate fallbacks cannot be reported as normal COMET-MBR success.
6. The model is installed outside the Electron application and outside the NSIS package. The application remains usable when COMET is not installed.
7. The current machine has approximately 15 GB system RAM and an 8 GB RTX 4060 Laptop GPU. HY-MT2 7B and COMET must not be assumed safe to keep resident together.
8. This design does not reintroduce a machine-translation-then-chat-AI-polish pipeline. The winning candidate is emitted unchanged after validation.

## Selected architecture

The selected path is:

1. build one paper-aware source unit for the title and one for the abstract;
2. generate three paper-level HY-MT2 candidate bundles with fixed, distinct seeds, each bundle containing one title and one complete abstract;
3. run deterministic hard gates and normalized duplicate removal;
4. score eligible candidates with reference-based `Unbabel/wmt22-comet-da` in an MBR-style pairwise comparison, where the other candidates act as pseudo references;
5. select one complete candidate with deterministic tie-breaking;
6. cache the result together with the actual generator, evaluator, prompt, glossary, and candidate identities.

`Unbabel/wmt22-comet-da` is selected because it is an independent COMET model, has an Apache-2.0 model license, and is materially smaller than the gated 3.5B COMETKiwi XL model. COMETKiwi XL is not the default: its model card specifies a minimum 15 GB GPU requirement, which exceeds the current 8 GB GPU. The runtime interface may support a future optional evaluator identifier, but no XL download or UI promise is included in this phase.

## Candidate generation

### Translation units

- The title is translated as its own unit with bounded abstract opening context, but remains paired with the same-seed abstract for final selection.
- The abstract is translated as a whole when the estimated input, prompt, protected markers, and reserved output fit safely inside the 4,096-token HY-MT2 context.
- If the abstract does not fit, it is split only at sentence or existing paragraph boundaries. Every candidate uses the same source segmentation and the existing paper-context rules.
- Source boundaries and protected-marker maps are recorded before generation so all candidates can be validated and compared against the same structure.

### Controlled diversity

- Generate exactly three primary candidates with fixed seeds `42`, `3407`, and `7919`.
- Keep the source, context, terminology constraints, style instruction, temperature profile, and output budget identical across candidates. Only the seed changes.
- A strict placeholder-preservation retry is allowed only for a candidate that fails a structural gate. The retry is identified separately and does not silently replace a valid diverse candidate.
- For a segmented abstract, one seed defines one complete abstract candidate across all segments. The selector never combines segments from different seeds or selects a title from a different seed than its abstract.

### Hard eligibility gates

A candidate bundle is ineligible when its title or abstract has any of the following failures:

- protected-marker multiset, required number, citation, DOI, arXiv identifier, or formula is missing, duplicated, or changed;
- output is empty, truncated, mojibake, predominantly untranslated English, or an English echo with a Chinese prefix;
- context-only text leaks into the translation;
- segment count or boundary restoration fails;
- output contains abnormal repetition, duplicated tails, obvious instruction text, or unsupported additions;
- mandatory high-confidence terminology is violated or a prohibited known mistranslation appears;
- a paper-specific method name or high-confidence term is rendered inconsistently between the title and abstract without source justification.

Hard gates are deterministic and run before COMET. COMET never overrides them.

### Duplicate removal

Eligible title/abstract bundles are normalized for whitespace, punctuation variants, and harmless Unicode differences. Exact normalized bundles are scored once but retain their seed provenance. If all bundles collapse to one unique translation, the system returns that bundle as `single-unique-candidate` degraded mode rather than claiming MBR selection.

## COMET-MBR selection

### Pairwise utility

For each unique eligible paper bundle `c_i`, every other bundle `c_j` is used as a pseudo reference:

`utility(c_i) = mean(COMET(source, mt=c_i, ref=c_j)) for all j != i`

The title is scored as one segment. Abstracts are scored on the shared source sentence/paragraph segmentation to avoid COMET truncating a long document. Abstract segment utilities are aggregated with source-token weighting. The bundle score combines title utility, abstract utility, and the worst component score, so a strong abstract cannot conceal a mistranslated title. The resulting score selects one title-and-complete-abstract bundle.

This is MBR-style consensus selection: it rewards a candidate that is best supported by the other independently sampled translations while remaining source-conditioned. It is not presented as a gold-reference COMET score.

### Deterministic selection

Candidates are ordered by:

1. highest aggregated COMET-MBR utility;
2. highest worst-segment utility, preventing one severely weak section from hiding behind a strong mean;
3. fewest cross-title/abstract consistency and other soft quality warnings;
4. shortest normalized edit distance from the median candidate length;
5. original seed order.

No random tie-breaking is permitted. Candidate scores, evaluator identity, and the selected seed are retained in diagnostics, while normal UI shows only concise stage and degradation status.

### Insufficient candidates

- Three or more unique eligible bundles: normal COMET-MBR selection.
- Two unique eligible bundles: pairwise COMET selection with a visible `two-candidate` degraded reason.
- One unique eligible bundle: deterministic hard-gate acceptance with a visible `single-candidate` reason.
- No eligible candidate: enter the existing NLLB/Argos fallback chain and report that COMET-MBR was not reached.

## Runtime and resource isolation

### Installation layout

The default external root is `E:\FTranslateTools\comet-mbr` and contains:

- an isolated Python 3.10 virtual environment;
- pinned COMET runtime dependencies;
- the `Unbabel/wmt22-comet-da` model snapshot and license metadata;
- an installation manifest with file hashes, Python identity, package versions, and model revision;
- worker logs that exclude source paper text by default.

The installer must first detect a compatible existing Python 3.10 runtime. It may create the virtual environment with access to the already installed compatible `torch` package, but it must not install packages into the global Python environment. Dependency compatibility is verified inside the environment before the worker is marked ready.

### Worker protocol

A local JSON-lines worker communicates over stdin/stdout and supports:

- `probe`: report Python, torch, CUDA, model, memory mode, and license identity;
- `load`: load the evaluator on the requested device;
- `score`: score a bounded batch of aligned candidate segments;
- `unload`: release model and CUDA allocations;
- `shutdown`: terminate cleanly.

Malformed requests, stderr output, timeouts, and process exits are surfaced with stable error codes. Source text and API keys are never written to the manifest or ordinary logs.

### Resource scheduler

The implementation benchmarks two safe modes on this machine before choosing a default:

1. CPU evaluator, batch size 1, only when a memory preflight leaves a conservative safety reserve and the benchmark completes without paging pressure or process instability.
2. Sequential GPU swap: generate all HY-MT2 candidates as a batch, stop and unload HY-MT2, load COMET in inference mode on CUDA with batch size 1, score all pairs, unload COMET, and restore HY-MT2 only if more generation work is queued.

The application never attempts simultaneous GPU residency by default. If neither mode passes the resource probe, COMET-MBR is disabled explicitly and the validated single-candidate path remains available. Installation checks available disk space before downloading and cleans only its own incomplete staging directory after a failed verified install.

## Application integration

### Service boundary

Add a `CometMbrRuntime` service behind a small evaluator interface. The arXiv translation service owns candidate generation and complete-unit selection; renderer components never invoke Python directly. The service exposes capability and stage events through the existing runtime/status channel.

### Cache identity

Advance the arXiv translation cache to `v11` with selection protocol `mbr-v1`. A cache key includes:

- normalized source title and abstract;
- paper-context prompt version and glossary version;
- actual HY-MT2 model identity and generation profile;
- candidate count and fixed seed set;
- hard-gate version;
- COMET model identifier, pinned revision, aggregation version, and device-independent scoring protocol.

The persisted record stores the final translation, selected seed, eligible candidate hashes, aggregate scores, degradation reason, and engine identities. Full candidate text is retained only in the local translation cache needed for reproducibility and can be cleared with translation cache controls. Favourites, projects, reading state, notes, and PDFs are unaffected by cache migration.

### UI behavior

No permanent new card or configuration panel is added to arXiv results. Existing translation status reports concise stages:

- generating candidate 1/3 through 3/3;
- validating candidates;
- evaluating quality;
- translation ready;
- degraded reason when applicable.

Runtime Center may show COMET-MBR installation, evaluator model, device mode, and last probe. Detailed scores belong in diagnostics, not in every paper card.

## Failure and recovery behavior

- Missing or incompatible COMET installation: skip evaluator, show `COMET-MBR unavailable`, and use the existing validated HY-MT2 result.
- COMET worker timeout or crash: terminate the worker, release resources, preserve eligible candidates, and select with deterministic structural/soft-gate ordering while marking evaluator failure.
- HY-MT2 candidate failure: retry only the failed structural candidate once; do not regenerate every valid candidate.
- GPU allocation failure: unload both runtimes, run the safe resource probe once, and either use the verified CPU mode or degrade explicitly. No infinite retry loop is allowed.
- Application exit or translation cancellation: terminate active scoring, release the worker, and leave no partially successful cache entry.
- Cache writes occur only after final selection and final hard validation.

## Verification and acceptance

### Automated tests

- candidate seed stability, title/abstract bundle integrity, complete-abstract grouping, and strict retry isolation;
- every hard eligibility gate and normalized duplicate removal;
- pairwise COMET request construction, source-token weighted aggregation, worst-segment tie-break, and deterministic seed fallback;
- one-, two-, and three-candidate degradation states;
- worker timeout, crash, cancellation, unload, and resource-scheduler decisions;
- cache `v11/mbr-v1` identity and invalidation;
- renderer stage text without new permanent UI clutter.

COMET unit tests use a deterministic fake scorer. Real-model tests are opt-in and never make a network download during the ordinary test suite.

### Quality benchmark

Create a versioned set of 30 difficult academic title/abstract samples across RL, PINN, robotics, tactile sensing, CBF/MPC, dynamics, method names, nested clauses, pronoun resolution, and mixed mathematical notation. Each sample includes a reviewed Chinese reference, protected literals, required terminology, and prohibited mistranslations.

Acceptance requires:

1. protected-content preservation of 100%;
2. no hard-gate regression against the current context-aware single-candidate baseline;
3. mean reference-based COMET score not lower than baseline, with per-domain results reported;
4. blinded human evaluation marking the new result win or tie on at least 90% of samples for faithfulness, terminology, fluency, and completeness;
5. no unresolved OOM, orphaned worker, cache corruption, or silent degradation in repeated runs;
6. cold/warm latency, p50/p95 latency, peak RAM, peak VRAM, model-swap time, and disk footprint reported rather than hidden behind a single speed claim.

Failure on any protected-content case blocks release even if aggregate COMET improves.

## Scope exclusions

- No cloud LLM review or post-editing.
- No COMETKiwi XL default installation on the current hardware.
- No PDF full-document MBR translation in this phase.
- No per-sentence mixing of candidates.
- No user-facing seed, temperature, or evaluator-score tuning controls.
- No claim that pseudo-reference MBR equals professional human reference evaluation.

## Primary references

- COMET official repository and runtime documentation: <https://github.com/Unbabel/COMET>
- `Unbabel/wmt22-comet-da` model files and license metadata: <https://huggingface.co/Unbabel/wmt22-comet-da>
- COMETKiwi XL model card and hardware requirement: <https://huggingface.co/Unbabel/wmt23-cometkiwi-da-xl>
- Minimum Bayes Risk decoding with neural metrics: <https://aclanthology.org/2022.tacl-1.47/>
