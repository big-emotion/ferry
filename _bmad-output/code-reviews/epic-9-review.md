# Epic 9 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 2

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 9-1 — Mandated TL;DR Block in PR Body | changes-requested | 4 |
| 9-2 — CI Check for TL;DR Format and Length | merge-ready | 1 |

---

## Per-story findings

### 9-1 — Mandated TL;DR Block in PR Body

**Verdict:** changes-requested

**AC coverage:**
- [x] 6-field markdown table (Ships, Touches, Risk, Tests, Rollback, Reviewer verdict) — present in `buildTldrBlock`; all six fields asserted in `tldr.test.ts::'builds a 6-field block'`
- [x] Wrapped in `<!-- ferry:tldr -->` / `<!-- /ferry:tldr -->` markers — asserted in same test
- [x] Total length capped at 500 chars (FR55) — tested in `tldr.test.ts::'rejects blocks longer than 500 characters'`
- [x] Idempotent upsert — tested in `tldr.test.ts::'upsertTldrInBody is idempotent on re-write'`
- [x] Reviewer verdict field updated in-place — tested in `tldr.test.ts::'updateReviewerVerdictField updates only that row'`
- [x] Reviewer verdict truncated at 40 chars — tested in `tldr.test.ts::'updateReviewerVerdictField truncates verdict text > 40 chars'`
- [ ] **Field order** — the story doc states "tldr.test.ts covers field order", but the test only asserts field *presence* (`toContain`), not order. No test checks that Ships appears before Touches before Risk, etc.

**Findings:**

1. (severity: **blocker**) `src/lib/io/tldr.ts:22-27` — `TldrError` extends plain `Error`, not `FerryError`. The ferry-grade protocol requires any thrown error to be a `FerryError` with a taxonomy code. A block-too-long condition is a `state-invariant` violation.
   - **fix:**
     ```ts
     import { FerryError } from '../error.js';
     // remove the TldrError class; replace the throw on line 66 with:
     throw new FerryError('state-invariant', { blockLength: block.length, max: TLDR_MAX_LEN });
     ```
     Update `tldr.test.ts` line 34: change `toThrow(TldrError)` to `toThrow(FerryError)` (import `FerryError` from `'../error.js'`).

2. (severity: **minor**) `src/lib/io/tldr.ts:48` — Magic number `80 + 8` for the risk field truncation limit is unexplained. The intent appears to be 80 chars of justification plus up to 8 chars of prefix (`'medium — '` = 9 chars, so the actual cap is ~88 chars), but the arithmetic is incorrect for the `medium` prefix (9 chars, not 8) and the rationale is undocumented.
   - **fix:** Extract a named constant and document the derivation:
     ```ts
     // 'medium — '.length (9) + 79 chars = 88 total; generous but bounded
     export const TLDR_MAX_RISK_LEN = 88;
     // ...
     const risk = `${input.risk_level} — ${input.risk_justification}`.slice(0, TLDR_MAX_RISK_LEN);
     ```

3. (severity: **nit**) `src/lib/io/tldr.ts:78-79` — `upsertTldrInBody` separator logic is inconsistent. A body without a trailing `\n` gets `block + '\n' + '\n\n' + body` (2 blank lines between block and existing body), while a body with a trailing `\n` gets `block + '\n' + '\n' + body` (1 blank line). Standard markdown convention is 1 blank line.
   - **fix:** Normalise to one blank line:
     ```ts
     const sep = body.length === 0 ? '' : '\n\n';
     return `${block}\n${sep}${body.trimStart()}`;
     // or simply: return `${block}\n\n${body.trimStart()}` when body non-empty
     ```
     (Exact approach depends on whether trimming the existing body's leading whitespace is acceptable.)

4. (severity: **nit**) `src/lib/io/tldr.test.ts:16-26` — The test named `'builds a 6-field block wrapped in ferry:tldr markers'` asserts field *presence* only. The story doc explicitly states "field order" is covered by this test suite, but no test verifies that Ships appears before Touches before Risk, etc. Order correctness is enforced by construction (the builder hardcodes the order), but a regression test would make this explicit.
   - **fix:** Add one assertion that checks relative position, e.g.:
     ```ts
     const idx = (s: string) => block.indexOf(s);
     expect(idx('| Ships |')).toBeLessThan(idx('| Touches |'));
     expect(idx('| Touches |')).toBeLessThan(idx('| Risk |'));
     // … etc.
     ```

**Recommendation:** Blocked until finding #1 (TldrError taxonomy) is fixed. Findings #2–#4 can be addressed in the same patch session.

---

### 9-2 — CI Check for TL;DR Format and Length

**Verdict:** merge-ready

**AC coverage:**
- [x] Passes for a well-formed block authored by the ferry bot — covered by `tldr-validate.test.ts::'passes for a well-formed block'`
- [x] Fails with explicit message when `ferry:tldr` marker is missing — covered by `tldr-validate.test.ts::'fails when ferry:tldr marker is missing'`
- [x] Fails with explicit message when fields are out of order — covered by `tldr-validate.test.ts::'fails when fields are out of order'`
- [x] Fails with explicit message when block exceeds 500 chars (FR56) — covered by `tldr-validate.test.ts::'fails when block exceeds 500 chars'`
- [x] Human-authored PRs are skipped (`{ ok: true, skipped: true }`) — covered by `tldr-validate.test.ts::'skips validation for human-authored PRs'`

**Findings:**

1. (severity: **nit**) `src/lib/io/tldr-validate.ts:35-42` — A block containing fewer than 6 fields (e.g., one field accidentally deleted) returns `{ ok: false, message: 'TL;DR fields out of order.' }` rather than a more descriptive "missing field" message. The AC does not require distinguishing these cases, so this is informational only.
   - **fix (optional):** After the order loop, add a guard `if (seen.length < TLDR_FIELD_ORDER.length) return { ok: false, message: 'TL;DR block is missing required fields.' };` before the order comparison.

**Recommendation:** Transition review → done is justified. The single nit does not block merge.

---

REVIEW COMPLETE — epic-9 — 1 merge-ready, 1 changes-requested, 0 needs-human — report at _bmad-output/code-reviews/epic-9-review.md
