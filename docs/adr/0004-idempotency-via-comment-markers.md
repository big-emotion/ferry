# 0004 — Idempotency via Comment Markers

**Status:** Accepted  
**Date:** 2024-01-01

## Context

Ferry agents are triggered by `repository_dispatch` events that GitHub may deliver more than once (network retries, manual re-runs, duplicate webhook deliveries). Each agent performs external writes: posting Jira comments, opening PRs, creating GitHub issue comments. Without a deduplication mechanism, a re-triggered agent would create duplicate PRs, post duplicate comments, or double-transition Jira tickets.

A database or distributed lock would require infrastructure that Ferry explicitly avoids — Ferry is a zero-infrastructure system that runs entirely within GitHub Actions. All state must live in systems that are already present: GitHub (PRs, issues, comments) and Jira (tickets, comments).

## Decision

Every agent posts a short opaque marker string — an **idempotency marker** — into the Jira ticket comment or GitHub PR comment that records its output. Before performing any work, the agent fetches existing comments and checks for its marker. If found, it exits immediately without re-executing.

### Marker format

```
[ferry:<role>:<discriminator>]
```

- `<role>` — the agent name: `refiner`, `dev`, `reviewer`, `iterator`
- `<discriminator>` — a value that uniquely identifies the specific invocation

Three discriminator strategies exist, implemented in `src/lib/agent-runtime/idempotency.ts`:

| Strategy              | Format                      | Used by                                              |
| --------------------- | --------------------------- | ---------------------------------------------------- |
| Event ID              | `[ferry:dev:abc123-def456]` | Developer, Iterator (first attempt)                  |
| PR head SHA (7 chars) | `[ferry:reviewer:abc1234]`  | Reviewer                                             |
| Review comment ID     | `[ferry:iterator:5678]`     | Iterator (when processing a specific review comment) |

The PR head SHA strategy is intentional: each new push from the Iterator agent advances the SHA, so the Reviewer always runs fresh on the new commit rather than being skipped as a duplicate of the previous review.

### Check and append

`src/lib/io/idempotency.ts` provides two pure functions:

- `checkIdempotencyMarker(marker, existingComments)` — returns `{ skipped: true }` if any comment contains the marker string, otherwise `{ skipped: false }`.
- `appendMarker(payload, marker)` — appends `\n\n<marker>` to a comment body before posting, ensuring the marker is present in the stored record.

The marker is embedded in the comment body (not a separate field) so it survives in any system that stores free-text comments (Jira Cloud, Jira Server, GitHub).

### Refiner subtask fingerprinting

The Refiner agent uses an extended variant: `[ferry:refiner-subtask:<planId>:<index>]` (`src/agents/refiner/idempotency.ts`). Each subtask in the plan gets its own marker so that a partial re-run can skip already-created subtasks and only create the missing ones.

## Consequences

**Positive:**

- Zero additional infrastructure — the storage layer is the same Jira and GitHub APIs the agents already use.
- Markers are visible to humans: a developer reading a Jira ticket or PR comment can see exactly which agent run produced the comment and whether re-runs were skipped.
- The string-include check (`item.includes(marker)`) is robust to comment reformatting by Jira or GitHub (wrapping, trailing whitespace, etc.) as long as the marker string itself is not truncated.

**Negative:**

- If a Jira or GitHub API call fails _after_ the marker is posted but _before_ all side effects complete, the agent will skip on re-run even though work is partially done. This is a known limitation; agents are designed to post the marker only as part of the final comment that records the completed output.
- Idempotency is per-agent-per-event, not per-side-effect. If an agent creates two PRs due to a bug before posting its marker, re-running will not create a third PR but will also not clean up the first duplicate.
- The marker format (`[ferry:role:discriminator]`) must not change between versions without a migration strategy, because old markers in existing Jira/GitHub comments would not be recognized by updated agents.

## Alternatives Considered

**External database (DynamoDB, Redis, Postgres)** — rejected because it introduces infrastructure that consumers must provision, pay for, and operate. Ferry's design goal is zero consumer infrastructure beyond GitHub Actions and Jira.

**GitHub Actions `outputs` or step caching** — rejected because these are scoped to a single workflow run; they do not survive across re-runs or duplicate event deliveries.

**Unique run IDs from GitHub (`github.run_id`)** — evaluated but insufficient alone. Run IDs are unique per run, so a re-run of the _same_ workflow would have a _different_ run ID and would not be recognized as a duplicate. Event IDs are the right discriminator because they identify the triggering event, not the workflow execution.

**Jira transition status as deduplication signal** — rejected because agents cannot rely on ticket column state as a proxy for "work done." A ticket may have been manually moved back, or a transition may have failed after the agent completed its work.
