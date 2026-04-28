# Epic 5 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 4

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 5-1 — CI-Status Gate | merge-ready | 0 |
| 5-2 — Fingerprinted Findings & Rule Taxonomy | changes-requested | 2 |
| 5-3 — Structured Reviewer Summary and Verdict | changes-requested | 2 |
| 5-4 — Auto-Transition Based on Review Outcome | changes-requested | 2 |

---

## Per-story findings

### 5-1 — CI-Status Gate: Green Proceeds, Red Produces Synthetic Finding

**Verdict:** merge-ready

**AC coverage:**
- [x] AC1 — Pending CI exits with `outcome: "pending-ci"`, no LLM call, no findings posted — covered by `ci-gate.test.ts::"pending CI returns pending-ci with no findings and skip flag"`
- [x] AC2 — Red CI emits synthetic finding with `rule_id: "ci-failure"`, transitions to `Changes Requested`, audit tokens=0, cost=0 — covered by `ci-gate.test.ts::"red CI returns synthetic ci-failure finding and transitions to changes-requested"`
- [x] AC3 — Green CI proceeds to real review path — covered by `ci-gate.test.ts::"green CI proceeds and emits no synthetic findings"`
- [x] AC4 — Both branches always emit an audit decision via gate output (tokens + cost_eur present in all three outcomes) — covered implicitly across all three branch tests; pending and red both assert `tokens.input=0, tokens.output=0, cost_eur=0`

**Additional coverage:**
- Red CI without `failure_summary` uses the default message — covered by `ci-gate.test.ts::"red CI without summary still emits a finding with a default message"`

**Pure logic:** `gateCi` has no IO; all side effects are delegated to the caller. Clean.

**FerryError taxonomy:** No errors are thrown by this module. N/A.

**English only / KISS / no Co-Authored-By:** Pass.

**Findings:** none

**Recommendation:** transition review → done OK.

---

### 5-2 — Code Review with Fingerprinted Findings and Rule Taxonomy

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — Findings reference a `rule_id` from `examples/reviewer-rules.yaml` plus synthetic `ci-failure`; unknown ids cause `ReviewerFindingsSchemaError` — covered by `schema.test.ts::"accepts findings with rule_ids drawn from the taxonomy"`, `"throws ReviewerFindingsSchemaError when rule_id is unknown"`, `"accepts the synthetic ci-failure rule_id"`
- [x] AC2 — Each fingerprint is `SHA-256({file, line_start, line_end, rule_id})` with POSIX-normalized paths (FR22) — covered by `fingerprint/index.test.ts::"is deterministic for the same inputs"`, `"normalizes windows path separators to POSIX"`, `"different rule_ids produce different fingerprints"`, `"fingerprintFinding tolerates missing line numbers via 0,0 default"`
- [x] AC3 — Schema rejects empty messages — covered by `schema.test.ts::"rejects empty messages"`

**Findings:**

1. (severity: minor) `src/agents/reviewer/schema.ts:10–44` — `readFileSync` is called directly inside `loadTaxonomy()` with no dependency injection. The module-level `cachedTaxonomy` variable also persists between test runs in the same process, so tests cannot reset the cache to simulate a missing YAML file. The story document explicitly calls this a "taxonomy loader" so some FS access is expected, but the absence of injection means the cache cannot be cleared and the missing-YAML branch (`catch {}` at line 50–52) has no test coverage. **fix:** Export a `resetTaxonomyCache()` function (for tests) and/or accept an optional `readFile` injector parameter in `loadTaxonomy`. Alternatively, document the test limitation and add a vitest `afterEach` that resets `cachedTaxonomy` by re-importing with `vi.resetModules()`.

2. (severity: nit) `src/agents/reviewer/schema.test.ts:31` — The empty-message test only exercises an empty string `''`. The implementation also rejects whitespace-only strings (`f.message.trim().length === 0`), but this sub-branch is not explicitly tested. **fix:** Add a test case: `validateFindings([{ ...validFinding, message: '   ' }])` should also throw `ReviewerFindingsSchemaError`.

**Recommendation:** bloqué jusqu'à fix du finding #1 (minor — testability gap in the FS-IO path of `loadTaxonomy`). Finding #2 can be addressed in the same pass.

---

### 5-3 — Structured Reviewer Summary and Verdict

**Verdict:** changes-requested

**AC coverage (derived from Implementation + Story sections; no explicit AC list in story doc):**
- [x] Three-field verdict struct (`decision`, `top-risk`, `reading-time-estimate`) — implemented in `verdict.ts:13–17`; covered by `verdict.test.ts::"builds a 3-field verdict with merge-ready when no findings"`
- [x] `merge-ready` when no findings, `top-risk: "none"` — covered by `verdict.test.ts::"builds a 3-field verdict with merge-ready when no findings"`
- [x] `changes-requested` with first finding (preferring `ci-failure`) as `top-risk` — covered by `verdict.test.ts::"uses changes-requested when findings are present"`; ci-failure preference tested implicitly via `buildVerdict` filtering at `verdict.ts:56–57`
- [x] `truncateVerdict` throws `ReviewerVerdictError` if verdict exceeds 120-word cap (NFR-UX3) — covered by `verdict.test.ts::"truncateVerdict throws when summary exceeds 120 words"` and `"truncateVerdict passes through verdicts at or under 120 words"`
- [x] `writeVerdictToBody` writes `<!-- ferry:reviewer-verdict --> ... <!-- /ferry:reviewer-verdict -->` slot idempotently — covered by `verdict.test.ts::"writes idempotent ferry:reviewer-verdict block into PR body"`

