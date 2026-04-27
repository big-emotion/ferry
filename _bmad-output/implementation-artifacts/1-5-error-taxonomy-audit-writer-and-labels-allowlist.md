# Story 1.5: Error Taxonomy, Audit Writer & Labels Allowlist

Status: done

## Story

As a Ferry agent,
I want every failure mapped to a deterministic label + Jira comment + audit outcome, and every run to emit exactly one JSON audit line,
So that operators can diagnose any failure from the `ferry-audit` issue alone without reading source code.

## Acceptance Criteria

1. **Given** `src/lib/error-taxonomy/index.ts` exports typed `FerryError` subclasses for all 5 classes: `transient`, `spend-cap`, `state-invariant`, `oscillation`, `unknown`
   **When** a `FerryError` is thrown and caught by the top-level try/catch
   **Then** `mapError(e)` returns the correct label(s), Jira comment template, and `outcome` string — verified by a unit test covering all 5 classes

2. **Given** `src/lib/audit/index.ts` exposes `emitAudit({ outcome, usage, runId, start })`
   **When** called at workflow exit (including under `if: always()` after a failure)
   **Then** it posts exactly one comment to the `ferry-audit` GitHub Issue with a valid JSON object containing all required fields (`ticket`, `phase`, `run_id`, `model`, `input_tokens`, `output_tokens`, `cost_eur`, `outcome`, `duration_ms`, `timestamp`) and idempotency marker `[ferry:audit:<run_id>]`

3. **Given** `src/labels/allowlist.ts` defines the closed label set
   **When** `labels-allowlist.test.ts` runs in CI
   **Then** it asserts every label string used anywhere in `src/lib/` and `src/agents/` belongs to the allowlist — failing CI if a new label was introduced outside the closed set

4. **And** `.github/actions/ferry-emit-audit/action.yml` wraps `emitAudit` as the final step in every workflow, replacing all `Placeholder — audit emission (Story 1.5)` steps

## Tasks / Subtasks

