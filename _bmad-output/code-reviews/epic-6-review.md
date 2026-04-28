# Epic 6 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 5

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 6-1   | changes-requested | 3 |
| 6-2   | merge-ready | 1 |
| 6-3   | merge-ready | 2 |
| 6-4   | changes-requested | 4 |
| 6-5   | changes-requested | 2 |

---

## Per-story findings

### 6-1 — Iterator Reads Review History and Applies Findings

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 (FR25) — `iteration_history[]` with fingerprints and `pr_sha` injected into prompt — covered by `prompt.test.ts > injects 1/2 prior iterations with fingerprints`
- [ ] AC2 (FR26) — diff scope-enforced via `src/lib/diff/apply.ts` (touch_paths ∪ {`.ferry/state.json`}, hard-reject `.github/**`) — `src/lib/diff/apply.ts` does **not exist**; the equivalent logic lives in `src/agents/developer/diff.ts` (story 4-2 scope). Neither the story artifact nor a test references that module. The path named in the AC is unimplemented for the iterator context.
- [x] AC3 — commit message format `[TICKET] fix: <summary>\n\nFixes findings: <ids>\n\n[ferry:iterator:<run_id>]` — covered by `prompt.test.ts > formats iterator commit message with run_id marker`
- [x] AC4 — unit test for 0, 1, 2 prior iteration rounds — covered by the three `buildIteratorPrompt` cases

**Findings:**
1. (severity: major) `src/lib/diff/apply.ts` — referenced in AC2 for scope enforcement on iterator diffs; the file does not exist. `src/agents/developer/diff.ts` implements equivalent logic scoped to story 4-2 but is not imported or exercised by any iterator code. Story 6-1 leaves FR26 (scope-enforced diff apply in the iterator path) without a dedicated implementation or test. **fix:** either expose `enforceScope` / `parseDiffPaths` from a shared `src/lib/diff/apply.ts` that both Developer and Iterator import, or document that story 4-2's `developer/diff.ts` is the shared implementation and add an import + test in iterator code confirming scope enforcement is wired.
2. (severity: minor) `prompt.test.ts` — `branch_head_sha` is set to `'abc123'` in all three `buildIteratorPrompt` test cases but never asserted. The prompt renders `Branch HEAD: ${input.branch_head_sha}` (line 51 of `prompt.ts`), so the field is emitted correctly, but there is zero test coverage verifying it. **fix:** add `expect(p).toContain('abc123')` (or the `'ccc'` value used in the 2-iteration case) to at least one test case.
3. (severity: nit) `prompt.test.ts` — no test exercises `buildIteratorPrompt` with `latest_findings: []`. The rendering loop is silent when empty, producing `Latest findings:\n\n` — acceptable output, but the empty-findings branch is not explicitly covered. **fix:** add a test case with an empty `latest_findings` array and assert the section header is still emitted.

**Recommendation:** blocked until finding #1 (FR26 path gap) is addressed. Findings #2 and #3 can be fixed in the same session.

---

### 6-2 — Resurgent-Finding Detection and Immediate Escalation

**Verdict:** merge-ready

**AC coverage:**
- [x] AC1 (FR27) — fingerprints present in both current and previous sets with `iteration >= 1` → `FerryError("oscillation")` thrown immediately — covered by `resurgence.test.ts > throws FerryError(oscillation) when resurgent at iteration >= 1`
- [x] AC2 — `FerryError("oscillation")` with `reason: "resurgent-findings"` and `resurgent` array in context — implementation at `resurgence.ts:25–29` ✓
- [x] AC3 — 0 resurgent → proceed — covered by `resurgence.test.ts > proceeds when no resurgent fingerprints`
- [x] AC3 — 1+ resurgent at iteration ≥ 1 → oscillation error — covered ✓
- [x] AC3 — resurgent at iteration 0 → proceed (first occurrence not oscillation) — covered by `resurgence.test.ts > does not throw at iteration 0` and `returns the resurgent set on early iterations`
- [x] Pure logic: no IO imports; only `FerryError` from `../error.js` ✓
- [x] FerryError taxonomy: uses `'oscillation'` code ✓

