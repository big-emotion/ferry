# 0002 — Ferry Bundles Committed to the Repository

**Status:** Accepted  
**Date:** 2024-01-01

## Context

Ferry's agent logic is written in TypeScript under `src/`. GitHub Actions composite actions can only execute JavaScript (or shell scripts) — they cannot run `tsc` or `tsx` at action runtime. This means the TypeScript source must be compiled and bundled before it can run inside a consumer's workflow.

Two broad distribution strategies exist:

1. **Build at release time, commit the artifacts** — transpile and bundle TypeScript into JavaScript, commit the output, and reference those committed files in composite action `action.yml` definitions. Consumers pin to a tag or SHA; the built files are always present.

2. **Build at workflow runtime** — ship only TypeScript source and have each consumer workflow run a build step (e.g., `npm ci && npm run build:ferry`) before invoking Ferry's composite actions.

Ferry is intended to be installed into consumer repositories via `uses: big-emotion/ferry/.github/actions/ferry-run-developer@v0.9.0`. Composite actions resolve their `runs.steps` at the time the workflow executes, not at install time. This creates the constraint: whatever path is referenced in `action.yml` must exist on the repository's default branch (or the pinned tag) at the moment GitHub checks out the action.

## Decision

Built artifacts are committed to the repository under `.ferry/` and copied into `.github/actions/ferry-run-{refiner,developer,reviewer,iterator}/` as self-contained bundles.

The build script (`scripts/build-ferry-actions.mjs`, invoked via `npm run build:ferry`) uses esbuild to:

1. Bundle each agent entrypoint from `src/agents/<agent>/<agent>-action.ts` into a single `.js` file.
2. Copy bundled agents, event schemas, and prompt Markdown files into each composite action directory so that each action directory is fully self-contained.
3. Write a minimal `package.json` for `.ferry/` that includes only the runtime dependencies (ajv, @octokit/rest, @anthropic-ai/sdk), then run `npm install` inside `.ferry/`.

The `.ferry/` path appears in `.gitignore` to prevent developers from accidentally committing stale local builds; CI enforces that the committed bundles match the source via a dedicated check. The canonical instruction is: **edit `src/`, run `npm run build:ferry`, commit both**.

## Consequences

**Positive:**

- Consumers can use `uses: big-emotion/ferry/.github/actions/ferry-run-developer@v0.9.0` with no build step in their own workflows. The action is ready to execute immediately on checkout.
- Version pinning works as expected: tagging a release freezes both the TypeScript source and its compiled output, so `@v0.9.0` is reproducible.
- The composite actions are self-contained: each action directory carries its own agent bundle, schema, and prompts, so actions do not cross-reference each other.

**Negative:**

- Committed build artifacts create diff noise in PRs that touch agent logic — reviewers see both the TypeScript change and the bundled JavaScript change.
- The `.gitignore` entry for `.ferry/` is intentionally overridden by the build-and-commit workflow, which is counterintuitive. Developers who are unaware of this pattern may be confused when `git status` does not show `.ferry/` changes.
- If a contributor edits `.ferry/` files directly (instead of `src/`), their changes will be silently overwritten by the next `npm run build:ferry` run.

## Alternatives Considered

**Build at workflow runtime** — rejected because it adds a mandatory build step to every consumer's workflow, requires Node.js to be available on the runner before the composite action starts, and makes cold-start time non-deterministic (network fetch of npm dependencies on every run).

**Publish to npm and reference via `node_modules`** — rejected because composite actions must reference local file paths or remote `uses:` references; they cannot `require()` npm packages dynamically. Publishing to npm solves the distribution problem only for CLI tooling, not for composite action execution.

**Use Docker container actions** — rejected because Docker actions have significantly higher startup latency, require Docker daemon access (unavailable on some GitHub-hosted runners), and add image registry complexity for what is fundamentally a Node.js script.
