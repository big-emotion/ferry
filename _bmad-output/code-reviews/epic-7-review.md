# Epic 7 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 4

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 7-1 | changes-requested | 2 |
| 7-2 | merge-ready | 0 |
| 7-3 | merge-ready | 0 |
| 7-4 | changes-requested | 1 |

---

## Per-story findings

### 7-1 — Manual Cancel via GitHub Actions UI

**Verdict:** changes-requested

**AC coverage:**
- [x] FR34 — SHA mismatch flagged stale, `status:stale` label applied, writes short-circuited — covered by `cancel-recovery.test.ts::"flags as stale when stored pr_sha does not match current HEAD"` (asserts `stale`, `add_labels`, `exit_without_writes`)
- [x] FR34 — Schema-invalid state flagged stale — covered by `cancel-recovery.test.ts::"flags as stale when schema validation fails"` (asserts `stale=true`)
- [x] FR34 — Fresh ticket (no stored SHA) proceeds normally — covered by `cancel-recovery.test.ts::"proceeds when there is no stored pr_sha (fresh ticket)"`
- [x] FR34 — Clean state (matching SHAs, valid schema) proceeds normally — covered by `cancel-recovery.test.ts::"proceeds when SHAs match and schema is valid"`

**Findings:**

1. (severity: minor) `cancel-recovery.test.ts:16-23` — The schema-failure test only asserts `out.stale === true`; it does not assert `add_labels` or `exit_without_writes`. The SHA-mismatch test checks all three output fields, so the schema-fail path has partial assertion coverage. **fix:** Add assertions `expect(out.add_labels).toContain('status:stale')` and `expect(out.exit_without_writes).toBe(true)` to the `'flags as stale when schema validation fails'` test.

2. (severity: nit) `cancel-recovery.test.ts` — The combination `schema_ok: false` with `stored_pr_sha: undefined` (fresh-ticket + schema corrupt) is not directly tested. The logic handles it correctly (`!false = true`), but an explicit case would document the intent. **fix:** Add a small test case: `{ stored_pr_sha: undefined, current_head_sha: 'abc', schema_ok: false }` → expect `stale: true`.

**Recommendation:** Transition to review → done unblocked after the two test-only fixes are applied; implementation logic is correct.

---

### 7-2 — Label Re-Trigger and @Mention Re-Trigger with Context

**Verdict:** merge-ready

**AC coverage:**
- [x] FR35 — Label re-trigger (`jira-label`) builds envelope with correct fields; `instructions` is absent when not provided — covered by `retrigger.test.ts::"builds an envelope from a label re-trigger with no instructions"`
- [x] FR36 — `event_id` passes through unchanged (caller responsible for ULID freshness) — covered by `retrigger.test.ts::"label re-trigger preserves the event_id"`
- [x] NFR-S1 — @mention instructions wrapped in `delimitUntrusted()` (`<<<UNTRUSTED>>>` / `<<<END UNTRUSTED>>>` fences) — covered by `retrigger.test.ts::"appends @mention instructions wrapped in delimitUntrusted"`

**Findings:** None.

**Notes (non-blocking):**
- `RetriggerEnvelopeInput` and `RetriggerEnvelope` are structurally identical; the types exist to distinguish pre-sanitisation input from post-sanitisation output, which is the correct design for a security boundary.
- Whitespace-only `instructions` is correctly treated as absent (`trim().length > 0` guard, line 41); no separate test exists for this branch, but the behaviour is demonstrably correct and the guard is trivial enough not to require one.

**Recommendation:** Transition review → done OK.

---

### 7-3 — Pause and Needs-Human Label Handling

**Verdict:** merge-ready

**AC coverage:**
- [x] FR37 — `ferry:paused` present → `halt: true, outcome: 'paused'` — covered by `halt-labels.test.ts::"exits with paused outcome when ferry:paused is present"`
- [x] FR38 — `needs-human` present → `halt: true, outcome: 'needs_human_halt'` — covered by `halt-labels.test.ts::"exits with needs_human_halt when needs-human is present"`
- [x] Precedence — both labels present → `ferry:paused` wins (most-restrictive) — covered by `halt-labels.test.ts::"paused takes precedence over needs-human (most-restrictive wins)"`
- [x] Clean state — neither label → `halt: false` — covered by `halt-labels.test.ts::"proceeds when neither label is present"`
- [x] Edge case — empty label array → `halt: false` — covered by `halt-labels.test.ts::"handles empty label arrays"`

**Findings:** None.

**Notes (non-blocking):**
- Pure function (no IO, no env access); `Set` deduplication is correct and O(1) per lookup.
- TypeScript discriminated union `HaltCheckResult` correctly prevents accessing `outcome` on a `halt: false` result at compile time.

**Recommendation:** Transition review → done OK.

---

### 7-4 — Human-Only Merge and Column-Transition Invariants

**Verdict:** changes-requested

**AC coverage:**
- [x] FR39 — Zero `octokit.pulls.merge` calls under `src/` — covered by `no-auto-merge.test.ts::"finds zero octokit.pulls.merge calls under src/"` (live filesystem scan)
- [x] FR39 — Positive detection on synthetic snippet — covered by `no-auto-merge.test.ts::"detects octokit.pulls.merge in synthetic snippets"`
- [x] FR39 — No false positive on harmless prose containing "merge" — covered by `no-auto-merge.test.ts::"does not detect harmless mentions of the word \"merge\""`
- [x] FR18/FR24/FR28 — README documents "Ferry never merges" and the three permitted auto-transitions — covered by `no-auto-merge.test.ts::"README documents Ferry never merges and the three auto-transitions"` (regex-matched assertions)

**Findings:**

1. (severity: nit) `no-auto-merge.ts:52-53` — The skip-comment reads: `// Skip the policy module itself (regex literal would self-match)`. This is inaccurate: the escaped regex literal in source (`\\.merge`) does **not** match the detector's own pattern. The self-skip of `no-auto-merge.ts` is harmless but the stated reason is wrong. The skip of `no-auto-merge.test.ts` is correctly necessary (the test file contains the literal string `'await octokit.pulls.merge({ pull_number: 1 });'` at line 17 which would match). **fix:** Update the comment to: `// Skip this module and its test; the test file contains a literal snippet that would self-match.`

**Recommendation:** Transition review → done OK after the comment correction (single-line nit, no logic change required).

---

REVIEW COMPLETE — epic-7 — 2 merge-ready, 2 changes-requested, 0 needs-human — report at _bmad-output/code-reviews/epic-7-review.md
