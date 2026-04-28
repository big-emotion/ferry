# Story 10.1: Real Jira REST client

Status: review

## Story

As a Ferry agent (Refiner / Developer / Reviewer / Iterator),
I want a real Jira Cloud REST v3 HTTP client behind `src/lib/io/jira.ts`,
so that ticket reads, comment writes, sub-task creation, label application, and column transitions execute against a live Jira tenant instead of returning scaffold stubs.

## Acceptance Criteria

1. `getTicket(ticketKey)` returns a parsed `JiraTicket` (title, description, comments with id+body, labels, issue type) by calling `GET /rest/api/3/issue/{key}?fields=summary,description,comment,labels,issuetype`.
2. `postComment(params)` posts a new ADF comment or updates an existing one (via `upsertJiraComment` directive) by calling `POST /rest/api/3/issue/{key}/comment` or `PUT /rest/api/3/issue/{key}/comment/{id}`.
3. `createSubtask(params)` creates a sub-task under the parent key by calling `POST /rest/api/3/issue` with `issuetype.name: "Subtask"`.
4. `addLabel(ticketKey, label)` adds a label without wiping existing labels by calling `PUT /rest/api/3/issue/{key}` with `update.labels: [{ add: label }]`.
5. `transitionTicket(ticketKey, targetName)` resolves the transition ID by calling `GET /rest/api/3/issue/{key}/transitions`, then posts `POST /rest/api/3/issue/{key}/transitions` — throws `FerryError('state-invariant')` if target name not found.
6. Every write operation runs `scanWithGitleaks` on the outbound string payload before sending; a leak hit throws `FerryError('spend-cap', { reason: 'secret-scan-hit' })` and never sends the request (FR47).
7. HTTP 429 / 402 → `FerryError('spend-cap')`. HTTP 5xx → `FerryError('transient')`. Non-2xx, non-retryable → `FerryError('unknown', { status })`. All retryable errors flow through existing `retry()`.
8. All authentication uses Basic auth (`email:token` base64) from env vars `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN` — no hardcoding.
9. No live network calls in CI: every test uses recorded fixtures from `src/__fixtures__/jira/`.
10. `src/lib/io/jira.ts` scaffold TODOs are fully replaced; the public API surface (function signatures) is unchanged or backward-compatible.

## Tasks / Subtasks

- [x] Task 1 — Write failing tests for `jira-rest.ts` (AC: 1, 2, 3, 4, 5, 7, 9)
  - [x] 1.1 Create `src/lib/io/jira-rest.test.ts` with fixture-based tests for each operation
  - [x] 1.2 Create fixture files: `src/__fixtures__/jira/get-issue-ACME-1.json`, `post-comment-201.json`, `put-comment-200.json`, `create-subtask-201.json`, `get-transitions.json`, `post-transition-204.json`
  - [x] 1.3 Confirm tests fail (no implementation yet)
- [x] Task 2 — Write failing tests for secret-scan gate in `jira.ts` (AC: 6)
  - [x] 2.1 Create `src/lib/io/jira.test.ts` asserting scan runs before each write
  - [x] 2.2 Assert that a payload with a dummy secret pattern throws `FerryError('spend-cap', { reason: 'secret-scan-hit' })` and does not call through to `jira-rest.ts`
- [x] Task 3 — Implement `src/lib/io/jira-rest.ts` (AC: 1, 2, 3, 4, 5, 7, 8)
  - [x] 3.1 Create `JiraRestClient` class accepting `baseUrl, email, apiToken` + `createJiraRestClientFromEnv()` factory
  - [x] 3.2 Implement `getIssue(key)` → raw Jira API response
  - [x] 3.3 Implement `postComment(key, adfBody)` and `putComment(key, commentId, adfBody)`
  - [x] 3.4 Implement `createSubtask(parentKey, summary, adfDescription)` with "Sub-task" fallback on 400
  - [x] 3.5 Implement `addLabel(key, label)` using `update.labels: [{ add: label }]`
  - [x] 3.6 Implement `getTransitions(key)` and `postTransition(key, transitionId)`
  - [x] 3.7 Implement HTTP error classifier using `classifyHttpStatus` from `spend-cap.ts`
- [x] Task 4 — Implement ADF helper (AC: 2, 3)
  - [x] 4.1 Create `src/lib/io/jira-adf.ts` with `textToAdf(text: string): AdfDoc` and `adfToText(adf): string`
  - [x] 4.2 Write `src/lib/io/jira-adf.test.ts` covering single/multi-paragraph, inline breaks, round-trip
- [x] Task 5 — Replace scaffold in `src/lib/io/jira.ts` (AC: 6, 7, 10)
  - [x] 5.1 Wire `postComment` in `jira.ts` to call secret scan, then call jira-rest `postComment` or `putComment` based on `upsertJiraComment` directive
  - [x] 5.2 Add `createSubtask`, `addLabel`, `transitionTicket`, `getTicket` exports — each runs secret scan on write payloads, delegates to jira-rest
  - [x] 5.3 Remove the two TODO comments; file compiles cleanly
