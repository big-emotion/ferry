# Contributing

## Getting started

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run format:check
```

All gates (tests, typecheck, lint, format, gitleaks, and CodeQL in CI) must pass before opening a PR against `main`. CI runs them automatically on every push.

### Before pushing: rebuild `.ferry/` bundles if you touched `src/`

The `.ferry/` directory contains committed JavaScript bundles that GitHub Actions actually executes. They are built from `src/` via:

```bash
npm run build:ferry
```

**If you modify anything under `src/`, you must rebuild before pushing.** A stale bundle causes silent drift between source and runtime — CI will catch this, but rebuilding locally is faster:

```bash
npm run build:ferry
git add .ferry/
git commit -m "build: rebuild ferry bundles"
```

You can verify the bundles are up-to-date with:

```bash
npm run check:bundle   # builds, then fails if .ferry/ has uncommitted changes
```

### Local hooks (Husky)

`npm install` automatically wires two strict Git hooks (via the `prepare` script):

- **`pre-commit`** — `lint-staged` runs Prettier and ESLint (`--max-warnings=0`) on staged files only. Fast (~1s).
- **`pre-push`** — full CI parity: `typecheck && lint && format:check && test`. Refuses the push if any gate is red. The bundle-drift check (`npm run check:bundle`) is enforced in CI rather than in the local hook.

FR-tag governance (e.g. `feat:` / `fix:` commits must reference `(FRn)`) is enforced repo-wide by `npm run check:fr-drift`, wired into the CI lint job — there is no local `commit-msg` hook today.

`--no-verify` bypasses both hooks and is **not** considered a normal workflow — only use it intentionally and accept that CI will catch the issue. The authoritative enforcement is server-side branch protection (see below).

### Recommended branch protection (repo admins)

To make `main` truly unbreakable, enable the following at
**Settings → Branches → Add rule → branch name pattern `main`**
(direct link: <https://github.com/big-emotion/ferry/settings/branches>):

- ☑ Require a pull request before merging
- ☑ Require status checks to pass before merging
  - ☑ Require branches to be up to date before merging
  - Required checks (search and add each):
    - `Typecheck`
    - `Tests (vitest)`
    - `Lint & Format`
    - `Secret Scan (gitleaks)`
    - `Analyze (javascript-typescript)` (CodeQL)
    - `Bundle Drift`
- ☑ Do not allow bypassing the above settings
- ☑ Restrict who can push to matching branches (admins only, or empty list)

With this in place, a red CI cannot reach `main` even via direct push or `--no-verify`.

## CodeQL (SAST)

Ferry runs CodeQL static analysis on every push to `main`, every PR, and weekly (Mondays 06:00 UTC) via `.github/workflows/codeql.yml`.

The workflow fails CI if CodeQL finds any **high or critical** severity issues (`SARIF level: error`). Medium/low findings appear in the repository's Security → Code Scanning tab but do not block the PR.

**Suppressing a false positive:** add an inline `// lgtm[<rule-id>]` comment at the finding location, or use a `.github/codeql/codeql-config.yml` exclusion. Always include a short rationale comment so reviewers understand why the suppression is intentional.

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
- Any Jira content (ticket body, comments) passed to an LLM must be wrapped with `delimitUntrusted()` from `src/lib/llm/delimit-untrusted.ts`.
- Agent output must pass `src/lib/safety/scan.ts` before being committed to a branch.

## Adding a new agent phase

1. Add the phase to `EventPhase` in `src/lib/envelope/types.ts` and the JSON Schema in `src/schemas/event.v1.schema.json`.
2. Add a `PHASE_TO_WORKFLOW` entry in `src/lib/dispatch/routing.ts`.
3. Create the workflow file in `.github/workflows/`.
4. Add an `index.ts` under `src/agents/<phase>/`.

## Commit style

Plain imperative summary line, no emoji, no `Co-Authored-By` trailers. Reference story IDs in the body when relevant (e.g. `Story 3-1`).

## Bundle smoke test

After rebuilding `.ferry/` bundles (`npm run build:ferry`), verify the bundles actually boot under Node 20:

```bash
npm run smoke:bundle
```

This is `scripts/smoke-bundle.sh`. It boots each `.ferry/<role>-action.js` with stub credentials and asserts stderr is free of the v0.5.1 DOA failure class: `Dynamic require of`, `Cannot find module`, and `is not a function`. The bundles exit non-zero because real API credentials are not provided — that is expected and intentional. The only assertion is that no module-loading error appeared. The drift check (`npm run check:bundle`) verifies the bundle is current; the smoke test verifies it actually runs. Both gates run in CI.

## Releasing

When preparing a release, add a `## <prev> → <this>` section to [`MIGRATIONS.md`](../MIGRATIONS.md) listing any consumer-visible changes (new secrets, new Jira-rule fields, status-name changes). See `docs/RELEASING.md` for the full pre-release checklist.

## Operations

On-call playbooks for stalled tickets, cost spikes, agent-loop runaways, and rollback procedures are in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Inspiration

Ferry was inspired by [OpenAI Symphony](https://github.com/openai/symphony). It adapts the same agentic pipeline concept to be GitHub Actions–native, Jira-driven, and multi-provider (Anthropic + Google AI + OpenAI).
