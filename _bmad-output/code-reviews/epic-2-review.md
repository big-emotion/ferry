# Epic 2 — Code Review

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 4

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 2-1 — Column-Transition Dispatch & Workflow Routing | changes-requested | 3 |
| 2-2 — Label-Based & @Mention Re-Trigger Dispatch | changes-requested | 2 |
| 2-3 — Per-Ticket Daily Trigger Cap | merge-ready | 0 |
| 2-4 — Phase Labels, Jira Phase Comments & ferry-audit Emission | merge-ready | 1 |

---

## Per-story findings

### 2-1 — Column-Transition Dispatch & Workflow Routing

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — Single source of truth in `routing.ts` — `routing.test.ts` imports only from `routing.ts`; `workflow-binding.test.ts` and `dry-run.test.ts` do the same.
- [x] AC2 — Workflow YAMLs assert matching `repository_dispatch.types` — `workflow-binding.test.ts::workflow ↔ phase binding` parses all four YAMLs and asserts type match. All four YAMLs verified to declare the correct types (`ferry-refine`, `ferry-dev`, `ferry-review`, `ferry-iterate`).
- [x] AC3 — Unknown phase rejected before side-effects — `dry-run.test.ts::"rejects unknown phase values before any side-effect (Story 1-3 regression)"` confirms Ajv throws on `phase: 'deploy'`.
- [x] AC4 — `shouldProcessTicketType` returns `false` for `Task`, `true` for `Story`/`Bug`/`Spike` — `routing.test.ts::shouldProcessTicketType` covers all cases including `undefined`. `skipCommentForTaskType` comment shape tested in `routing.test.ts`. `skip-task-type-action.ts` is wired in `refine.yml` and exits 0. **Partial gap:** the FR6 skip step (`skip-task-type-action.ts`) is wired only in `refine.yml`; `dev.yml`, `review.yml`, and `iterate.yml` do not include it (see Finding 2).
- [x] AC5 — All four phase-to-workflow mappings covered by `dry-run.test.ts::dry-run E2E`.

**Findings:**

