# Story 1.1: Project Scaffold, TypeScript Config & CI Pipeline

Status: done

## Story

As a Ferry operator,
I want a well-structured Ferry repository with a passing CI pipeline,
so that I have a validated, contributor-ready foundation before any agent code is written.

## Acceptance Criteria

1. **Given** a freshly cloned `ferry` repo, **When** `npm ci && npm test` is run locally, **Then** TypeScript compiles without errors (`tsc --noEmit`), ESLint reports zero violations, Prettier reports zero formatting issues, and all vitest tests pass.

2. **Given** a PR is opened against `main`, **When** `ferry-ci.yml` runs, **Then** it executes all quality gates in order: typecheck → lint → vitest → gitleaks → CODEOWNERS test — and fails the PR if any gate fails.

3. **Given** `.github/CODEOWNERS` is present, **When** a PR touches any file under `.github/**`, `src/schemas/**`, or `prompt.*.md`, **Then** CI asserts the CODEOWNERS rule matches and the PR requires the named human reviewer — verified by `codeowners.test.ts` that parses and asserts coverage.

4. **Given** `dependabot.yml` is configured, **When** a GitHub Action dependency is referenced in any workflow file, **Then** it is pinned by commit SHA (not tag) and Dependabot is enabled to update it with SHA-pinning preserved.

5. **And** the project structure matches the architecture: `src/agents/`, `src/lib/`, `src/schemas/`, `.github/workflows/`, `.github/actions/`, `examples/`, with `tsconfig.json` set to strict, ES2023, nodenext.

## Tasks / Subtasks

