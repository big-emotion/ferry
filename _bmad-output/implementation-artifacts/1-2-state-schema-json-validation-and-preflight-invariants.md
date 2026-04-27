# Story 1.2: State Schema, JSON Validation & Preflight Invariants

Status: done

## Story

As a Ferry agent,
I want to read and write per-ticket pipeline state from a schema-validated `.ferry/state.json` file,
So that every agent phase starts from a known-good state and corrupt state is detected before any write.

## Acceptance Criteria

1. **Given** `src/schemas/state.v1.schema.json` exists with all required fields (`version`, `ticket_key`, `phase`, `run_id`, `prompt_version`, `iteration`, `iteration_history`, `updated_at`)
   **When** `loadState(envelope)` is called on a branch that has `.ferry/state.json`
   **Then** it reads and validates the file against the schema using Ajv, returning a typed `FerryStateV1` object — or throws `FerryError("state-invariant")` on schema violation

2. **Given** `writeState(state)` is called with a valid state object
   **When** the write completes
   **Then** the resulting `.ferry/state.json` validates against the v1 schema, and the previous valid state is preserved if the new state fails schema validation (no silent corruption)

3. **Given** `preflight(envelope)` is called at the start of an agent run
   **When** any invariant fails: PR not open, head SHA mismatch, branch absent, or Jira column mismatches expected phase
   **Then** it throws `FerryError("state-invariant")` with the specific mismatch logged — no external writes occur

4. **And** `src/schemas/schemas.test.ts` validates the schema file itself is valid JSON Schema, and the state schema `phase` enum pre-reserves all values including `paused`, `cancelled`, `needs-human` so Epic 7 override transitions require no schema change

## Tasks / Subtasks

