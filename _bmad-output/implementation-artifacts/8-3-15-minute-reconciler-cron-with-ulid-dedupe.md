# 8-3 15-Minute Reconciler Cron With ULID Dedupe

Status: review

## Implementation

`src/reconciler/reconcile.ts` exports `reconcileTickets` — given a snapshot
of Ferry-managed tickets it dispatches `repository_dispatch` envelopes with
`source: "reconciler"` and a fresh ULID for each ticket whose Jira column
disagrees with `state.phase`, or whose state file is missing AND
`last_audit_minutes_ago >= 20` (FR50). Tickets in agreement are skipped so
no duplicate runs are issued (FR51). The decision is pure; the actual
dispatch happens in `reconciler.yml`.

## Tests

`src/reconciler/reconcile.test.ts` covers mismatch, match, no-state-stale,
no-state-fresh, and total-count summary.