- [x] Task 1: Initialize package.json and install all dependencies (AC: #1, #5)
  - [x] Run `npm init -y`
  - [x] Install dev deps: `npm install --save-dev typescript @types/node vitest tsx eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-config-prettier`
  - [x] Install runtime deps: `npm install @anthropic-ai/sdk @google/genai openai @octokit/rest ulid ajv`
  - [x] Add `scripts` to `package.json`: `"build": "tsc --noEmit"`, `"test": "vitest run"`, `"lint": "eslint src --ext .ts"`, `"lint:fix": "eslint src --ext .ts --fix"`, `"format:check": "prettier --check 'src/**/*.ts'"`

- [x] Task 2: Configure TypeScript (AC: #1, #5)
  - [x] Run `npx tsc --init` then configure `tsconfig.json`: `strict: true`, `target: "ES2023"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `rootDir: "src"`, `outDir: "dist"`, `skipLibCheck: true`
  - [x] Ensure `tsc --noEmit` passes on empty `src/` stubs

- [x] Task 3: Configure ESLint and Prettier (AC: #1)
  - [x] Create `eslint.config.js` (ESLint v9 flat config) with `@typescript-eslint` rules, `no-restricted-imports` rule blocking direct `@octokit/rest` in `src/agents/**`
  - [x] Create `.prettierrc` (single quotes, 100 chars line width, trailing commas)
  - [x] ESLint ignores `dist/`, `node_modules/` via `ignores` array in flat config

- [x] Task 4: Create directory structure with stubs (AC: #5)
  - [x] `src/agents/refiner/index.ts` — empty stub with `export {}`
  - [x] `src/agents/developer/index.ts` — empty stub
  - [x] `src/agents/reviewer/index.ts` — empty stub
  - [x] `src/agents/iterator/index.ts` — empty stub
  - [x] `src/lib/.gitkeep` (will be populated in subsequent stories)
  - [x] `src/schemas/.gitkeep` (will hold `state.v1.schema.json`, `event.v1.schema.json` in Stories 1.2–1.3)
  - [x] `examples/.gitkeep`
  - [x] `.github/actions/.gitkeep`

- [x] Task 5: Create CODEOWNERS and its test (AC: #3)
  - [x] Create `.github/CODEOWNERS` protecting `.github/**`, `src/schemas/**`, `prompt.*.md` with `@jnk` as owner
  - [x] Create `src/codeowners.test.ts` that reads `.github/CODEOWNERS`, parses rules, and asserts that `.github/**`, `src/schemas/**`, and `prompt.*.md` patterns are present with at least one owner

- [x] Task 6: Create ferry-ci.yml with all quality gates (AC: #2)
  - [x] Create `.github/workflows/ferry-ci.yml` with parallel jobs: `typecheck`, `lint`, `test`, `gitleaks`
  - [x] All GitHub Actions pinned by SHA (not tag)
  - [x] Workflow `name:` field: `Ferry — CI`
  - [x] Trigger: `push` to `main` and `pull_request` targeting `main`
  - [x] `gitleaks` step: uses `gitleaks/gitleaks-action` SHA-pinned

- [x] Task 7: Create stub workflow files (AC: #2, #4)
  - [x] `.github/workflows/refine.yml` — `name: Ferry — Refine`, hardened concurrency block, `cancel-in-progress: true`
  - [x] `.github/workflows/dev.yml` — `name: Ferry — Dev`, `cancel-in-progress: false`
  - [x] `.github/workflows/review.yml` — `name: Ferry — Review`, `cancel-in-progress: false`
  - [x] `.github/workflows/iterate.yml` — `name: Ferry — Iterate`, `cancel-in-progress: false`
  - [x] `.github/workflows/reconciler.yml` — `name: Ferry — Reconciler`, cron `*/15 * * * *`, `cancel-in-progress: true`
  - [x] `.github/workflows/audit-daily.yml` — `name: Ferry — Audit Daily`, cron `0 9 * * *`
  - [x] All stub workflows include the hardened sinkhole concurrency block
  - [x] All GHA action refs SHA-pinned

- [x] Task 8: Configure Dependabot (AC: #4)
  - [x] Create `.github/dependabot.yml` with `github-actions` ecosystem, weekly schedule
  - [x] Also added npm ecosystem entry with TypeScript toolchain grouping

- [x] Task 9: Verify everything passes locally (AC: #1)
  - [x] `npm ci` succeeds
  - [x] `npm run build` (tsc --noEmit) passes with zero errors
  - [x] `npm run lint` passes with zero violations
  - [x] `npm run format:check` passes
  - [x] `npm test` passes (5/5 codeowners.test.ts tests pass)

### Review Findings

**Decision needed (resolve before patching):**

- [x] [Review][Decision] D1: `ferry-ci.yml` concurrency block → Option A: added `group: ci-${{ github.ref }}, cancel-in-progress: true`
- [x] [Review][Decision] D2: CODEOWNERS test gate visibility → Option A: stays inside vitest job

**Patches (fix after decisions resolved):**

- [x] [Review][Patch] P1: `no-restricted-imports` scoped to `src/agents/**` only [eslint.config.js]
- [x] [Review][Patch] P2: `eslint --ext .ts` flag removed; lint script now `eslint src` [package.json]
- [x] [Review][Patch] P3: Added `parserOptions.project: './tsconfig.json'` for type-aware rules [eslint.config.js]
- [x] [Review][Patch] P4: Added `if: always()` to `prune-processed-events` job [.github/workflows/audit-daily.yml]
- [x] [Review][Patch] P5: Renamed `build` → `typecheck` in package.json and ferry-ci.yml [package.json, .github/workflows/ferry-ci.yml]
- [x] [Review][Patch] P6: Moved `readFileSync` into `beforeAll` for clean error surfacing [src/codeowners.test.ts]
- [x] [Review][Patch] CHAN-: Replaced `startsWith(ticket_key, 'CHAN-')` with project-agnostic `ticket_key != ''` in all 4 dispatch workflows

**Deferred:**

- [x] [Review][Defer] W1: Concurrency sinkhole only guards `CHAN-` prefix — multi-project support is post-MVP (OQ9). [.github/workflows/dev.yml et al.] — deferred, post-MVP
- [x] [Review][Defer] W2: CI jobs each run full `npm ci` independently — install time grows with dep count. [.github/workflows/ferry-ci.yml] — deferred, performance
- [x] [Review][Defer] W3: Reconciler no `timeout-minutes` — relevant once real reconciler code replaces placeholder. [.github/workflows/reconciler.yml] — deferred, placeholder
- [x] [Review][Defer] W4: `tsconfig.json` includes test files — `src/**/*` compiles test code against production types; a separate `tsconfig.test.json` would isolate this. — deferred, minor
- [x] [Review][Defer] W5: Dependabot doesn't group LLM runtime deps — individual PRs per SDK could land partial upgrades. [.github/dependabot.yml] — deferred, low risk

## Dev Notes

### Critical Architecture Constraints

**No framework.** Ferry is hand-scaffolded TypeScript + Node.js on GitHub Actions. Do not install any web framework, ORM, or agent SDK. The runtime is GHA `ubuntu-latest` ephemeral runners — no server, no daemon.

**Exact scaffold commands (from architecture doc):**
```bash
npm init -y
npm install --save-dev typescript @types/node vitest tsx
npm install @anthropic-ai/sdk @google/genai openai @octokit/rest ulid ajv
npx tsc --init --rootDir src --outDir dist --module nodenext --target es2023 --strict
```

**TypeScript config required settings:**
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "skipLibCheck": true
  }
}
```

### Hardened Concurrency Block (MANDATORY in every workflow)

Every workflow file MUST include this exact concurrency block at the top level. This is the sinkhole pattern from D3:

```yaml
concurrency:
  group: ferry-${{ startsWith(github.event.client_payload.ticket_key, 'CHAN-') && github.event.client_payload.ticket_key || 'ferry-invalid-payload-sinkhole' }}
  cancel-in-progress: <per-phase-policy>
```

Per-phase `cancel-in-progress` policy:
- `refine.yml`: `true`
- `dev.yml`: `false`
- `review.yml`: `false`
- `iterate.yml`: `false`
- `reconciler.yml`: `true`
- `audit-daily.yml`: n/a (no ticket_key; use a fixed group name)

The sinkhole group prevents malformed payloads from exhausting the 500-group GHA cap. A vitest test in a later story (1.4) will parse all workflow YAMLs and assert these policies — write-phase workflows with `cancel-in-progress: true` will fail CI.

### GHA SHA-Pinning (MANDATORY)

All GitHub Actions references MUST use commit SHA, not tags. Example:
```yaml
# WRONG:
uses: actions/checkout@v4

# CORRECT:
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
```

Find current SHAs for commonly used actions:
- `actions/checkout`: `11bd71901bbe5b1630ceea73d27597364c9af683` (v4.2.2 as of 2026-04)
- `actions/setup-node`: `39370e3970a6d050c480ffad4ff0ed4d3fdee5af` (v4.1.0 as of 2026-04)

Verify actual current SHAs using the GitHub API or the action's releases page before committing. Dependabot will keep them updated.

### File Naming Conventions

- TypeScript files: `kebab-case.ts` (e.g., `secret-scan.ts`, `state-schema.ts`)
- Role entry points: `src/agents/<role>/index.ts` (exception to kebab-case for the entry point)
- Test files: co-located `*.test.ts` (e.g., `codeowners.test.ts` beside `codeowners.ts`)
- **No default exports** — named exports only. This keeps grep trivial across the codebase.
- JSON schema fields: `snake_case` (matches PRD conventions: `event_id`, `run_id`, `ticket_key`, `cost_eur`)

### ESLint Rules to Configure

```json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [{
        "group": ["@octokit/rest"],
        "message": "Import @octokit/rest only through src/lib/io/github.ts"
      }]
    }],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn"
  }
}
```

The `no-auto-merge` rule (blocking `octokit.pulls.merge`) will be added in Story 7.4, but the pattern is established here.

### Directory Structure to Create

```
ferry/
├── src/
│   ├── agents/
│   │   ├── refiner/index.ts        # stub: export {}
│   │   ├── developer/index.ts      # stub: export {}
│   │   ├── reviewer/index.ts       # stub: export {}
│   │   └── iterator/index.ts       # stub: export {}
│   ├── lib/                        # (empty, populated Stories 1.2–1.7)
│   ├── schemas/                    # (empty, populated Stories 1.2–1.3)
│   └── codeowners.test.ts          # parses + asserts CODEOWNERS coverage
├── .github/
│   ├── workflows/
│   │   ├── ferry-ci.yml
│   │   ├── refine.yml              # skeleton
│   │   ├── dev.yml                 # skeleton
│   │   ├── review.yml              # skeleton
│   │   ├── iterate.yml             # skeleton
│   │   ├── reconciler.yml          # skeleton
│   │   └── audit-daily.yml         # skeleton
│   ├── actions/                    # (empty, populated later)
│   ├── CODEOWNERS
│   └── dependabot.yml
├── examples/                       # (empty, populated Story 1.8)
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
└── README.md                       # exists (update if needed)
```

### CODEOWNERS Format

```
# Ferry protected paths — changes require human reviewer
/.github/**      @jnk
/src/schemas/**  @jnk
prompt.*.md      @jnk
```

### codeowners.test.ts Implementation Pattern

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('CODEOWNERS coverage', () => {
  const content = readFileSync(join(process.cwd(), '.github', 'CODEOWNERS'), 'utf-8');

  it('protects .github/**', () => {
    expect(content).toMatch(/\.github\/\*\*/);
  });

  it('protects src/schemas/**', () => {
    expect(content).toMatch(/src\/schemas\/\*\*/);
  });

  it('protects prompt.*.md', () => {
    expect(content).toMatch(/prompt\.\*\.md/);
  });

  it('each protected pattern has at least one owner', () => {
    const lines = content.split('\n').filter(l => !l.startsWith('#') && l.trim());
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[1]).toMatch(/^@/);
    }
  });
});
```

### ferry-ci.yml Quality Gates Order

The workflow must run gates in this exact order (each job `needs` the previous):
1. `typecheck` — `tsc --noEmit`
2. `lint` — ESLint + `prettier --check`
3. `test` — `vitest run` (includes `codeowners.test.ts`)
4. `gitleaks` — secret scan on diff
5. `codeowners-test` — can be merged into the `test` job since it's a vitest test

Alternatively all gates can run in parallel (no `needs` dependency) and the PR is blocked if any fails — this is simpler and faster. Use parallel jobs.

### Workflow `name:` Convention

```yaml
name: Ferry — CI          # ferry-ci.yml
name: Ferry — Refine      # refine.yml
name: Ferry — Dev         # dev.yml
name: Ferry — Review      # review.yml
name: Ferry — Iterate     # iterate.yml
name: Ferry — Reconciler  # reconciler.yml
name: Ferry — Audit Daily # audit-daily.yml
```

The `Ferry —` prefix makes all Ferry runs visible in the Actions tab at a glance.

### Gitleaks in CI

For the `gitleaks` CI step, use the official gitleaks GitHub Action (SHA-pinned):
```yaml
- name: Scan for secrets
  uses: gitleaks/gitleaks-action@44c470fc88ef5d2f79e0e11dc8df79bf4d2e8b60  # v2.3.7
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Or install the binary and run:
```yaml
- name: Install gitleaks
  run: curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz -C /usr/local/bin
- name: Scan for secrets
  run: gitleaks detect --source . --log-level warn
```

