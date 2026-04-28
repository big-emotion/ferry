# Story 4.4: Draft PR Open & Auto-Transition to In Review

Status: review

## Story

As a Ferry operator,
I want a draft PR opened automatically once code is committed, with the ticket linked in the PR body,
So that the PR appears in GitHub and the ticket advances to `In Review` without me lifting a finger.

## Acceptance Criteria

1. **Given** a ticket key, summary, and Jira base URL
   **When** `formatPullRequestTitle({ ticketKey, summary })` runs
   **Then** it returns `"[CHAN-27] <summary>"` (FR16).

2. **Given** a ticket key, Jira base URL, run id, and TLDR string
   **When** `formatPullRequestBody({ ticketKey, jiraBaseUrl, runId, tldr })` runs
   **Then** the body contains a clickable Jira ticket URL, the run id, and the TLDR — verified by unit test.

3. **Given** an existing state object and a PR number
   **When** `transitionToReview({ state, prNumber })` runs
   **Then** the returned state has `phase = "reviewing"` and `pr_number = <prNumber>` (FR16, FR18).

4. **And** the helper exports `DRAFT_PR_OPTS = { draft: true }` so the wrapper can pass it directly to
   the GitHub create-PR call.

## Tasks / Subtasks

- [x] `src/agents/developer/pr.ts`: `formatPullRequestTitle`, `formatPullRequestBody`,
      `transitionToReview`, `DRAFT_PR_OPTS`.
- [x] `src/agents/developer/pr.test.ts`: covers all four helpers.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: state mutation returns a new object (immutable). The caller is responsible for serialising and
  validating against the schema (via existing 1-2 helpers).
