# Story 4.1: Developer Reads Ticket & Builds File Context

Status: review

## Story

As a Ferry Developer agent,
I want to read the refined Jira ticket and load only the files the Refiner authorized me to touch,
So that my prompt is grounded in the actual codebase and I cannot modify files outside the authorized scope.

## Acceptance Criteria

1. **Given** an injected `readFile` callback and a list of paths
   **When** `buildContext({ ticket, touchPaths, readFile, maxBytes })` runs
   **Then** each file is wrapped in `<file path="...">…</file>` blocks (NFR-S1) and the ticket text is wrapped
   in `delimitUntrusted` fences.

2. **Given** the total bytes across files exceed `maxBytes` (default 200 KB)
   **When** `buildContext` runs
   **Then** it throws `FerryError("state-invariant", { reason: "context-too-large" })`.

3. **Given** `touchPaths` is empty or undefined
   **When** `buildContext` runs
   **Then** it throws `FerryError("state-invariant", { reason: "missing-touch-paths" })` so the workflow can
   apply `status:stale` per spec.

4. **And** `MAX_TOUCH_PATHS = 20` and `MAX_CONTEXT_BYTES = 200_000` constants are exported.

## Tasks / Subtasks

- [x] `src/agents/developer/context.ts`: `buildContext`, constants.
- [x] `src/agents/developer/context.test.ts`: happy path, oversize bytes, missing/empty touchPaths,
      delimiter shape.
- [x] All four CI gates pass locally.

## Dev Notes

- The injected `readFile(path) → Promise<string>` keeps unit tests free of disk IO.
- Files larger than the per-file limit (40 KB by default) are passed through verbatim; the cumulative limit is
  the actual guard.
