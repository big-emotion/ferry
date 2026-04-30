# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

```bash
npm ci                                              # Install dependencies
npm run typecheck                                   # TypeScript type checking (CI gate)
npm run lint                                        # Run ESLint
npm run format:check                                # Check Prettier formatting
npm test                                            # Run all tests with Vitest
npx vitest run src/path/to/test.test.ts            # Run a single test file
npm run build:ferry                                 # Build .ferry/ action bundles from src/
```

There is no dedicated `build` command for the main codebase — `npm run typecheck` is the compile-time gate. All CI gates (typecheck, lint, format, tests, gitleaks) must pass on push and PRs to `main`.

## Project Overview

Ferry is a **GitHub Actions-native agent pipeline** for Jira-driven autonomous development. The system orchestrates four agents (Refiner, Developer, Reviewer, Iterator) that run as GitHub Actions workflows, triggered by Jira column transitions via `repository_dispatch` events.

**Key constraint:** Ferry never merges code and rarely moves Jira columns autonomously — it only auto-transitions on three explicit FR (Ferry Requirement) numbers: FR18 (Dev → In Review), FR24 (Reviewer → Ready or Changes), FR28 (Iterator → In Review).

## Architecture Layers

### 1. **Envelope & Dispatch** (`src/lib/envelope/`, `src/lib/dispatch/`)

Every agent workflow starts with a `repository_dispatch` event. The composite action at `.github/actions/ferry-envelope-validate` validates the payload against `src/schemas/event.v1.schema.json` using AJV in strict mode. Payload must match `EventEnvelopeV1` type (`src/lib/envelope/types.ts`).

**Key invariants:**
- All external writes are idempotent — comments and file operations use fingerprinting (e.g., `[ferry:dedupe] <eventId> <ticketKey> <runId>`)
- Event deduplication: `src/lib/envelope/dedupe.ts` claims work by writing to audit issue; `src/lib/preflight/freshness.ts` uses ULID lexical ordering to detect when a newer event has superseded the current run
- Validation must never leak raw payload values — sanitize via AJV path reporting and trim large fields (e.g., `instructions` to 2000 chars)

### 2. **State Management** (`src/lib/state/`)

Durable ticket state lives in `.ferry/state.json` on the per-ticket branch `ferry/<ticket-key>`, NOT on `main`. 

- `src/lib/state/index.ts` is the **only** supported read/write path for state
- All state writes are atomic: write to `state.json.tmp`, validate against `src/schemas/state.v1.schema.json`, then rename
- State uses different phase names than events: events use `refine | dev | review | iterate | reconcile`; state uses `refining | developing | reviewing | iterating | ready | paused | cancelled | needs-human`
- Never write state ad hoc — use the shared state helpers

### 3. **Preflight & Safety Gates** (`src/lib/preflight/`)

Before any external write (branch commit, PR comment, Jira update), call `preflight()`:
- Verify branch exists and matches expected state
- Verify PR is still open (if applicable)
- Verify HEAD SHA still matches what state expects
- Verify Jira ticket column still matches expected phase

This guards against race conditions between old and new runs.

### 4. **IO Abstraction** (`src/lib/io/`)

All external interactions (GitHub, Jira, LLM) go through shared IO helpers. **Critical rule:** Agent code under `src/agents/**` must never import `@octokit/rest` or Jira modules directly. Route all access through:
- GitHub: `src/lib/dispatch/runner/github-actions/`
- Jira: `src/lib/io/tracker/factory.ts`
- LLM: `src/lib/llm/`

This decoupling allows mocking and testing without touching real APIs.

### 5. **Agent Entrypoints** (`src/agents/refiner/`, `developer/`, `reviewer/`, `iterator/`)

Each agent is a separate implementation. Key patterns:
- Agents define their own LLM schemas (e.g., `src/agents/reviewer/schema.ts`)
- Agents use shared preflight and state helpers
- Agent code is linted to forbid direct Octokit/Jira imports
- Reviewer agent has special gates: `src/agents/reviewer/ci-gate.ts` (blocks on red CI), `src/agents/reviewer/transition.ts` (auto-moves Jira on verdict)

