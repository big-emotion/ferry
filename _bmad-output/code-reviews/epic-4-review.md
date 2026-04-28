# Epic 4 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 4

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 4-1 — Developer Reads Ticket & Builds File Context | changes-requested | 3 |
| 4-2 — Branch Creation, Code Generation & Scope-Enforced Diff Application | changes-requested | 2 |
| 4-3 — Critical-Model Routing on `critical` Label | changes-requested | 1 |
| 4-4 — Draft PR Open & Auto-Transition to In Review | merge-ready | 0 |

---

## Per-story findings

### 4-1 — Developer Reads Ticket & Builds File Context

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — `buildContext` wraps each file in `<file path="...">…</file>` blocks and ticket in `delimitUntrusted` fences — partially covered by `context.test.ts` "wraps ticket and files in delimited blocks": open fence `<<<UNTRUSTED>>>` asserted, but close fence `<<<END UNTRUSTED>>>` is not asserted (see Finding 1).
- [x] AC2 — throws `FerryError("state-invariant", { reason: "context-too-large" })` when bytes exceed `maxBytes` — covered by "throws state-invariant when total bytes exceed cap"; `FerryError` instance check passes but the specific `.code` value is not asserted (see Finding 2).
- [x] AC3 — throws `FerryError("state-invariant", { reason: "missing-touch-paths" })` for empty `touchPaths` — covered by "throws state-invariant when touchPaths is empty"; the `undefined` variant is unchecked at the test layer (see Finding 3).
- [x] AC4 — `MAX_TOUCH_PATHS = 20` and `MAX_CONTEXT_BYTES = 200_000` exported — covered by "exports the documented constants".

**Findings:**

1. (minor) `context.test.ts:19` — AC1 requires the ticket to be wrapped in `delimitUntrusted` fences (plural). The test only asserts the open token `<<<UNTRUSTED>>>` but never asserts the close token `<<<END UNTRUSTED>>>`. A prompt-injection escape (e.g. a description containing `<<<END UNTRUSTED>>>`) would silently suppress the closing fence, and the test would not catch it. **fix:** add `expect(out).toContain('<<<END UNTRUSTED>>>');` alongside the existing open-fence assertion.

2. (minor) `context.test.ts:26–32` — The test for AC2 is named "throws state-invariant when total bytes exceed cap" but only asserts `.rejects.toBeInstanceOf(FerryError)` — it does not assert that `error.code === 'state-invariant'` or that `context.reason === 'context-too-large'`. A regression that changes the error code would pass silently. By contrast, the missing-touch-paths test correctly uses `.rejects.toThrow(/missing-touch-paths/)`, which exercises the message content. **fix:** change the assertion to `.rejects.toThrow(/context-too-large/)` (or add `.rejects.toMatchObject({ code: 'state-invariant' })`).

3. (nit) `context.test.ts` — AC3 states "empty **or undefined**". The TypeScript interface declares `touchPaths: string[]` (non-optional), so the TypeScript compiler prevents passing `undefined` via normal typed calls. However, the runtime guard `if (!input.touchPaths || ...)` explicitly handles the `undefined` case, and callers from JavaScript or via `as unknown` casting could hit it. There is no test for the `undefined` branch. **fix:** add a test case `buildContext({ ticket, touchPaths: undefined as unknown as string[], readFile: … })` to verify the runtime guard.

**Recommendation:** Blocked until findings 1 and 2 are fixed; finding 3 is optional but recommended for completeness.

---

### 4-2 — Branch Creation, Code Generation & Scope-Enforced Diff Application

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — `parseDiffPaths(diff)` returns deduped list of touched files — covered by "returns deduped paths from diff --git headers" and "returns empty array for empty diff".
- [x] AC2 — `enforceScope` throws `FerryError("state-invariant", { reason: "scope-violation" })` for paths outside `allowedPaths ∪ {".ferry/state.json"}` — covered by "throws scope-violation when a path is outside the allow-list" and "passes when a path is the well-known state file".
- [x] AC3 — `.github/**` paths are hard-rejected regardless of `allowedPaths` — covered by "hard-rejects .github/** even if explicitly allowed (defense-in-depth)".
- [x] AC4 — `formatDeveloperCommit({ ticketKey, runId, summary })` returns canonical format with `[ferry:developer:runId]` trailer — covered by "renders the canonical commit message format".
- [x] AC5 — `formatBranchName(ticketKey)` returns `ferry/<ticketKey>` — covered by parametric test in `commit.test.ts`.

**Findings:**