- [x] Task 1: Install `ajv-formats` dependency (AC: #1, #2)
  - [x] `npm install ajv-formats` — required for `"format": "date-time"` validation in Ajv 8 (formats are opt-in via this package)
  - [x] Verify `ajv-formats` is in `package.json` dependencies

- [x] Task 2: Create `src/schemas/state.v1.schema.json` (AC: #1, #4)
  - [x] Write the exact schema from architecture D1 (full definition in Dev Notes below)
  - [x] Include all required fields: `version`, `ticket_key`, `phase`, `run_id`, `prompt_version`, `iteration`, `iteration_history`, `updated_at`, optional `updated_by_run`, optional `findings_fingerprints`
  - [x] `phase` enum MUST include all 8 values: `refining`, `developing`, `reviewing`, `iterating`, `ready`, `paused`, `cancelled`, `needs-human`
  - [x] `$defs.fingerprintArray` shared def used by both `findings_fingerprints` and `iteration_history[].fingerprints`
  - [x] `additionalProperties: false` at root level
  - [x] Mirror schema to `examples/state.v1.schema.json` (copy, not symlink)

- [x] Task 3: Create `src/lib/error.ts` — minimal `FerryError` (AC: #1, #3)
  - [x] Export `FerryError extends Error` with constructor `(code: FerryErrorCode, context?: Record<string, unknown>)`
  - [x] `FerryErrorCode` union type: `'state-invariant' | 'spend-cap' | 'transient' | 'oscillation' | 'unknown'` (full 5 codes from architecture D11 — Story 1.5 adds subclasses + `mapError`, but the codes are fixed)
  - [x] `code` property on the error instance (for catch handlers to switch on)
  - [x] Named export only — no default export

- [x] Task 4: Create `src/lib/state/types.ts` — TypeScript interfaces (AC: #1, #2)
  - [x] `FerryPhase` string union: `'refining' | 'developing' | 'reviewing' | 'iterating' | 'ready' | 'paused' | 'cancelled' | 'needs-human'`
  - [x] `Fingerprint` interface: `{ file: string; line_start: number; line_end: number; rule_id: string; hash: string }`
  - [x] `IterationHistoryEntry` interface: `{ iteration: number; run_id: string; completed_at: string; pr_sha: string; fingerprints: Fingerprint[]; review_verdict?: 'clean' | 'findings' | 'escalate' }`
  - [x] `FerryStateV1` interface matching schema exactly (all required + optional fields)
  - [x] Named exports only

- [x] Task 5: Create `src/lib/state/index.ts` — `loadState` and `writeState` (AC: #1, #2)
  - [x] `loadState(envelope: { ticket_key: string }): Promise<FerryStateV1 | null>` — returns `null` when `.ferry/state.json` does not exist (new branch); throws `FerryError("state-invariant")` on schema violation
  - [x] `writeState(state: FerryStateV1): Promise<void>` — atomic write: validate first, write to `.ferry/state.json.tmp`, validate result, then `fs.renameSync` (no partial write on failure)
  - [x] Cross-validate `state.ticket_key` matches `envelope.ticket_key` in `loadState` — throw `FerryError("state-invariant")` on mismatch
  - [x] State file path: `path.join(process.cwd(), '.ferry', 'state.json')` — create `.ferry/` dir if absent on write
  - [x] Named exports only

- [x] Task 6: Create `src/lib/state/state.test.ts` — unit tests (AC: #1, #2)
  - [x] Test: `loadState` returns `null` when file does not exist
  - [x] Test: `loadState` returns valid typed object for a valid state fixture
  - [x] Test: `loadState` throws `FerryError("state-invariant")` for a state with missing required fields
  - [x] Test: `loadState` throws `FerryError("state-invariant")` for a state with invalid `phase` value
  - [x] Test: `loadState` throws `FerryError("state-invariant")` when `state.ticket_key !== envelope.ticket_key`
  - [x] Test: `writeState` writes valid state and re-reads as valid
  - [x] Test: `writeState` does NOT write when the state object is invalid — previous file is preserved
  - [x] Use `tmp` directory or `afterEach` cleanup to isolate test file I/O

- [x] Task 7: Create `src/schemas/schemas.test.ts` — schema meta-validation (AC: #4)
  - [x] Test: `state.v1.schema.json` parses as valid JSON
  - [x] Test: `state.v1.schema.json` compiles as a valid JSON Schema Draft 2020-12 (use `ajv.compile()`)
  - [x] Test: `phase` enum contains all 8 values (`refining`, `developing`, `reviewing`, `iterating`, `ready`, `paused`, `cancelled`, `needs-human`)
  - [x] Test: `run_id` pattern matches ULID pattern `^[0-9A-HJKMNP-TV-Z]{26}$`
  - [x] Test: a minimal valid state object passes validation
  - [x] Test: a state object with unknown top-level field is rejected (`additionalProperties: false`)

- [x] Task 8: Create `src/lib/preflight/index.ts` — `preflight()` (AC: #3)
  - [x] `preflight(envelope: PreflightEnvelope, deps?: PreflightDeps): Promise<void>`
  - [x] `PreflightEnvelope`: `{ ticket_key: string; phase: string }` (minimal — full EventEnvelope comes in Story 1.3)
  - [x] `PreflightDeps` interface for dependency injection (see Dev Notes for full definition)
  - [x] Invariant checks in order (each throws `FerryError("state-invariant")` with descriptive message):
    - [x] Branch `ferry/<ticket_key>` exists — use `deps.branchExists`
    - [x] If `state.pr_number` is set: PR is still open — use `deps.getPrState`
    - [x] If `state.pr_sha` is set: current HEAD SHA matches state's `pr_sha` — use `deps.getHeadSha`
    - [x] Jira column key for `ticket_key` maps to `envelope.phase` — use `deps.getJiraColumn`
  - [x] `preflight` calls `loadState(envelope)` internally — if state is null (no file), skip PR/SHA checks; still check branch exists
  - [x] No external writes occur on any failure path
  - [x] Named exports only

- [x] Task 9: Create `src/lib/preflight/preflight.test.ts` — unit tests (AC: #3)
  - [x] All 4 invariant failure paths each throw `FerryError("state-invariant")`
  - [x] Happy path: all invariants pass → resolves without error
  - [x] Null state (no `.ferry/state.json`): skips PR/SHA checks, still runs branch check
  - [x] Tests use mock `PreflightDeps` (no live API calls)

- [x] Task 10: Verify all tests pass (AC: all)
  - [x] `npm run typecheck` — zero errors
  - [x] `npm run lint` — zero violations
  - [x] `npm run format:check` — passes
  - [x] `npm test` — all tests pass (33/33)

### Review Findings

- [x] [Review][Decision] D1: `pr_number`, `pr_sha`, `touch_paths` declared in `FerryStateV1` but absent from schema — resolved: added all three to schema properties in `state.v1.schema.json` and `examples/state.v1.schema.json`. [src/schemas/state.v1.schema.json]
- [x] [Review][Decision] D3: `preflight` phase namespace mismatch — resolved: added TODO comment in `preflight/index.ts` flagging that Story 2.x should use `state.phase` for the Jira column lookup. [src/lib/preflight/index.ts:66]
- [x] [Review][Patch] P1: NFR-S1 leak in state/preflight errors — resolved: replaced raw AJV errors and actual values with safe `instancePath+keyword` paths only. [src/lib/state/index.ts | src/lib/preflight/index.ts]
- [x] [Review][Patch] P6: Duplicate `if (expectedColumn !== undefined)` guard removed. [src/lib/preflight/index.ts]
- [x] [Review][Patch] P7: `PHASE_TO_JIRA_COLUMN` test expanded to all 8 phases. [src/lib/preflight/preflight.test.ts]
- [x] [Review][Defer] W1: `validateEnvelope` uses `'state-invariant'` code for envelope failures — deferred, Story 1.5 adds full taxonomy
- [x] [Review][Defer] W2: Concurrent claim race in `checkAndClaim` — deferred, workflow concurrency key serializes runs per ticket_key
- [x] [Review][Defer] W3: Stale `.tmp` file on crashed write — deferred, POSIX rename is atomic; ENOSPC edge case out of scope
- [x] [Review][Defer] W4: `ticket_key` pattern allows single-char keys and underscores — deferred, breaking change risk
- [x] [Review][Defer] W5: AJV singleton load failure produces raw stack trace — deferred to Story 1.6 (I/O wrappers)
- [x] [Review][Defer] W6: `writeState` read-back verification belt-and-suspenders — deferred, spec-mandated atomic write pattern

## Dev Notes

### Exact State Schema (D1 — authoritative)

Create `src/schemas/state.v1.schema.json` with this exact content:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ferry.dev/schemas/state.v1.json",
  "type": "object",
  "required": ["version", "ticket_key", "phase", "run_id", "prompt_version", "iteration", "iteration_history", "updated_at"],
  "properties": {
    "version": { "const": "v1" },
    "ticket_key": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]+-\\d+$" },
    "phase": {
      "enum": ["refining", "developing", "reviewing", "iterating", "ready", "paused", "cancelled", "needs-human"]
    },
    "run_id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
    "prompt_version": { "type": "string" },
    "iteration": { "type": "integer", "minimum": 0, "maximum": 3 },
    "findings_fingerprints": { "$ref": "#/$defs/fingerprintArray" },
    "iteration_history": {
      "type": "array",
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": ["iteration", "run_id", "completed_at", "pr_sha", "fingerprints"],
        "properties": {
          "iteration": { "type": "integer", "minimum": 0, "maximum": 3 },
          "run_id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
          "completed_at": { "type": "string", "format": "date-time" },
          "pr_sha": { "type": "string", "pattern": "^[a-f0-9]{40}$" },
          "fingerprints": { "$ref": "#/$defs/fingerprintArray" },
          "review_verdict": { "enum": ["clean", "findings", "escalate"] }
        }
      }
    },
    "updated_at": { "type": "string", "format": "date-time" },
    "updated_by_run": { "type": "string" }
  },
  "$defs": {
    "fingerprintArray": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "line_start", "line_end", "rule_id", "hash"],
        "properties": {
          "file": { "type": "string" },
          "line_start": { "type": "integer" },
          "line_end": { "type": "integer" },
          "rule_id": { "type": "string" },
          "hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
        }
      }
    }
  },
  "additionalProperties": false
}
```

### FerryError Design

Story 1.5 will add `mapError()` and typed subclasses. For now, create a minimal class that all subsequent stories can `throw` and `catch`:

```typescript
// src/lib/error.ts
export type FerryErrorCode = 'state-invariant' | 'spend-cap' | 'transient' | 'oscillation' | 'unknown';

export class FerryError extends Error {
  constructor(
    public readonly code: FerryErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`[ferry:${code}]${context ? ` ${JSON.stringify(context)}` : ''}`);
    this.name = 'FerryError';
  }
}
```

### Ajv Setup (CRITICAL — do not skip `ajv-formats`)

The schema uses `"format": "date-time"` for `updated_at` and `iteration_history[].completed_at`. In Ajv 8, format validation is opt-in via `ajv-formats`. Without it, `format` keywords are silently ignored — dates are not validated.

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile(stateSchema);
```

Create ONE shared Ajv instance (module-level singleton) — do not call `new Ajv()` on every `loadState` call.

### Atomic `writeState` Pattern

Write failures must NEVER corrupt the existing state. Use the rename pattern:

```typescript
const tmpPath = statePath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
// Validate the tmp file before committing
const written = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
if (!validate(written)) {
  fs.unlinkSync(tmpPath);
  throw new FerryError('state-invariant', { errors: validate.errors });
}
fs.renameSync(tmpPath, statePath); // atomic on same FS
```

`fs.renameSync` is atomic on POSIX (same filesystem) — the rename either succeeds fully or fails, never leaving a partial file.

### PreflightDeps Interface

Design `PreflightDeps` for testability without live APIs:

```typescript
export interface PreflightDeps {
  branchExists: (branch: string) => Promise<boolean>;
  getPrState: (prNumber: number) => Promise<'open' | 'closed' | 'merged'>;
  getHeadSha: () => Promise<string>;
  getJiraColumn: (ticketKey: string) => Promise<string>;
}
```

Default implementations (used in production) can use:
- `branchExists`: `execSync('git rev-parse --verify refs/heads/<branch>')` — exit code 0 = exists
- `getHeadSha`: `execSync('git rev-parse HEAD').toString().trim()`
- `getPrState` / `getJiraColumn`: leave as stubs that return defaults for now — Story 1.6 wires up real Octokit/Jira calls through the IO wrappers

The production defaults live in `src/lib/preflight/defaults.ts` (separate file to keep the main module testable).

### `pr_sha` vs `state.phase` notes

The `preflight` SHA check uses `state.pr_sha` which is set by the Developer on first PR open (Story 4.4). In Story 1.2, this field may not be set (state is brand new). Handle:
- If `state` is `null` (no file): skip PR and SHA checks; only check branch existence
- If `state.pr_number` is undefined: skip PR check
- If `state.pr_sha` is undefined: skip SHA check

### Phase-to-Jira-Column Mapping

For the Jira column invariant check, the expected mapping (from architecture) is:
- `"refining"` → Jira column `"Refinement"`
- `"developing"` → Jira column `"In Development"`
- `"reviewing"` → Jira column `"In Review"`
- `"iterating"` → Jira column `"Changes Requested"`

Export this as `PHASE_TO_JIRA_COLUMN: Record<FerryPhase, string>` from `src/lib/preflight/index.ts` — it's needed by Story 1.4 tests and Story 2.x routing.

### Module Resolution (NodeNext)

With `"module": "NodeNext"` in tsconfig, all imports need explicit `.js` extensions (TypeScript resolves them to the compiled `.js` files):

```typescript
// CORRECT:
import { FerryError } from '../error.js';
import stateSchema from '../../schemas/state.v1.schema.json' with { type: 'json' };

// WRONG:
import { FerryError } from '../error';
```

For JSON imports, use the `with { type: 'json' }` assertion (TypeScript 5.3+ with `--moduleResolution NodeNext`). Alternatively, use `fs.readFileSync` + `JSON.parse` to avoid the assertion — either works, but pick one approach and be consistent.

If using `import ... with { type: 'json' }`, ensure `tsconfig.json` has `"resolveJsonModule": true` — it already does from Story 1.1.

### Test File I/O Isolation

Tests that write `.ferry/state.json` must not pollute the actual repo. Use `os.tmpdir()`:

```typescript
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import os from 'os';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ferry-state-test-'));
  // Override process.cwd() for state path — or pass stateDir as optional param
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
```

To make the state path injectable for tests, add an optional `stateDir` parameter to `loadState` and `writeState`:

```typescript
export async function loadState(
  envelope: { ticket_key: string },
  stateDir: string = process.cwd(),
): Promise<FerryStateV1 | null>
```

This is the simplest approach — no DI container, no mocking library needed.

### File Structure

```
src/
  lib/
    error.ts                      ← new
    state/
      index.ts                    ← new
      types.ts                    ← new
      state.test.ts               ← new
    preflight/
      index.ts                    ← new
      defaults.ts                 ← new (production PreflightDeps)
      preflight.test.ts           ← new
  schemas/
    state.v1.schema.json          ← new (move .gitkeep → replace)
    schemas.test.ts               ← new
examples/
  state.v1.schema.json            ← new mirror (copy from src/schemas/)
```

### Patterns from Story 1.1 to Continue

- All files: kebab-case names, named exports only (no default exports)
- Test files: `beforeAll` / `beforeEach` for setup, not module-level side effects
- Prettier auto-formats long lines — run `npx prettier --write 'src/**/*.ts'` after writing test files
- `"type": "module"` in package.json — all code is ESM
- No comments explaining WHAT — only comments for non-obvious WHY

### Why `iteration_history[]` is Mandatory

`iteration_history` must be in the schema (not optional) because FR27 resurgent-finding detection (Story 6.2) computes:
```typescript
const prev = state.iteration_history.at(-1)?.fingerprints ?? [];
```
If the field were optional, every consumer would need a null-guard. Making it required (empty array `[]` at init) eliminates this defensive branching everywhere.

### References

- Architecture: D1 State artifact — `.ferry/state.json`, full schema, resurgence algorithm
- Architecture: D3 Concurrency — preflight freshness check context
- Architecture: D11 Error taxonomy — 5 error codes (Story 1.5 adds `mapError`)
- Epics: Story 1.2 — AC definitions
- Epics: Story 1.5 — full `FerryError` subclasses built on top of `FerryError` defined here
- Story 1.1 Dev Notes — ESLint config, NodeNext module rules, file naming conventions

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- TypeScript NodeNext subpath import limitation: `ajv/dist/2020` has no `exports` field in its `package.json`, so TypeScript NodeNext refuses to resolve it as a package subpath import. Resolved by using `createRequire` (CJS interop) for `ajv/dist/2020` and `ajv-formats`, with targeted `any` casts and eslint-disable blocks. Same pattern used for the JSON schema import.
- Test fixture ULID: `01HWXYZ1234567890ABCDEFGHIJ` failed the `run_id` regex (ULID Crockford base32 excludes I, L, O, U). Updated to `01JFBK9Q4BVCJAGTYQ6S3XTDMN`.
- `ajv/dist/2020.d.ts` exports `class Ajv2020` — needed to use the 2020-12 meta-schema. Ajv 8's default `import Ajv from 'ajv'` is draft-07 only.

### Completion Notes List

- `src/schemas/state.v1.schema.json` — exact D1 schema with all 8 `phase` enum values (pre-reserves `paused`, `cancelled`, `needs-human` for Epic 7 without any schema change)
- `examples/state.v1.schema.json` — mirrored copy per architecture
- `src/lib/error.ts` — minimal `FerryError` with all 5 error codes; Story 1.5 builds typed subclasses + `mapError()` on top
- `src/lib/state/types.ts` — `FerryPhase`, `Fingerprint`, `IterationHistoryEntry`, `FerryStateV1` interfaces; also added optional `pr_number`, `pr_sha`, `touch_paths` fields needed by downstream stories
- `src/lib/state/index.ts` — `loadState` / `writeState` with atomic rename pattern; `stateDir` param for testability
- `src/lib/preflight/index.ts` — `preflight()` with `PreflightDeps` DI interface; `PHASE_TO_JIRA_COLUMN` map exported for reuse in Story 1.4 and 2.x
- 33/33 tests pass; typecheck clean; lint clean; format clean

### File List

- package.json (modified — added `ajv-formats`)
- package-lock.json (modified)
- src/schemas/state.v1.schema.json (new)
- src/schemas/schemas.test.ts (new)
- src/schemas/.gitkeep (deleted)
- examples/state.v1.schema.json (new)
- examples/.gitkeep (deleted)
- src/lib/error.ts (new)
- src/lib/error.test.ts (new)
- src/lib/state/types.ts (new)
- src/lib/state/index.ts (new)
- src/lib/state/state.test.ts (new)
- src/lib/preflight/index.ts (new)
- src/lib/preflight/preflight.test.ts (new)