### 6. **Scheduled Work** (`.github/workflows/reconciler.yml`, `audit-daily.yml`)

- **Reconciler** (`src/reconciler/reconcile.ts`): Sweeps for missed work, re-triggers stalled tickets
- **Daily audit** (`src/cost-governance/daily-check.ts`): Checks provider spend against caps, auto-pauses tickets via `ferry:paused` label when spend reaches 50% of monthly limit

## Language & Module Rules

- **Strict TypeScript** in NodeNext ESM mode
- All local imports use `.js` specifiers (e.g., `import { foo } from './bar.js'`)
- JSON schemas and AJV are loaded via `createRequire(...)`, not ESM imports (see `src/lib/envelope/validate.ts`)
- No `any` types — `@typescript-eslint/no-explicit-any` is an error
- Project must compile with `npm run typecheck` and pass all ESLint rules

## Code Ownership & Guardrails

Files under `.github/**`, `src/schemas/**`, and `prompts/*.md` are CODEOWNERS-protected. Expect scrutiny when editing:
- Workflow changes affect all consumers
- Schema changes are migrations (backward compat required unless breaking intentionally)
- System prompts drive agent behavior — changes impact production runs

## Comment & Fingerprint Conventions

External writes use standardized prefixes for idempotency:
- `[ferry:dedupe] <eventId> <ticketKey> <runId>` — claim work on audit issue
- `[ferry:<role>:<run-id>] ...` — agent-specific comments (e.g., `[ferry:reviewer:abc123] ...`)
- Do not invent new comment formats casually — all external writes must be repeatable

## Testing Strategy

- Unit tests live next to implementation (e.g., `src/lib/state/index.ts` → `src/lib/state/index.test.ts`)
- Use Vitest fixtures in `src/__fixtures__/` for mock payloads and state
- Agent code has `__lint-fixtures__/` (not real tests, just lint rule checks)
- All external IO is mocked in tests — tests never hit real GitHub, Jira, or LLM APIs
- Run tests early and often: `npm test` or `npm run test:watch`

## Common Workflows

**Adding a new LLM provider:**
1. Implement provider client in `src/lib/llm/<provider>/`
2. Extend `src/lib/llm/factory.ts` to instantiate it
3. Update agent prompts if provider has different constraints
4. Add tests in `src/lib/llm/<provider>/<provider>.test.ts`

**Changing agent behavior:**
1. Update system prompt in `prompts/<agent>.md`
2. Update agent schema in `src/agents/<agent>/schema.ts` if output format changes
3. Test with Vitest: `npx vitest run src/agents/<agent>/<agent>.test.ts`
4. Run full suite: `npm test`

**Adding a new preflight check:**
1. Add check logic to `src/lib/preflight/index.ts`
2. Update type in `src/lib/preflight/types.ts` if needed
3. Add tests in `src/lib/preflight/preflight.test.ts`
4. Update call sites to check the new condition

**Modifying state shape:**
1. Update schema in `src/schemas/state.v1.schema.json`
2. Update TypeScript type in `src/lib/state/types.ts`
3. Add migration logic in `src/lib/state/index.ts` if needed for backward compat
4. Update tests in `src/lib/state/state.test.ts`

## Requirements & Constraints

- Node.js ≥ 20
- Strict TypeScript compilation required
- All code must pass: typecheck → lint → format → tests → gitleaks scan
- Event idempotency is driven by audit issue comments, not a database
- Branch state is atomic: all writes go through `state.json.tmp` + validate + rename pattern

## Deployment

Building the distributable `.ferry/` bundles:
```bash
npm run build:ferry
```

This compiles TypeScript source in `src/` into bundled JavaScript in `.ferry/`. The built files are committed and are what GitHub Actions actually execute. Do not edit `.ferry/` files directly — all changes go in `src/` and are built.