**Findings:**
1. (severity: nit) `resurgence.test.ts:23` — `toThrow(FerryError)` asserts the correct class but does not assert `.code === 'oscillation'`. The test description mentions "oscillation" but the code property is not verified. **fix:** use `expect(...).toThrow(expect.objectContaining({ code: 'oscillation' }))` or check `err.code` explicitly via `try/catch`.

**Recommendation:** transition review → done OK. Nit can be fixed opportunistically.

---

### 6-3 — 3-Iteration Cap with needs-human Escalation

**Verdict:** merge-ready

**AC coverage:**
- [x] AC1 — `state.iteration === 3` with findings → `FerryError("oscillation", { reason: "3-iteration-cap" })` — covered by `cap.test.ts > throws oscillation at iteration === 3 with findings`
- [x] AC2 — `state.iteration` 0, 1, 2 → `{ proceed: true }` — covered by `cap.test.ts > proceeds at iteration 0,1,2`
- [x] AC2 — `state.iteration === 3` with no findings → `{ proceed: true }` — covered by `cap.test.ts > does not throw at iteration 3 if there are no remaining findings`
- [x] AC3 — unit test asserts cap at exactly iteration = 3, not before ✓
- [x] Pure logic: no IO imports ✓
- [x] FerryError taxonomy: uses `'oscillation'` code ✓

**Findings:**
1. (severity: minor) `cap.ts:15` — `if (input.iteration >= 3 && input.hasFindings)`. The story doc says "at iteration === 3" and the test only exercises exactly `3`; the implementation fires at `>= 3` (iteration 4 or higher would also throw). While `>= 3` is more defensive and correct for production (prevents infinite bypass), the discrepancy between the doc/test ("exactly 3") and implementation (`>= 3`) should be acknowledged. **fix:** either update the doc and add a test case for `iteration = 4` confirming it also throws, or change the implementation to `=== 3` if the spec intentionally limits the cap to exactly one boundary. Recommended: keep `>= 3` and add test for `iteration = 4`.
2. (severity: nit) `cap.test.ts:15` — `toThrow(FerryError)` does not assert `.code === 'oscillation'`. **fix:** same pattern as finding #1 in story 6-2.

**Recommendation:** transition review → done OK. Both findings are non-blocking improvements.

---

### 6-4 — Escalation Summary Block on PR Body

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 (FR59) — block titled `🚨 Escalation Summary — human attention needed` with five sections — covered by `escalation.test.ts > renders all five required sections inside ferry:escalation markers`
- [x] AC1 — `What I tried`: 2–5 bullets ≤ 120 chars — validated and tested ✓
- [x] AC1 — `What blocked me`: ≥ 1 fingerprinted finding — validated and tested ✓
- [x] AC1 — `My best hypothesis`: ≤ 400 chars — validated and tested ✓
- [x] AC1 — `Suggested next action for you` — rendered and tested ✓
- [ ] AC1 — optional `Context` section — `buildEscalationBlock` renders it when present (`escalation.ts:81–85`), but **no test exercises the Context path**
- [x] AC2 — wrapped in `<!-- ferry:escalation -->…<!-- /ferry:escalation -->` markers — tested ✓
- [x] AC3 — idempotent re-write — covered by `escalation.test.ts > writeEscalationToBody is idempotent across re-runs`
- [x] AC4 — clear-after-resolution — covered by `escalation.test.ts > clearEscalationFromBody removes the marker region`
- [ ] AC1/AC4 — AC says "When `src/lib/io/github.ts` writes the escalation block to the PR body" — `github.ts` has no PR-body update function; `writeEscalationToBody` / `clearEscalationFromBody` are not called from `github.ts`. The glue between the pure builder and the GitHub API write is absent.

