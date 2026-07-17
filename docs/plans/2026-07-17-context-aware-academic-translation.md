# Context-aware Academic Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline plan execution task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HY-MT2 7B translate arXiv titles and abstract segments with bounded paper context, academic style, exact protected markers, and a real-domain quality regression corpus.

**Architecture:** Extend local batch translation with optional per-item context metadata. HY-MT2 consumes that metadata through the official contextual/style/terminology prompt, validates each output locally, and retries only a structurally invalid segment once. The arXiv service builds title/previous-segment context, includes context in batch identity, and advances its cache identity to v10.

**Tech Stack:** Electron main process, TypeScript, Vitest, Node fetch, llama.cpp OpenAI-compatible server, SQLite, React renderer diagnostics.

---

### Task 1: Per-item context and official HY-MT2 prompt

**Files:**
- Modify: `src/main/localTranslationService.ts`
- Modify: `src/main/hyMtTranslationService.test.ts`
- Modify: `src/main/hyMtTranslationService.ts`

- [x] **Step 1: Write failing prompt tests**

Add tests that call the wished-for API:

```ts
const prompt = buildHyMt2Prompt(source, {
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  itemContext: {
    context: 'Paper title: Physics-Informed Robot Dynamics',
    style: 'academic-paper'
  }
});
expect(prompt).toContain('参考上面的信息');
expect(prompt).toContain('学术论文书面语');
expect(prompt).toContain('不要翻译上文');
```

Add a second test with source `The residual is evaluated at 8675300901.` and require the prompt to state that every `86753...901` marker must remain unchanged and occur exactly once.

- [x] **Step 2: Verify RED**

Run:

```powershell
npx vitest run src/main/hyMtTranslationService.test.ts
```

Expected: FAIL because `LocalTranslateDirectionOptions` has no `itemContext` and the prompt lacks context/style/marker instructions.

- [x] **Step 3: Implement minimal metadata and prompt composition**

Add:

```ts
export interface LocalTranslationItemContext {
  context?: string;
  style?: 'academic-paper';
}

export interface LocalTranslateDirectionOptions {
  sourceLanguage?: LocalTranslationLanguage;
  targetLanguage?: LocalTranslationLanguage;
  itemContext?: LocalTranslationItemContext;
  itemContexts?: LocalTranslationItemContext[];
}
```

`buildHyMt2Prompt` must:

- collect terminology from the current `source` only;
- include bounded background when `itemContext.context` is non-empty;
- request faithful, accurate, natural academic prose without added claims;
- add exact marker preservation when `86753\d{2}901` is present;
- retain the existing generic Chinese-to-English path without reverse glossary guesses.

In `HyMt2Runtime.translate`, pass `options.itemContexts?.[index]` into each `translateOne` call as `itemContext`.

- [x] **Step 4: Verify GREEN**

Run the same Vitest command. Expected: all prompt/runtime unit tests pass.

### Task 2: Per-segment validation and one strict retry

**Files:**
- Modify: `src/main/hyMtTranslationService.test.ts`
- Modify: `src/main/hyMtTranslationService.ts`

- [x] **Step 1: Write failing validation tests**

Add tests for exported pure helpers:

```ts
expect(validateHyMt2ProtectedMarkers('A 8675300901 B', '甲 8675300901 乙')).toBe(true);
expect(validateHyMt2ProtectedMarkers('A 8675300901 B', '甲')).toBe(false);
expect(validateHyMt2ProtectedMarkers('A 8675300901 B', '甲 8675300901 8675300901')).toBe(false);
expect(hasHyMt2ContextLeakage('The residual is small.', output, context)).toBe(true);
```

The leakage fixture uses a six-word English phrase that exists only in context. Add a length-expansion case that exceeds 1.8 times the meaningful source length while context is present.

- [x] **Step 2: Verify RED**

Run the HY-MT2 unit test. Expected: FAIL because both helpers are absent.

- [x] **Step 3: Implement validation and retry**

Implement exact marker multiset comparison and conservative context-leak detection. In `translateOne`, perform at most two attempts:

```ts
for (let attempt = 0; attempt < 2; attempt += 1) {
  const strict = attempt === 1;
  const output = await requestCompletion(source, itemContext, strict);
  if (validateHyMt2ProtectedMarkers(source, output) &&
      !hasHyMt2ContextLeakage(source, output, itemContext?.context ?? '')) {
    return output;
  }
}
throw new Error('HY-MT2 未能保持受保护内容或错误输出了上下文。');
```

The strict attempt adds stronger marker/context-only instructions but does not ask the model to edit the first result.

- [x] **Step 4: Verify GREEN**

Run the HY-MT2 unit test. Expected: all tests pass.

### Task 3: Build paper context in the arXiv service

**Files:**
- Modify: `src/main/arxivTranslationService.test.ts`
- Modify: `src/main/arxivTranslationService.ts`

- [x] **Step 1: Write a failing captured-context test**

Use an injected `translateTextsWithEngine` that accepts `(texts, options)` and records `options.itemContexts`. Translate a title and a summary longer than 480 characters. Assert:

```ts
expect(contexts[0]?.context).toContain(summary.slice(0, 120));
expect(contexts[1]?.context).toContain(`Paper title: ${title}`);
expect(contexts[2]?.context).toContain(firstAbstractSegment.slice(0, 80));
expect(contexts.every((item) => (item.context?.length ?? 0) <= 900)).toBe(true);
```

Add a duplicate-sentence case from two papers and require two batch entries when contexts differ.

- [x] **Step 2: Verify RED**

Run:

```powershell
npx vitest run src/main/arxivTranslationService.test.ts
```

Expected: FAIL because translators only receive `texts` and deduplication ignores context.

- [x] **Step 3: Implement bounded context and context-aware batch identity**

Introduce an internal translator type:

```ts
type TranslationBatchTranslator = (
  texts: string[],
  options?: Pick<LocalTranslateDirectionOptions, 'itemContexts'>
) => Promise<LocalTranslateBatchResult>;
```

Build title context from the first 700 source characters of the abstract. Build every abstract segment context from `Paper title: ...` plus nearest preceding source segments, keeping at most 900 characters. Replace text-only deduplication with `{ text, itemContext }` requests whose key contains normalized text, context, and style.

Pass item contexts through primary HY-MT2 translation, selective fallback calls, and injected test translators. NLLB/Argos ignore the optional context while preserving existing behavior.

- [x] **Step 4: Verify GREEN**

Run the arXiv service tests. Expected: context and existing cache/fallback tests all pass.

### Task 4: Cache v10 and real academic benchmark

**Files:**
- Modify: `src/main/arxivTranslationService.test.ts`
- Modify: `src/main/arxivTranslationService.ts`
- Modify: `src/main/hyMtTranslationService.integration.test.ts`

- [x] **Step 1: Write failing cache and benchmark tests**

Change the expected cache payload to:

```ts
{
  version: 10,
  contextPrompt: 'paper-context-v1',
  glossary: ACADEMIC_TRANSLATION_GLOSSARY_VERSION,
  hyMt2Model: resolveHyMt2ModelCacheIdentity(),
  target: 'zh',
  ...input
}
```

Add real-model cases for RL, PINN, tactile robotics, CBF/MPC, and mixed method names. Each case declares `required`, `forbidden`, `protected`, and `contextOnly` arrays and asserts all constraints.

- [x] **Step 2: Verify RED**

Run the cache test normally and the real test with:

```powershell
npx vitest run src/main/arxivTranslationService.test.ts
$env:FTRANSLATE_RUN_HYMT_INTEGRATION='1'; npx vitest run src/main/hyMtTranslationService.integration.test.ts
```

Expected: cache test fails on version 9; the new benchmark fails until contexts are passed and validated.

- [x] **Step 3: Implement cache identity and benchmark-compatible behavior**

Set cache version 10 and `contextPrompt: 'paper-context-v1'`. Keep all non-translation state outside the cache key unchanged. Adjust only general prompt/validation behavior exposed by real failures; do not add sentence-specific rewrites.

- [x] **Step 4: Verify GREEN**

Run both commands again. Expected: cache tests and all real CUDA quality cases pass, with cold and warm durations printed separately.

### Task 5: Diagnostics, release documentation, and packaging

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/renderer/components/ArxivSearchPage.tsx`
- Modify: `src/renderer/components/ArxivSearchPage.test.ts`
- Modify: `scripts/visual-check.mjs`
- Modify: `README.md`
- Modify: `PLAN.md`
- Modify: `docs/plans/2026-07-17-context-aware-academic-translation.md`

- [x] **Step 1: Add a failing renderer status test**

Require the existing runtime line to display `HY-MT2 7B 上下文质量档` without adding controls or another card.

- [x] **Step 2: Verify RED and implement the minimal label change**

Run the arXiv renderer test, observe the missing label, then update the existing diagnostic text and visual assertion only.

- [x] **Step 3: Update version and docs**

Set version `0.1.37`. Update README and PLAN with context construction, retry semantics, real benchmark outputs, cache migration, limitations, and exact verification evidence.

- [x] **Step 4: Run required verification**

Run:

```powershell
npm run build
$env:VISUAL_CHECK_SCENARIO='settings'; npm run visual:check
$env:VISUAL_CHECK_SCENARIO='arxiv'; npm run visual:check
npm run dist
$env:VISUAL_CHECK_PACKAGED='1'; $env:VISUAL_CHECK_SCENARIO='settings'; npm run visual:check
$env:VISUAL_CHECK_PACKAGED='1'; $env:VISUAL_CHECK_SCENARIO='arxiv'; npm run visual:check
```

Before `npm run dist`, inspect the non-13 plotting worktree and do not merge it. Manually inspect the two relevant screenshots after source and packaged runs.

- [x] **Step 5: Publish**

Verify installer size and SHA-256, delete only the superseded 0.1.36 installer/blockmap, launch an isolated visible 0.1.37 hot preview, check `git diff`, stage only intended files, commit, and push `codex/scientific-plot-axis-controls`.