- [x] Task 6 — Run full test suite and typecheck (AC: all)
  - [x] 6.1 `npx vitest run src/lib/io/jira-rest.test.ts` — 15 tests pass
  - [x] 6.2 `npx vitest run src/lib/io/jira.test.ts` — 10 tests pass
  - [x] 6.3 `npm run typecheck` — zero errors
  - [x] 6.4 `npm run lint` — zero errors

## Dev Notes

### Architecture constraints

- **Jira Cloud REST v3 only.** No v2. No Forge. No Atlassian SDK. Use native `fetch` (Node 20+ built-in). [Source: architecture.md — "Jira Cloud REST v3 only"]
- **No direct fetch outside `jira-rest.ts`.** `jira.ts` imports from `jira-rest.ts`; agents import from `jira.ts`. ESLint `no-restricted-imports` enforces this. [Source: architecture.md line 821]
- **Auth:** `Authorization: Basic <base64(email:apiToken)>`. Always include `Accept: application/json` and `Content-Type: application/json` on writes. Base64 encode in Node with `Buffer.from(`${email}:${apiToken}`).toString('base64')`.
- **Env vars:** `process.env.FERRY_JIRA_BASE_URL`, `process.env.FERRY_JIRA_EMAIL`, `process.env.FERRY_JIRA_API_TOKEN`. Throw `FerryError('state-invariant', { reason: 'missing-env', key: '...' })` if any are absent.
- **Secret scan before every write.** Import `scanWithGitleaks` from `src/lib/secret-scan/scan.ts`. Scan the string payload (comment body, sub-task title+description). Gitleaks binary path comes from `process.env.GITLEAKS_PATH` (default: `'gitleaks'`). On scan hit, throw `FerryError('spend-cap', { reason: 'secret-scan-hit' })` — never send the request. [Source: architecture.md line 499, FR47]
- **HTTP error handling:** use `classifyHttpStatus(status)` from `src/lib/io/spend-cap.ts` to classify. Map: `'spend-cap'` → `FerryError('spend-cap')`, `'transient'` → `FerryError('transient')`. Wrap in `retry()` from `src/lib/io/retry.ts` for `transient` only (retry respects `FerryError.code === 'transient'`).
- **Idempotency on postComment:** `jira.ts` must call `upsertJiraComment` from `src/lib/io/jira-upsert.ts` to decide create vs. update, then call the appropriate `jira-rest` function. This satisfies FR60 (comment-volume ceiling).

### ADF format (Atlassian Document Format)

Jira REST v3 requires comment/description bodies in ADF, not plain text. Minimal valid ADF for a text payload:

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "your text here" }]
    }
  ]
}
```

For multi-line text, split on `\n\n` to create multiple paragraph nodes. Each paragraph has one `text` node. Inline `\n` within a paragraph becomes a `hardBreak` node: `{ "type": "hardBreak" }` inserted between `text` nodes.

Isolate this in `src/lib/io/jira-adf.ts` — keep it out of `jira-rest.ts` to make it testable independently.

### Transition ID lookup

Jira transitions are identified by numeric IDs, not names. Names are tenant-specific (e.g. "In Review" vs "In review" vs "Review"). The resolution pattern:

```
GET /rest/api/3/issue/{key}/transitions
→ { transitions: [{ id: "21", name: "In Review" }, ...] }

Find by: transitions.find(t => t.name.toLowerCase() === targetName.toLowerCase())
If not found: throw FerryError('state-invariant', { reason: 'transition-not-found', target: targetName })
Then: POST /rest/api/3/issue/{key}/transitions { transition: { id } }
```

### createSubtask fields

Jira requires a project key to create a sub-task. The project key is the prefix of the parent ticket key (e.g. `CHAN` from `CHAN-12`). Extract with `ticketKey.split('-')[0]`.

Minimal POST body:
```json
{
  "fields": {
    "project": { "key": "CHAN" },
    "parent": { "key": "CHAN-12" },
    "summary": "sub-task title",
    "issuetype": { "name": "Subtask" },
    "description": { ...adfDoc }
  }
}
```

The `issuetype` name may vary by Jira configuration (`"Subtask"` vs `"Sub-task"`). Retry with the alternate name if the first call returns 400 with an issuetype error. Document this in a code comment.

### Test fixtures

Fixtures live at `src/__fixtures__/jira/`. Use `vi.stubGlobal('fetch', ...)` or a minimal fetch mock to return fixture responses. Do **not** use MSW or any network interception library — keep it simple. Pattern from `retry.test.ts`: use `vi.fn()` to mock the inner HTTP call.

Fixture filenames:
- `get-issue-CHAN-1.json` — a representative GET /issue response with comments, labels, sub-tasks
- `post-comment-201.json` — successful comment creation response
- `put-comment-200.json` — successful comment update response
- `create-subtask-201.json` — successful sub-task creation response
- `get-transitions.json` — transitions list including "In Review", "Ready to Merge", "Changes Requested"
- `post-transition-204.json` — empty body (Jira returns 204 on success)

Fixture data must be realistic but must not contain real credentials, URLs, or user PII. Use `acme-corp.atlassian.net` as the base URL and `ACME-` as the project prefix.

### File layout impact

```
src/lib/io/
  jira.ts              ← REPLACE scaffold; keep public API, add createSubtask/addLabel/transitionTicket/getTicket
  jira-rest.ts         ← NEW: raw fetch calls, auth header construction, HTTP error mapping
  jira-adf.ts          ← NEW: textToAdf() helper
  jira-rest.test.ts    ← NEW: fixture-based tests
  jira-adf.test.ts     ← NEW: unit tests for ADF conversion
