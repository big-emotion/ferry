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

Ferry is a **GitHub Actions-native agent pipeline** for Jira-driven autonomous development. The system orchestrates five agents (Refiner, Developer, Reviewer, Iterator, Merger) that run as GitHub Actions workflows, triggered by Jira column transitions (and, for the Merger, by a `ferry-merge` dispatch on Reviewer approval) via `repository_dispatch` events.

**Key constraint:** Four of the five agents (Refiner, Developer, Reviewer, Iterator) never merge code — that ban is code-enforced via the Developer sandbox deny-list and the agents' architecture (ADR-0005). The **Merger** is the single, deliberately gated exception (FR32, ADR-0005 amendment): it runs `gh pr merge` only when triggered by a `ferry-merge` `repository_dispatch`, which only the Reviewer emits on approve. Ferry otherwise rarely moves Jira columns autonomously — it auto-transitions on four explicit FR (Ferry Requirement) numbers: FR18 (Dev → In Review), FR24 (Reviewer → Changes Requested), FR28 (Iterator → In Review), and FR32 (Merger merges the PR, then optionally → Done when `FERRY_MERGE_DONE_TRANSITION_ID` is set).

The canonical consumer-facing install guide is the **`## Quick install`** section in `README.md` (with full configuration reference in **`docs/CONFIGURATION.md`**). Contributor guidelines live in **`CONTRIBUTING.md`**.

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
- Reviewer agent has a CI gate (`src/agents/reviewer/ci-gate.ts`) that blocks reviews when CI is red; its pure `gateCi()` resolver is reused by the `ferry-ci-gate` composite on the claude-code path

### 4. **Scheduled Work** (`src/reconciler/`, `src/cost-governance/`)

CLI entrypoints live in `src/reconciler/run.ts` and `src/cost-governance/run.ts`. Consumer workflow stubs in `examples/consumer-setup/workflows/` show how to wire these up — see the `## Operations setup (required)` section in `README.md`. The ferry repo does not ship `.github/workflows/reconcile.yml` or `cost-daily.yml`; consumers add those to their own repos.

- **Reconciler** (`src/reconciler/reconcile.ts` + `run.ts`): Sweeps for missed work, re-triggers stalled tickets
- **Daily audit** (`src/cost-governance/daily-check.ts` + `run.ts`): Checks provider spend against caps, auto-pauses tickets via `ferry:paused` label when spend reaches 50% of monthly limit

The only workflow files in this repo are the dogfood consumer install (`ferry-router.yml` — Ferry running on its own repo, pinned to the latest release; FER-1), the CI gate (`ferry-ci.yml`), the release pipeline (`release.yml`), CodeQL SAST (`codeql.yml`), and Claude Code helpers (`claude.yml`, `claude-code-review.yml`).

### 5. **Composite Actions** (`.github/actions/`)

The bundled composite actions are `ferry-envelope-validate`, `ferry-route`, `ferry-emit-audit`, `ferry-ci-gate` (the reviewer CI pre-gate on the claude-code path), and `ferry-run-{refiner,developer,reviewer,iterator}`. Workflows are thin — most logic lives in `src/agents/**` / `src/lib/dispatch/**` and is invoked via these actions. On the `claude-code` execution path each agent runs as a single direct `anthropics/claude-code-action` call (no Ferry composite) — see `docs/CONFIGURATION.md`.

### 6. **CLI Entrypoints** (`src/cli/`)

Four consumer-facing CLIs are exposed via `package.json` `bin`:

- `ferry-init` (`src/cli/init/`) — scaffolds Ferry into a new consumer repo
- `ferry-doctor` (`src/cli/doctor/`) — diagnoses configuration issues in a consumer repo
- `ferry-update` (`src/cli/update/`) — upgrades pinned Ferry refs in consumer workflows; reads `MIGRATIONS.md` and prints required follow-ups
- `ferry-uninstall` (`src/cli/uninstall/`) — removes Ferry workflows, secrets, and variables from a consumer repo

Run locally with `npm run ferry-init` / `npm run ferry-doctor` / `npm run ferry-update` / `npm run ferry-uninstall` (uses `tsx`).

A fifth bin, `ferry-jira-mcp` (`src/jira-mcp/`), is a stdio MCP server — not a CLI. It wraps the Jira IO layer (token-auth via the `FERRY_JIRA_*` env) and exposes the Jira tools the `claude-code`-path agents call (`get_issue`, `list_subtasks`, `create_subtask`, `get_transitions`, `transition_issue`, `post_comment`). Consumer claude-code workflows launch it via `npx -p @big-emotion/ferry ferry-jira-mcp`.

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

> Consumers should NOT edit `prompts/<agent>.md` directly — that breaks Ferry's contract. They use `prompts/<agent>.extra.md` to enrich the bundled prompt without replacing it. See `docs/CONFIGURATION.md` for full customization options. The resolver lives in `src/lib/prompts/resolve.ts`; composition happens in `src/lib/agent-runtime/prompt.ts`.

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
