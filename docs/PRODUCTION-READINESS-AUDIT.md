# Production-Readiness Audit — Ferry

**Date:** 2026-05-02
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria, with a special focus on whether a fresh consumer install can complete the Jira→PR cycle.
**Verdict:** **7.4 / 10 — strong code/security posture, but the install flow is currently broken and a fresh `ferry-init` cannot produce a runnable Ferry workflow.**
**Target:** **8–9 / 10**, addressed by the residual actions in §5.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (962 tests passing), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `.github/workflows/codeql.yml`, `.github/workflows/release.yml`.
- **Docs:** `README.md` (Quick install), `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls. Remote tag inspection via `git ls-remote --tags`.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **No, conditional on three install-flow P0 fixes.** All quality gates are green and the security/code-quality posture is strong, but a fresh consumer install via `npx ferry-init` cannot run today: the wizard scaffolds workflows pinned to `@v1`, but the `v1` floating major tag has not been published to origin yet (`git ls-remote --tags` returns only `v0.2.0` and `v0.3.0`); and two of the six scaffolded stubs reference reusable workflows (`reconciler.yml`, `audit-daily.yml`) that do not exist in `.github/workflows/`. The previous audit's release-engineering blockers (no tag, no CHANGELOG, no release workflow, no npm publish) have all landed — but the CLI overhaul that landed alongside them (PRs #123, #129, #131, #133, #134) introduced new install-time incoherence.
2. **Can a consumer install and reach the full Jira → PR-approved cycle?** **No.** A user running `npx -p @big-emotion/ferry ferry-init` against the current `main` ends up with `.github/workflows/ferry-{refine,dev,review,iterate,reconciler,audit-daily}.yml` all pinned to `@v1`. GitHub Actions resolves `@v1` against the Ferry repo at run time and fails: the tag does not exist on origin. Even if the user manually rewrites the pin to `@v0.3.0`, two of the six stubs still call non-existent reusable workflows (`reconciler.yml`, `audit-daily.yml`) and will fail. Separately, the README's "Operations setup" step tells the user to `curl` two _other_, differently-named stubs (`ferry-reconcile.yml`, `ferry-cost-daily.yml`) from the `main` branch, which both works and is a mutable supply-chain pull.
3. **Security posture?** Strong. Strict AJV schema validation; all shell calls use `execFileSync` with argv-as-array (no shell strings); the only `spawn` (`tools.ts:357`) also passes argv as an array. CodeQL + npm audit (clean, 0 vulns) + gitleaks (configured + run before every dev-agent commit) wired in CI. Every workflow job has an explicit `permissions:` block. All third-party actions pinned by SHA. Internal Ferry composite-action references are pinned to `@v0.3.0` (no remaining `@main` self-references). `@octokit/rest` and Jira imports are forbidden under `src/agents/**` (lint rule + dedicated test). The "Ferry never merges" invariant is now asserted by the e2e pipeline test (`pipeline.test.ts:377`). No `harden-runner` egress allowlist (defense-in-depth gap), no fine-grained GitHub App for the GITHUB_TOKEN (the CLI provisions one but the reusable workflows use `github.token`).
4. **Is the score close to 8–9/10?** Computed score is **7.4** (vs. 7.2 last audit). The composition has shifted: release-engineering moved from 2.5 → 6.0 (tags cut, npm publish wired, CHANGELOG present, release.yml runs the full gate), but consumer documentation/install-flow regressed from 8.5 → 5.5 (templates.ts ↔ README ↔ reusable-workflow surface are mutually inconsistent). Three actions close most of the distance: (i) cut `v1` floating tag from v0.3.0 (the script exists but has not run yet), (ii) ship the missing `reconciler.yml` and `audit-daily.yml` reusable workflows _or_ remove the two scaffolded stubs that depend on them, (iii) reconcile the secret-naming convention used by `ferry-init` / `ferry-doctor` with what the reusable workflows actually consume.

---

## 2. Overall score — **7.4 / 10**

Movement since the previous audit (7.2): release-engineering blockers resolved, install-flow regressions introduced. The remaining gap is concentrated in **consumer install execution** and **doc/template/workflow coherence** — not in code quality, security, or test coverage.

Quality gates at audit time (all green):

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 83 files / **962 tests** / 100% passing in 1.8s
- `npm audit` (moderate+) — 0 vulnerabilities (332 deps total)
- TODO/FIXME/XXX/HACK count under `src/` — 3
- `console.log` count under `src/` — 8 (down from previous; structured JSON logger in production paths)

Release artifacts present:

- Tags `v0.2.0` and `v0.3.0` cut on origin
- `CHANGELOG.md` present at repo root
- `MIGRATIONS.md` present at repo root
- `.github/workflows/release.yml` runs the full quality gate, publishes to npm with provenance, creates a GitHub Release, and force-pushes the floating major tag via `scripts/retag-major.sh`
- Package published as `@big-emotion/ferry` (public access in `publishConfig`)
- 4 CLIs exposed via `bin`: `ferry-init`, `ferry-doctor`, `ferry-uninstall`, `ferry-update`

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. prev | Trend  |
| --- | ---------------------------------- | ------------ | ---------- | ------ |
| 1   | Application security               | **8.5 / 10** | 0          | strong |
| 2   | Supply-chain security              | **7.5 / 10** | +0.5       | strong |
| 3   | GitHub Actions security            | **7.5 / 10** | 0          | strong |
| 4   | Tests & coverage                   | **8.0 / 10** | +0.5       | strong |
| 5   | E2E / acceptance tests             | **8.0 / 10** | +1.0       | strong |
| 6   | CI/CD gates                        | **9.0 / 10** | 0          | strong |
| 7   | Reliability (idempotency, retries) | **8.0 / 10** | 0          | strong |
| 8   | Observability / audit              | **7.0 / 10** | 0          | medium |
| 9   | Consumer documentation             | **5.5 / 10** | -3.0       | weak   |
| 10  | Code quality / typing              | **8.5 / 10** | 0          | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0          | strong |
| 12  | Operations / runbooks / rollback   | **5.5 / 10** | 0          | medium |
| 13  | Release / distribution             | **6.0 / 10** | +3.5       | strong |
| 14  | Cost governance (runtime)          | **7.0 / 10** | 0          | medium |

Mean = **7.39 / 10** → reported as **7.4**.

---

## 4. Domain analysis

### 4.1 Application security — 8.5 (unchanged)

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- All shell calls use `execFileSync` with argv-as-array (`src/agents/developer/dev-action.ts`, `loop.ts`, `workspace.ts`, `src/agents/iterator/iterate-action.ts`). The single `spawn` (`src/agents/developer/tools.ts:357`) also passes args as an array.
- `FerryError` taxonomy with typed codes (`state-invariant`, `spend-cap`, `transient`, `unknown`).
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit (`src/lib/agent-runtime/secret-scan.ts`); never includes raw stdout/stderr in error messages.
- `@typescript-eslint/no-explicit-any: 'error'` plus `no-restricted-imports` for agent code (verified via `src/agents/restricted-imports.test.ts`; only `__lint-fixtures__/restricted-imports.ts` matches the pattern, by design).
- "Ferry never merges" invariant is asserted by `src/e2e/pipeline.test.ts:377` ("never calls octokit.rest.pulls.merge").

**Weaknesses**

- LLM-supplied `commit_message` reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 7.5 (+0.5)

**Strengths**

- **Tag-pin consistency table — every Ferry self-reference resolves and matches:**

  | Location                                                                         | Pin                | Status    |
  | -------------------------------------------------------------------------------- | ------------------ | --------- |
  | `package.json` `.version`                                                        | `0.3.0`            | canonical |
  | `.github/workflows/{refine,dev,review,iterate}.yml`                              | `@v0.3.0`          | match     |
  | `.github/actions/*/action.yml` setup-node SHAs                                   | SHA                | pinned    |
  | `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.3.0`          | match     |
  | `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.3.0`           | match     |
  | `docs/RELEASING.md`                                                              | `@v0.3.0`          | match     |
  | `README.md` SHA-pinning recipe                                                   | `@v0.3.0`          | match     |
  | `git tag --list` (origin)                                                        | `v0.2.0`, `v0.3.0` | exist     |

- **CodeQL SAST wired** (`.github/workflows/codeql.yml`).
- **`audit:ci` job in CI** (`scripts/npm-audit-check.mjs`).
- **Bundle-drift check in CI** (`check-bundle` job): rebuilds `.ferry/` from `src/` and fails if the diff is non-empty.
- Third-party actions pinned by SHA with version comments (`actions/checkout@de0fac2e…  # v6.0.2`, `actions/setup-node@39370e3970…  # v4.1.0`, etc.).
- gitleaks tarball pinned by SHA256 in `ferry-ci.yml`.
- `npm audit` clean (0 across info/low/moderate/high/critical, 332 dependencies).
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped (`.github/dependabot.yml`).
- `scripts/retag-major.sh` exists to maintain a moving major tag (`v1`) per Actions-ecosystem convention; wired into `.github/workflows/release.yml:106`.

