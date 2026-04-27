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

### Workflows (`./github/workflows/`)

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
| `envelope/validate.ts` | AJV validation of envelope against `schemas/event.v1.schema.json`; truncates `instructions` to 2000 chars |
| `envelope/dedupe.ts` | `checkAndClaim` — checks/writes `[ferry:dedupe] <eventId>` comments to the canonical audit Issue |
| `state/types.ts` | `FerryStateV1`, `FerryPhase`, `Fingerprint`, `IterationHistoryEntry` |
| `state/index.ts` | `loadState` / `writeState` — reads/writes `.ferry/state.json` on the PR branch; write is atomic (tmp → rename) with AJV re-validation |
| `preflight/index.ts` | `preflight()` — runs before any agent write: asserts branch exists, PR is open, HEAD SHA matches, Jira column matches expected phase |
| `preflight/freshness.ts` | `assertFreshOrSupersede()` — detects if a newer event for the same ticket has already been processed (ULID ordering) |
| `error.ts` | `FerryError` with typed codes: `state-invariant` · `spend-cap` · `transient` · `oscillation` · `unknown` |
| `ulid/index.ts` | ULID generation for event IDs |

### State artifact

State lives in `.ferry/state.json` **on the `ferry/<ticket-key>` branch** — not on `main`. It is validated against `src/schemas/state.v1.schema.json` on every read and write. The `preflight()` function must run before any agent writes to external systems.

### Key invariants

- All external writes are idempotent; every comment is prefixed with `[ferry:<role>:<run-id>]`
- Dedupe uses ULID ordering: a newer event ID for the same ticket supersedes the current run
- Reviewer findings are fingerprinted as `(file, line_start, line_end, rule_id, hash)` tuples; resurgent fingerprints trigger immediate `needs-human`
- The Iterator caps at 3 rounds; agents never merge and never move Jira columns except the three documented transitions
- All Actions are SHA-pinned; Dependabot keeps them current

### Schemas

JSON Schemas live in `src/schemas/`. They are loaded at runtime via `createRequire` (bypasses TypeScript NodeNext subpath restrictions on `ajv/dist/2020`).

## Development method

Planning artifacts live in `_bmad-output/planning-artifacts/` (architecture, epics, implementation-readiness report). Story files (per-ticket implementation specs) live in `_bmad-output/implementation-artifacts/`. These are the authoritative source of requirements; consult them before implementing new features.