Verify the latest gitleaks version and SHA before pinning.

### Project Structure Notes

- The `src/` stubs (empty `export {}`) exist only to make `tsc --noEmit` succeed; they will be replaced by real implementations in subsequent stories.
- `src/lib/` and `src/schemas/` can start as empty directories (add `.gitkeep`) — they're populated in Stories 1.2–1.7.
- The `examples/` directory is populated in Story 1.8.
- `.github/actions/` will hold `ferry-concurrency/action.yml` (Story 1.4) and `ferry-envelope-validate/action.yml` (Story 1.3) — create as empty directory now.

### References

- Architecture: D8 Testing strategy — [Source: _bmad-output/planning-artifacts/architecture.md#D8]
- Architecture: Starter Template — [Source: _bmad-output/planning-artifacts/architecture.md#Starter-Template-Evaluation]
- Architecture: Naming patterns — [Source: _bmad-output/planning-artifacts/architecture.md#Naming-Patterns]
- Architecture: D3 Concurrency — [Source: _bmad-output/planning-artifacts/architecture.md#D3]
- Epics: Story 1.1 — [Source: _bmad-output/planning-artifacts/epics.md#Story-1.1]
- NFR-S7: SHA-pinned Actions, Dependabot — [Source: _bmad-output/planning-artifacts/epics.md#NonFunctional-Requirements]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — clean implementation, no failures.

### Completion Notes List

- Used ESLint v9 flat config (`eslint.config.js`) instead of legacy `.eslintrc.json` — ESLint 9 dropped support for the old format.
- Prettier auto-formatted `codeowners.test.ts` after initial write (long lines); all tests still pass after format fix.
- All 7 workflow files include the hardened sinkhole concurrency block with correct per-phase `cancel-in-progress` policy as specified in architecture D3.
- GHA deps SHA-pinned: `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` (v4.2.2), `actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af` (v4.1.0), `gitleaks/gitleaks-action@44c470fc88ef5d2f79e0e11dc8df79bf4d2e8b60` (v2.3.7).
- `package.json` uses `"type": "module"` to match NodeNext module resolution in tsconfig.
- All 5 CODEOWNERS vitest tests pass; tsc, eslint, prettier all clean.

### File List

- package.json
- package-lock.json
- tsconfig.json
- eslint.config.js
- .prettierrc
- src/agents/refiner/index.ts
- src/agents/developer/index.ts
- src/agents/reviewer/index.ts
- src/agents/iterator/index.ts
- src/lib/.gitkeep
- src/schemas/.gitkeep
- src/codeowners.test.ts
- examples/.gitkeep
- .github/CODEOWNERS
- .github/dependabot.yml
- .github/actions/.gitkeep
- .github/workflows/ferry-ci.yml
- .github/workflows/refine.yml
- .github/workflows/dev.yml
- .github/workflows/review.yml
- .github/workflows/iterate.yml
- .github/workflows/reconciler.yml
- .github/workflows/audit-daily.yml