**Weaknesses**

- **`v1` floating major tag does not exist on origin.** `git ls-remote --tags` returns only `v0.2.0` and `v0.3.0`. The `retag-major.sh` script that would create/update `v1` was added in commit `3b748d0` _after_ v0.3.0 was tagged at `53757af`, so it has never been executed on a real release. Every `templates.ts` stub now emits `@v1` (commit `3b748d0`), so any consumer running `ferry-init` today gets workflows that GitHub cannot resolve. **This is a P0 install-flow blocker.**
- README "Operations setup" still uses `curl https://raw.githubusercontent.com/big-emotion/ferry/main/...` (mutable `main` ref) for `ferry-reconcile.yml` and `ferry-cost-daily.yml`. Should pull from a pinned tag (`/v0.3.0/`) for supply-chain hygiene.
- No commit signing, no SLSA provenance attestation on the GitHub Release (npm publish has `--provenance`, GH release does not).
- No SBOM, no OSSF Scorecard, no `harden-runner` egress allowlist.

### 4.3 GitHub Actions security — 7.5 (unchanged)

**Strengths**

- **Explicit `permissions:` blocks on every job** across `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`, `ferry-ci.yml`, `release.yml`, `codeql.yml` (verified via `grep -nE "permissions:" .github/workflows/*.yml`).
- Concurrency groups per ticket (`ferry-${workflow}-${ticket_key}`) prevent races; `cancel-in-progress: false` on writes (dev/iterate), `true` on read-only (refine/review).
- Fallback `'ferry-invalid-payload-sinkhole'` in concurrency string blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.
- `release.yml` uses `id-token: write` only for npm provenance.

