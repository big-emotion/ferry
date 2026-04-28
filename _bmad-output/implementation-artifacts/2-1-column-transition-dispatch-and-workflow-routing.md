# Story 2-1 — Column-Transition Dispatch & Workflow Routing

## Status
- **Story**: 2-1-column-transition-dispatch-and-workflow-routing
- **Epic**: Epic 2 — Event Routing — Ticket Ingestion & Dispatch
- **Status**: ready-for-dev

## Context
Ferry is triggered via `repository_dispatch` events emitted by Jira Automation when a ticket moves to a configured Ferry column (e.g., “Refinement”).

This story adds:
- A pure routing/contract helper for phase→workflow and Task-type skip semantics.
- Support for `issue_type` in the event envelope schema to enable Task skipping.
- A workflow step (before `run-agent`) that skips Task tickets by posting a Jira comment via the existing scaffold (`src/lib/io/jira.ts`) and exits 0.

## User Story
As a Ferry operator,
I want moving a Jira ticket to a Ferry column to automatically trigger the correct GitHub Actions workflow on the target repo,
So that Ferry starts working the moment I drag a ticket on the board — no manual intervention needed.

## Acceptance Criteria
1) **Phase routes to workflow (contract test)**
- Given a Jira Automation rule sends `repository_dispatch` payload `{ phase: "refine", ticket_key: "CHAN-27", ... }` with type `ferry-refine`
- When the dispatch is received by the target repo
- Then `refine.yml` triggers (and only `refine.yml`) — satisfied by per-workflow `repository_dispatch` types; additionally enforced via unit tests for the static mapping.

2) **Unknown phase is rejected**
- Given `validateEnvelope(payload)` enforces allowed phases
- When an unknown `phase` value is dispatched
- Then it is rejected before any side-effect runs.

3) **Task type is skipped**
- Given a ticket of type `Task` (not `Story`) triggers a dispatch
- When the workflow starts
- Then it posts a Jira comment `[ferry:refiner:<run_id>] Skipped — ticket type Task is not processed by Ferry` and exits 0 without creating sub-tasks or writing state (FR6)

4) **Dry-run E2E fixture coverage**
- And all four phase-to-workflow mappings are covered by a unit/fixture test.

## Open Questions
- None.
