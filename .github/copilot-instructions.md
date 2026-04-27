# Copilot instructions for Ferry

## Commands

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
```

Run one test file with Vitest:

```bash
npx vitest run src/lib/envelope/validate.test.ts
```

There is no dedicated `build` script today; CI treats `npm run typecheck` as the compile-time gate. On push and pull requests to `main`, CI runs typecheck, lint, format check, tests, and a gitleaks secret scan.

## Architecture

Ferry is a GitHub Actions-native agent pipeline for Jira-driven development. Jira automation emits `repository_dispatch` events whose payload must match `EventEnvelopeV1` (`src/lib/envelope/types.ts`). Each agent workflow (`refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`) starts with the local composite action at `.github/actions/ferry-envelope-validate`, which runs `src/lib/envelope/validate-action.ts` to validate and sanitize the dispatch payload against `src/schemas/event.v1.schema.json`.

The durable state for a ticket lives in `.ferry/state.json` on the `ferry/<ticket-key>` branch, not on `main`. `src/lib/state/index.ts` is the only supported read/write path: it validates state against `src/schemas/state.v1.schema.json`, writes atomically through `state.json.tmp`, and re-validates before rename. `src/lib/preflight/index.ts` is the guardrail before external writes; it checks that the branch exists, the PR is still open, the current HEAD SHA still matches state, and the Jira column still matches the expected phase.

Event idempotency is driven by audit issue comments, not a database. `src/lib/envelope/dedupe.ts` claims work by writing `[ferry:dedupe] <eventId> <ticketKey> <runId>` comments, and `src/lib/preflight/freshness.ts` uses ULID lexical ordering to detect when a newer event has superseded the current run. Scheduled workflows fill in the rest of the system shape: `reconciler.yml` sweeps for missed work, and `audit-daily.yml` handles spend checks and dedupe pruning.

Most of the implemented behavior is in `src/lib/**` plus the workflow wiring; `src/agents/*` entrypoints are still placeholders.

## Conventions

- This is strict TypeScript running in NodeNext ESM mode. Keep local TypeScript imports using `.js` specifiers.
- Load JSON schemas and AJV 2020 through `createRequire(...)` as in `src/lib/envelope/validate.ts` and `src/lib/state/index.ts`; direct ESM imports are intentionally avoided here.
- Preserve the split between event phases and state phases. Event payloads use `refine | dev | review | iterate | reconcile`, while persisted state uses `refining | developing | reviewing | iterating | ready | paused | cancelled | needs-human`.
- External writes are expected to be idempotent and fingerprintable. Existing conventions use prefixes like `[ferry:dedupe] ...` and `[ferry:<role>:<run-id>] ...`; do not invent new comment formats casually.
- Validation and logging must not leak raw payload values. Existing envelope validation reports sanitized AJV paths and trims `instructions` to 2000 characters.
- When changing branch/PR/ticket state, go through `preflight()` and the shared state helpers instead of writing ad hoc file or API logic.
- Workflow concurrency settings are meaningful: `refine` and `reconciler` allow newer runs to supersede older ones, while `dev`, `review`, and `iterate` explicitly avoid cancellation because they mutate branch, PR, or state artifacts.
- Agent code under `src/agents/**` is linted to forbid direct `@octokit/rest` imports; route GitHub access through shared IO helpers rather than wiring Octokit directly into agent logic.
- `_bmad-output/planning-artifacts/` and `_bmad-output/implementation-artifacts/` are treated as the authoritative requirements source for new feature work.
- `.github/**`, `src/schemas/**`, and `prompt.*.md` are CODEOWNERS-protected; expect extra scrutiny when editing them.
