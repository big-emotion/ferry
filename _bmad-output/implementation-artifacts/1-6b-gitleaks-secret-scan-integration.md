# Story 1.6b: Gitleaks Secret-Scan Integration

Status: review

## Story

As a Ferry agent,
I want every outbound string scanned for secrets via gitleaks before any external write,
so that secret leakage is prevented at the harness level.

## Acceptance Criteria

1. **Given** `src/lib/secret-scan/index.ts` invokes gitleaks with the repository's ruleset (e.g. `.gitleaks.toml`)
   **When** `scanForSecrets(text)` is called with a string containing a credential pattern
   **Then** it returns a non-empty findings array — verified by a unit test using a synthetic secret string and the repo rules.

2. **Given** an agent harness calls the Jira/GitHub IO wrappers
   **When** the outbound payload contains a secret pattern
   **Then** secret scanning aborts the write, applies `ferry:paused` + reason `secret-scan-hit`, and posts a Jira comment without including the leaked content.

3. **Given** CI runs on a PR
   **When** the CI gate executes
   **Then** a gitleaks scan runs as part of the quality gates.

   Status: Done (Option A — pinned GitHub Action + deterministic `.gitleaks.toml` ruleset).

## Architectural decision required (blocker for implementation)

We must decide how the gitleaks binary is provided in CI and in workflows:

- **Option A (CI-only GitHub Action):** Use a pinned gitleaks action in `ferry-ci.yml`.
  - Pros: no binary vendoring, easy.
  - Cons: does not help local invocation from TypeScript harness unless we also add a different mechanism.

- **Option B (vendored binary in repo):** Commit gitleaks binary under a versioned path.
  - Pros: TypeScript wrapper can invoke deterministically.
  - Cons: larger repo, multi-platform concerns.

- **Option C (system install in workflow):** `apt-get` / `brew` style install.
  - Pros: simple.
  - Cons: violates reproducibility/pinning requirements.

Recommendation: **Option A for CI gate** plus **a separate follow-up story** to decide harness-level runtime invocation.

Follow-up: `1-6c-gitleaks-harness-runtime-scanning` (deferred). Architectural decision remains open between **Option B (vendored binary)** vs **Option D (pinned-download + checksums)**.

## Tasks / Subtasks

- [ ] Defer harness runtime scanning to `1-6c-gitleaks-harness-runtime-scanning` (AC #1 and #2).
- [x] Add `.gitleaks.toml` that deterministically extends upstream defaults.
- [x] Add CI gate integration for gitleaks (pinned GitHub Action; blocks merges).
- [x] Add unit test that asserts `.gitleaks.toml` exists and is valid TOML.
- [ ] Implement `src/lib/secret-scan/index.ts` with deterministic gitleaks invocation (deferred to 1-6c).
- [ ] Wire secret scan into IO wrappers/harness before any write (deferred to 1-6c).
- [ ] Add unit tests for scanForSecrets and a negative control case (deferred to 1-6c).

## Dev Notes

- Must not leak secrets in logs or comments.
- Unit tests must be hermetic; if invoking gitleaks in tests, use a controlled fixture and ensure process execution is stable.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6]
