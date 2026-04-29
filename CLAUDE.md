# CLAUDE.md

## What this is

Ferry is a GitHub Actions agent pipeline connecting Jira to an autonomous dev loop. It runs only on ephemeral GHA runners — no long-running processes, no owned database. Each agent (refiner, developer, reviewer, iterator) runs in its own workflow, triggered by `repository_dispatch`.

## Commands

```bash
npm ci                 # install
npm test               # vitest
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src
npm run format:check   # prettier
```

Single test: `npx vitest run path/to/file.test.ts`

CI runs typecheck → lint → format:check → test → gitleaks on push/PR to `main`.

## Layout

- `src/lib/` — shared modules (envelope, state, io, audit, etc.)
- `src/agents/` — per-agent entry points + sub-modules
- `src/schemas/` — JSON schemas (loaded via `createRequire`)
- `.github/workflows/` — one workflow per phase
- `scripts/build-ferry-actions.mjs` — bundles agent entry points into `.ferry/`

Read the code for conventions; don't ask for a paper trail.

## Hard rules

1. **Idempotent external writes.** Every Jira/GitHub comment is prefixed `[ferry:<role>:<run-id>]`. Check before writing.
2. **Untrusted input must be fenced.** Wrap all Jira content (description, comments) with `delimitUntrusted()` before injecting into any LLM prompt.
3. **Documentation in English.** Comments, commit messages, PR/MR descriptions, README — even if the chat is in French.
4. **No `Co-Authored-By` trailers** on commits or PRs.
5. **TDD + KISS.** Failing test first when behavior is non-trivial. Boring code over clever code.

## Scope discipline

Match the size of the change to the task. A 200-line script does not need preflight, state.json, fingerprinting, or any other piece of the architecture unless the task asks for it. If you think a new abstraction is needed, ask first.
