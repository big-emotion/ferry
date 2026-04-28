# Story 2.3: Per-Ticket Daily Trigger Cap

Status: review

## Story

As a Ferry operator,
I want Ferry to refuse processing a ticket that has already been triggered too many times today,
So that a misconfigured Jira Automation rule or a runaway reconciler cannot exhaust my API budget on a single ticket.

## Background

Story 1-3 stores every dispatch claim as a comment on the `ferry-processed-events` issue with prefix
`[ferry:dedupe] <event_id> <ticket_key> <run_id>`. Counting the comments for one ticket since UTC midnight is
the cheapest signal for "trigger volume" — no extra storage required.

## Acceptance Criteria

1. **Given** a ticket has been dispatched ≥ 10 times today (cap configurable; default 10)
   **When** a new dispatch arrives
   **Then** `checkDailyTicketCap(...)` returns `{ allowed: false, count, cap, ticketKey }` and the agent posts
   `[ferry:<role>:<run_id>] Paused — daily trigger cap (10) reached for CHAN-27. Resets at midnight UTC.` and
   exits 0 without starting agent work (FR7).

2. **Given** the cap is not yet reached
   **When** `checkDailyTicketCap(...)` is called
   **Then** it returns `{ allowed: true, count, cap, ticketKey }` and the run proceeds.

3. **Given** the cap-check helper depends on a comment-listing function
   **When** unit tests call it
   **Then** they inject a fake `listClaimsToday` that returns a deterministic count — no network or filesystem
   IO in tests.

4. **And** the helper exposes `formatCapPauseComment({ phase, runId, ticketKey, cap })` which returns the
   exact FR7 comment string — verified by unit test.

## Non-Goals

- Do not add a UI for adjusting the cap mid-flight; the cap is sourced from `FERRY_DAILY_TICKET_CAP` env var,
  defaulting to 10. A future config-yaml story can override this.
- Do not gate this check before envelope validation — it must run AFTER envelope validation + dedupe so we
  never double-count an already-processed event.

## Tasks / Subtasks

- [x] `src/lib/dispatch/daily-cap.ts` with `checkDailyTicketCap`, `formatCapPauseComment`, and
      `getConfiguredCap`.
- [x] `src/lib/dispatch/daily-cap.test.ts` covering allowed / blocked / boundary / formatting / config.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: counter is `count >= cap` → `allowed: false`. Boundary tested explicitly.
- The `listClaimsToday` callback returns `Date[]` so the helper can drop entries before today's midnight UTC —
  the caller (the GitHub IO wrapper) is responsible for fetching comments and filtering by ticket prefix.
- The configured cap is read once via `getConfiguredCap()` so runtime tweaks require redeploying the workflow.