src/__fixtures__/jira/
  *.json               ← NEW: recorded API responses
```

### Project Structure Notes

- All new files go under `src/lib/io/` — no new top-level directories.
- `jira-rest.ts` and `jira-adf.ts` must not import from `src/agents/` (one-way dependency graph: agents → io, never io → agents).
- The `src/lib/io/jira.ts` public-facing export signatures must not change in a breaking way — `postComment(params: PostCommentParams)` stays as-is; new exports are additions only.
- Test files follow the `*.test.ts` colocation pattern established across the project.

### Risk R-A mitigation (from sprint change proposal)

This story carries **HIGH** risk due to tenant-specific Jira edge cases. Mitigations to bake into the implementation:

1. **Fixture-first development:** write tests against realistic recorded responses before touching live APIs.
2. **issuetype fallback:** try `"Subtask"` first, then `"Sub-task"` on 400 (log which one succeeded).
3. **Transition name normalisation:** case-insensitive match.
4. **ADF version tolerance:** Jira sometimes returns `"version": 1` with optional fields — be defensive on reads, strict on writes.
5. **Comment body field name:** GET /issue returns `comment.comments[].body` as ADF; write back as ADF. Never echo back a GET body directly without round-tripping through `textToAdf` or an explicit ADF passthrough.

### References

- Jira REST v3 docs: `https://developer.atlassian.com/cloud/jira/platform/rest/v3/` (fetch latest if needed)
- `src/lib/io/retry.ts` — retry() function and RetryOptions interface
- `src/lib/io/spend-cap.ts` — classifyHttpStatus(), HttpClass type
- `src/lib/io/idempotency.ts` — checkIdempotencyMarker(), appendMarker()
- `src/lib/io/jira-upsert.ts` — upsertJiraComment(), UpsertDirective type
- `src/lib/secret-scan/scan.ts` — scanWithGitleaks(), ScanOptions
- `src/lib/error.ts` — FerryError, FerryErrorCode
- Architecture: `_bmad-output/planning-artifacts/architecture.md` lines 499–503, 821, 979, 1126–1127
- FR8–FR12, FR47: `docs/prd.md` lines 922–932, 1042–1044
- Sprint Change Proposal: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-28.md` risk R-A

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

No blockers encountered. Issuetype fallback ("Subtask" → "Sub-task") handled by peeking at HTTP 400 before classifying via `classifyHttpStatus`. ADF `adfToText` added alongside `textToAdf` to support `getTicket` comment body extraction for idempotency marker checks.

### Completion Notes List

- `JiraRestClient` class with 7 methods: `getIssue`, `postComment`, `putComment`, `createSubtask`, `addLabel`, `getTransitions`, `postTransition`. Factory `createJiraRestClientFromEnv()` validates all three env vars on construction.
- `createSubtask` retries with `"Sub-task"` issuetype name when the first attempt returns HTTP 400 (tenant-specific Jira config).
- `transitionTicket` resolves transition ID via case-insensitive name match; throws `FerryError('state-invariant')` if target not found.
- `scanStringPayload` writes payload to a temp file, runs `scanWithGitleaks`, deletes the file. Throws `FerryError('spend-cap', { reason: 'secret-scan-hit' })` on any leak.
- `JiraComment` updated to include `id: number` (previously body-only) to support `upsertJiraComment` target resolution.
- All existing tests pass (396 total); 38 new tests added across 3 new test files.

### File List

**New files:**
- `src/__fixtures__/jira/get-issue-ACME-1.json`
- `src/__fixtures__/jira/post-comment-201.json`
- `src/__fixtures__/jira/put-comment-200.json`
- `src/__fixtures__/jira/create-subtask-201.json`
- `src/__fixtures__/jira/get-transitions.json`
- `src/__fixtures__/jira/post-transition-204.json`
- `src/lib/io/jira-adf.ts`
- `src/lib/io/jira-adf.test.ts`
- `src/lib/io/jira-rest.ts`
- `src/lib/io/jira-rest.test.ts`
- `src/lib/io/jira.test.ts`

**Modified files:**
- `src/lib/io/jira.ts`

## Change Log

- 2026-04-28: Implement Story 10.1 — Real Jira REST client. Added `jira-rest.ts` (JiraRestClient class, createJiraRestClientFromEnv factory), `jira-adf.ts` (textToAdf/adfToText), fixture files, and 3 new test files. Replaced scaffold TODOs in `jira.ts` with real secret-scan gate + REST delegation. Added `getTicket`, `createSubtask`, `addLabel`, `transitionTicket` exports.
