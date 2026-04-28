# Epic 8 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 4

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 8-1 | merge-ready | 1 (nit) |
| 8-2 | changes-requested | 2 (1 major, 1 minor) |
| 8-3 | changes-requested | 2 (1 major, 1 minor) |
| 8-4 | merge-ready | 0 |

---

## Per-story findings

### 8-1 — Daily Provider Spend Check and 50% Soft Alert

**Verdict:** merge-ready

**AC coverage:**
- [x] FR45 / NFR-C4 — per-provider monthly spend checked against `FERRY_MAX_SPEND_EUR` cap — covered by `daily-check.test.ts::"emits ok when all providers under 50%"` and `"emits alert for any provider at >= 50% of cap"`
- [x] Alert triggered at ≥ 50% of cap — `SOFT_THRESHOLD = 0.5` with `ratio >= SOFT_THRESHOLD`; test exercises 51.7% case
- [x] Alert payload carries provider name, percent, monthly_eur, daily_eur, cap_eur — covered by `"alert text contains provider, percent, cap, and daily figures"`
- [x] EUR format `€X.XX` used throughout — `fmtEur` helper with `.toFixed(2)`; confirmed in text assertions
- [x] Negative spend clamped to `€0.00` — `fmtEur` applies `v < 0 ? 0 : v`; covered by `"clamps negative spend to €0.00 in formatted output"`
- [x] Pure logic — no IO in module; side effects explicitly delegated to `audit-daily.yml`

**Findings:**
1. (severity: nit) `daily-check.test.ts` — No boundary test for exactly 50% (e.g. `monthly_eur: 100, cap: 200` → ratio `= 0.5`). The `>=` operator makes it correct, but an explicit boundary case would strengthen confidence. — **fix:** add a single `it('triggers alert at exactly 50%', ...)` test case.

**Recommendation:** transition review → done OK.

---

### 8-2 — HTTP 429/402 Auto-Pause on Provider Rate Limits

**Verdict:** changes-requested

**AC coverage:**
- [x] FR46 — 429 classified as `spend-cap` — `classifyHttpStatus(429)` tested
- [x] FR46 — 402 classified as `spend-cap` — `classifyHttpStatus(402)` tested
- [x] NFR-R4 — 5xx classified as `transient` — `classifyHttpStatus(500)` tested
- [x] 2xx classified as `ok` — `classifyHttpStatus(200)` tested
- [x] Pause directive applies both `ferry:paused` and `ferry:spend-cap` labels — covered by `"builds the pause directive with both labels and a Jira comment"`
- [x] Jira comment carries `[ferry:<role>:<run_id>]` marker — covered by `"builds the pause directive…"`
- [x] `audit_outcome: 'spend-cap'` present on directive — tested
- [x] Pause is ticket-scoped (`ticket_key` on directive, no global flag) — by construction
- [ ] Other 4xx (e.g. 403, 404) branch — NOT covered: the code returns `'spend-cap'` but the inline comment claims "treat as unknown (caller should error out, not auto-pause)". This is a comment/logic mismatch **and** this branch has no test.

**Findings:**
1. (severity: major) `src/lib/io/spend-cap.ts:15` — `if (status >= 400) return 'spend-cap';` classifies all other 4xx (401 Unauthorized, 403 Forbidden, 404 Not Found, etc.) as `spend-cap`, which would trigger ticket auto-pause for auth errors and missing resources. The inline comment on lines 13–14 explicitly states these should NOT auto-pause ("caller should error out"), but the code contradicts that intent. The `HttpClass` type has no `'unknown'` member to express this. — **fix:** either (a) add `'unknown'` to `HttpClass` and return it here, letting callers handle it as a non-retryable error without auto-pausing, or (b) change the comment to acknowledge 4xx other than 429/402 will pause, and add a test for it. Option (a) is preferred for correct semantics per the comment.

