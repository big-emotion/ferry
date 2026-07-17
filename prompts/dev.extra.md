## Ferry-repo Developer rules

1. **Rebuild bundles last.** If your diff touches `src/`, your final implementation step — after all code and tests are green — is `npm run build:ferry`, then commit the `.ferry/` diff in the same PR. A PR with `src/` changes and no matching `.ferry/` rebuild fails CI (`check:bundle`).
2. **Run the four gates before opening the PR**: `npm run typecheck && npm run lint && npm run format:check && npm test`. When your change is FR-tagged, also run `npm run check:fr-drift` and add/update the `docs/REQUIREMENTS.md` entry in the same PR.
3. **Tests live next to the implementation** (`src/x/y.ts` → `src/x/y.test.ts`), use Vitest, and mock all external IO — tests never hit real GitHub, Jira, or LLM APIs. Fixtures live in `src/__fixtures__/`.
4. **CODEOWNERS-protected paths** (`.github/**`, `src/schemas/**`, `prompts/*.md`): if the ticket forces you to touch them, state it explicitly in the PR body ("requires codeowner review: <paths>").
5. **Idempotency**: any new external write (comment, label, transition) must be fingerprinted/repeatable per the `[ferry:<role>:<run-id>]` convention.