**Findings:**
1. (severity: major) `src/lib/io/escalation.ts:24–28` — `EscalationError` is a plain `Error` subclass, not a `FerryError`. The review protocol requires all thrown errors to be `FerryError` instances with a code from the taxonomy (`state-invariant | spend-cap | transient | oscillation | unknown`). Input-validation failures in `validate()` should map to `FerryError('state-invariant', { reason: 'invalid-escalation-input', ... })`. The same pattern issue exists in `src/lib/io/tldr.ts` (out of scope here but worth noting). **fix:** replace `export class EscalationError extends Error` with `FerryError('state-invariant', ...)` in all five `throw` sites in `validate()`; remove the `EscalationError` class export; update `escalation.test.ts` assertions to `toThrow(FerryError)`.
2. (severity: major) `src/lib/io/github.ts` — AC2 specifies that `github.ts` is the integration point that writes the escalation block to the PR body on `needs-human` transition. `github.ts` currently has no `updatePrBody` or equivalent function; the escalation builder is entirely disconnected from the GitHub write path. **fix:** add `updatePrBody(params: { repo: string; prNumber: number; body: string; octokit: ... }): Promise<void>` (or a scaffold stub matching the existing `createIssueComment` pattern) to `github.ts`, and wire `writeEscalationToBody` / `clearEscalationFromBody` through it.
3. (severity: minor) `escalation.test.ts` — no test for the optional `Context` section rendering when `input.context` is provided. **fix:** add a test case with `context: 'some extra context'` and assert `block.toContain('**Context**')` and `block.toContain('some extra context')`.
4. (severity: minor) `escalation.test.ts` — `next_action` empty-string validation is implemented (`escalation.ts:51–53`) but not tested. Similarly, `hypothesis` empty-string path is untested. **fix:** add `buildEscalationBlock({ ...validInput, next_action: '' })` and `buildEscalationBlock({ ...validInput, hypothesis: '' })` test cases asserting `toThrow(FerryError)` (or `EscalationError` until finding #1 is fixed).

**Recommendation:** blocked until findings #1 (taxonomy violation) and #2 (github.ts integration gap) are addressed. Findings #3 and #4 in the same session.

---

### 6-5 — Auto-Transition to In Review After Iterator Commit

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 (FR28) — transitions to `In Review`, applies `ferry:reviewing`, `next_phase: 'reviewing'`, increments `state.iteration` by 1 — covered by `transition.test.ts > returns In Review with ferry:reviewing label and increments iteration`
- [x] AC1 — `self_dispatch: false` — asserted in test ✓
- [ ] AC1 — "emits the `ferry-audit` line with cost and iteration number" — `transition.ts` returns only the transition descriptor; no audit emission is produced or tested. (Audit is a side effect; the pure function cannot emit it. However the story artifact says no test is needed for audit, so this is an orchestration gap.)
- [ ] AC3 — "a dry-run E2E test asserts the full Iterator flow: load history → LLM call (mocked) → apply diff → commit → transition → audit — with `state.iteration` correctly incremented" — **no such test exists**. The architecture doc planned `tests/e2e/iterate-happy.e2e.test.ts` and `tests/e2e/resurgent-escalation.e2e.test.ts` but the `tests/e2e/` directory does not exist.
- [x] AC2 — `self_dispatch: false` ensures Jira Automation (not Ferry) fires the next `repository_dispatch` — correctly hardcoded ✓
- [x] Pure logic: no IO imports ✓

**Findings:**
1. (severity: major) `tests/e2e/` directory — AC3 explicitly requires a dry-run E2E test asserting the full iterator flow (mocked LLM → apply diff → commit → transition → audit). Neither `tests/e2e/iterate-happy.e2e.test.ts` nor the directory exists. This is an unmet AC. **fix:** create `tests/e2e/iterate-happy.e2e.test.ts` with `FERRY_DRY_RUN=1`, a mock LLM response returning a minimal diff, mocked `git apply`, and assertions that `decideIteratorTransition` returns `next_iteration = initial + 1` and `self_dispatch === false`.
2. (severity: minor) `transition.test.ts` — `remove_labels: ['ferry:iterating']` is in the return value of `decideIteratorTransition` but no assertion checks it. **fix:** add `expect(t.remove_labels).toContain('ferry:iterating')` to the first test case.

**Recommendation:** blocked until finding #1 (missing E2E test) is addressed. Finding #2 in the same session.

---

REVIEW COMPLETE — epic-6 — 2 merge-ready, 3 changes-requested, 0 needs-human — report at _bmad-output/code-reviews/epic-6-review.md
