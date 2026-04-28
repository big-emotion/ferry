# Story 1.6c: Gitleaks Harness Runtime Scanning

Status: backlog

## Story

As a Ferry agent harness,
I want every outbound string scanned for secrets via gitleaks before any external write,
so that secret leakage is prevented at runtime (not only in CI).

## Background

Story `1-6b-gitleaks-secret-scan-integration` shipped only the **CI gate** (pinned gitleaks GitHub Action) plus a minimal deterministic `.gitleaks.toml` that extends upstream defaults.

This story exists to implement the **harness-level runtime scanning** acceptance criteria that were deferred from 1-6b.

## Acceptance Criteria

1. **Given** `src/lib/secret-scan/index.ts` invokes gitleaks with the repository's ruleset (e.g. `.gitleaks.toml`)
   **When** `scanForSecrets(text)` is called with a string containing a credential pattern
   **Then** it returns a non-empty findings array — verified by a unit test using a synthetic secret string and the repo rules.

2. **Given** an agent harness calls the Jira/GitHub IO wrappers
   **When** the outbound payload contains a secret pattern
   **Then** secret scanning aborts the write, applies `ferry:paused` + reason `secret-scan-hit`, and posts a Jira comment without including the leaked content.

## Architectural decision required (blocker)

We must decide how the gitleaks binary is provided **for runtime invocation from TypeScript**.

Two viable options remain (non-reversible choice):

- **Option B (vendored binary in repo):** Commit gitleaks binaries under a versioned path (per platform).
  - Pros: fully deterministic; no network at runtime; easiest to make tests hermetic.
  - Cons: larger repo; multi-platform distribution/updates.

- **Option D (pinned-download + checksums):** Download the gitleaks release artifact at runtime or at CI setup time, verify SHA256, then invoke.
  - Pros: keeps repo small; still deterministic when pinned to version + checksums.
  - Cons: requires network; more code and error handling; tests must mock download or use fixtures.

Until one is chosen, we cannot implement `scanForSecrets()` deterministically in the harness.

## Tasks / Subtasks

- [ ] Choose runtime delivery mechanism (Option B vs Option D) and document the decision in this story.
- [ ] Implement `src/lib/secret-scan/index.ts` runtime invocation.
- [ ] Add unit tests for positive detection and negative controls.
- [ ] Wire secret scanning into outbound Jira/GitHub IO wrappers (pre-write guard).
- [ ] Ensure no leaked content is logged or posted in comments.

## Dev Notes

- Avoid including any detected secret text in logs, comments, or thrown errors.
- Keep tests stable: prefer fixtures + deterministic invocation over timing-based assertions.
