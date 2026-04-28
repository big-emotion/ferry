# Contributing

## Getting started

```bash
npm ci
npm test
npm run typecheck
npm run lint
```

All four gates must pass before opening a PR against `main`. CI runs them automatically on every push.

## Workflow

- One branch per change: `ferry/<topic>` or `fix/<topic>`.
- Keep PRs focused. A PR that touches the shared library and two agents is usually too large — split it.
- Every PR must include a `TL;DR` block in the PR body (CI validates this).

## Tests

Ferry uses [Vitest](https://vitest.dev/). Test files live next to source files (`*.test.ts`).

Run a single file:
```bash
npx vitest run src/lib/envelope/validate.test.ts
```

The `src/agents/__lint-fixtures__/` directory contains intentionally broken code used by ESLint rule tests — don't fix it.

## Shared library conventions

- All external writes (GitHub comments, Jira comments) must go through `checkIdempotencyMarker` / `appendMarker` (`src/lib/io/idempotency.ts`) — every comment must carry a `[ferry:<role>:<run-id>]` prefix.
- Any Jira content (ticket body, comments) passed to an LLM must be wrapped with `delimitUntrusted()` from `src/lib/sanitization/delimit-untrusted.ts`.
- `preflight()` must run before any agent performs external writes.
- Agent output must pass `src/lib/secret-scan/scan.ts` before being committed to a branch.

## Adding a new agent phase

1. Add the phase to `EventPhase` in `src/lib/envelope/types.ts` and the JSON Schema in `src/schemas/event.v1.schema.json`.
2. Add a `PHASE_TO_WORKFLOW` entry in `src/lib/dispatch/routing.ts`.
3. Create the workflow file in `.github/workflows/`.
4. Add an `index.ts` under `src/agents/<phase>/`.

## Commit style

Plain imperative summary line, no emoji, no `Co-Authored-By` trailers. Reference story IDs in the body when relevant (e.g. `Story 3-1`).

## Inspiration

Ferry was inspired by [OpenAI Symphony](https://github.com/openai/symphony). It adapts the same agentic pipeline concept to be GitHub Actions–native, Jira-driven, and multi-provider (Anthropic + Google AI + OpenAI).
