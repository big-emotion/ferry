# Epic 3 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 3

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 3-1 | changes-requested | 3 |
| 3-2 | changes-requested | 2 |
| 3-3 | merge-ready | 1 |

---

## Per-story findings

### 3-1 — Refiner Reads Ticket & Produces Sub-Task Plan

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — `runRefiner` sanitises ticket via `delimitUntrusted` before LLM call, plan validated against `RefinerOutput` schema — covered by `refine.test.ts::passes the ticket payload through delimitUntrusted` and `returns parsed plan and audit summary`
- [x] AC2 — malformed JSON throws `FerryError("state-invariant", { reason: "refiner-output-invalid" })` — covered by `refine.test.ts::throws state-invariant on malformed JSON` and `throws state-invariant on schema violation`; note: tests assert `instanceof FerryError` but do not assert `.code === 'state-invariant'` (see Finding 1)
- [x] AC3 — `touch_paths` > 20 throws `FerryError("oscillation", { reason: "spec-too-broad" })` — covered by `refine.test.ts::throws oscillation on touch_paths over the cap`; boundary at exactly 20 not tested (see Finding 2)
- [x] AC4 — `RefinerResult { plan, auditSummary }` returned with correct shape — covered by `refine.test.ts::returns parsed plan and audit summary` and `reports cost 0 when usage missing`

**Findings:**

1. (severity: minor) `src/agents/refiner/refine.test.ts:67–85` — AC2 tests assert `rejects.toBeInstanceOf(FerryError)` but never assert `.code`. A `FerryError('unknown', ...)` would pass these assertions. The taxonomy contract (code = `state-invariant`) is unverified by the test suite.
   **fix:**
   ```ts
   await expect(runRefiner({ ticket, callLlm: badLlm, runLink: 'r' }))
     .rejects.toMatchObject({ code: 'state-invariant' });
   ```
   Apply the same pattern to the schema-violation case (line 83).

2. (severity: nit) `src/agents/refiner/refine.test.ts:88–97` — Only the over-cap (21 paths) case is tested. The at-boundary case (exactly 20 paths) is not tested; a fencepost bug (`>` vs `>=` in `refine.ts:102`) would go undetected.
   **fix:** Add a test asserting that a plan with exactly 20 `touch_paths` resolves successfully (does not throw).

3. (severity: nit) `src/agents/refiner/refine.test.ts:73–82` — `badLlm` is declared, commented as schema-valid, then suppressed with `void badLlm`. This is dead code that adds noise. The comment's intent is valid but the dead variable should be removed.
   **fix:** Delete lines 73–77 (`badLlm` declaration) and the `void badLlm` line 82; keep only the `reallyBad` fixture.

**Recommendation:** Blocked until Findings 1–2 are fixed (Finding 3 can be bundled). The `.code` assertion gap means the taxonomy contract for AC2 is untested.

---

### 3-2 — Atomic Batch Sub-Task Creation with Cap

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — `prepareBatch` passes through plans ≤ 12 with idempotency footer `[ferry:refiner-subtask:<plan_id>:<index>]` — covered by `batch.test.ts::passes through plans at or below the cap` and `appends an idempotency footer to each sub-task description`
- [x] AC2 — plans > 12 truncated to first 12, `truncated` true, `originalCount` recorded — covered by `batch.test.ts::truncates plans above the cap`
- [x] AC3 — `applyBatch` wraps callback rejection in `FerryError("transient")` — covered by `batch.test.ts::wraps callback failure in FerryError(transient)`; note: test asserts `instanceof FerryError` only, not `.code === 'transient'` (see Finding 1)
- [x] AC4 — `detectLocale` returns `'fr'` for French stopwords, `'en'` otherwise — covered by `locale.test.ts` with 2 French and 2 English fixtures plus empty-input guard

**Findings:**

1. (severity: minor) `src/agents/refiner/batch.test.ts:58–61` — `applyBatch` failure test asserts `rejects.toBeInstanceOf(FerryError)` without checking `.code === 'transient'`. A `FerryError('unknown', ...)` would pass. AC3 explicitly names the `transient` code.
   **fix:**
   ```ts
   await expect(applyBatch(prepareBatch(makePlan(3), 'plan-1'), create))
     .rejects.toMatchObject({ code: 'transient' });
   ```

