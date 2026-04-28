# Story 3.1: Refiner Reads Ticket & Produces Sub-Task Plan

Status: review

## Story

As a Ferry operator,
I want the Refiner to read a Jira ticket and produce an ordered plan of sub-tasks before creating anything,
So that I can see what Ferry intends to do — and catch hallucinations — before any sub-tasks are written to Jira.

## Background

Story 1-7 shipped the LLM harness config / route selector. Story 3-1 adds the first agent surface: a pure-logic
Refiner core that takes a `RefinerInput` (ticket data + injected LLM call) and returns a validated
`RefinerOutput`. The actual LLM provider call is injected so unit tests fake it; the agent file is a thin shim
that wires the real provider in production.

## Acceptance Criteria

1. **Given** an injected LLM-call returns a parseable JSON plan
   **When** `runRefiner({ ticket, callLlm })` runs
   **Then** the input is sanitised through `delimitUntrusted` before being forwarded to the LLM and the
   returned plan is validated against the `RefinerOutput` schema (NFR-S1).

2. **Given** the LLM returns malformed JSON (truncation, comments, BOM, or invalid shape)
   **When** the Refiner parses it
   **Then** it throws `FerryError("state-invariant", { reason: "refiner-output-invalid" })`.

3. **Given** the validated plan has more than 20 entries in `touch_paths`
   **When** the cap check runs
   **Then** it throws `FerryError("oscillation", { reason: "spec-too-broad" })` — the operator must split the
   ticket. (We reuse the existing `oscillation` error class because the taxonomy explicitly does not have a
   `spec-too-broad` code; the failure mode is "the LLM is asking for too much scope," which is the same
   guardrail intent.)

4. **And** `runRefiner` returns `RefinerResult { plan: RefinerOutput, auditSummary: { subtaskCount, costEur,
   runLink, attachmentNames } }` so the workflow can render the FR9 audit comment without re-parsing.

## Non-Goals

- Do not call any real LLM provider. The provider call is injected.
- Do not write to Jira. Story 3-2 owns that.

## Tasks / Subtasks

- [x] `src/lib/sanitization/delimit-untrusted.ts`: helper that wraps untrusted strings between `<<<UNTRUSTED>>>`
      / `<<<END UNTRUSTED>>>` fences and escapes any literal occurrences of those fences.
- [x] `src/lib/sanitization/delimit-untrusted.test.ts`.
- [x] `src/agents/refiner/schema.ts`: `RefinerOutput` Ajv schema + types.
- [x] `src/agents/refiner/refine.ts`: `runRefiner({ ticket, callLlm, runLink })`.
- [x] `src/agents/refiner/refine.test.ts`: happy path, malformed JSON, over-cap touch paths, sanitisation
      passthrough, audit summary shape.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: the Refiner is a function, not a class.
- The cost in `auditSummary` is taken straight from the injected LLM call's reported usage; if absent, defaults
  to 0 and the audit comment surfaces "cost unknown" downstream.
- The schema accepts `output_locale` `en` | `fr` per Story 3-2's locale handling.
