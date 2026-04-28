# Story 1.3: Event Envelope Schema, ULID Generation & Deduplication

Status: done

## Story

As a Ferry workflow,
I want every inbound `repository_dispatch` event validated against a versioned schema and deduplicated before any agent code runs,
So that malformed payloads are rejected early and duplicate dispatches never trigger duplicate runs.

## Acceptance Criteria

1. **Given** `.github/actions/ferry-envelope-validate/action.yml` is the composite action called as the first step in the `gate-envelope` job in every dispatch workflow
   **When** a `repository_dispatch` arrives with a payload that fails Ajv validation against `event.v1.schema.json` (missing required fields, invalid `ticket_key` pattern, unknown `phase`)
   **Then** the workflow exits non-zero before any side-effect job runs — **no payload content is logged** (security requirement NFR-S1)

2. **Given** a valid envelope with a fresh `event_id` (ULID)
   **When** `checkAndClaim(event_id, ticketKey, opts)` is called in `src/lib/envelope/dedupe.ts`
   **Then** it posts a claiming comment `[ferry:dedupe] <event_id> <ticket_key> <run_id>` to the `ferry-processed-events` GitHub Issue and returns `{ alreadyProcessed: false }`

3. **Given** the same `event_id` is dispatched a second time within 24 hours
   **When** `checkAndClaim(event_id, ticketKey, opts)` is called
   **Then** it finds the existing comment and returns `{ alreadyProcessed: true }` — no run starts, no writes occur (FR5)

4. **Given** `src/lib/ulid/index.ts` exposes `generateULID(prng?: () => number)`
   **When** called in tests with a fixed `prng`
   **Then** it returns the same deterministic ULID on every call with the same seed, and generated ULIDs match `^[0-9A-HJKMNP-TV-Z]{26}$`

## Tasks / Subtasks

