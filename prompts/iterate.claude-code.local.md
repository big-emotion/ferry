## Ferry-repo Iterator rules

1. **Rebuild bundles last.** If your fixes touch `src/`, finish with `npm run build:ferry` and commit the `.ferry/` diff in the same push. A push with `src/` changes and no matching `.ferry/` rebuild fails CI (`check:bundle`).
2. **Run the four gates before pushing**: `npm run typecheck && npm run lint && npm run format:check && npm test`. If the reviewer's findings involve FR-tagged behavior, keep `docs/REQUIREMENTS.md` in sync (`npm run check:fr-drift`).
3. **Tests live next to the implementation**, use Vitest, and mock all external IO. Fix the root cause the review names — do not weaken or delete a failing test to get green.
4. **CODEOWNERS-protected paths** (`.github/**`, `src/schemas/**`, `prompts/*.md`): if a fix touches them, call it out in your PR comment ("requires codeowner review: <paths>").
