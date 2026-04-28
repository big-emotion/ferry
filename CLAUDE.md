# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm ci                 # install dependencies
npm test               # run all tests (vitest)
npm run test:watch     # vitest in watch mode
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src
npm run lint:fix       # eslint src --fix
npm run format:check   # prettier check
```

Run a single test file:
```bash
npx vitest run src/lib/envelope/validate.test.ts
```

CI checks (typecheck → lint → format:check → test → gitleaks secret scan) all run on push/PR to `main`.

## Architecture

Ferry is a **GitHub Actions–native agent pipeline** that connects Jira to an autonomous dev loop. It runs entirely on ephemeral GHA runners — no long-running processes, no owned persistence layer.

### Dispatch flow

```
Jira column move / label / @mention
  → repository_dispatch (JSON payload = EventEnvelopeV1)
  → gate-envelope step: validate + dedupe
  → one of: refine.yml · dev.yml · review.yml · iterate.yml · reconciler.yml
```

### Workflows (`.github/workflows/`)

| File | Trigger | Agent role |
|---|---|---|
| `refine.yml` | `repository_dispatch` phase=refine | Refiner — reads ticket, creates sub-tasks |
| `dev.yml` | `repository_dispatch` phase=dev | Developer — opens draft PR on `ferry/<key>` |
| `review.yml` | `repository_dispatch` phase=review | Reviewer — posts fingerprinted findings |
| `iterate.yml` | `repository_dispatch` phase=iterate | Iterator — applies findings (≤3 rounds) |
| `reconciler.yml` | cron 15min | Recovers missed webhooks via ULID dedupe |
| `audit-daily.yml` | cron daily | Checks provider usage; warns at 50% cap |

### Shared library (`src/lib/`)

| Module | Purpose |
|---|---|
| `envelope/types.ts` | `EventEnvelopeV1` — the inbound event shape |
| `envelope/validate.ts` | AJV validation against `schemas/event.v1.schema.json`; truncates `instructions` to 2000 chars |
| `envelope/dedupe.ts` | `checkAndClaim` — checks/writes `[ferry:dedupe] <eventId>` comments to the audit Issue |
| `state/types.ts` | `FerryStateV1`, `FerryPhase`, `Fingerprint`, `IterationHistoryEntry` |
| `state/index.ts` | `loadState` / `writeState` — reads/writes `.ferry/state.json` on the PR branch; atomic (tmp → rename) with AJV re-validation |
| `preflight/index.ts` | `preflight()` — asserts branch exists, PR is open, HEAD SHA matches, Jira column matches expected phase |
| `preflight/freshness.ts` | `assertFreshOrSupersede()` — detects newer event for the same ticket via ULID ordering |
| `preflight/halt-labels.ts` | Checks for `ferry:paused` / `needs-human` labels; aborts run if present |
| `dispatch/routing.ts` | `PHASE_TO_WORKFLOW` table — single source of truth for phase → workflow/dispatchType mapping; `shouldProcessTicketType` skips Task tickets |
| `dispatch/daily-cap.ts` | Per-ticket per-day trigger cap; prevents spam re-dispatch |
| `dispatch/triggers.ts` | Label-based and `@mention` re-trigger parsing |
| `fingerprint/index.ts` | `(file, line_start, line_end, rule_id, hash)` tuple generation for reviewer findings |
| `fingerprint/resurgence.ts` | Detects resurgent findings across iteration history → triggers `needs-human` escalation |
| `llm/config.ts` | `FerryLlmConfig` — per-role model IDs and API keys loaded from env |
| `llm/route.ts` | `routeModel()` — routes `developer` to `critical` model when `critical` label is set; all other agents use default |
| `io/github.ts` | Octokit wrapper — PR, branch, commit, label operations |
| `io/jira.ts` | Jira REST API wrapper — ticket read, comment write, sub-task creation |
| `io/idempotency.ts` | `checkIdempotencyMarker` / `appendMarker` — prevents duplicate writes via `[ferry:<role>:<run-id>]` prefix |
| `io/retry.ts` | Exponential backoff for transient 5xx / rate-limit errors |
| `io/spend-cap.ts` | Detects 429/402 responses → labels ticket `ferry:paused`, posts audit comment |
| `io/tldr.ts` | Generates and validates the mandatory TL;DR block in PR bodies |
| `io/escalation.ts` | Writes `needs-human` escalation summary block to PR body |
| `sanitization/delimit-untrusted.ts` | `delimitUntrusted()` — wraps Jira content in `<<<UNTRUSTED>>>` fences before injecting into LLM prompts |
| `secret-scan/scan.ts` | Pre-push output scan for credential patterns |
| `audit/index.ts` | `emitAudit()` — appends JSON line to the `ferry-audit` GitHub Issue |
| `error.ts` | `FerryError` with typed codes: `state-invariant` · `spend-cap` · `transient` · `oscillation` · `unknown` |
| `ulid/index.ts` | ULID generation for event IDs |

### Agents (`src/agents/`)

Each agent has an `index.ts` entry point plus focused sub-modules:

- **refiner**: `refine.ts` (ticket decomposition), `batch.ts` (atomic sub-task creation), `idempotency.ts`, `empty.ts` (no-story escalation), `locale.ts`
- **developer**: `context.ts` (repo context loading), `diff.ts` (scope-enforced diff), `pr.ts` (draft PR open), `commit.ts`
- **reviewer**: `ci-gate.ts` (waits for green CI or injects synthetic finding), `schema.ts` (finding structure), `verdict.ts` (pass/needs-work/needs-human), `transition.ts` (post-review Jira column move)
- **iterator**: `prompt.ts` (builds prompt from review history), `cap.ts` (3-round cap), `transition.ts`

### State artifact

State lives in `.ferry/state.json` **on the `ferry/<ticket-key>` branch** — not on `main`. Validated against `src/schemas/state.v1.schema.json` on every read and write. `preflight()` must run before any agent writes to external systems.

### Schemas

JSON Schemas live in `src/schemas/`. Loaded at runtime via `createRequire` (bypasses TypeScript NodeNext subpath restrictions on `ajv/dist/2020`).

### Key invariants

- All external writes are idempotent; every comment is prefixed with `[ferry:<role>:<run-id>]`
- Dedupe uses ULID ordering: a newer event ID for the same ticket supersedes the current run
- Reviewer findings are fingerprinted as `(file, line_start, line_end, rule_id, hash)` tuples; resurgent fingerprints trigger immediate `needs-human`
- The Iterator caps at 3 rounds; agents never merge and never move Jira columns except the three documented transitions
- All Actions are SHA-pinned; Dependabot keeps them current
- Untrusted Jira content (ticket body, comments) must be wrapped with `delimitUntrusted()` before inclusion in any LLM prompt
