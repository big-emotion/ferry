# Story 1.6: Secret Scanning, CODEOWNERS Path-Filter & IO Wrappers

Status: review

<!-- Note: This story is intentionally split (Path D) to defer gitleaks delivery decisions. See 1-6b. -->

## Story

As a Ferry agent,
I want all Jira/GitHub writes routed through shared IO wrappers with idempotency and retry,
so that external writes are safe to re-run and transient failures are handled consistently.

## Acceptance Criteria

1. **Given** `src/codeowners.test.ts` exists
   **When** CI runs
   **Then** it passes and asserts the `.github/CODEOWNERS` file protects:
   - `.github/**`
   - `src/schemas/**`
   - `prompt.*.md`
   - And every rule line has at least one `@owner`.

2. **Given** `src/lib/io/idempotency.ts` exposes `checkIdempotencyMarker(marker, items)` and `appendMarker(payload, marker)`
   **When** an external write is attempted with marker `[ferry:<role>:<run_id>]` already present in recent items
   **Then** the write is skipped and the function returns `{ skipped: true }`.

3. **Given** `src/lib/io/retry.ts` wraps any IO function with exponential backoff
   **When** the wrapped function throws a `transient` error up to 3 times
   **Then** it retries with base 2s delay, ±50% jitter, factor 2 — and escalates to `FerryError("unknown")` after 3 failures.

4. **And** ESLint rule `no-restricted-imports` fails CI if `@octokit/rest` or Jira fetch is imported directly anywhere in `src/agents/`.

5. **And** `src/lib/io/jira.ts` and `src/lib/io/github.ts` exist as thin wrappers that:
   - are the only allowed import surface for agents to talk to Jira/GitHub,
   - call through `retry()` for transient failures,
   - use `checkIdempotencyMarker()` to skip duplicate comment writes.

> Deferred from this story (split to 1-6b): gitleaks-based secret scanning implementation and wiring enforcement into IO wrappers/harness.

## Tasks / Subtasks

- [x] Ensure CODEOWNERS coverage tests pass (AC: 1)
  - [x] Review `.github/CODEOWNERS` and update tests only if necessary

- [x] Implement idempotency helpers (AC: 2)
  - [x] Add `src/lib/io/idempotency.ts`
  - [x] Add unit tests for marker detection + append behavior

- [x] Implement retry helper (AC: 3)
  - [x] Add `src/lib/io/retry.ts`
  - [x] Add unit tests covering: retries 3x for transient, jitter bounds, escalates to FerryError("unknown")

- [x] Add agent import guardrails (AC: 4)
  - [x] Update ESLint config with `no-restricted-imports` for `src/agents/**`
  - [x] Add a minimal lint test fixture (or equivalent) proving restricted imports are blocked

- [x] Scaffold IO wrappers (AC: 5)
  - [x] Add `src/lib/io/jira.ts` (thin wrapper; no live API calls in tests)
  - [x] Add `src/lib/io/github.ts` (thin wrapper; no live API calls in tests)

- [x] Split deferred gitleaks work into 1-6b story spec (non-code task)
  - [x] Create `_bmad-output/implementation-artifacts/1-6b-gitleaks-secret-scan-integration.md`
  - [x] Update `sprint-status.yaml` to add 1-6b backlog
  - [x] (Done by split) Ensure this story spec points to 1-6b for gitleaks work

## Dev Notes

### Constraints / guardrails

- No new non-npm binary dependencies are allowed in this story.
- Tests must be hermetic (no live Jira/GitHub calls).
- Prefer small pure functions; keep wrappers thin.

### Existing patterns to reuse

- Error taxonomy and `FerryError` live under `src/lib/error.ts` and `src/lib/error-taxonomy/*` (see story 1-5).
- Unit tests use `vitest` with `describe/it/expect`.

### Implementation notes (intended behavior)

- **Idempotency marker format:** the literal marker string is provided by callers (e.g. `[ferry:refiner:<run_id>]`).
  - `checkIdempotencyMarker(marker, items)` should:
    - return `{ skipped: true }` if any string in `items` includes `marker`.
    - otherwise return `{ skipped: false }`.
  - `appendMarker(payload, marker)` should append `\n\n${marker}` if not already present.
- **Retry:** only retry when thrown error is a `FerryError` with `code === 'transient'`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6]
- [Source: src/codeowners.test.ts]
- [Source: src/lib/error.ts]
- [Source: src/lib/error-taxonomy/index.ts]

## Dev Agent Record

### Agent Model Used

cron-subagent

### Debug Log References

### Completion Notes List

- Implemented IO idempotency and retry helpers with unit tests.
- Added thin Jira/GitHub IO wrapper modules for agents to import (no live API calls yet).
- Hardened agent import boundaries with ESLint `no-restricted-imports` and a guardrail test.
- Split gitleaks/secret-scan integration into Story 1-6b.

### File List
- eslint.config.js
- tsconfig.json
- src/lib/io/idempotency.ts
- src/lib/io/idempotency.test.ts
- src/lib/io/retry.ts
- src/lib/io/retry.test.ts
- src/lib/io/jira.ts
- src/lib/io/github.ts
- src/agents/restricted-imports.test.ts
- src/agents/__lint-fixtures__/restricted-imports.ts
- _bmad-output/implementation-artifacts/1-6b-gitleaks-secret-scan-integration.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
