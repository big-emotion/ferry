# Epic 1 — Code Review (Story 1-6c)

Reviewer: bmad-code-review (subagent)
Date: 2026-04-28
Stories reviewed: 1

## Summary

| Story | Verdict | Findings |
|-------|---------|----------|
| 1-6c  | merge-ready | 2 (nit) |

---

## Per-story findings

### 1-6c — Gitleaks Harness Runtime Scanning

**Verdict:** merge-ready

---

**AC coverage:**

- [x] AC1 — `ensureGitleaksBinary()` downloads, verifies SHA256, extracts, makes executable, returns path — covered by `binary.test.ts::"downloads, verifies checksum, extracts, and caches"` and `"uses pinned constants when called with no overrides"`.
- [x] AC2 — Cache hit returns cached path without re-downloading — covered by `binary.test.ts::"returns the cached path without invoking fetch when binary exists"`.
- [x] AC3 — SHA256 mismatch → binary NOT extracted, partial download removed, `FerryError` `unknown` thrown — covered by `binary.test.ts::"throws FerryError unknown on checksum mismatch and removes partial cache"`. The archive is held in-memory only and never written to disk, so there is no disk-level partial file to remove; the test confirms `binPath` is absent post-failure, which satisfies the spirit of the AC.
- [x] AC4 — `scanWithGitleaks({ path })` spawns with `--source=<path> --report-format=json --no-banner`, captures stdout, parses findings, returns `{ findings, leaksFound }` — covered by `scan.test.ts::"passes --source, --report-format=json, --no-banner to gitleaks"` and `"returns leaksFound=false and empty findings on exit code 0 (clean)"`. Implementation also adds the required `detect` subcommand and `--report-path=/dev/stdout` (needed so gitleaks emits JSON to stdout); both are verified in tests.
- [x] AC5 — Exit codes 0 and 1 handled as success; `leaksFound` reflects code 1 — covered by `scan.test.ts::"returns leaksFound=false…"` (exit 0) and `"returns leaksFound=true with parsed findings on exit code 1"`.
- [x] AC6 — Any other non-zero exit code throws `FerryError` with stderr captured in context — covered by `scan.test.ts::"throws FerryError unknown on exit code 2"`. Implementation records `stderrLength` instead of the raw stderr content (intentional security hardening: avoids leaking secret text into error logs). The Dev Notes explicitly endorse this approach ("never the body (could contain leaked content)"), so this is spec-aligned at the intent level even though the AC wording says "stderr captured".

---

**Findings:**

1. (severity: nit) `scan.ts:86-92` — AC6 says "stderr captured in context"; implementation stores `stderrLength` only (not the raw stderr). This is a deliberate, security-motivated deviation documented in both the code comment and Dev Notes. No fix required; the rationale should be noted in the PR description for traceability. **fix:** document in PR body or inline comment (already present) — no code change needed.

2. (severity: nit) `binary.ts:30` — `ferryCacheDir()` reads `process.env.FERRY_CACHE_DIR` directly. Per ferry-grade pure-logic rule, IO/env access should ideally be at the module entry point. Here `ferryCacheDir()` is itself the designated entry point for that config (per Dev Notes: "Override via `FERRY_CACHE_DIR` for tests"), and the tests use it correctly via `beforeEach`/`afterEach`. Acceptable pattern; flagged for awareness only. **fix:** none required.

---

**TDD check:** Tests precede or match implementation structure. Binary tests cover: cache-hit fast path, download happy path, pinned-constant verification, checksum mismatch, network/fetch failure, non-2xx HTTP, and no-payload-in-error-context. Scan tests cover: clean exit (code 0), leaks-found exit (code 1), error exit (code 2), JSON parse error, arg forwarding (`--source`, `--report-format`, `--no-banner`, `--config`), empty stdout, and no-leaked-content-in-error. All 19 tests pass (`vitest run`).

**Pure logic:** Helpers `verifyChecksum`, `gitleaksReleaseUrl`, `gitleaksBinaryPath`, `ferryCacheDir` are IO-free (or use only `node:` builtins as documented entry points). Spawn and fetch are injectable via `opts` for full testability.

**FerryError taxonomy:** `unknown` used for checksum mismatch, tar extraction failure, unexpected exit code, and JSON parse error; `transient` used for network errors and non-2xx HTTP. Both codes are in the approved taxonomy. `name` is `'FerryError'` as required.

**Idempotence:** `ensureGitleaksBinary` is idempotent — cache-hit path returns immediately without side effects; repeated calls after first download are pure reads.

**English only:** All comments and identifiers are English. No Co-Authored-By lines.

**Gates:** typecheck (`tsc --noEmit`) ✅, lint (`eslint src`) ✅, format:check (`prettier --check`) ✅, test (`vitest run`) ✅ — 19/19 tests pass.

**Recommendation:** Transition review → done OK. No blocking issues.
