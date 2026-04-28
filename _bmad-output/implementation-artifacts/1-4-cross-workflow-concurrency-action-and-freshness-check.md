# Story 1.4: Cross-Workflow Concurrency Action & Freshness Check

Status: done

## Story

As a Ferry pipeline,
I want exactly one agent run executing per ticket at any time, with stale queued runs self-terminating,
So that concurrent Jira events never corrupt `.ferry/state.json` or produce duplicate outputs.

## Acceptance Criteria

1. **Given** a workflow includes the concurrency block with the `startsWith(ticket_key, 'CHAN-')` guard
   **When** a malformed `ticket_key` (missing, empty, or without the expected prefix) arrives
   **Then** it collapses into the `ferry-invalid-payload-sinkhole` group — verified by a vitest test that parses the workflow YAML and asserts the expression

2. **Given** `cancel-in-progress.test.ts` parses all workflow files
   **When** it checks write-phase workflows (`dev.yml`, `review.yml`, `iterate.yml`)
   **Then** `cancel-in-progress` is `false` for all three — the test fails CI if any write-phase workflow sets it to `true`

3. **Given** `refine.yml` and `reconciler.yml` exist
   **When** parsed by the same test
   **Then** `cancel-in-progress` is `true` for both

4. **Given** `assertFreshOrSupersede(envelope, opts)` runs at the start of a write-phase agent
   **When** a newer `event_id` for the same `ticket_key` exists in `ferry-processed-events`
   **Then** the current run returns `{ superseded: true, newerEventId: string }` with no LLM call, no external writes — the caller emits `outcome: "superseded"` to `ferry-audit` and exits 0

## Tasks / Subtasks