**Weaknesses**

- `GITHUB_TOKEN` used by reusable workflows instead of a fine-grained GitHub App. Notably, `ferry-init` _does_ provision a GitHub App and stores `FERRY_APP_ID`/`FERRY_PRIVATE_KEY` secrets — but the reusable workflows in `.github/workflows/{dev,refine,review,iterate}.yml` never reference those secrets and use `github.token` directly. Either remove the GitHub-App provisioning from the wizard or wire the App token through to the agent calls.
- No `harden-runner` (StepSecurity) for egress allowlisting on the dev/iterate workflows that perform git push.
- No OIDC for federated auth to Anthropic / Jira.
- Audit issue rotation: capped at `MAX_PAGES * 100 = 1000` comments, then silently fails.

### 4.4 Tests & coverage — 8.0 (+0.5)

| Metric  | Status                                          |
| ------- | ----------------------------------------------- |
| Suite   | 83 files / **962 tests** / all passing in 1.8 s |
| Reports | text, text-summary, html, lcov                  |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`     |

**Strengths**

- 84 new tests since previous audit (878 → 962), covering the four new CLIs (`uninstall`, `update`) and the new init steps (`jira-bundle`, `jira-resolve`, `secrets`, `verify`, `workflows`, `github-app`).
- Coverage threshold uniform at 75% across statements/branches/functions/lines.
- CLI module coverage closed: every check in `cli/doctor/checks/*` has a sibling `.test.ts`.
- Composite-action entrypoints (`*-action.ts`) and CLI bin entrypoints excluded from coverage with documented reason.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 8.0 (+1.0)

**Strengths**

- **Mocked end-to-end pipeline test** at `src/e2e/pipeline.test.ts` replays refine→dev→review→iterate, asserts the no-auto-merge invariant (line 377), and exercises FR18/FR24/FR28.
- **Install-guide acceptance test** at `src/install-guide.test.ts` (70 tests) covers 18 sections of the README — secret names, reusable-workflow refs, `@v0.3.0` pin, FR mentions, `event_id` schema match, audit-issue creation, smoke-test wording, no `@main` in internal workflows (issue #77 gate), ops stubs (reconcile/cost-daily), bundle-drift CI gate, npm audit step.
- FR drift detector (`scripts/check-fr-drift.sh`) wired into CI lint job.

**Weaknesses**

- No idempotency assertion across a full replay of the same `event_id` against the same audit issue.
- **Install-guide test does not cover what `ferry-init` actually scaffolds.** It validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts`. As a result the test stayed green even after templates.ts started emitting two stubs (`ferry-reconciler.yml`, `ferry-audit-daily.yml`) that reference reusable workflows which do not exist in `.github/workflows/`.

### 4.6 CI/CD gates — 9.0 (unchanged)

**Strengths**

- Six parallel CI jobs in `ferry-ci.yml`: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `check-bundle`, `audit`; plus the gitleaks workflow, the CodeQL workflow, and the release workflow gate.
- `release.yml` runs typecheck + lint + format + tests + audit + bundle-drift before npm publish.
- All actions in CI pinned by SHA.
- Concurrency cancels superseded CI runs on the same branch.

**Weaknesses**

- No `npm ci --audit-signatures` integrity check.
- No required-checks branch-protection assertion in repo metadata (out of scope for this read-only pass).

### 4.7 Reliability — 8.0 (unchanged)

**Strengths**

- Idempotency markers `[ferry:role:runId]` on every external write.
- Centralised `retry` helper with backoff (`src/lib/io/retry.ts`).
- Spend-cap detection: 4xx classified transient/non-transient.
- `FerryError` taxonomy enables differentiated handling.
- Concurrency mutex per ticket via GitHub Actions.

**Weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- Audit pagination capped at 1000 with no rotation/archival.
- Reconciler depends on the consumer wiring `ferry-reconcile.yml` from the legacy stubs **AND** the missing `reconciler.yml` reusable workflow (see §4.9). End state for a fresh install: reconciler does not run.

### 4.8 Observability — 7.0 (unchanged)

**Strengths**

- Structured JSON logger in production paths (`{level, ts, correlation_id, component, message, ...}`).
- Centralised audit issue with JSON-per-phase lines (ticket, phase, run_id, tokens, cost).
- Correlation by `run_id` / ULID across phases.

**Weaknesses**

- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human (mitigated only when the consumer wires the reconciler).
- Some emitters still pass `correlation_id: ""` (visible in test output) — not all entry points propagate the ID.
- 8 raw `console.log` calls remain under `src/`.

### 4.9 Consumer documentation — 5.5 (-3.0)

The major regression. Three independent install-flow incoherences:

**Weaknesses (P0)**

- **Three competing install patterns coexist in the repo:**
  1. `templates.ts` (what `ferry-init` actually emits): 6 stubs `ferry-{refine,dev,review,iterate,reconciler,audit-daily}.yml`, all pinned to `@v1`. Two of these (`ferry-reconciler.yml`, `ferry-audit-daily.yml`) reference reusable workflows `big-emotion/ferry/.github/workflows/{reconciler,audit-daily}.yml@v1` that **do not exist in `.github/workflows/`**.
  2. `examples/consumer-setup/workflows/` (legacy stubs the README still curls): different file names — `ferry-reconcile.yml`, `ferry-cost-daily.yml` — using `actions/checkout` of the Ferry repo + `npx tsx src/reconciler/run.ts` pattern, pinned to `FERRY_REF: v0.3.0`. These work.
  3. README quick-install (the canonical user-facing doc): says the wizard installs "the 4 consumer workflow stubs", then tells users to additionally `curl` `ferry-reconcile.yml` and `ferry-cost-daily.yml` from `main`. The `ferry-init` wizard actually says (`src/cli/init/index.ts:51`) it installs "6 Ferry workflow stubs". After both steps a consumer ends up with eight workflow files, two of which fail at run time.
- **Secret-naming inconsistency.** README and the actual reusable workflows use `ANTHROPIC_API_KEY` (no `FERRY_` prefix) and do not reference `FERRY_APP_ID` / `FERRY_PRIVATE_KEY`. `ferry-init`, `ferry-doctor`, and `templates.ts` use `FERRY_ANTHROPIC_API_KEY`, `FERRY_APP_ID`, `FERRY_PRIVATE_KEY`. The wizard stores secrets under one set of names, the workflows read from the other set — a fresh install fails secret resolution unless the user manually duplicates.
- README "Operations setup" `curl`s from `main` (mutable). Should pull from a pinned tag.

**Strengths (carried over)**

- `docs/CONFIGURATION.md` is internally consistent and matches the reusable workflow secret names.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.
- `docs/adr/` (5 ADRs, README index) present.
- `docs/RELEASING.md` is up-to-date with the @v0.3.0 / @v1 dual-tag scheme.
- `MIGRATIONS.md` and `CHANGELOG.md` both present at repo root.

### 4.10 Code quality — 8.5 (unchanged)

**Strengths**

- Strict TypeScript NodeNext ESM, `no-explicit-any: error`.
- ESLint with agent-specific rules; restricted-imports verified by test.
- Prettier mandatory and currently clean.
- Layered architecture respected (agents never import Octokit/Jira directly).
- Unit tests next to implementation; lint fixtures isolated under `__lint-fixtures__/`.

**Weaknesses**

- No complexity gates (cyclomatic, max lines).
- No `eslint-plugin-security` or `eslint-plugin-no-secrets`.
- `src/agents/reviewer/review-loop.ts` size still hints at complexity debt.

### 4.11 Traceability / FR governance — 7.5 (unchanged)

**Strengths**

- `docs/REQUIREMENTS.md` is the single source of truth for `FR\d+` IDs.
- `npm run check:fr-drift` (wired into CI lint job) fails the build on undocumented FR tags.
- Five ADRs cover the foundational decisions.
- Audit issue traces every runtime execution.

**Weaknesses**

- No commit-msg lint enforcing FR or issue back-reference.
- No bidirectional code → FR mapping beyond grep.

### 4.12 Operations — 5.5 (unchanged)

**Strengths**

- Reconciler stub `ferry-reconcile.yml` and cost-daily stub `ferry-cost-daily.yml` ship in `examples/consumer-setup/workflows/` (legacy pattern, working).
- `ferry-uninstall` CLI present (#129) — first reversible-deploy path.
- `ferry-update` CLI present (#134) — first migration path.

**Weaknesses**

- No rollback plan documented in a runbook.
- No on-call runbook (`docs/RUNBOOK.md` not yet created).
- No proactive monitoring — audit issue pings nobody.
- The consumer is responsible for actually wiring the reconciler/cost workflow; the broken `ferry-reconciler.yml` / `ferry-audit-daily.yml` from `ferry-init` shadow the legacy ones, doubling the surface and confusion.

### 4.13 Release / distribution — 6.0 (+3.5)

Major progress, but the floating major tag is not yet live.

**Strengths**

- `release.yml` runs full quality gate, publishes `@big-emotion/ferry` to npm with `--provenance`, creates a GitHub Release with notes from `CHANGELOG.md`, and force-pushes the floating major tag via `scripts/retag-major.sh`.
- Tags `v0.2.0` and `v0.3.0` cut on origin.
- `package.json`: `"version": "0.3.0"`, `"publishConfig": { "access": "public" }`, no longer `private: true`.
- `CHANGELOG.md` and `MIGRATIONS.md` present.
- Four CLIs (`ferry-init`, `ferry-doctor`, `ferry-uninstall`, `ferry-update`) shipped under the `bin` field, `npx`-ready.
- `check:bundle` CI job ensures `.ferry/` matches `src/` so a tag carries a consistent payload.

**Weaknesses**

- **Floating `v1` tag does not exist on origin.** The retag step was added to `release.yml` _after_ v0.3.0 was released, so `v1` has never been written. Every `templates.ts` stub emits `@v1` — fresh installs cannot resolve it. **P0 — fix is one line: `git tag -f v1 v0.3.0 && git push --force origin v1`** (or wait for the next release to run `retag-major.sh`).
- No SLSA provenance on the GitHub Release artifact.
- No documented LTS / support window (which majors are supported, when do they EOL).

### 4.14 Cost governance (runtime) — 7.0 (unchanged)

**Strengths**

- `src/cost-governance/daily-check.ts` written and tested.
- `examples/consumer-setup/workflows/ferry-cost-daily.yml` ships as a copy-paste stub (cron `0 6 * * *`); 50% monthly cap → auto-pause via `ferry:paused` label.
- Audit line carries `cost_eur` per execution.

**Weaknesses**

- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.
- The safety net is the consumer copying the stub; nothing validates they did. Worse, if they followed the wizard's `ferry-audit-daily.yml` instead, they got a broken workflow that never runs (see §4.9).

---

## 5. Prioritized action plan (residual)

The list, ordered by what closes the score gap fastest:

| Order | Action                                                                                                                                                                                                                                                                             | Domain                      | Score before | Priority | Effort |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------ | -------- | ------ |
| 1     | Cut floating `v1` tag from `v0.3.0` (`git tag -f v1 v0.3.0 && git push --force origin v1`); from then on, every release runs `retag-major.sh`                                                                                                                                      | Release / distribution      | 6.0          | **P0**   | XS     |
| 2     | Either ship `.github/workflows/{reconciler,audit-daily}.yml` reusable workflows _or_ remove the two scaffolded stubs from `templates.ts` (and `init.ts:51` claim of "6 stubs")                                                                                                     | Consumer docs / Reliability | 5.5 / 8.0    | **P0**   | M      |
| 3     | Reconcile secret-naming convention: pick one set of names — `ANTHROPIC_API_KEY` / no GitHub App (matches reusable workflows) **or** `FERRY_*` / GitHub App (matches `ferry-init` / `ferry-doctor`) — and align all four surfaces (README, templates.ts, secrets.ts, doctor checks) | Consumer docs               | 5.5          | **P0**   | M      |
| 4     | Replace README `curl .../main/...` operations curls with `curl .../v0.3.0/...` (or generate them via `ferry-init` and remove the curl step entirely)                                                                                                                               | Supply chain                | 7.5          | **P1**   | S      |
| 5     | Extend `src/install-guide.test.ts` to invoke `workflowTemplates()` and assert each emitted stub references a reusable workflow that exists in `.github/workflows/` and a tag that exists on origin                                                                                 | E2E                         | 8.0          | **P1**   | S      |
| 6     | Reconcile the `ferry-reconcile.yml` (legacy stub) ↔ `ferry-reconciler.yml` (init-emitted stub) duplication — one canonical name, one canonical mechanism                                                                                                                           | Consumer docs               | 5.5          | **P1**   | S      |
| 7     | Audit-issue rotation when comments approach the 1000-comment cap                                                                                                                                                                                                                   | Reliability                 | 8.0          | **P1**   | M      |
| 8     | Add `harden-runner` egress allowlist to dev/iterate workflows                                                                                                                                                                                                                      | GH Actions                  | 7.5          | **P1**   | S      |
| 9     | On-call runbook (`docs/RUNBOOK.md`): stalled ticket, cost spike, agent loop runaway                                                                                                                                                                                                | Operations                  | 5.5          | **P2**   | M      |
| 10    | OSSF Scorecard + SLSA provenance on the GitHub Release artifact                                                                                                                                                                                                                    | Supply chain                | 7.5          | **P2**   | M      |
| 11    | Migrate `GITHUB_TOKEN` to a fine-grained GitHub App with least-privilege scopes (or remove the App provisioning from `ferry-init`)                                                                                                                                                 | GH Actions                  | 7.5          | **P2**   | L      |

### 5.1 Expected score after the plan

| Domain                  | Current | After P0 | After P0+P1 | After all |
| ----------------------- | ------- | -------- | ----------- | --------- |
| Application security    | 8.5     | 8.5      | 8.5         | 9.0       |
| Supply-chain security   | 7.5     | 8.0      | 8.5         | 9.0       |
| GitHub Actions security | 7.5     | 7.5      | 8.5         | 9.0       |
| Tests & coverage        | 8.0     | 8.0      | 8.0         | 8.0       |
| E2E / acceptance        | 8.0     | 8.0      | 8.5         | 8.5       |
| CI/CD gates             | 9.0     | 9.0      | 9.0         | 9.0       |
| Reliability             | 8.0     | 8.5      | 8.5         | 8.5       |
| Observability           | 7.0     | 7.0      | 7.0         | 7.5       |
| Consumer documentation  | 5.5     | 8.5      | 9.0         | 9.0       |
| Code quality            | 8.5     | 8.5      | 8.5         | 8.5       |
| Traceability            | 7.5     | 7.5      | 7.5         | 7.5       |
| Operations              | 5.5     | 6.0      | 6.0         | 7.5       |
| Release / distribution  | 6.0     | 8.5      | 8.5         | 9.0       |
| Cost governance         | 7.0     | 7.0      | 7.5         | 8.0       |
| **Overall**             | **7.4** | **7.96** | **8.21**    | **8.50**  |

P0 alone is sufficient to clear the 8.0 / 10 bar.

---

## 6. What changed since the previous audit (7.2 → 7.4)

| #   | Action (prev. audit)                                                                | Status                          | Evidence                                                                                  |
| --- | ----------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Cut tag `v0.1.0`, lift `private: true`, add release workflow                        | **done** (as `v0.2.0`/`v0.3.0`) | tags exist on origin; `release.yml` runs full gate + npm publish + retag                  |
| 2   | Replace `ferry-*@main` with a release tag                                           | **done**                        | all four agent workflows reference `@v0.3.0`                                              |
| 3   | Add `CHANGELOG.md` (Keep a Changelog format)                                        | **done**                        | `CHANGELOG.md` and `MIGRATIONS.md` present at repo root                                   |
| 4   | Audit-issue rotation when comments approach the 1000-comment cap                    | open                            | still capped silently                                                                     |
| 5   | Add `harden-runner` egress allowlist                                                | open                            | not present                                                                               |
| 6   | E2E idempotency replay (same `event_id` twice → same outcome)                       | open                            | not present                                                                               |
| 7   | `octokit.rest.pulls.merge` lint ban + test for the no-auto-merge invariant          | **done** (test)                 | `src/e2e/pipeline.test.ts:377`                                                            |
| 8   | On-call runbook                                                                     | open                            | not present                                                                               |
| 9   | OSSF Scorecard + SLSA provenance                                                    | partial                         | npm provenance yes, GH release no, Scorecard no                                           |
| 10  | Migrate `GITHUB_TOKEN` to fine-grained GitHub App                                   | partial                         | wizard provisions one but workflows do not consume it                                     |
| —   | New: `ferry-uninstall` CLI                                                          | **landed** (#129)               | `src/cli/uninstall/`                                                                      |
| —   | New: `ferry-update` CLI                                                             | **landed** (#134)               | `src/cli/update/`                                                                         |
| —   | New: `ferry-init` collects Jira workspace ARI + project ID                          | **landed** (#126)               | `src/cli/init/steps/jira-resolve.ts`                                                      |
| —   | New: `ferry-init` Jira automation bundle schema fixed                               | **landed** (#127)               | `src/cli/init/steps/jira-bundle.ts`                                                       |
| —   | New: `ferry-init` Jira status names configurable                                    | **landed** (#132)               | `src/cli/init/steps/jira-bundle.ts`                                                       |
| —   | New: install/lifecycle docs rewritten (#131, #135)                                  | **landed**                      | `README.md` quick-install, `MIGRATIONS.md`                                                |
| —   | **Regression:** `ferry-init` emits `@v1` stubs but `v1` tag not yet published       | **introduced** (#133)           | `src/cli/init/templates.ts`, `git ls-remote --tags`                                       |
| —   | **Regression:** two scaffolded stubs reference reusable workflows that do not exist | **introduced** (#133)           | `templates.ts:151,173`, `ls .github/workflows/`                                           |
| —   | **Regression:** secret-naming drift between wizard/doctor and reusable workflows    | **introduced**                  | `templates.ts` headers vs `dev.yml:68` (`ANTHROPIC_API_KEY` vs `FERRY_ANTHROPIC_API_KEY`) |

---

## 7. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §5 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