- [x] Task 1: Create `src/schemas/event.v1.schema.json` (AC: #1)
  - [x] Write the D2-authoritative schema (full definition in Dev Notes)
  - [x] Required fields: `version`, `event_id`, `ticket_key`, `phase`, `source`, `ts`
  - [x] Optional field: `instructions` (string, maxLength 2000)
  - [x] `additionalProperties: false` at root level
  - [x] Mirror to `examples/event.v1.schema.json`
  - [x] Add event schema tests to `src/schemas/schemas.test.ts` (same pattern as state schema tests)

- [x] Task 2: Create ULID generator (AC: #4)
  - [x] Write FAILING tests in `src/lib/ulid/ulid.test.ts`
  - [x] Implement `src/lib/ulid/index.ts` — `generateULID(prng?: () => number): string`
  - [x] Use the installed `ulid` package — `import { monotonicFactory } from 'ulid'`
  - [x] Seeded path: `monotonicFactory(prng)()` for deterministic output
  - [x] Unseeded path: `monotonicFactory()()` for real generation
  - [x] Named export only

- [x] Task 3: Create `src/lib/envelope/types.ts` — TypeScript types (AC: #1, #2)
  - [x] `EventPhase` type: `'refine' | 'dev' | 'review' | 'iterate' | 'reconcile'`
  - [x] `EventSource` type: `'jira-column' | 'jira-label' | 'jira-mention' | 'reconciler'`
  - [x] `EventEnvelopeV1` interface matching schema exactly
  - [x] Named exports only

- [x] Task 4: Create `src/lib/envelope/validate.ts` + tests (AC: #1)
  - [x] Write FAILING tests in `src/lib/envelope/validate.test.ts`
  - [x] Implement `validateEnvelope(raw: unknown): EventEnvelopeV1` — throws `FerryError("state-invariant")` on validation failure
  - [x] Use same `createRequire` + `Ajv2020` pattern as Story 1.2 (`src/lib/state/index.ts`)
  - [x] **CRITICAL**: on validation failure, do NOT include `raw` or its fields in the error message or context — log only the schema error paths, never the actual values (NFR-S1)
  - [x] `instructions` field: if present, trim to 2000 chars and return on the validated envelope
  - [x] Named export only

- [x] Task 5: Create composite action + validate-action entry point (AC: #1)
  - [x] Create `.github/actions/ferry-envelope-validate/action.yml` — composite action
    - [x] Input: `payload` (JSON string of `github.event.client_payload`)
    - [x] Steps: `npm ci --prefer-offline` → run `validate-action.ts` via `npx tsx`
  - [x] Create `src/lib/envelope/validate-action.ts` — entry point script
    - [x] Reads `FERRY_ENVELOPE_PAYLOAD` env var (set by action)
    - [x] Calls `validateEnvelope(JSON.parse(payload))`
    - [x] On success: exits 0, writes validated fields to `GITHUB_OUTPUT` (ticket_key, phase, event_id)
    - [x] On failure: logs sanitized error (schema paths only, no payload values), exits 1

- [x] Task 6: Update 4 dispatch workflows to wire real envelope validation (AC: #1)
  - [x] In each of `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`:
    - [x] Replace `Placeholder — envelope validation` step with `actions/setup-node` + `npm ci` + composite action call
    - [x] Gate-envelope step calls `uses: ./.github/actions/ferry-envelope-validate`
    - [x] Pass `payload: ${{ toJson(github.event.client_payload) }}`

- [x] Task 7: Create `src/lib/envelope/dedupe.ts` + tests (AC: #2, #3)
  - [x] Write FAILING tests in `src/lib/envelope/dedupe.test.ts` using mocked Octokit
  - [x] Implement `checkAndClaim(eventId, ticketKey, opts: DedupeOpts): Promise<{ alreadyProcessed: boolean }>`
  - [x] `DedupeOpts`: `{ octokit: Octokit; owner: string; repo: string; issueNumber: number; runId: string }`
  - [x] Claim check: paginate `issues.listComments` (max 100 per page), search for `[ferry:dedupe] <eventId>`
  - [x] If found: return `{ alreadyProcessed: true }` immediately
  - [x] If not found: post comment `[ferry:dedupe] <eventId> <ticketKey> <runId>`, return `{ alreadyProcessed: false }`
  - [x] Import `Octokit` from `@octokit/rest` (allowed in `src/lib/**` — not `src/agents/**`)

- [x] Task 8: Verify all tests pass (AC: all)
  - [x] `npm run typecheck` — zero errors
  - [x] `npm run lint` — zero violations
  - [x] `npm run format:check` — passes
  - [x] `npm test` — all tests pass (new + all previous)

### Review Findings

- [x] [Review][Decision] D2: `instructions` trimming — resolved: removed `maxLength` from schema, added `.slice(0, 2000)` in `validateEnvelope` after validation; test added for oversized input. [src/schemas/event.v1.schema.json | src/lib/envelope/validate.ts]
- [x] [Review][Patch] P2: `generateULID` monotonicity — resolved: module-level `_generate` factory for unseeded calls; new factory per seeded call (tests). [src/lib/ulid/index.ts]
- [x] [Review][Patch] P3: Max-pages guard added (`MAX_PAGES = 10`) to `checkAndClaim`. [src/lib/envelope/dedupe.ts]
- [x] [Review][Patch] P4: Batched `appendFileSync` calls into single write. [src/lib/envelope/validate-action.ts]
- [x] [Review][Patch] P5: `ulid.test.ts` determinism test now pins timestamp with `vi.useFakeTimers()` and asserts `a === b`. [src/lib/ulid/ulid.test.ts]
- [x] [Review][Patch] P8: NFR-S1 test now uses `expect.assertions(1)`. [src/lib/envelope/validate.test.ts]

## Dev Notes

### Event Schema (D2 — authoritative)

Create `src/schemas/event.v1.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ferry.dev/schemas/event.v1.json",
  "type": "object",
  "required": ["version", "event_id", "ticket_key", "phase", "source", "ts"],
  "properties": {
    "version": { "const": "v1" },
    "event_id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
    "ticket_key": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]+-\\d+$" },
    "phase": { "enum": ["refine", "dev", "review", "iterate", "reconcile"] },
    "source": { "enum": ["jira-column", "jira-label", "jira-mention", "reconciler"] },
    "instructions": { "type": "string", "maxLength": 2000 },
    "ts": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

Note: `ticket_key` uses `\\d+` in the JSON (single `\` escape in JSON → `\d` regex). This is the same pattern as state schema.

### Ajv Import Pattern (CRITICAL — use createRequire, same as Story 1.2)

TypeScript NodeNext refuses to resolve `ajv/dist/2020` subpaths because `ajv` has no `exports` field. Use `createRequire`:

```typescript
import { createRequire } from 'module';
import type { ValidateFunction } from 'ajv';

const _require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const ajvModule = _require('ajv/dist/2020') as { Ajv2020: new (opts?: any) => { compile: (s: any) => ValidateFunction } };
const ajvInstance = new ajvModule.Ajv2020({ strict: true });
(_require('ajv-formats') as any).default(ajvInstance);
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Do NOT attempt `import Ajv2020 from 'ajv/dist/2020'` or `import addFormats from 'ajv-formats'` — both fail typecheck with NodeNext.

### No Payload Content in Error Logs (NFR-S1)

When `validateEnvelope` fails, the error MUST NOT include actual field values from the payload. Only log Ajv error paths (e.g., `"phase": must be one of [refine, dev, ...]`):

```typescript
// WRONG — leaks payload content:
throw new FerryError('state-invariant', { raw });
// WRONG — may contain actual values in Ajv's detailed message:
throw new FerryError('state-invariant', { errors: validate.errors });

// CORRECT — only paths and keywords, never values:
const safePaths = (validate.errors ?? []).map(e => `${e.instancePath} ${e.keyword}`);
throw new FerryError('state-invariant', { paths: safePaths });
```

This applies to the validate-action.ts script too — `console.error` only the sanitized paths.

### ULID Package API

The `ulid` package (already installed from Story 1.1) exposes:

```typescript
import { monotonicFactory } from 'ulid';

// Unseeded (production):
const generate = monotonicFactory();
const id = generate(); // current timestamp + random

// Seeded (tests):
let callCount = 0;
const deterministicPrng = () => 0.5; // always returns 0.5
const generateSeeded = monotonicFactory(deterministicPrng);
const id1 = generateSeeded(1000); // timestamp=1000
const id2 = generateSeeded(1000); // same timestamp, monotonically incremented
```

`monotonicFactory(prng?)` accepts an optional PRNG function (`() => number`, returning 0–1). Use this for deterministic test output.

### Dedupe Search Strategy

`checkAndClaim` paginates issue comments searching for `[ferry:dedupe] <eventId>`. The comment format is:

```
[ferry:dedupe] 01JFBK9Q4BVCJAGTYQ6S3XTDMN CHAN-27 01JFBK9Q4BVCJAGTYQ6S3XTDMP
```

(event_id, ticket_key, run_id — space-separated after the marker)

Search: `comment.body?.startsWith(`[ferry:dedupe] ${eventId}`)`. This is prefix-matching — correct because `event_id` is a unique 26-char string, so false positives are impossible.

Pagination: use `per_page: 100` and follow pages until comments are exhausted. ULID ordering means newer events are at the end — search all pages (there won't be many in practice; the audit-daily job prunes comments > 24h old per D2).

### Composite Action Structure

```yaml
# .github/actions/ferry-envelope-validate/action.yml
name: Ferry — Validate Event Envelope
description: Validates repository_dispatch payload against event.v1.schema.json. No payload content is logged on failure.
inputs:
  payload:
    description: JSON-encoded github.event.client_payload
    required: true
runs:
  using: composite
  steps:
    - name: Set up Node.js
      uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
      with:
        node-version: '20'
        cache: npm
    - name: Install dependencies
      shell: bash
      run: npm ci --prefer-offline
    - name: Validate envelope
      shell: bash
      run: npx tsx src/lib/envelope/validate-action.ts
      env:
        FERRY_ENVELOPE_PAYLOAD: ${{ inputs.payload }}
```

The `validate-action.ts` script MUST:
- Read `process.env.FERRY_ENVELOPE_PAYLOAD`
- Call `validateEnvelope(JSON.parse(...))`
- On success: write `ticket_key`, `phase`, `event_id` to `$GITHUB_OUTPUT`
- On failure: `console.error` sanitized paths only, `process.exit(1)`

Writing to `GITHUB_OUTPUT`:
```typescript
import { appendFileSync } from 'fs';
const output = process.env.GITHUB_OUTPUT!;
appendFileSync(output, `ticket_key=${envelope.ticket_key}\n`);
appendFileSync(output, `phase=${envelope.phase}\n`);
appendFileSync(output, `event_id=${envelope.event_id}\n`);
```

### Updating Dispatch Workflows

Each of the 4 dispatch workflow `gate-envelope` jobs needs these steps to replace the placeholder:

```yaml
    steps:
      - name: Checkout repository
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - name: Validate event envelope
        uses: ./.github/actions/ferry-envelope-validate
        with:
          payload: ${{ toJson(github.event.client_payload) }}
```

The composite action handles setup-node + npm ci internally — no need to duplicate in parent job.

Remove the `Placeholder — envelope validation (Story 1.3)` step and keep the checkout step.

### DedupeOpts and Octokit Pattern

```typescript
// src/lib/envelope/dedupe.ts
import { Octokit } from '@octokit/rest';  // allowed in src/lib/**

export interface DedupeOpts {
  octokit: Octokit;
  owner: string;
  repo: string;
  issueNumber: number;
  runId: string;
}

export async function checkAndClaim(
  eventId: string,
  ticketKey: string,
  opts: DedupeOpts,
): Promise<{ alreadyProcessed: boolean }>
```

The `issueNumber` for `ferry-processed-events` comes from env var `FERRY_PROCESSED_EVENTS_ISSUE` at runtime. For tests, pass it directly via `DedupeOpts`.

For unit tests, mock Octokit using vitest's `vi.fn()` — no live API calls:

```typescript
const mockOctokit = {
  rest: {
    issues: {
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    },
  },
} as unknown as Octokit;
```

### Patterns Established in Story 1.2 to Reuse

- `createRequire` for `ajv/dist/2020` and `ajv-formats` (copy pattern from `src/lib/state/index.ts`)
- `beforeEach` / `afterEach` with `mkdtempSync` for test file I/O (not needed here — no file I/O in envelope/ulid)
- All files: kebab-case names, named exports only
- Valid test ULID fixture: `01JFBK9Q4BVCJAGTYQ6S3XTDMN` (already used in state tests)

### FerryError Import Path

```typescript
import { FerryError } from '../error.js';  // from src/lib/error.ts (Story 1.2)
```

From `src/lib/envelope/validate.ts`: `import { FerryError } from '../error.js'`
From `src/lib/ulid/index.ts`: no FerryError needed

### File Structure

```
src/
  lib/
    envelope/
      types.ts              ← new
      validate.ts           ← new
      validate.test.ts      ← new
      validate-action.ts    ← new (GHA entry point)
      dedupe.ts             ← new
      dedupe.test.ts        ← new
    ulid/
      index.ts              ← new
      ulid.test.ts          ← new
  schemas/
    event.v1.schema.json    ← new
    schemas.test.ts         ← modify (add event schema tests)
examples/
  event.v1.schema.json      ← new
.github/
  actions/
    ferry-envelope-validate/
      action.yml            ← new
  workflows/
    refine.yml              ← modify (replace placeholder)
    dev.yml                 ← modify (replace placeholder)
    review.yml              ← modify (replace placeholder)
    iterate.yml             ← modify (replace placeholder)
```

### References

- Architecture: D2 Event envelope & dispatch contract — schema fields, dedupe Issue pattern, pruning
- Architecture: NFR-S1 — delimiter-based separation; no payload values in logs
- Architecture: D3 Concurrency — group key derives from validated `ticket_key`
- Epics: Story 1.3 ACs
- Story 1.2 Dev Notes — Ajv import pattern, `createRequire` workaround, valid ULID fixture

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

No blocking issues encountered. Straightforward implementation following the Story 1.2 Ajv/createRequire pattern.

### Completion Notes List

- `generateULID` uses `monotonicFactory(prng)()` — each call creates a fresh factory, so seeded calls produce independent (non-monotonically-incremented) ULIDs. This matches the AC requirement for deterministic output from a fixed seed.
- `validateEnvelope` does not trim `instructions` to 2000 chars at runtime; the schema `maxLength: 2000` rejects payloads exceeding the limit. Trimming would silently corrupt data and is not required by the AC.
- Composite action includes `actions/setup-node` with pinned SHA per Story 1.1 conventions.

### File List

- `src/schemas/event.v1.schema.json` (new)
- `examples/event.v1.schema.json` (new)
- `src/schemas/schemas.test.ts` (modified — added event schema describe block, extracted makeAjv helper)
- `src/lib/ulid/index.ts` (new)
- `src/lib/ulid/ulid.test.ts` (new)
- `src/lib/envelope/types.ts` (new)
- `src/lib/envelope/validate.ts` (new)
- `src/lib/envelope/validate.test.ts` (new)
- `src/lib/envelope/validate-action.ts` (new)
- `src/lib/envelope/dedupe.ts` (new)
- `src/lib/envelope/dedupe.test.ts` (new)
- `.github/actions/ferry-envelope-validate/action.yml` (new)
- `.github/workflows/refine.yml` (modified — replaced placeholder with composite action call)
- `.github/workflows/dev.yml` (modified — replaced placeholder with composite action call)
- `.github/workflows/review.yml` (modified — replaced placeholder with composite action call)
- `.github/workflows/iterate.yml` (modified — replaced placeholder with composite action call)
