# Story 1.6c: Gitleaks Harness Runtime Scanning

Status: review

## Story

As a Ferry harness,
I want to invoke gitleaks programmatically at runtime to scan a path or commit range,
so that the Developer/Iterator agents can verify their draft PRs are leak-free before pushing.

## Background

Story 1-6 shipped repository hygiene (CODEOWNERS, IO wrappers, ESLint guardrails). Story 1-6b shipped the **CI gate** (gitleaks runs on every push/PR). What's still missing is **harness-runtime scanning**: programmatic invocation from inside the harness (e.g., agent code) to catch leaks before the CI gate even sees them.

This story was previously parked pending an architectural decision on **how the harness obtains the gitleaks binary at runtime**. The decision is **pinned download with checksum verification**, mirroring the approach used in 1-6b's CI step:
- Pin to `gitleaks v8.30.1`
- SHA256: `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (linux x64)
- Download lazily on first use, cache under `~/.ferry/bin/gitleaks`, reuse afterwards
- No vendored binary in the repo (avoids LFS/bloat); no extra dependency on a system-installed gitleaks

## Acceptance Criteria

1. **Given** the Ferry cache directory does not yet contain the gitleaks binary
   **When** `ensureGitleaksBinary()` is called
   **Then** it downloads `gitleaks_8.30.1_linux_x64.tar.gz` from the pinned GitHub release URL,
   verifies SHA256 matches the pinned value, extracts the `gitleaks` binary into the cache, makes it executable,
   and returns the absolute path — verified by unit tests with mocked HTTP fetch + filesystem.

2. **Given** the cached binary already exists
   **When** `ensureGitleaksBinary()` is called
   **Then** it returns the cached path without re-downloading — verified by unit tests.

3. **Given** the downloaded archive's SHA256 does not match the pinned value
   **When** verification runs
   **Then** the binary is NOT extracted, the partial download is removed, and a `FerryError` with code `unknown` (or `transient` if the failure pattern fits) is thrown — verified by unit tests.

4. **Given** the harness has a path to a directory and the gitleaks binary
   **When** `scanWithGitleaks({ path })` is called
   **Then** it spawns gitleaks with `--source=<path> --report-format=json --no-banner`,
   captures stdout, parses findings into a typed array, and returns `{ findings, leaksFound }` — verified by unit tests with a mocked spawn.

5. **Given** gitleaks exits with code 1 (leaks found) or code 0 (clean)
   **When** result is computed
   **Then** both cases are handled as success (no throw) and `leaksFound` reflects exit code 1 — verified by unit tests.

6. **Given** gitleaks exits with any other non-zero code (e.g., 2 = error)
   **When** result is computed
   **Then** a `FerryError` is thrown with the stderr captured in `context` — verified by unit tests.

## Non-Goals

- Do not auto-call the harness from the Developer agent in this story (that's a future wiring story).
- Do not support Windows or macOS in this story; linux-x64 only (CI runs Linux; matches 1-6b).
- Do not vendor any binaries.

## Tasks / Subtasks

- [x] Add `src/lib/secret-scan/binary.ts` with `ensureGitleaksBinary()` (downloads + verifies + caches).
- [x] Add `src/lib/secret-scan/binary.test.ts` covering: missing-cache download, cached return, checksum mismatch, network error.
- [x] Add `src/lib/secret-scan/scan.ts` with `scanWithGitleaks({ path, configPath? })` (spawns + parses).
- [x] Add `src/lib/secret-scan/scan.test.ts` covering: clean exit, leaks-found exit, error exit, JSON parse.
- [x] Wire constants (version, SHA, download URL, cache dir) at the top of `binary.ts` for easy bumps.
- [x] All gates pass: typecheck, lint, format:check, test.

## Dev Notes

- **Cache location:** `path.join(os.homedir(), '.ferry', 'bin', 'gitleaks')`. Override via `FERRY_CACHE_DIR` env for testing.
- **Download URL:** `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz`.
- **Use only `node:` builtins:** `node:fs/promises`, `node:crypto`, `node:os`, `node:path`, `node:child_process`, `node:zlib`, `node:stream`. No new npm deps.
- **Use the existing IO wrapper for spawn** (if one exists in `src/lib/io/`); otherwise spawn directly via `child_process.spawn` and wrap output reading in promises.
- **Tar handling:** the archive contains a single `gitleaks` binary at the top level. Either use a small JS tar reader or shell out to `tar` (which is universal on Linux runners) — prefer shelling out to keep the JS surface small.
- **Errors:** reuse `FerryError` from `src/lib/error.ts` with code `unknown` for checksum mismatch / parse error / non-0/1 exit; `transient` for network errors (so retry logic can apply).
- **Mock surface for tests:**
  - `dependencies` parameter or DI: `{ fetch?: typeof fetch, spawn?: typeof spawn, fs?: typeof fs }`.
  - Or split into pure helpers (e.g., `verifyChecksum(buf, expected)`) and test those directly.
- **TDD:** write the binary tests first (cache-hit fast path, then download, then checksum-mismatch). Run red. Then implement.

## Files Created / Modified

**Modified:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 1-6c → done

**Created:**
- `src/lib/secret-scan/binary.ts`
- `src/lib/secret-scan/binary.test.ts`
- `src/lib/secret-scan/scan.ts`
- `src/lib/secret-scan/scan.test.ts`

## References

- `.github/workflows/ferry-ci.yml` — CI gate from 1-6b, same gitleaks version and SHA
- `.gitleaks.toml` — minimal config (`useDefault = true`), reused at runtime
- `src/lib/error.ts` — `FerryError` class
- `src/lib/io/` — existing IO wrapper patterns
- `_bmad-output/planning-artifacts/epics.md` — Epic 1 spec (story 1.6c was added at sprint planning)