1. **(info: dual-API — non-blocking)** `src/lib/dispatch/routing.ts` (this story, my implementation) and `src/lib/dispatch/route.ts` + `src/lib/dispatch/skip-task-type-action.ts` (PR #18 from main) coexist and implement overlapping functionality with divergent APIs:
   - `routing.ts`: `phaseToWorkflow(phase: keyof RoutingTable): WorkflowFile` — TypeScript-typed, returns `undefined` at runtime for out-of-enum input (relies on upstream Ajv gate), no FerryError thrown.
   - `route.ts`: `phaseToWorkflow(phase: EventPhase): string` — switch-default throws `FerryError('state-invariant')` for unknown phases (more defensive at runtime).
   - `skip-task-type-action.ts` uses `envelope.issue_type` (legacy field); `routing.ts` uses `ticket_type` (canonical field per AC4).
   - Both code paths are exercised and tested. There is no functional regression.
   - **Recommendation:** consolidate to one API (`routing.ts` + `routing.test.ts`) in a follow-up story; deprecate `route.ts` and `skip-task-type-action.ts`. Does not block merge.

2. **(severity: minor)** `src/lib/dispatch/skip-task-type-action.ts` is wired only in `.github/workflows/refine.yml` (line 45). The AC4 requirement ("exits 0 without creating sub-tasks or writing state") implies FR6 should guard all four phase entry-points. `dev.yml`, `review.yml`, and `iterate.yml` have no corresponding skip step.
   - **Impact:** A Task ticket dispatched to dev/review/iterate phases will not be filtered. Low-risk given Task tickets are typically created by the Refiner (not by Jira Automation rules directly triggering dev/review/iterate), but architecturally incomplete.
   - **Fix:** Add the `Skip Task tickets (FR6)` step to `dev.yml`, `review.yml`, and `iterate.yml` (copy lines 43–47 from `refine.yml`), or — preferably — wire it via a reusable composite action once the dual-API is resolved. This fix can be done in the same session.

3. **(severity: nit)** `src/lib/dispatch/routing.ts:29` — `phaseToWorkflow` has no runtime guard for unexpected input. If called with a dynamic string at runtime (e.g., from a future code path that casts before validating), `PHASE_TO_WORKFLOW[phase]` returns `undefined` and the `.workflow` access throws a cryptic `TypeError` rather than a `FerryError('state-invariant')`. The `route.ts` implementation handles this more defensively with a switch-default.
   - **Fix (optional for now):** Add a runtime guard:
     ```ts
     export function phaseToWorkflow(phase: keyof RoutingTable): WorkflowFile {
       const route = PHASE_TO_WORKFLOW[phase];
       if (!route) throw new FerryError('state-invariant', { message: `Unknown phase '${String(phase)}'` });
       return route.workflow;
     }
     ```
   - Does not block merge (TypeScript types prevent this at compile time; Ajv blocks it at runtime upstream).

**Recommendation:** Transition review → done permitted once Finding 2 (FR6 skip step in the remaining three workflow YAMLs) is resolved. Findings 1 and 3 are deferred.

---

### 2-2 — Label-Based & @Mention Re-Trigger Dispatch

**Verdict:** changes-requested

**AC coverage:**
- [x] AC1 — `agentLabelToPhase` maps all four `agent:*` labels to phases — `triggers.test.ts::agentLabelToPhase` covers all four labels plus null returns.
- [x] AC2 — `parseAgentMention` returns `{phase, instructions}` — `triggers.test.ts::parseAgentMention` covers all four mention forms, embedded-in-body, case-insensitive, unknown role (null), empty instructions.
- [x] AC3 — `phaseToWorkflow` is source-agnostic — `triggers.test.ts::source-agnostic routing` validates all three source values (`jira-column`, `jira-label`, `jira-mention`) route identically.
- [ ] AC4 — `instructions` truncated to 2000 chars AND **warning logged** — truncation works (`triggers.test.ts::instructions truncation warning` asserts `env.instructions.toHaveLength(2000)`). **NOT covered:** the story requires "a warning is logged … via a captured logger" and the story task says "Envelope-truncation warning surfaced via an injectable logger; default is `console.warn`." `src/lib/envelope/validate.ts:27–29` truncates silently — no `console.warn` or logger call exists. The test sets up `vi.spyOn(console, 'warn')` but **never asserts `warn` was called** (`expect(warn).toHaveBeenCalled()` is missing). The warning emission AC is unimplemented.

**Findings:**

1. **(severity: major)** `src/lib/envelope/validate.ts:27–29` — instructions truncation is silent; no warning is emitted. Story AC4 and story task checklist both require a `console.warn` (or injectable logger) call. The test's `vi.spyOn(console, 'warn')` spy is set up but the assertion is missing.
   - **Fix — validate.ts (lines 27–29):**
     ```ts
     // Inject via optional parameter to keep validate.ts testable without globals.
     export function validateEnvelope(
       raw: unknown,
       warn: (msg: string) => void = console.warn,
     ): EventEnvelopeV1 {
       // ... existing Ajv check ...
       const envelope = raw as EventEnvelopeV1;
       if (envelope.instructions !== undefined && envelope.instructions.length > 2000) {
         warn(`[ferry:envelope] instructions truncated from ${envelope.instructions.length} to 2000 chars`);
         envelope.instructions = envelope.instructions.slice(0, 2000);
       }
       return envelope;
     }
     ```
   - **Fix — triggers.test.ts (after line 106):**
     ```ts
     expect(warn).toHaveBeenCalledOnce();
     expect(warn.mock.calls[0][0]).toMatch(/truncated/);
     ```
   - Blocks merge (AC not satisfied and story task checked off incorrectly).

2. **(severity: nit)** `src/lib/dispatch/triggers.ts:45` — `MENTION_REGEX = /@agent-([a-z]+)\b\s*([^\n\r]*)/i` captures instructions only up to the first newline. A multi-line Jira comment such as `"@agent-developer\nPlease fix auth"` would return empty instructions. This is not tested and the story AC only specifies same-line instructions, but the regex silently drops instruction text on a new line.
   - **Fix (low priority):** Document the single-line constraint in a JSDoc comment, or extend the regex to capture across lines if desired. No AC explicitly requires multiline support.
   - Does not block merge.

**Recommendation:** Blocked until Finding 1 is resolved (warning emission + test assertion in `validate.ts` + `triggers.test.ts`).

---

### 2-3 — Per-Ticket Daily Trigger Cap

**Verdict:** merge-ready

**AC coverage:**
- [x] AC1 — `checkDailyTicketCap` returns `{allowed: false, count, cap, ticketKey}` at cap — `daily-cap.test.ts::"blocks the run at the cap boundary"` tests `count === cap → allowed: false`.
- [x] AC2 — Returns `{allowed: true}` below cap — `daily-cap.test.ts::"allows the run when count is below cap"`.
- [x] AC3 — No IO in tests; `listClaimsToday` is injected — all test cases pass a `() => Promise.resolve([...])` lambda; no network or FS access.
- [x] AC4 — `formatCapPauseComment` returns exact FR7 string — `daily-cap.test.ts::"returns the documented FR7 comment string"` asserts the exact string with `refiner` alias and `Resets at midnight UTC.` suffix. Non-refine phases tested separately.

**Findings:** None.

**Recommendation:** Transition review → done OK.

---

### 2-4 — Phase Labels, Jira Phase Comments & ferry-audit Emission

**Verdict:** merge-ready

**AC coverage:**
- [x] AC1 — `phaseToStatusLabel` returns correct labels for all four phases — `phase-comments.test.ts::phaseToStatusLabel` covers `ferry:refining`, `ferry:developing`, `ferry:reviewing`, `ferry:iterating`.
- [x] AC2 — `formatPhaseStatusComment` starts with `[ferry:<role>:<run_id>]`, includes phase, outcome, `€`-prefixed cost with two decimals, run URL — `phase-comments.test.ts::formatPhaseStatusComment` asserts all fields including cost formatting and negative-cost clamping.
- [x] AC3 — `checkIdempotencyMarker` reports second call as skipped — `phase-comments.dry-run.test.ts::"a re-run with the same run_id leaves the count unchanged"` verifies that three identical calls produce exactly one store entry.
- [x] AC4 — Dry-run E2E: one comment + one audit line after first run; count unchanged after re-run — `phase-comments.dry-run.test.ts` verifies the idempotent path via in-memory store. The "audit line" aspect is delegated to the existing `emitAudit` function (out of scope per Non-Goals); the story scope covers the comment idempotency fixture only. Satisfied within stated scope.

**Findings:**

1. **(severity: nit)** `src/lib/dispatch/phase-comments.ts:25–30` — `PHASE_AGENT` uses `'dev'`, `'review'`, `'iterate'` verbatim as agent names, but `phase-comments.test.ts:20–27` asserts `[ferry:review:r3]` and `[ferry:iterate:r4]`. These differ from the `triggers.ts` convention (`agent:reviewer`, `agent:iterator`) and from the `daily-cap.ts` `formatCapPauseComment` which also uses `input.phase` verbatim for non-refine phases. The inconsistency is internal to the codebase (no operator-visible impact at this stage) but will need alignment when these comment formats are documented for operators. No AC explicitly specifies agent names for `review` and `iterate` beyond `refiner` (the only special case). Noted for future alignment.
   - Does not block merge.

**Recommendation:** Transition review → done OK.

---

## Cross-cutting observations

- **Pure logic**: All four stories deliver modules with no injected IO outside designated entry-point scripts (`skip-task-type-action.ts`). `daily-cap.ts`'s `getConfiguredCap()` accesses `process.env` which is acceptable for a config-reader function.
- **FerryError taxonomy**: `route.ts:17` correctly throws `FerryError('state-invariant')` for unknown phases. All other modules use null-returns for unknown/optional inputs (correct pattern for non-error conditions).
- **Idempotence**: `PHASE_TO_WORKFLOW` is deep-frozen; `phaseStatusMarker` is a pure formatter; `checkIdempotencyMarker` is stable on re-execution.
- **English only**: No non-ASCII characters found in any dispatch source file.
- **No Co-Authored-By**: Not present in Epic 2 commits.
- **KISS**: All four stories use frozen object literals or Maps with no classes. Routing logic is sub-30-line modules throughout.

---

REVIEW COMPLETE — epic-2 — 2 merge-ready, 2 changes-requested, 0 needs-human — report at _bmad-output/code-reviews/epic-2-review.md