- [x] Task 1: Create FAILING `src/lib/error-taxonomy/error-taxonomy.test.ts` (AC: #1)
  - [x] Test: `mapError(new FerryError('transient'))` returns `{ labels: [], outcome: 'transient', jiraCommentTemplate: expect.stringContaining('Retrying') }`
  - [x] Test: `mapError(new FerryError('spend-cap'))` returns `{ labels: ['ferry:paused', 'ferry:spend-cap'], outcome: 'spend-cap', jiraCommentTemplate: expect.stringContaining('budget') }`
  - [x] Test: `mapError(new FerryError('state-invariant'))` returns `{ labels: ['status:stale'], outcome: 'state-invariant', jiraCommentTemplate: expect.stringContaining('stale') }`
  - [x] Test: `mapError(new FerryError('oscillation'))` returns `{ labels: ['needs-human'], outcome: 'oscillation', jiraCommentTemplate: expect.stringContaining('oscillation') }`
  - [x] Test: `mapError(new FerryError('unknown'))` returns `{ labels: ['needs-human'], outcome: 'unknown', jiraCommentTemplate: expect.stringContaining('unexpected') }`
  - [x] Test: `mapError(new Error('non-ferry'))` (plain Error, not FerryError) returns the `unknown` mapping
  - [x] Test: `mapError(new FerryError('unknown', { context: 'extra' }))` includes context in the comment template

- [x] Task 2: Implement `src/lib/error-taxonomy/index.ts` (AC: #1)
  - [x] Export `ErrorMapping` interface: `{ labels: string[]; outcome: string; jiraCommentTemplate: string }`
  - [x] Export `mapError(e: unknown): ErrorMapping` — switch on `e instanceof FerryError && e.code`, default to `unknown`
  - [x] `transient` mapping: `{ labels: [], outcome: 'transient', jiraCommentTemplate: '[ferry:{role}:{runId}] Retrying — transient error. Check GHA run for details.' }`
  - [x] `spend-cap` mapping: `{ labels: ['ferry:paused', 'ferry:spend-cap'], outcome: 'spend-cap', jiraCommentTemplate: '[ferry:{role}:{runId}] Paused — spend cap or provider rate limit reached. Resolve billing issue and remove ferry:paused to resume.' }`
  - [x] `state-invariant` mapping: `{ labels: ['status:stale'], outcome: 'state-invariant', jiraCommentTemplate: '[ferry:{role}:{runId}] Aborted — stale state detected. Re-dispatch to resume.' }`
  - [x] `oscillation` mapping: `{ labels: ['needs-human'], outcome: 'oscillation', jiraCommentTemplate: '[ferry:{role}:{runId}] Escalated — oscillation detected (same finding resurfaced). See PR for details.' }`
  - [x] `unknown` mapping: `{ labels: ['needs-human'], outcome: 'unknown', jiraCommentTemplate: '[ferry:{role}:{runId}] unexpected error — human triage required. See GHA run: {runUrl}' }`
  - [x] Named exports only — no default export

- [x] Task 3: Create FAILING `src/lib/audit/audit.test.ts` (AC: #2)
  - [x] Mock Octokit with `vi.fn()` pattern (same as dedupe.test.ts and freshness.test.ts)
  - [x] Test: `emitAudit(payload, opts)` calls `octokit.rest.issues.createComment` exactly once
  - [x] Test: the comment body is valid JSON with all required fields: `ticket`, `phase`, `run_id`, `model`, `input_tokens`, `output_tokens`, `cost_eur`, `outcome`, `duration_ms`, `timestamp`
  - [x] Test: the comment body starts with `[ferry:audit:<run_id>]\n` idempotency marker
  - [x] Test: `duration_ms` is computed as `Date.now() - opts.start` (approximately) — assert it is a non-negative integer
  - [x] Test: `timestamp` is a valid ISO-8601 string
  - [x] Test: if comment with marker `[ferry:audit:<run_id>]` already exists in last 50 comments, `createComment` is NOT called (idempotency re-post guard)
  - [x] Test: `input_tokens`, `output_tokens`, `cost_eur` default to 0 when `usage` is `null`

- [x] Task 4: Implement `src/lib/audit/index.ts` (AC: #2)
  - [x] Export `AuditUsage` interface: `{ inputTokens: number; outputTokens: number; costEur: number }`
  - [x] Export `AuditPayload` interface: `{ ticket: string; phase: string; runId: string; model: string; outcome: string; usage: AuditUsage | null; start: number }`
  - [x] Export `AuditOpts` interface: `{ octokit: Octokit; owner: string; repo: string; auditIssue: number }`
  - [x] Export `emitAudit(payload: AuditPayload, opts: AuditOpts): Promise<void>`
  - [x] Idempotency guard: fetch last 50 comments from `auditIssue`, check if any body starts with `[ferry:audit:${payload.runId}]` — if found, skip post
  - [x] Build JSON object: `{ ticket, phase, run_id: runId, model, input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0, cost_eur: usage?.costEur ?? 0, outcome, duration_ms: Math.round(Date.now() - start), timestamp: new Date().toISOString() }`
  - [x] Comment body format: `[ferry:audit:${runId}]\n${JSON.stringify(auditLine)}`
  - [x] Post via `octokit.rest.issues.createComment({ owner, repo, issue_number: auditIssue, body })`
  - [x] Named exports only

- [x] Task 5: Create `src/labels/allowlist.ts` (AC: #3)
  - [x] Export `LABELS_ALLOWLIST: readonly string[]` — the closed set:
    - Agent re-triggers: `agent:refiner`, `agent:dev`, `agent:reviewer`, `agent:iterator`
    - Ferry phase status: `ferry:refining`, `ferry:developing`, `ferry:reviewing`, `ferry:iterating`, `ferry:ready`, `ferry:paused`, `ferry:cancelled`, `ferry:spend-cap`
    - Escalation: `needs-human`, `status:stale`
    - Routing (user-applied, not agent-applied, but included for completeness): `critical`
  - [x] Named export only — no default export

- [x] Task 6: Create FAILING `src/labels/labels-allowlist.test.ts` (AC: #3)
  - [x] Scan all `.ts` files recursively under `src/lib/` and `src/agents/` using `fs.readdirSync` + recursive walk
  - [x] Extract candidate label strings: any string literal matching `/['"`]((?:ferry:|agent:|needs-human|status:|critical)[^'"`\s]+)['"`]/g` pattern
  - [x] For each extracted label, assert it exists in `LABELS_ALLOWLIST`
  - [x] Use `readFileSync` + regex — do NOT use AST parsing
  - [x] The test FAILS if any `.ts` file in `src/lib/` or `src/agents/` contains a label string not in the allowlist
  - [x] Verify the test currently passes with the existing codebase before marking done (the existing label `'state-invariant'` should NOT match the regex since it doesn't start with `ferry:`, `agent:`, `needs-human`, `status:`, or `critical`)

- [x] Task 7: Create entrypoint `src/lib/audit/emit-audit-action.ts` for composite action
  - [x] Reads env vars: `GITHUB_TOKEN`, `FERRY_AUDIT_ISSUE`, `FERRY_OWNER`, `FERRY_REPO`, `FERRY_RUN_ID`, `FERRY_TICKET`, `FERRY_PHASE`, `FERRY_MODEL`, `FERRY_OUTCOME`, `FERRY_INPUT_TOKENS`, `FERRY_OUTPUT_TOKENS`, `FERRY_COST_EUR`, `FERRY_START_MS`
  - [x] Constructs `AuditPayload` and `AuditOpts` from env vars, calls `emitAudit()`
  - [x] Throws a descriptive error for missing required env vars
  - [x] No unit test needed for this thin entrypoint (it's integration-only)

- [x] Task 8: Create `.github/actions/ferry-emit-audit/action.yml` (AC: #4)
  - [x] Follow exact same structure as `.github/actions/ferry-envelope-validate/action.yml`
  - [x] Inputs: `ticket`, `phase`, `run_id`, `model`, `outcome`, `input_tokens` (default `0`), `output_tokens` (default `0`), `cost_eur` (default `0`), `start_ms`, `audit_issue`, `github_token`
  - [x] Steps: setup-node → npm ci --prefer-offline → run entrypoint via `npx tsx src/lib/audit/emit-audit-action.ts`
  - [x] Pass all inputs as env vars matching `FERRY_*` names expected by entrypoint
  - [x] SHA-pin `actions/setup-node` to the same SHA used in `ferry-envelope-validate/action.yml`: `39370e3970a6d050c480ffad4ff0ed4d3fdee5af`
  - [x] SHA-pin `actions/checkout` if needed: `11bd71901bbe5b1630ceea73d27597364c9af683`

- [x] Task 9: Update all 5 workflows to use `ferry-emit-audit` action and fix condition guard (AC: #4, deferred W1 from 1.4)
  - [x] In `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`, `reconciler.yml`: replace placeholder `emit-audit` job with real action call
  - [x] Fix `emit-audit` job condition: change `if: always()` to `if: needs.run-agent.result != 'skipped'`
  - [x] Add a `Checkout repository` step before the composite action call (required to use local actions)
  - [x] Each workflow must pass the correct `phase` input matching its role: `refine`, `dev`, `review`, `iterate`, `reconcile`
  - [x] Pass `github_token: ${{ secrets.GITHUB_TOKEN }}` and `run_id: ${{ github.event.client_payload.event_id }}`
  - [x] Note: placeholder values used for model/tokens until agent entry points are wired in later stories

- [x] Task 10: Reclassify `validateEnvelope` error code (deferred W1 from 1.2/1.3)
  - [x] In `src/lib/envelope/validate.ts` line 23: `throw new FerryError('state-invariant', ...)` — confirmed correct per taxonomy. No code change needed.

- [x] Task 11: Verify all tests pass (AC: all)
  - [x] `npm run typecheck` — zero errors
  - [x] `npm run lint` — zero violations (also fixed pre-existing unused imports in ulid.test.ts)
  - [x] `npm run format:check` — passes
  - [x] `npm test` — 92 tests pass (13 test files)

## Dev Notes

### Architecture Reference: Error Taxonomy (D11)

From `architecture.md` §D11:

| Class | Label(s) | Action | Retry |
|-------|----------|--------|-------|
| `transient` | none | exponential backoff in-run | max 3, ULID-deduped |
| `spend-cap` | `ferry:paused` + `ferry:spend-cap` | abort run, Jira comment | human unpauses |
| `state-invariant` | `status:stale` | abort run, no writes | human re-dispatches |
| `oscillation` | `needs-human` | abort after resurgent-fingerprint detection | human intervention |
| `unknown` | `needs-human` + link to GHA log | abort | human triages |

`mapError` is NOT responsible for applying labels or posting comments — it returns the mapping. The caller (agent entry point, implemented in Stories 3.1, 4.1, 5.1, 6.1) does the actual writes. Story 1.5 only builds the mapper and the audit emitter.

### Existing Code: FerryError (already implemented in Story 1.2)

`src/lib/error.ts` already defines `FerryError` and `FerryErrorCode`. Do NOT recreate or modify it. Import from `'../error.js'`:

```typescript
import { FerryError } from '../error.js';
```

`src/lib/error-taxonomy/index.ts` is a NEW file alongside the existing `error.ts`. It does not replace it — it adds `mapError` logic on top of the existing `FerryError` class.

### Audit Line: Required Fields (FR41)

The audit JSON object must contain exactly these fields, in `snake_case` per naming conventions:

```typescript
{
  ticket: string,         // ticket_key, e.g. "CHAN-27"
  phase: string,          // "refine" | "dev" | "review" | "iterate" | "reconcile"
  run_id: string,         // ULID event_id from envelope
  model: string,          // model ID string or "none" for no-LLM runs (e.g. gate-envelope failure)
  input_tokens: number,   // 0 if no LLM call made
  output_tokens: number,  // 0 if no LLM call made
  cost_eur: number,       // 0.0000 if no LLM call made
  outcome: string,        // "success" | "transient" | "spend-cap" | "state-invariant" | "oscillation" | "unknown" | "superseded" | "paused" | "cancelled" | "needs-human-halt" | "pending-ci"
  duration_ms: number,    // integer milliseconds
  timestamp: string,      // ISO-8601, e.g. "2026-04-28T14:00:00.000Z"
}
```

### Audit Idempotency Marker Format

Comment body format (REQUIRED):
```
[ferry:audit:<run_id>]
{"ticket":"CHAN-27","phase":"refine","run_id":"01JXY...","model":"gemini-2.5-flash",...}
```

The marker MUST be the first line of the comment body. The JSON is on the second line. This format allows the idempotency guard to check `comment.body.startsWith('[ferry:audit:' + runId + ']')`.

### Labels Allowlist: Closed Set

```typescript
export const LABELS_ALLOWLIST = [
  // Agent re-triggers (user-applied to trigger a phase)
  'agent:refiner',
  'agent:dev',
  'agent:reviewer',
  'agent:iterator',
  // Ferry phase status labels
  'ferry:refining',
  'ferry:developing',
  'ferry:reviewing',
  'ferry:iterating',
  'ferry:ready',
  'ferry:paused',
  'ferry:cancelled',
  'ferry:spend-cap',
  // Escalation labels
  'needs-human',
  'status:stale',
  // Routing (user-applied, not agent-applied)
  'critical',
] as const;
```

### Labels Allowlist Test: Extraction Regex

The regex to extract label candidates from TypeScript source files:

```typescript
const LABEL_PATTERN = /['"`]((?:ferry:|agent:|needs-human|status:stale|critical)[^'"`\s,)]+)['"`]/g;
```

Walk files with `fs.readdirSync` recursively — same pattern as `codeowners.test.ts` which already scans the codebase. Look at `src/codeowners.test.ts` for the recursive walk helper pattern.

### Composite Action: `ferry-emit-audit`

Follow the exact pattern from `.github/actions/ferry-envelope-validate/action.yml`:
- Same `actions/setup-node` SHA: `39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0`
- `cache: npm` to use the GitHub Actions npm cache
- `npm ci --prefer-offline` to install deps
- `npx tsx src/lib/audit/emit-audit-action.ts` to run the entrypoint

### Workflow: `emit-audit` Job Fix

The current `emit-audit` condition `if: always()` runs even when `run-agent` was skipped (because `gate-envelope` failed). This produces misleading audit records for rejected envelopes (they have no `ticket` or `run_id` since those come from the agent context).

**Fix:**
```yaml
emit-audit:
  name: Emit audit line
  needs: [run-agent]
  if: needs.run-agent.result != 'skipped'    # ← was: if: always()
  runs-on: ubuntu-latest
  steps:
    - name: Checkout repository
      uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    - name: Emit audit line
      uses: ./.github/actions/ferry-emit-audit
      with:
        ticket: ${{ github.event.client_payload.ticket_key }}
        phase: refine    # change per workflow
        run_id: ${{ github.event.client_payload.event_id }}
        model: placeholder
        outcome: ${{ job.status }}
        input_tokens: '0'
        output_tokens: '0'
        cost_eur: '0'
        start_ms: ${{ github.run_id }}   # placeholder until agent entry points pass real value
        audit_issue: ${{ vars.FERRY_AUDIT_ISSUE }}
        github_token: ${{ secrets.GITHUB_TOKEN }}
```

Note: `start_ms` is a placeholder here. Real `start_ms` (epoch ms when agent began) will be passed from agent entry point outputs in Stories 3.1, 4.1, 5.1, 6.1. Using `github.run_id` as placeholder will produce nonsensical `duration_ms` but won't crash.

### Octokit Import Pattern

Use the same Octokit pattern established in Stories 1.3 and 1.4:

```typescript
import type { Octokit } from '@octokit/rest';
```

Do NOT instantiate Octokit inside library code. The `Octokit` instance is always passed in via `opts`. This keeps library code testable without live API calls.

### Mock Pattern for Audit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { emitAudit, type AuditPayload, type AuditOpts } from './index.js';

const RUN_ID = '01JFBK9Q4BVCJAGTYQ6S3XTDMN';

function makeMockOctokit(existingComments: string[] = []): Octokit {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({
          data: existingComments.map((body, i) => ({ id: i + 1, body })),
        }),
        createComment: vi.fn().mockResolvedValue({ data: { id: 99 } }),
      },
    },
  } as unknown as Octokit;
}

const PAYLOAD: AuditPayload = {
  ticket: 'CHAN-27',
  phase: 'refine',
  runId: RUN_ID,
  model: 'gemini-2.5-flash',
  outcome: 'success',
  usage: { inputTokens: 100, outputTokens: 50, costEur: 0.0012 },
  start: Date.now() - 5000,
};

const OPTS: AuditOpts = {
  owner: 'org',
  repo: 'target',
  auditIssue: 42,
};
```

### File Structure

```
src/
  lib/
    error-taxonomy/
      index.ts                        ← new
      error-taxonomy.test.ts          ← new
    audit/
      index.ts                        ← new
      audit.test.ts                   ← new
      emit-audit-action.ts            ← new (thin GHA entrypoint)
  labels/
    allowlist.ts                      ← new
    labels-allowlist.test.ts          ← new
.github/
  actions/
    ferry-emit-audit/
      action.yml                      ← new
  workflows/
    refine.yml                        ← modify (emit-audit job)
    dev.yml                           ← modify (emit-audit job)
    review.yml                        ← modify (emit-audit job)
    iterate.yml                       ← modify (emit-audit job)
    reconciler.yml                    ← modify (emit-audit job)
```

### Patterns from Previous Stories to Reuse

- **Named exports only** — no default exports (established Stories 1.1–1.4)
- **kebab-case filenames** — `error-taxonomy.test.ts`, `emit-audit-action.ts`
- **`createRequire` pattern for JSON/Ajv** — already used in `validate.ts` (Story 1.2/1.3); `audit/index.ts` does NOT need Ajv or schemas
- **Vitest mock pattern** — `vi.fn()` + `as unknown as Octokit` (same as dedupe and freshness tests)
- **No `process.env` in library code** — only in entrypoint `emit-audit-action.ts`
- **No `js-yaml`** — not in `package.json`; use `readFileSync` + string includes/regex for workflow/YAML assertions
- **Recursive file walk** — check `src/codeowners.test.ts` for existing helper pattern to reuse in `labels-allowlist.test.ts`

### What This Story Does NOT Implement

- Actual label application on GitHub/Jira tickets — that is in agent entry points (Stories 3.1, 4.1, 5.1, 6.1)
- Jira comment posting for errors — that is in agent entry points
- The `transient` retry logic — that is in `src/lib/io/retry.ts` (Story 1.6)
- The `cost_eur` computation — that is in `src/lib/llm/pricing.ts` (Story 1.7)
- Real `start_ms` from agent entry points — placeholder used for now; Stories 3.1+ will pass the real value

### Deferred Items from Previous Code Reviews

**W1 from 1.4** (now resolved in Task 9): `emit-audit` job runs on `gate-envelope` failure. Fix: `if: needs.run-agent.result != 'skipped'`.

**W1 from 1.2/1.3** (now resolved in Task 10): `validateEnvelope` uses `'state-invariant'` code — this is correct per D11 taxonomy. No change needed.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Fixed `vi.mocked()` cast in audit.test.ts: the committed version used `as ReturnType<typeof vi.fn>` which TypeScript rejected; replaced with `vi.mocked()` + `as { body: string }` cast.
- Fixed pre-existing unused import lint error in `src/lib/ulid/ulid.test.ts` (`beforeEach`, `afterEach` were imported but never used).
- `reconciler.yml` uses a different job structure (`reconcile` not `run-agent`) so `emit-audit` depends on `reconcile` with `if: always()` rather than the skipped-guard pattern used in the other four workflows.

### Completion Notes List

- `src/lib/error-taxonomy/index.ts`: exports `ErrorMapping` interface and `mapError(e: unknown): ErrorMapping` mapping all 5 `FerryError` codes plus plain `Error` to the `unknown` fallback. Context is appended to the unknown template string.
- `src/lib/audit/index.ts`: exports `emitAudit` with idempotency guard (fetches last 50 comments, checks for existing marker), builds the 10-field audit JSON line, posts with `[ferry:audit:<runId>]` marker.
- `src/lib/audit/emit-audit-action.ts`: thin GHA entrypoint; reads all required env vars, throws descriptive errors for missing values, instantiates Octokit and calls `emitAudit`.
- `.github/actions/ferry-emit-audit/action.yml`: composite action following `ferry-envelope-validate` pattern exactly; SHA-pinned `setup-node`; passes all inputs as `FERRY_*` env vars.
- All 5 workflows updated: `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml` use `if: needs.run-agent.result != 'skipped'`; `reconciler.yml` adds emit-audit after its `reconcile` job with `if: always()`.
- Task 10 confirmed: `validateEnvelope` throwing `'state-invariant'` is intentional — maps to `status:stale` label, correct action for a malformed envelope.

### File List

- `src/lib/error-taxonomy/index.ts` — new
- `src/lib/error-taxonomy/error-taxonomy.test.ts` — new
- `src/lib/audit/index.ts` — new
- `src/lib/audit/audit.test.ts` — new (also fixed type casts vs previous partial commit)
- `src/lib/audit/emit-audit-action.ts` — new
- `src/labels/allowlist.ts` — new
- `src/labels/labels-allowlist.test.ts` — new
- `.github/actions/ferry-emit-audit/action.yml` — new
- `.github/workflows/refine.yml` — modified (emit-audit job)
- `.github/workflows/dev.yml` — modified (emit-audit job)
- `.github/workflows/review.yml` — modified (emit-audit job)
- `.github/workflows/iterate.yml` — modified (emit-audit job)
- `.github/workflows/reconciler.yml` — modified (added emit-audit job)
- `src/lib/ulid/ulid.test.ts` — modified (removed unused `beforeEach`, `afterEach` imports)

### Change Log

- Implemented error taxonomy mapper (`mapError`) for all 5 FerryError codes (Date: 2026-04-28)
- Implemented audit emitter (`emitAudit`) with idempotency guard and required JSON fields (Date: 2026-04-28)
- Created `ferry-emit-audit` composite action and thin entrypoint (Date: 2026-04-28)
- Wired `ferry-emit-audit` into all 5 workflows; fixed misleading `if: always()` condition (W1 from 1.4) (Date: 2026-04-28)
- Created labels allowlist and enforcement test (Date: 2026-04-28)

### Review Findings

- [x] [Review][Patch] Labels extraction regex uses `status:stale` literal — widen to `status:` prefix so future `status:*` labels are caught; also remove trailing `,)` from character class (artefact narrowing the match) [src/labels/labels-allowlist.test.ts:6]

- [x] [Review][Patch] Stray word "budget" at end of spend-cap `jiraCommentTemplate` — ends with `…to resume. budget`, which will appear verbatim in Jira comments; remove trailing ` budget` [src/lib/error-taxonomy/index.ts:27]
- [x] [Review][Patch] `outcome: ${{ job.status }}` always resolves to `"success"` — `job.status` reflects the current (emit-audit) job, not the upstream agent job; change to `needs.run-agent.result` in `dev.yml`, `refine.yml`, `review.yml`, `iterate.yml`, and `needs.reconcile.result` in `reconciler.yml` [.github/workflows/]
- [x] [Review][Patch] Idempotency guard fetches only 50 comments with no pagination — after 50 audit comments accumulate, duplicate records can be posted for replayed run IDs; add pagination loop (e.g. `per_page: 100`, up to N pages) consistent with `dedupe.ts` pattern [src/lib/audit/index.ts:32]
- [x] [Review][Patch] `unknown` error `jiraCommentTemplate` starts with lowercase `unexpected` — spec Task 2 mandates capital-U `Unexpected`; also update the test assertion to `stringContaining('Unexpected')` [src/lib/error-taxonomy/index.ts:47, error-taxonomy.test.ts:48]
- [x] [Review][Patch] Optional token env vars (`FERRY_INPUT_TOKENS`, `FERRY_OUTPUT_TOKENS`, `FERRY_COST_EUR`) not validated for NaN — `parseInt`/`parseFloat` on non-numeric input silently yields `NaN`, posted to audit JSON; add `isNaN` guards consistent with `auditIssue` and `start` validation [src/lib/audit/emit-audit-action.ts:27-29]

- [x] [Review][Defer] `start_ms: ${{ github.run_id }}` produces nonsensical `duration_ms` (~55 years) — known per spec Dev Notes; real epoch ms will be passed from agent entry points in Stories 3.1, 4.1, 5.1, 6.1 [.github/workflows/] — deferred, pre-existing by spec design
- [x] [Review][Defer] `jiraCommentTemplate` placeholders `{role}`, `{runId}`, `{runUrl}` are never substituted — caller (agent entry point) is responsible for substitution; `mapError` is a pure mapper per spec design [src/lib/error-taxonomy/index.ts] — deferred, pre-existing by spec design
- [x] [Review][Defer] FerryError `context` JSON-serialised into Jira comment template without sanitisation — injection risk via context payload; sanitisation responsibility belongs to the caller in Stories 3.1+, not this story [src/lib/error-taxonomy/index.ts:12] — deferred, pre-existing by spec design
- [x] [Review][Defer] Reconciler `run_id: ${{ github.run_id }}` is a numeric ID, not a ULID — inconsistent with other workflows and could confuse downstream tooling; fix when reconciler is fully implemented in Story 8.3 [.github/workflows/reconciler.yml:37] — deferred, pre-existing by spec design
- [x] [Review][Defer] `npm ci` in composite action on cold cache causes audit step to fail — low probability with `--prefer-offline`; same pattern as `ferry-envelope-validate`; consider pre-bundling in a later infrastructure story [.github/actions/ferry-emit-audit/action.yml:49] — deferred, pre-existing
- [x] [Review][Defer] Multi-repo marker collision: `github.run_id` not globally unique across repos — not relevant to current single-repo deployment; revisit if Ferry is ever deployed to multiple repos [.github/workflows/reconciler.yml] — deferred, pre-existing
