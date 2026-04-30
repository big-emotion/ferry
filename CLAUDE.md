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

The canonical consumer-facing install guide is **`docs/CONSUMER-SETUP.md`**. Contributor guidelines live in **`CONTRIBUTING.md`**.

## Architecture Layers

### 1. **Envelope & Dispatch** (`src/lib/envelope/`, `src/lib/dispatch/`)

Every agent workflow starts with a `repository_dispatch` event. The composite action at `.github/actions/ferry-envelope-validate` validates the payload against `src/schemas/event.v1.schema.json` using AJV in strict mode. Payload must match `EventEnvelopeV1` type (`src/lib/envelope/types.ts`).

**Key invariants:**
- All external writes are idempotent — comments and file operations use fingerprinting (e.g., `[ferry:<role>:<run-id>] ...`)
- Validation must never leak raw payload values — sanitize via AJV path reporting and trim large fields (e.g., `instructions` to 2000 chars)

### 2. **IO Abstraction** (`src/lib/io/`)

All external interactions (GitHub, Jira, LLM) go through shared IO helpers. **Critical rule:** Agent code under `src/agents/**` must never import `@octokit/rest` or Jira modules directly. Route all access through:
- GitHub: `src/lib/dispatch/runner/github-actions/`
- Jira: `src/lib/io/tracker/factory.ts`
- LLM: `src/lib/llm/`

This decoupling allows mocking and testing without touching real APIs.

### 3. **Agent Entrypoints** (`src/agents/refiner/`, `developer/`, `reviewer/`, `iterator/`)

Each agent is a separate implementation. Key patterns:
- Agents define their own LLM schemas (e.g., `src/agents/refiner/schema.ts`, or inline tool-call schemas in `src/agents/reviewer/review-loop.ts`)
- Agent code is linted to forbid direct Octokit/Jira imports
- Reviewer agent has a CI gate (`src/agents/reviewer/ci-gate.ts`) that blocks reviews when CI is red

### 4. **Scheduled Work** (`src/reconciler/`, `src/cost-governance/`)

These modules exist as library code but are currently **not wired to a workflow** — the example `reconciler.yml` and `audit-daily.yml` workflow stubs were removed. Keep the modules building and tested; consumers wire them up themselves.

- **Reconciler** (`src/reconciler/reconcile.ts`): Sweeps for missed work, re-triggers stalled tickets
- **Daily audit** (`src/cost-governance/daily-check.ts`): Checks provider spend against caps, auto-pauses tickets via `ferry:paused` label when spend reaches 50% of monthly limit

The only workflow files in this repo are the agent dispatch workflows (`refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`), the CI gate (`ferry-ci.yml`), and Claude Code helpers (`claude.yml`, `claude-code-review.yml`).

### 5. **Composite Actions** (`.github/actions/`)

Each agent has a composite action used by its workflow: `ferry-envelope-validate`, `ferry-emit-audit`, and `ferry-run-{refiner,developer,reviewer,iterator}`. Workflows are thin — most logic lives in `src/agents/**` and is invoked via these actions.

### 6. **CLI Entrypoints** (`src/cli/`)

Two consumer-facing CLIs are exposed via `package.json` `bin`:
- `ferry-init` (`src/cli/init/`) — scaffolds Ferry into a new consumer repo
- `ferry-doctor` (`src/cli/doctor/`) — diagnoses configuration issues in a consumer repo

Run locally with `npm run ferry-init` / `npm run ferry-doctor` (uses `tsx`).

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
- `[ferry:<role>:<run-id>] ...` — agent-specific comments (e.g., `[ferry:reviewer:abc123] ...`)
- Do not invent new comment formats casually — all external writes must be repeatable

## Testing Strategy

- Unit tests live next to implementation (e.g., `src/lib/io/jira.ts` → `src/lib/io/jira.test.ts`)
- Use Vitest fixtures in `src/__fixtures__/` for mock payloads and state
- Agent code has `__lint-fixtures__/` (not real tests, just lint rule checks)
- All external IO is mocked in tests — tests never hit real GitHub, Jira, or LLM APIs
- Run tests early and often: `npm test` or `npm run test:watch`

## Common Workflows

**Adding a new LLM provider:**
1. Implement the provider invoker in `src/lib/llm/<provider>.ts` (flat layout — see `anthropic.ts`, `openai.ts`, `google.ts`)
2. Extend `src/lib/llm/call.ts` (`createLlmCall`) with a branch that wires the new invoker
3. Update agent prompts if provider has different constraints
4. Add provider-integration tests in `src/lib/llm/call.test.ts`

**Changing agent behavior (contributors editing the bundled defaults):**
1. Update system prompt in `prompts/<agent>.md`
2. Update agent schema in `src/agents/<agent>/schema.ts` if output format changes
3. Test with Vitest: `npx vitest run src/agents/<agent>/<agent>.test.ts`
4. Run full suite: `npm test`

> Consumers should NOT edit `prompts/<agent>.md` directly — that breaks Ferry's contract. They use `prompts/<agent>.extra.md` to enrich the bundled prompt without replacing it. See the "Customizing agent prompts" section of `docs/CONSUMER-SETUP.md`. The resolver lives in `src/lib/prompts/resolve.ts`; composition happens in `src/lib/agent-runtime/prompt.ts`.

## Requirements & Constraints

- Node.js ≥ 20
- Strict TypeScript compilation required
- All code must pass: typecheck → lint → format → tests → gitleaks scan
- Event idempotency is driven by audit issue comments, not a database

## Deployment

Building the distributable `.ferry/` bundles:
```bash
npm run build:ferry
```

This compiles TypeScript source in `src/` into bundled JavaScript in `.ferry/`. The built files are committed and are what GitHub Actions actually execute. Do not edit `.ferry/` files directly — all changes go in `src/` and are built.
