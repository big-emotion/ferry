# Story 3.3: Idempotent Re-Run & Empty-Ticket Escalation

Status: review

## Story

As a Ferry operator,
I want re-triggering the Refiner to be safe on a ticket that already has sub-tasks, and unactionable tickets
to escalate clearly.

## Acceptance Criteria

1. **Given** a ticket already has sub-tasks with `[ferry:refiner-subtask:<plan_id>:<index>]` markers
   **When** `filterExistingSubtasks(prepared, existingSubtasks)` runs
   **Then** sub-tasks whose marker is already present are dropped from the batch (FR12) — verified by unit
   test.

2. **Given** a ticket has empty / unactionable description
   **When** `classifyEmptyTicket(ticket)` runs
   **Then** it returns `{ unactionable: true, reason }` for: empty description, fewer than 5 words, or
   description matching the no-op heuristic regex — and the formatter emits the FR11 comment
   `[ferry:refiner:<run_id>] Cannot plan — ticket description is empty or unactionable. Please add
   requirements and re-trigger.`

3. **And** `formatRefinerReadyComment` returns the FR success summary string the workflow posts after a
   successful refine, applying `ferry:ready` (the workflow side; out of scope here) — covered in tests by
   asserting the comment shape.

4. **And** an idempotency dry-run E2E asserts: running the batch twice over the same plan_id with the same
   pre-existing sub-tasks list produces zero net new sub-tasks the second time.

## Tasks / Subtasks

- [x] `src/agents/refiner/idempotency.ts`: `extractSubtaskMarker`, `filterExistingSubtasks`.
- [x] `src/agents/refiner/empty.ts`: `classifyEmptyTicket`, `formatEmptyTicketComment`,
      `formatRefinerReadyComment`.
- [x] `src/agents/refiner/idempotency.test.ts`, `src/agents/refiner/empty.test.ts`,
      `src/agents/refiner/refine.dry-run.test.ts`.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: marker is a literal substring scan — sub-task descriptions are short and the marker is unique.
- The "unactionable" heuristic is intentionally conservative; we'd rather process a borderline ticket than
  silently drop work.
