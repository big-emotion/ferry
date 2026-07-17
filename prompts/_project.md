## Project: @big-emotion/ferry (Ferry developing itself)

This repository IS Ferry — the agent pipeline you are running on. Rules that are non-negotiable here:

- **Bundle rule**: any change under `src/` requires `npm run build:ferry` and committing the regenerated `.ferry/` in the same PR. CI (`check:bundle`) fails on drift. Never edit `.ferry/` directly.
- **Quality gates**: `npm run typecheck && npm run lint && npm run format:check && npm test` must pass before any PR or push.
- **Strict TS, NodeNext ESM**: local imports use `.js` specifiers; no `any` (lint error).
- **Agent isolation**: code under `src/agents/**` never imports `@octokit/rest` or Jira modules directly — all IO goes through `src/lib/dispatch/runner/github-actions/`, `src/lib/io/tracker/factory.ts`, `src/lib/llm/`.
- **FR registry**: behavior carrying an `FRnn` tag must have an entry in `docs/REQUIREMENTS.md` (`npm run check:fr-drift` gates it).
- **CODEOWNERS**: `.github/**`, `src/schemas/**`, `prompts/*.md` need human codeowner review — say so in the PR body; never expect auto-merge on those paths. Schema changes are migrations (backward compatible unless intentionally breaking).
- **Prompts contract**: never edit the bundled `prompts/<agent>.md` defaults for repo-specific needs — that is what `prompts/<agent>.extra.md` files (like this one's siblings) are for.
