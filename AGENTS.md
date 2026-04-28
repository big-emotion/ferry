# AGENTS.md

## Commands

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
```

Run a single test file with Vitest:

```bash
npx vitest run src/lib/envelope/validate.test.ts
```

Build the `.ferry/` action bundles (including `dev-action.js`) with:

```bash
npm run build:ferry
```

CI on `main` runs typecheck, lint, format check, tests, and a gitleaks secret scan.

## Architecture

Ferry is a GitHub Actions-native agent pipeline for Jira-driven development. Jira automation sends `repository_dispatch` payloads shaped as `EventEnvelopeV1` (`src/lib/envelope/types.ts`). The main workflows are `.github/workflows/refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`, plus the scheduled `reconciler.yml` and `audit-daily.yml`.

Each dispatch workflow starts by running the local composite action at `.github/actions/ferry-envelope-validate`, which executes `src/lib/envelope/validate-action.ts`. That path validates the payload against `src/schemas/event.v1.schema.json`, trims `instructions` to 2000 characters, and avoids logging raw payload values on failure.

Per-ticket durable state lives in `.ferry/state.json` on the `ferry/<ticket-key>` branch, not on `main`. Use `src/lib/state/index.ts` for all state access; it validates against `src/schemas/state.v1.schema.json`, writes through a temporary file, and renames atomically after re-validation. Before any external write, run through `src/lib/preflight/index.ts`, which checks branch existence, PR openness, HEAD SHA freshness, and Jira column alignment.

Idempotency and freshness are implemented through audit issue comments, not a separate datastore. `src/lib/envelope/dedupe.ts` claims events with `[ferry:dedupe] <eventId> <ticketKey> <runId>` comments, and `src/lib/preflight/freshness.ts` uses ULID lexical ordering to detect when a newer event has already superseded the current run.

The developer agent runs as an agentic tool-use loop (`src/agents/developer/loop.ts`). It receives a Jira ticket, explores the repo with tools (`read_file`, `write_file`, `str_replace`, `bash`, etc.), and calls `done` when finished. The entry point is `src/agents/developer/dev-action.ts`, which bundles to `.ferry/dev-action.js`. Path safety and bash restrictions are enforced in `src/agents/developer/sandbox.ts`.

## Conventions

- This repo uses strict TypeScript with NodeNext ESM. Keep local TypeScript imports on `.js` specifiers.
- JSON schemas and AJV 2020 are loaded with `createRequire(...)` rather than direct ESM imports; follow the existing pattern in `src/lib/envelope/validate.ts` and `src/lib/state/index.ts`.
- Keep the event-phase vocabulary separate from the persisted state-phase vocabulary. Event envelopes use `refine | dev | review | iterate | reconcile`; state uses `refining | developing | reviewing | iterating | ready | paused | cancelled | needs-human`.
- External writes are expected to be idempotent and use stable prefixes such as `[ferry:dedupe] ...` and `[ferry:<role>:<run-id>] ...`.
- Do not log raw payload values in validation failures or similar error paths.
- Use shared helpers for state and preflight checks instead of ad hoc file or API writes.
- Workflow concurrency is intentional: `refine` and `reconciler` allow superseding older runs; `dev`, `review`, and `iterate` do not allow cancellation because they mutate stateful artifacts.
- Code under `src/agents/**` must not import `@octokit/rest` directly; follow the lint rule and route GitHub access through shared IO helpers.
- `_bmad-output/planning-artifacts/` and `_bmad-output/implementation-artifacts/` are the authoritative requirements source for new feature work.
- `.github/**`, `src/schemas/**`, and `prompt.*.md` are CODEOWNERS-protected.
