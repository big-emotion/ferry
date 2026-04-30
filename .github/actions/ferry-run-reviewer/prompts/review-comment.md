# Review comment template

This file is the canonical template for every Ferry reviewer PR comment.
The agent loads it at runtime and must follow this structure exactly.

---

## Structure

```
[ferry:reviewer:TICKET]

**Review summary for TICKET:**

**Expected behaviour from the ticket**
- [One bullet per AC or key requirement. Quote the ticket directly when useful.]

**What the diff delivers**
- [One bullet per significant change. Cite the specific file and what it does.]

**Issues requiring changes**
1. `path/to/file` — **Why**: [Which AC or rule this violates, with specific evidence from the diff — file name, quoted content, or line context.] **Fix**: [One concrete action.]
2. ...

**Verdict**: Approved / Changes requested. [One sentence. If changes requested, name the top blocker.]
```

---

## Filled example (CHAN-10, Story 1.1 — Next.js bootstrap)

```
[ferry:reviewer:CHAN-10]

**Review summary for CHAN-10:**

**Expected behaviour from the ticket**
- Next.js 16 / React 19 / TypeScript strict greenfield project with Node 22 engine pinning
- next-intl locale routing with /fr as default locale
- Base layout with self-hosted WOFF2 fonts and preload links
- Six brand tokens wired to Tailwind 4 via @theme
- /api/health route returning { status, version, commit }
- Husky + commitlint commit hooks
- pnpm lint:tokens gate preventing raw hex literals in source
- Project metadata files (README, CHANGELOG, CONTRIBUTING, AGENTS.md)

**What the diff delivers**
- `src/app/[locale]/layout.tsx` — next-intl LocaleLayout with `<html lang={locale}>`, WOFF2 preload `<link>` tags for all three typefaces, and NextIntlClientProvider
- `src/styles/globals.css` — @font-face declarations, six :root brand token CSS variables, semantic aliases, and @theme block wiring tokens to Tailwind 4 utilities
- `src/styles/tokens.ts` — TypeScript source-of-truth for brand hex values
- `src/app/api/health/route.ts` — GET /api/health returning status/version/commit with Cache-Control: no-store
- `src/i18n/routing.ts` + `src/middleware.ts` — next-intl routing scoped to ["fr"]
- `scripts/lint-tokens.mjs` — hex-literal scanner enforcing use of CSS variables; wired as pnpm lint:tokens
- `.husky/commit-msg` + `commitlint.config.mjs` — conventional-commit enforcement
- `package.json` — Node 22 engine pin, pnpm packageManager, all required dev dependencies

**Issues requiring changes**
1. `.ferry/node_modules/**` (1 500+ files added) — **Why**: The .gitignore covers only `/node_modules` (root-level), leaving `.ferry/node_modules/` unguarded. As a result, the entire @anthropic-ai/sdk, @babel/runtime, json-schema-to-ts, and ts-algebra packages (compiled JS, source TS, sourcemaps) are committed to the repo. This inflates the PR by ~1 550 files of third-party artefacts that have no business being in version control, violates the "reproducible foundation" goal of CHAN-10, and would bloat `git clone` for every team member. **Fix**: Add `.ferry/node_modules/` (or `.ferry/`) to `.gitignore` and remove those files from the branch.
2. `src/styles/globals.css` — **Why**: The PR metadata explicitly reports `mergeable=false` with `src/styles/globals.css` listed as a conflicted file. Git conflict markers in this file would cause a build failure and block all subsequent stories from using the Tailwind 4 / brand-token setup that CHAN-10 is meant to deliver. **Fix**: Resolve the merge conflict against `main` before merging.

**Verdict**: Changes requested. The two blockers — committed `.ferry/node_modules/` (1 500+ stray files) and the unresolved merge conflict in `src/styles/globals.css` — must be fixed before this branch can land.
```

---

## Rules

- **Every issue must have a Why** — cite specific filenames, quoted content, or metrics from the diff. "X is missing" alone is not acceptable.
- **Omit "Issues requiring changes"** entirely when `approved = true`.
- **Keep total comment under 600 words.**
- **Do not add sections** not listed in the structure above (no "Summary", "Praise", "Next steps", etc.).
