# Story 4.2: Branch Creation, Code Generation & Scope-Enforced Diff Application

Status: review

## Story

As a Ferry Developer agent,
I want to generate a unified diff and apply it only to authorized file paths,
So that the code change is scoped exactly to what the Refiner planned and cannot touch `.github/**` or
other out-of-scope paths.

## Acceptance Criteria

1. **Given** a unified-diff string and an `allowedPaths` set
   **When** `parseDiffPaths(diff)` runs
   **Then** it returns the deduped list of files the diff touches.

2. **Given** the diff touches a path not in `allowedPaths ∪ {".ferry/state.json"}`
   **When** `enforceScope(diff, allowedPaths)` runs
   **Then** it throws `FerryError("state-invariant", { reason: "scope-violation" })`.

3. **Given** the diff touches any path under `.github/**`
   **When** `enforceScope` runs
   **Then** it is rejected regardless of `allowedPaths` (defense-in-depth on top of CODEOWNERS).

4. **Given** a ticket key, run id, and summary
   **When** `formatDeveloperCommit({ ticketKey, runId, summary })` runs
   **Then** it returns `"[CHAN-27] feat: add login\n\n[ferry:developer:01HXYZ]"` — verified by unit test (FR15).

5. **Given** a `branch-name` is requested
   **When** `formatBranchName(ticketKey)` runs
   **Then** it returns `ferry/CHAN-27`.

## Tasks / Subtasks

- [x] `src/agents/developer/diff.ts`: `parseDiffPaths`, `enforceScope`, `STATE_FILE_PATH`,
      `BLOCKED_PATH_PREFIXES`.
- [x] `src/agents/developer/commit.ts`: `formatDeveloperCommit`, `formatBranchName`.
- [x] `src/agents/developer/diff.test.ts`, `src/agents/developer/commit.test.ts`.
- [x] All four CI gates pass locally.

## Dev Notes

- KISS: parse `diff --git a/<path> b/<path>` headers via regex. We do not (and need not) replicate `git
  apply` — that runs in the workflow shell. Our job is to refuse to even attempt invalid scope.
- The `.github/**` blocklist is a hard prefix check, applied before the allow-list, so an over-broad Refiner
  plan cannot accidentally authorise workflow edits.