- [x] Task 1: Create FAILING `src/lib/concurrency/cancel-in-progress.test.ts` (AC: #1, #2, #3)
  - [x] Write tests that read all 5 dispatch/cron workflows using `readFileSync`
  - [x] Assert `dev.yml`, `review.yml`, `iterate.yml` contain `cancel-in-progress: false`
  - [x] Assert `refine.yml` contains `cancel-in-progress: true`
  - [x] Assert `reconciler.yml` contains `cancel-in-progress: true`
  - [x] Assert `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml` contain the `startsWith` expression guard
  - [x] Assert all four dispatch workflows contain `ferry-invalid-payload-sinkhole`

- [x] Task 2: Update concurrency group expression in 4 dispatch workflows (AC: #1)
  - [x] In `refine.yml`: change `ticket_key != ''` to `startsWith(github.event.client_payload.ticket_key, 'CHAN-')`
  - [x] In `dev.yml`: same change
  - [x] In `review.yml`: same change
  - [x] In `iterate.yml`: same change
  - [x] Do NOT modify `reconciler.yml` — it uses a static group `ferry-reconciler`
  - [x] Verify Task 1 tests now pass

- [x] Task 3: Write FAILING `src/lib/preflight/freshness.test.ts` (AC: #4)
  - [x] Test: returns `{ superseded: false }` when no comments exist in `ferry-processed-events`
  - [x] Test: returns `{ superseded: false }` when only older `event_id`s exist for the same `ticket_key`
  - [x] Test: returns `{ superseded: true, newerEventId }` when a newer `event_id` exists for the same `ticket_key`
  - [x] Test: returns `{ superseded: false }` when a newer `event_id` exists for a DIFFERENT `ticket_key`
  - [x] Test: paginates when `ferry-processed-events` has more than 100 comments (mock multiple pages)
  - [x] Mock Octokit using `vi.fn()` pattern (same as Story 1.3 dedupe tests)

- [x] Task 4: Implement `src/lib/preflight/freshness.ts` (AC: #4)
  - [x] Export `FreshnessResult` type (see Dev Notes)
  - [x] Export `FreshnessOpts` interface (see Dev Notes)
  - [x] Implement `assertFreshOrSupersede(envelope, opts): Promise<FreshnessResult>`
  - [x] Paginate `ferry-processed-events` issue comments (max 100 per page)
  - [x] Parse dedupe comment format: `[ferry:dedupe] <event_id> <ticket_key> <run_id>`
  - [x] ULID comparison: string comparison is chronologically correct (lexicographic = time-ordered)
  - [x] Named export only

- [x] Task 5: Verify all tests pass (AC: all)
  - [x] `npm run typecheck` — zero errors
  - [x] `npm run lint` — zero violations
  - [x] `npm run format:check` — passes
  - [x] `npm test` — all tests pass (new + all previous)

## Dev Notes

### Current State of Workflows

All 4 dispatch workflows already have a `concurrency:` block but with an **incomplete guard**:

```yaml
# CURRENT (wrong):
group: ferry-${{ github.event.client_payload.ticket_key != '' && github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
```

The `!= ''` check allows any non-empty string through, including adversarial keys that could fragment the concurrency group space or exhaust the 500-group GHA cap. Story 1.4 hardens this to use `startsWith`:

```yaml
# CORRECT (after this story):
group: ferry-${{ startsWith(github.event.client_payload.ticket_key, 'CHAN-') && github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
```

The `reconciler.yml` uses a static group `ferry-reconciler` — do NOT modify it.

### Cancel-in-Progress Test (YAML Parsing via Regex)

`js-yaml` is a transitive dep in `node_modules` but is not in `package.json` and has no stable TypeScript types. **Do not add or import it.** Parse the YAML workflow files with `readFileSync` + string assertions — the workflow structure is deterministic and regex/`includes()` is sufficient:

```typescript
// src/lib/concurrency/cancel-in-progress.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf-8');
}
```

Assert `cancel-in-progress`:
```typescript
// Write-phase: must be false
expect(readWorkflow('dev.yml')).toContain('cancel-in-progress: false');
expect(readWorkflow('review.yml')).toContain('cancel-in-progress: false');
expect(readWorkflow('iterate.yml')).toContain('cancel-in-progress: false');

// Read-phase: must be true
expect(readWorkflow('refine.yml')).toContain('cancel-in-progress: true');
expect(readWorkflow('reconciler.yml')).toContain('cancel-in-progress: true');
```

Assert group-key expression (only for dispatch workflows — reconciler has static group):
```typescript
const SINKHOLE_GUARD = "startsWith(github.event.client_payload.ticket_key, 'CHAN-')";
const SINKHOLE_GROUP = 'ferry-invalid-payload-sinkhole';

for (const name of ['refine.yml', 'dev.yml', 'review.yml', 'iterate.yml']) {
  const content = readWorkflow(name);
  expect(content, `${name} missing startsWith guard`).toContain(SINKHOLE_GUARD);
  expect(content, `${name} missing sinkhole group`).toContain(SINKHOLE_GROUP);
}
```

### Why the Tests Come First

The 4 dispatch workflows already have the correct `cancel-in-progress` values (`false` for write-phase, `true` for `refine.yml`). Writing tests first will:
1. Fail on the **group-key expression** check (Task 1 produces failing tests)
2. Pass on the `cancel-in-progress` values (already correct)

After updating the 4 workflows (Task 2), all assertions pass.

### FreshnessResult Type and assertFreshOrSupersede Interface

```typescript
// src/lib/preflight/freshness.ts
import { Octokit } from '@octokit/rest';

export interface FreshnessOpts {
  octokit: Octokit;
  owner: string;
  repo: string;
  processedEventsIssue: number; // issue number for 'ferry-processed-events'
}

export type FreshnessResult =
  | { superseded: false }
  | { superseded: true; newerEventId: string };

export async function assertFreshOrSupersede(
  envelope: { ticket_key: string; event_id: string },
  opts: FreshnessOpts,
): Promise<FreshnessResult>
```

The caller pattern in agent entry points (implemented in later stories):
```typescript
const freshness = await assertFreshOrSupersede(envelope, opts);
if (freshness.superseded) {
  await emitAudit({ outcome: 'superseded', ... });
  process.exit(0);
}
```

### ULID Chronological Ordering

ULIDs are lexicographically sortable by time — the first 10 characters encode millisecond timestamp. String comparison is sufficient and correct:

```typescript
// '01JXYZ...' > '01JABC...' ← first ULID is newer (higher timestamp)
// Therefore: newerEventId > envelope.event_id → this run is superseded
```

No special ULID library needed for comparison — use `>` operator on strings.

### Dedupe Comment Format

The `ferry-processed-events` issue comments follow this format (written by `src/lib/envelope/dedupe.ts`, which Story 1.3 implements):

```
[ferry:dedupe] 01JFBK9Q4BVCJAGTYQ6S3XTDMN CHAN-27 01JFBK9Q4BVCJAGTYQ6S3XTDMP
                ↑ event_id (ULID)             ↑ ticket_key  ↑ run_id
```

Parsing pattern:
```typescript
const DEDUPE_PREFIX = '[ferry:dedupe] ';

for (const comment of comments) {
  if (!comment.body?.startsWith(DEDUPE_PREFIX)) continue;
  const parts = comment.body.slice(DEDUPE_PREFIX.length).split(' ');
  const [commentEventId, commentTicketKey] = parts;  // run_id at parts[2] is ignored
  if (commentTicketKey === envelope.ticket_key && commentEventId > envelope.event_id) {
    return { superseded: true, newerEventId: commentEventId };
  }
}
```

### Octokit Pagination Pattern

Paginate `issues.listComments` the same way as `dedupe.ts` (Story 1.3):

```typescript
let page = 1;
while (true) {
  const { data: comments } = await opts.octokit.rest.issues.listComments({
    owner: opts.owner,
    repo: opts.repo,
    issue_number: opts.processedEventsIssue,
    per_page: 100,
    page,
  });
  
  for (const comment of comments) {
    // ... check each comment
  }
  
  if (comments.length < 100) break;  // no more pages
  page++;
}
return { superseded: false };
```

### Mock Pattern for Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { assertFreshOrSupersede } from './freshness.js';

const ENVELOPE = { ticket_key: 'CHAN-27', event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN' };
const NEWER_ID  = '01JZZZZZZZZZZZZZZZZZZZZZZZ';  // > ENVELOPE.event_id
const OLDER_ID  = '01JAAAAAAAAAAAAAAAAAAAAAAA';  // < ENVELOPE.event_id
const OPTS = { owner: 'org', repo: 'target', processedEventsIssue: 42 };

function makeMockOctokit(commentBodies: string[]): Octokit {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({
          data: commentBodies.map((body, i) => ({ id: i + 1, body })),
        }),
      },
    },
  } as unknown as Octokit;
}
```

### File Structure

```
src/
  lib/
    concurrency/
      cancel-in-progress.test.ts   ← new
    preflight/
      index.ts                     ← unchanged
      preflight.test.ts            ← unchanged
      freshness.ts                 ← new
      freshness.test.ts            ← new
.github/
  workflows/
    refine.yml                     ← modify (group-key expression only)
    dev.yml                        ← modify (group-key expression only)
    review.yml                     ← modify (group-key expression only)
    iterate.yml                    ← modify (group-key expression only)
    reconciler.yml                 ← DO NOT MODIFY
```

### Patterns from Previous Stories to Reuse

- Named exports only — no default exports (established in Stories 1.1–1.3)
- All files: kebab-case names (e.g. `freshness.ts`, not `Freshness.ts`)
- Vitest mock pattern: `vi.fn()` + `as unknown as Octokit` (same as dedupe tests in Story 1.3)
- No `process.env` reads in library code — env vars are read only in entry points and passed via `opts`
- Valid test ULID: `01JFBK9Q4BVCJAGTYQ6S3XTDMN` (used across stories as the canonical fixture value)

### What This Story Does NOT Implement

- The agent entry points that call `assertFreshOrSupersede` — those are in Stories 3.1, 4.1, 5.1, 6.1
- The `emitAudit({ outcome: 'superseded' })` call on detection — that's handled by the entry points
- The `.github/actions/ferry-concurrency/action.yml` composite action — architecture D3 notes "Key derivation remains in the shared composite action for documentation" but this is deferred (the `concurrency:` block must live in each workflow; the action is reference documentation only)

### References

- Architecture D3: Concurrency primitive — group-key expression, per-phase cancel policy, freshness check algorithm
- Architecture D2: Event envelope — `ferry-processed-events` issue, dedupe comment format
- FR33: Cross-workflow concurrency group
- NFR-R3: Zero state corruption under concurrent Jira events
- Story 1.3 Dev Notes: Octokit mock pattern, valid ULID fixture values

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation was straightforward.

### Completion Notes List

- Hardened concurrency group expression in all 4 dispatch workflows: replaced `!= ''` guard with `startsWith(..., 'CHAN-')` to prevent adversarial or malformed ticket keys from escaping the sinkhole group
- Created `src/lib/concurrency/cancel-in-progress.test.ts`: 13 vitest assertions covering cancel-in-progress policy (write-phase=false, read-phase=true) and sinkhole guard on all 4 dispatch workflows — CI gate enforcing D3 invariants
- Created `src/lib/preflight/freshness.ts`: `assertFreshOrSupersede(envelope, opts)` paginates `ferry-processed-events` comments, compares ULIDs lexicographically, returns `{ superseded: true, newerEventId }` when a newer event exists for same ticket
- Created `src/lib/preflight/freshness.test.ts`: 6 tests covering empty issue, older-only events, newer event detection, cross-ticket isolation, non-dedupe comment filtering, and multi-page pagination

### File List

- `src/lib/concurrency/cancel-in-progress.test.ts` — new
- `src/lib/preflight/freshness.ts` — new
- `src/lib/preflight/freshness.test.ts` — new
- `.github/workflows/refine.yml` — modified (group-key expression)
- `.github/workflows/dev.yml` — modified (group-key expression)
- `.github/workflows/review.yml` — modified (group-key expression)
- `.github/workflows/iterate.yml` — modified (group-key expression)

### Review Findings

- [x] [Review][Decision→Patch] Cross-workflow cancel: added `${{ github.workflow }}` to concurrency group key in all 4 dispatch workflows — write-phase runs are now isolated from `refine.yml` cancellation [`.github/workflows/*.yml`]
- [x] [Review][Patch] `parts[1]` can be `undefined` for malformed dedupe comments — added `if (!commentEventId || !commentTicketKey) continue;` guard [`src/lib/preflight/freshness.ts:34`]
- [x] [Review][Defer] `emit-audit` job runs on `gate-envelope` failure due to `if: always()` — produces audit records for rejected envelopes [`.github/workflows/*.yml`] — deferred, pre-existing placeholder (Story 1.5 implements proper audit logic)
- [x] [Review][Defer] `assertFreshOrSupersede` not wired to audit emit or `process.exit(0)` — deferred by design to agent entry-point stories (3.1, 4.1, 5.1, 6.1) [`src/lib/preflight/freshness.ts`] — deferred, pre-existing
