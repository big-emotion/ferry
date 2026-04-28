# Story 2.4: Phase Labels, Jira Phase Comments & ferry-audit Emission

Status: review

## Story

As a Ferry operator,
I want each workflow run to update the ticket's phase label, post a Jira status comment, and emit an audit line,
So that I can see exactly what Ferry is doing on any ticket at a glance — in Jira and in the `ferry-audit` issue.

## Background

`emitAudit()` already exists (Story 1-5). What's missing is:
- The `phase → ferry:<state>` label mapping (FR44).
- A formatter for the idempotent per-phase Jira comment (FR42), reusing the existing `[ferry:<role>:<run_id>]`
  marker convention so a re-run edits in place.
- An end-to-end fixture test asserting that, given an audit emit + a phase comment formatter, exactly one
  comment and one audit line are produced for the ticket.

## Acceptance Criteria

1. **Given** a workflow starts
   **When** `phaseToStatusLabel(phase)` runs
   **Then** it returns `ferry:refining` / `ferry:developing` / `ferry:reviewing` / `ferry:iterating` for the
   four phases — verified by unit tests (FR44).

2. **Given** a workflow completes
   **When** `formatPhaseStatusComment({ phase, runId, outcome, costEur, runUrl })` is called
   **Then** the returned string starts with `[ferry:<role>:<run_id>]`, includes the phase name, the outcome,
   the cost in EUR (always two decimals, prefixed with `€`), and the run URL — verified by unit test (FR42).

3. **Given** the same `(phase, runId)` is processed twice
   **When** the idempotency marker is consulted via `checkIdempotencyMarker`
   **Then** the second call is reported skipped, so the workflow performs an in-place edit instead of creating
   a duplicate comment (already covered for the dedupe issue; this story validates the same path for the
   per-ticket Jira comment).

4. **And** a dry-run E2E test asserts the full sequence: starting with an empty comment list, after one run
   we have exactly one phase comment and one audit line; after a re-run with the same `run_id` the count is
   unchanged (idempotent).

## Non-Goals

- Do not modify the existing `emitAudit` implementation.
- Do not actually call GitHub or Jira IO — the dry-run E2E uses in-memory list/edit fakes.

## Tasks / Subtasks

- [x] `src/lib/dispatch/phase-comments.ts`: `phaseToStatusLabel`, `formatPhaseStatusComment`,
      `phaseStatusMarker`.
- [x] `src/lib/dispatch/phase-comments.test.ts`: unit tests for label mapping + comment formatting.
- [x] `src/lib/dispatch/phase-comments.dry-run.test.ts`: idempotent dry-run with an in-memory comment store.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: the marker is `[ferry:<role>:<run_id>]`, identical to existing audit / dedupe markers — keeps muscle
  memory consistent across the codebase.
- Cost is always rendered with two decimals because operators eyeball the comments — readability over
  precision.