2. (severity: minor) `src/lib/io/spend-cap.test.ts` — Test suite claims to cover "all classifier branches" (story doc) but has no test for other-4xx, 3xx, or 1xx/sub-200 paths. With the finding above outstanding, the 3xx → `transient` and other-4xx → `spend-cap` branches are entirely untested. — **fix:** add tests for at least `403` (currently `spend-cap`, should be `unknown` if (a) above is adopted) and `302` (currently `transient`).

**Recommendation:** blocked until finding #1 (major) is resolved; finding #2 should be addressed in the same pass.

---

### 8-3 — 15-Minute Reconciler Cron With ULID Dedupe

**Verdict:** changes-requested

**AC coverage:**
- [x] FR50 — dispatch issued when Jira column ≠ `state.phase` column equivalent — covered by `"dispatches when Jira column does not match state.phase"`
- [x] FR51 — no dispatch when column matches phase — covered by `"does NOT dispatch when column matches state.phase"`
- [x] FR50 — dispatch when no state file AND `last_audit_minutes_ago >= 20` — covered by `"dispatches when no state file but recent audit is older than 20 minutes"`
- [x] FR51 — no dispatch when no state file but `last_audit_minutes_ago < 20` — covered by `"does NOT dispatch when no state file but a recent audit (<20m) exists"`
- [x] `scanned` count in outcome — covered by `"summary includes total ticket count scanned"`
- [x] `source: 'reconciler'` on every directive — tested in mismatch case
- [x] Fresh ULID per dispatch (dedupe) — regex `/^[0-9A-Z]{26}$/` validated in test
- [x] Pure logic — no IO, no `process.env`; imports only `generateULID` from internal lib

**Findings:**
1. (severity: major) `src/reconciler/reconcile.ts:77` — `inferPhase` falls back to `'refine'` for any column not present in `COLUMN_TO_PHASE` (which covers only the four active work columns). Terminal/special columns `'Paused'`, `'Cancelled'`, `'Ready to Merge'`, and `'Needs Human'` are absent from `COLUMN_TO_PHASE`, so a no-state-file + stale-audit ticket sitting in one of these columns would be dispatched with `phase: 'refine'`, potentially restarting a finished or paused ticket. No test covers this path. — **fix:** either (a) add the missing columns to `COLUMN_TO_PHASE` mapping to their correct phase names, or (b) return `undefined`/skip dispatch when `inferPhase` gets an unrecognised column, and add tests for at least `'Paused'` and `'Cancelled'` columns.

2. (severity: minor) `src/reconciler/reconcile.ts:41` — `now_iso: string` is declared in `ReconcileInput` but is never read anywhere in `reconcileTickets` or any helper. It is dead interface surface that inflates every call site. — **fix:** remove `now_iso` from `ReconcileInput` (and from all test call sites), or document clearly why it is reserved for future use with a `// reserved` comment.

**Recommendation:** blocked until finding #1 (major) is resolved; finding #2 is a clean-up that can be done in the same pass.

---

### 8-4 — Comment Volume Ceiling via In-Place Editing

**Verdict:** merge-ready

**AC coverage:**
- [x] FR60 — `update` directive returned with correct `target_id` and refreshed `[ferry:<role>:<run_id>]` marker when a matching comment exists — covered by `"updates in place when an existing marker matches the role"`
- [x] NFR-UX4 — `create` directive returned when no marker for the role exists — covered by `"creates a new comment when no marker for the role exists"`
- [x] Different roles produce separate comments (no cross-role collision) — covered by `"different roles produce separate comments"`
- [x] Matching is by `[ferry:<role>:` prefix only, `run_id` changes do not split comments — covered by `"matches the existing comment by role marker prefix only (run_id is ignored)"`
- [x] `target_id` undefined on `create` directive — tested
- [x] Pure logic — no IO; single-responsibility function
- [x] Comment format `[ferry:<role>:<run_id>]` prefix — by construction and tested

**Findings:** none.

**Recommendation:** transition review → done OK.

---

REVIEW COMPLETE — epic-8 — 2 merge-ready, 2 changes-requested, 0 needs-human — report at _bmad-output/code-reviews/epic-8-review.md
