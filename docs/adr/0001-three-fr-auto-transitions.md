# 0001 — Three FR Auto-Transitions (FR18, FR24, FR28)

**Status:** Accepted  
**Date:** 2024-01-01

## Context

Ferry orchestrates a Jira-driven development pipeline across four agents: Refiner, Developer, Reviewer, and Iterator. Each agent's work corresponds to a Jira column transition (e.g., "In Progress" → "In Review"). The question was: which transitions should happen automatically, and which should require a human action?

The risk of over-automating Jira transitions is that stakeholders lose visibility into ticket state — columns no longer reflect real project status because the tool is churning through them without human awareness. Conversely, requiring manual transitions for every agent handoff would negate much of Ferry's automation value.

The Jira transition IDs are consumer-configurable via environment variables (`FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`), so the set of auto-transitions needed to be a deliberate, documented invariant rather than an incidental implementation detail.

## Decision

Exactly three column transitions are automated. They are identified by Ferry Requirement numbers:

- **FR18** — Developer → In Review: After the Developer agent successfully creates a PR, it transitions the Jira ticket from its in-progress column to the review column. Implementation: `tracker.postTransition(ticketKey, reviewTransitionId)` in `src/agents/developer/dev-action.ts`.

- **FR24** — Reviewer → Changes Requested (or Ready): After the Reviewer agent completes its review loop, it transitions the ticket based on verdict. If changes are required (`review.approved === false`), it moves the ticket to the iterator column. If approved, it does not auto-transition (see FR below). Implementation: `tracker.postTransition(ticketKey, iterTransitionId)` in `src/agents/reviewer/review-action.ts`.

- **FR28** — Iterator → In Review: After the Iterator agent pushes fixes, it transitions the ticket back to the review column so another Reviewer pass can begin. Implementation: `src/agents/iterator/transition.ts`, called from `src/agents/iterator/iterate-action.ts`.

All other transitions — including moving a ticket to "Done" after a merge, approving a ticket for merge, or advancing past a planning column — require human action.

## Consequences

**Positive:**

- The automated handoffs (Dev→Review, Changes→Iterator, Iterator→Review) form a closed loop that covers the mechanical parts of a development cycle without human intervention.
- Stakeholders retain control over the decisions that carry business risk: initiating work, approving merges, and closing tickets.
- The explicit FR numbering makes it easy to search the codebase and documentation for the exact points where automation fires.

**Negative:**

- Consumers must configure two environment variables (`FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`) for transitions to work. A misconfiguration silently skips the transition rather than failing loudly.
- The Reviewer's approval path does not auto-transition the ticket to an "Approved" or "Ready to Merge" column, so consumers who want full automation must build that step themselves (e.g., a webhook that fires on the `ferry:approved` label).

## Alternatives Considered

**Auto-transition on every agent completion** — rejected because it removes human checkpoints at business-significant moments (planning sign-off, merge approval) and makes it impossible for teams with regulated release processes to use Ferry without custom overrides.

**No auto-transitions at all (fully manual)** — rejected because the Developer→Review and Iterator→Review handoffs are purely mechanical: if the agent succeeded, the ticket must move. Requiring humans to do this is friction with no upside.

**Auto-merge on Reviewer approval** — rejected; see ADR 0005.
