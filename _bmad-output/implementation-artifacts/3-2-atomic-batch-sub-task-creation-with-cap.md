# Story 3.2: Atomic Batch Sub-Task Creation with Cap

Status: review

## Story

As a Ferry operator,
I want sub-tasks created as a single atomic batch capped at 12,
So that either all sub-tasks appear or none do — no partial states.

## Acceptance Criteria

1. **Given** a plan has ≤ 12 sub-tasks
   **When** `prepareBatch(plan)` runs
   **Then** all sub-tasks pass through unchanged, each with an idempotency footer
   `[ferry:refiner-subtask:<plan_id>:<index>]` (FR10).

2. **Given** a plan has > 12 sub-tasks
   **When** `prepareBatch(plan)` runs
   **Then** the result is truncated to the first 12 (LLM priority order) and `truncated` is `true` with
   `originalCount` recorded — verified by unit test.

3. **Given** an injected `createBatch` callback rejects
   **When** `applyBatch(...)` runs
   **Then** no sub-task is reported created, the failure is wrapped in a `FerryError("transient")`, and the
   caller may retry — verified by unit test.

4. **Given** `output_locale` is `fr`
   **When** `detectLocale(parentTicketText)` runs against French stopwords
   **Then** it returns `'fr'`; `'en'` otherwise — verified across multiple fixtures (D9).

## Non-Goals

- Do not call Jira REST. The batch creator is injected.
- Do not implement re-run idempotency by scanning Jira for existing markers — Story 3-3 owns that.

## Tasks / Subtasks

- [x] `src/agents/refiner/batch.ts`: `prepareBatch`, `applyBatch`, `SUBTASK_CAP`.
- [x] `src/agents/refiner/locale.ts`: `detectLocale`.
- [x] `src/agents/refiner/batch.test.ts`, `src/agents/refiner/locale.test.ts`.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: French detection uses a small set of high-frequency stopwords (`le`, `la`, `les`, `de`, `et`, `est`,
  `pour`, `avec`, etc.). Misses are acceptable because the operator already passes `output_locale` from the
  Refiner; this helper is a defensive cross-check, not the source of truth.
