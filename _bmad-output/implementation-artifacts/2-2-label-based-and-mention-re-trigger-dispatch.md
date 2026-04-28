# Story 2.2: Label-Based & @Mention Re-Trigger Dispatch

Status: review

## Story

As a Ferry operator,
I want to re-trigger any Ferry phase by adding a label or posting a comment on a Jira ticket,
So that I can restart a specific phase with or without extra instructions — without moving the ticket column.

## Background

Story 1-3 already validates `instructions` in the envelope and truncates to 2000 chars. Story 2-1 introduced
the phase routing table. 2-2 wires the `agent:<role>` label and `@agent-<role>` mention conventions onto the
existing routing — exposing helpers the Jira Automation rule (and tests) can rely on.

## Acceptance Criteria

1. **Given** the label `agent:refiner` / `agent:developer` / `agent:reviewer` / `agent:iterator` is applied to a
   Jira ticket
   **When** `agentLabelToPhase(label)` runs
   **Then** it returns the matching phase (`refine` / `dev` / `review` / `iterate`) — verified by unit tests for
   all four labels (FR2).

2. **Given** a Jira comment `@agent-developer please focus only on the auth module`
   **When** `parseAgentMention(commentBody)` runs
   **Then** it returns `{ phase: 'dev', instructions: 'please focus only on the auth module' }` — extracted from
   anywhere in the comment, case-insensitive on the role token, instructions trimmed (FR3).

3. **Given** an envelope arrives with `source: "jira-label"` or `"jira-mention"` instead of `"jira-column"`
   **When** the routing module is consulted
   **Then** `phaseToWorkflow(phase)` returns the same workflow file — routing is source-agnostic.

4. **Given** an `instructions` string longer than 2000 chars is posted
   **When** `validateEnvelope` runs
   **Then** the field is truncated to 2000 chars and a warning is logged (not rejected) — verified by an envelope
   regression test (already partially covered; this story adds the warning-emission assertion via a captured logger).

## Non-Goals

- Do not implement the daily trigger cap (Story 2-3).
- Do not implement Jira automation rules — those live outside the repo.

## Tasks / Subtasks

- [x] `src/lib/dispatch/triggers.ts` exposing `agentLabelToPhase`, `parseAgentMention`, and the canonical
      label / mention constants.
- [x] `src/lib/dispatch/triggers.test.ts` covering all four labels, the four mention forms, malformed input,
      and source-agnostic routing.
- [x] Envelope-truncation warning surfaced via an injectable logger; default is `console.warn`.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: a regex parses `@agent-<role>` followed by whitespace and arbitrary text.
- The label and mention constants are exported so external rule generators (out of scope for this story) can
  share them.