2. (severity: nit) `src/agents/refiner/batch.ts:48–56` — `applyBatch` always calls `create(prepared.subtasks)` even when `prepared.subtasks` is empty (the zero-delta re-run path). This issues a no-op batch request to the injected Jira creator in production, which is wasteful and may produce unexpected audit entries. There is no test for this case specifically (the dry-run test in story 3-3 invokes it and relies on the injected fake returning `[]`, which works, but a real Jira adapter receiving an empty array may behave differently).
   **fix:** Add an early-return guard:
   ```ts
   if (prepared.subtasks.length === 0) return { createdCount: 0, ids: [] };
   ```
   Add a test asserting `create` is never called when the batch is empty.

**Recommendation:** Blocked until Finding 1 is fixed. Finding 2 is a hardening improvement; can be bundled in the same session.

---

### 3-3 — Idempotent Re-Run & Empty-Ticket Escalation

**Verdict:** merge-ready

**AC coverage:**
- [x] AC1 — `filterExistingSubtasks` drops sub-tasks whose marker is already present — covered by `idempotency.test.ts::drops sub-tasks whose marker is already present in existing list`, `returns input unchanged when no markers match`, and `handles all-already-existing case (zero net new)`
- [x] AC2 — `classifyEmptyTicket` returns `{ unactionable: true, reason }` for empty, < 5 words, and placeholder patterns; `formatEmptyTicketComment` emits the FR11 comment string — covered by `empty.test.ts::classifies "" as unactionable` (6 input fixtures) and `returns the documented comment string`
- [x] AC3 — `formatRefinerReadyComment` returns the FR success summary string — covered by `empty.test.ts::mentions the marker and sub-task count`
- [x] AC4 — idempotency dry-run E2E: second run over same plan_id with pre-existing sub-tasks produces zero net new — covered by `refine.dry-run.test.ts::a re-run on the same plan_id with prior sub-tasks produces zero net new`

**Findings:**

1. (severity: nit) `src/agents/refiner/empty.test.ts:9–14` — The `classifyEmptyTicket` parameterised test checks `unactionable: true` but never asserts the `reason` field. The three branches (`empty`, `too-short`, `placeholder`) are all exercised as inputs but their returned `reason` values are not pinned, so a future refactor that mixes up reasons would go undetected.
   **fix:** Add per-branch assertions, e.g.:
   ```ts
   expect(classifyEmptyTicket('').reason).toBe('empty');
   expect(classifyEmptyTicket('too short').reason).toBe('too-short');
   expect(classifyEmptyTicket('n/a').reason).toBe('placeholder');
   ```

**Recommendation:** Transition review → done is justified. Finding 1 is a nit that can be addressed opportunistically; it does not block merge.

---

## Cross-cutting observations

- **Pure logic**: All production modules (`refine.ts`, `batch.ts`, `locale.ts`, `idempotency.ts`, `empty.ts`, `delimit-untrusted.ts`) contain zero direct `fetch`/`octokit`/`fs`/`process.env` calls. IO is fully injected. ✅
- **FerryError taxonomy**: All thrown errors use valid taxonomy codes (`state-invariant`, `oscillation`, `transient`). The error class itself is correct. Tests partially verify this (see per-story findings). ✅ / minor gap
- **Idempotency/marker stability**: `[ferry:refiner-subtask:<plan_id>:<index>]` markers are deterministic and substring-stable across re-runs. `extractSubtaskMarker` returns the first match which is always the marker regardless of double-appends. ✅
- **English only / KISS**: All identifiers, comments, and string literals are in English. `locale.ts:36` uses French accented characters inside a regex character class for tokenisation — this is a technical necessity for the French-detection feature, not a policy violation. No Co-Authored-By commits observed. ✅
- **Jira/PR comment format**: `formatEmptyTicketComment` and `formatRefinerReadyComment` correctly emit `[ferry:refiner:<run_id>]` prefixes per the FR11/FR success-comment spec. `batch.ts` footers use `[ferry:refiner-subtask:<plan_id>:<index>]`. ✅