**Findings:**

1. (severity: minor) `src/agents/reviewer/verdict.ts:48–63` — `buildVerdict` can only return `merge-ready` or `changes-requested`. The `ReviewerDecision` type includes `needs-human`, but there is no code path inside `buildVerdict` that produces it, and no test validates that `writeVerdictToBody` works correctly when the decision is `needs-human`. A caller who manually constructs a `needs-human` verdict and passes it to `writeVerdictToBody` will get the correct slot rendering, but this is untested. **fix:** Add a test case in `verdict.test.ts` that calls `writeVerdictToBody` with a manually-constructed `needs-human` verdict and verifies the block is written correctly (decision line = `decision: needs-human`).

2. (severity: nit) `src/agents/reviewer/verdict.ts:56` — The `ci-failure` preference comment in `buildVerdict` is tested indirectly (through finding list ordering) but there is no explicit test that places a non-`ci-failure` finding before a `ci-failure` finding in the input array and asserts the `ci-failure` is promoted to `top-risk`. **fix:** Add a test: `findings: [{rule_id: 'no-co-authored-by', message: 'x'}, {rule_id: 'ci-failure', message: 'y'}]` — expect `v['top-risk']` to start with `ci-failure:`.

**Recommendation:** bloqué jusqu'à fix du finding #1 (minor — `needs-human` path through `writeVerdictToBody` is untested). Finding #2 is a nit and can be batched.

---

### 5-4 — Auto-Transition Based on Review Outcome

**Verdict:** changes-requested

**AC coverage (derived from Implementation section; no explicit AC list in story doc):**
- [x] `merge-ready` → `jira_status: "Ready to Merge"`, add `ferry:ready`, remove `ferry:reviewing`, `next_phase: "ready"`, `self_dispatch: false` — fully covered by `transition.test.ts::"merge-ready transitions to Ready to Merge with ferry:ready label"`
- [x] `changes-requested` → `jira_status: "Changes Requested"`, remove `ferry:reviewing"`, `next_phase: "iterating"`, `self_dispatch: false` — covered by `transition.test.ts::"changes-requested transitions to Changes Requested and never self-dispatches"`
- [x] `needs-human` → no column move (`jira_status: undefined`), add `needs-human`, `next_phase: "escalated"` — covered by `transition.test.ts::"needs-human escalates without changing the column"`
- [x] `self_dispatch` is always `false` — covered for `merge-ready` and `changes-requested` branches; NOT explicitly asserted in the `needs-human` test

**Findings:**

1. (severity: minor) `src/agents/reviewer/transition.test.ts:23–28` — The `needs-human` test does not assert `self_dispatch === false` or that `remove_labels` contains `'ferry:reviewing'`. The implementation does set both correctly (`transition.ts:43–44`), but the omission leaves these invariants un-guarded by tests. Given that `self_dispatch: false` is highlighted in both the story doc ("Ferry must not self-trigger downstream phases") and a comment in the source (`/** Always false; Ferry must not self-trigger downstream phases. */`), this is worth closing. **fix:** Extend the `needs-human` test to add `expect(t.self_dispatch).toBe(false)` and `expect(t.remove_labels).toContain('ferry:reviewing')`.

2. (severity: nit) `src/agents/reviewer/transition.test.ts:14–21` — The `changes-requested` test does not assert `add_labels` is empty (the implementation correctly returns `add_labels: []`). **fix:** Add `expect(t.add_labels).toEqual([])` to the `changes-requested` test to guard against accidental label additions in future refactors.

**Recommendation:** bloqué jusqu'à fix du finding #1 (minor — `self_dispatch` invariant for `needs-human` is unguarded). Finding #2 is a nit.

---

## Cross-cutting observations

- **FerryError taxonomy:** `ReviewerFindingsSchemaError` (`schema.ts`) and `ReviewerVerdictError` (`verdict.ts`) both extend `Error` directly rather than `FerryError`. This is consistent with the pattern already established in the codebase (`EscalationError`, `TldrError` in `src/lib/io/` also extend `Error`). These are domain-validation errors, not operational errors requiring a `FerryErrorCode`. No action required.
- **English only / KISS:** All source and test files are English-only, comments are clear, no Co-Authored-By trailers found in Epic 5 commits.
- **Idempotence:** `writeVerdictToBody` slot replacement confirmed idempotent via test and code inspection. `fingerprintFinding` is deterministic by construction (SHA-256 of stable JSON).