1. (minor) `diff.ts:12–18` / `diff.test.ts` — `parseDiffPaths` adds **both** the `a/` and `b/` paths from each `diff --git a/<src> b/<dst>` header to the set. For renames (`git mv old.ts new.ts`), the two paths differ, which means `enforceScope` would require **both** the old path and the new path to be present in `allowedPaths`. The old path no longer exists after the rename and would typically not be in the Refiner's scope list. There is no test for this case and no comment acknowledging the limitation. **fix:** Either add a `parseDiffPaths` test case for renames documenting the current behavior, or handle renames explicitly (e.g. parse `rename from`/`rename to` headers and only require the new path in `allowedPaths`). At minimum, document the known behavior with a comment in `diff.ts`.

2. (nit) `commit.test.ts:15–23` — The "lowercases the leading character of the summary" test passes `'Add Login Button'` and asserts `toContain('feat: add Login Button')`. This correctly documents that only the first character is lower-cased. However there is no test for an already-lowercase summary or an empty summary string (the implementation has a length guard but no test for `summary = ''`). **fix:** Add a test for `summary = ''` to confirm it does not throw and the result is well-formed.

**Recommendation:** Blocked until finding 1 is addressed (at minimum with a documenting test/comment); finding 2 is a nit.

---

### 4-3 — Critical-Model Routing on `critical` Label

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — `routeModel({ agent: 'developer', labels: ['critical'] }, cfg)` returns `cfg.critical` — covered by "developer + critical label -> critical route".
- [x] AC2 — `routeModel` without `critical` label returns `cfg.default` — covered by "developer without critical label -> default route".
- [x] AC3 — non-developer agents always get `cfg.default` even with `critical` label — covered by "non-developer agents always use the default route" (tests all three: refiner, reviewer, iterator).

**Findings:**

1. (nit) `route.ts:4` — The JSDoc comment contains a Unicode EM dash (`—`, U+2014, bytes `0xE2 0x80 0x94`): `"the critical label — refiner / reviewer /"`. All other source files in this epic are pure ASCII. This is a single non-ASCII byte sequence in a comment only. The protocol requires English-only and, by convention for this codebase, ASCII source content. **fix:** replace `—` with a plain ASCII hyphen or double-hyphen: `"the critical label -- refiner / reviewer /"`.

**Recommendation:** Transition review → done is acceptable once the nit is fixed; it does not block functionality.

---

### 4-4 — Draft PR Open & Auto-Transition to In Review

**Verdict:** merge-ready

**AC coverage:**
- [x] AC1 — `formatPullRequestTitle({ ticketKey, summary })` returns `"[<key>] <summary>"` — covered by "prefixes the ticket key in brackets".
- [x] AC2 — `formatPullRequestBody` returns body containing Jira URL, run id, and TLDR — covered by "includes Jira link, run id, and TLDR"; also by "keeps the body trim-able (no trailing spaces, ends with newline)".
- [x] AC3 — `transitionToReview({ state, prNumber })` returns new object with `phase = "reviewing"` and `pr_number = prNumber` — covered by "sets phase=reviewing and pr_number while preserving other fields"; immutability of input also verified in the same test.
- [x] AC4 — `DRAFT_PR_OPTS = { draft: true }` exported — covered by "is { draft: true }".

**Findings:** None.

**Pure-logic checks:**
- `pr.ts` — no direct IO (no `fetch`, `octokit`, `fs`, `process.env`). State mutation returns a new spread object (immutable). Trailing-slash normalisation on `jiraBaseUrl` is robust (`replace(/\/+$/, '')`).
- All four helpers are independently unit-tested.

**Recommendation:** Transition review → done is fully justified.

---

## Cross-cutting observations

- **FerryError taxonomy**: all errors raised across the four stories use `'state-invariant'`, which is the correct code for pre-condition violations. No use of other codes where inappropriate.
- **Pure logic / no injected IO**: all five implementation modules (`context.ts`, `diff.ts`, `commit.ts`, `pr.ts`, `route.ts`) are free of direct `fetch`/`octokit`/`fs`/`process.env` calls. IO is either injected (4-1 `readFile` callback) or absent.
- **Idempotence**: no ferry slot/marker builders (`<!-- ferry:* -->`) appear in these modules; idempotency criterion is not applicable.
- **English only**: all comments are English. The single EM dash in `route.ts:4` is a typographic non-ASCII in a comment (flagged above as nit).
- **No Co-Authored-By markers**: confirmed absent.
- **`[ferry:<role>:]` prefix**: correctly applied in commit trailers (`[ferry:developer:${runId}]` in `commit.ts`). PR body uses plain prose for run id as required by AC2 of story 4-4 — no Jira comment context applies there.

---

REVIEW COMPLETE — epic-4 — 1 merge-ready, 3 changes-requested, 0 needs-human — report at _bmad-output/code-reviews/epic-4-review.md
