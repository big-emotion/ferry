# Production-Readiness Audit — Ferry

**Date:** 2026-05-02
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria, post-`v0.4.0` release.
**Verdict:** **7.9 / 10 — production-ready for pilot consumers; the install flow runs end-to-end and the release pipeline is proven.**
**Target:** **8–9 / 10**, addressed by the residual P1 items in §5.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (962 tests passing), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`. Recent run history via `gh run list`.
- **Release artifacts:** `git ls-remote --tags origin`, `npm view @big-emotion/ferry version`.
- **Docs:** `README.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes — for pilot consumers.** All three P0 install-flow blockers from the previous audit have been closed by `cd10e8c` + the `v0.4.0` release: (i) the floating `v1` tag now exists on origin (`43749a2`, force-pushed by `retag-major.sh` as the last step of `release.yml`); (ii) `templates.ts` no longer emits the two broken stubs that referenced non-existent reusable workflows; (iii) the `ANTHROPIC_API_KEY` secret-naming drift between `ferry-init`/`ferry-doctor` and the reusable workflows is gone. `release.yml` ran end-to-end on the v0.4.0 tag push: full CI gate green, npm publish with provenance succeeded (`npm view @big-emotion/ferry version` → `0.4.0`), GitHub Release created from `CHANGELOG.md [0.4.0]`, and `retag-major.sh` retagged `v1`. Remaining gaps are all P1/P2 hardening — none block a pilot install.
2. **Can a consumer install and reach the full Jira → PR-approved cycle?** **Yes.** A user running `npx -p @big-emotion/ferry@0.4.0 ferry-init` today gets four working stubs (`ferry-{refine,dev,review,iterate}.yml`) all pinned to `@v0.4.0` (which exists on origin and resolves cleanly). `ferry-doctor` now checks all 8 required secrets including the two transition IDs. The README's Operations setup curls `ferry-reconcile.yml` and `ferry-cost-daily.yml` from `/v0.4.0/` (no longer mutable `main`). The three FR auto-transitions (FR18 / FR24 / FR28) are exercised by `src/e2e/pipeline.test.ts` (11 describe blocks, 437 LOC). The `MIGRATIONS.md` `v0.3.x → v0.4.0` section documents the two `(action)` items existing installs need to apply.
3. **Security posture?** Strong. Strict AJV schema validation; all shell calls use `execFileSync` with argv-as-array (no shell strings); the only `spawn` (`tools.ts:357`) also passes argv as an array. CodeQL + npm audit (clean, 0 vulns) + gitleaks (configured + run before every dev-agent commit) wired in CI. Every workflow job has an explicit `permissions:` block. All third-party actions pinned by SHA. Internal Ferry composite-action references are pinned to `@v0.4.0` (no `@main` self-references). `@octokit/rest` and Jira imports are forbidden under `src/agents/**` (lint rule + dedicated test). The "Ferry never merges" invariant is asserted by the e2e pipeline test (`pipeline.test.ts:377`). Recent CI: Release ✓, CodeQL ✓, Ferry — CI ✓ (latest 5 runs all green). Defense-in-depth gaps remain — no `harden-runner` egress allowlist, no SLSA provenance on the GitHub Release artifact (npm publish has it).
4. **Is the score close to 8–9/10?** Computed score is **7.9** (vs. 7.4 last audit, vs. 7.2 two audits ago). All three P0s closed. Top three actions to clear 8.5: (i) audit-issue rotation when comments approach the 1000-comment cap, (ii) on-call runbook (`docs/RUNBOOK.md`) covering stalled tickets / cost spikes / agent-loop runaway, (iii) `harden-runner` egress allowlist on the dev/iterate workflows.

---

## 2. Overall score — **7.9 / 10**

Movement since the previous audit (7.4): the install-flow regression is fully resolved, release pipeline proven end-to-end on a real tag push.

Quality gates at audit time (all green):

- `npm run typecheck` — clean (`@big-emotion/ferry@0.4.0`)
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 83 files / **962 tests** / 100% passing in 1.8s
- `npm audit` (moderate+) — 0 vulnerabilities (332 deps total)
- TODO/FIXME/XXX/HACK count under `src/` — 3
- Recent CI: Release ✓, CodeQL ✓, Ferry — CI ✓

Release artifacts proven:

- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, **`v1`** (floating major, points at `43749a2`)
- `@big-emotion/ferry@0.4.0` published to npm with provenance
- GitHub Release v0.4.0 created with notes from `CHANGELOG.md`
- `release.yml` exercised on a live tag push for the first time, all 11 steps green
- `retag-major.sh` exercised for the first time — `v1` now exists

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. prev | Trend  |
| --- | ---------------------------------- | ------------ | ---------- | ------ |
| 1   | Application security               | **8.5 / 10** | 0          | strong |
| 2   | Supply-chain security              | **8.5 / 10** | +1.0       | strong |
| 3   | GitHub Actions security            | **7.5 / 10** | 0          | strong |
| 4   | Tests & coverage                   | **8.0 / 10** | 0          | strong |
| 5   | E2E / acceptance tests             | **8.0 / 10** | 0          | strong |
| 6   | CI/CD gates                        | **9.0 / 10** | 0          | strong |
| 7   | Reliability (idempotency, retries) | **8.0 / 10** | 0          | strong |
| 8   | Observability / audit              | **7.0 / 10** | 0          | medium |
| 9   | Consumer documentation             | **8.5 / 10** | +3.0       | strong |
| 10  | Code quality / typing              | **8.5 / 10** | 0          | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0          | strong |
| 12  | Operations / runbooks / rollback   | **5.5 / 10** | 0          | medium |
| 13  | Release / distribution             | **9.0 / 10** | +3.0       | strong |
| 14  | Cost governance (runtime)          | **7.0 / 10** | 0          | medium |

Mean = **7.89 / 10** → reported as **7.9**.

---

## 4. Domain analysis

### 4.1 Application security — 8.5 (unchanged)

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- All shell calls use `execFileSync` with argv-as-array. The single `spawn` (`src/agents/developer/tools.ts:357`) also passes args as an array.
- `FerryError` taxonomy with typed codes (`state-invariant`, `spend-cap`, `transient`, `unknown`).
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit (`src/lib/agent-runtime/secret-scan.ts`); never includes raw stdout/stderr in error messages.
- `@typescript-eslint/no-explicit-any: 'error'` plus `no-restricted-imports` for agent code (verified via `src/agents/restricted-imports.test.ts`).
- "Ferry never merges" invariant is asserted by `src/e2e/pipeline.test.ts:377` ("never calls octokit.rest.pulls.merge").

**Weaknesses**

- LLM-supplied `commit_message` reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 8.5 (+1.0)

The supply-chain self-replication risk is fully closed.

**Strengths — tag-pin consistency table is fully clean:**

| Location                                                                         | Pin                                    | Status    |
| -------------------------------------------------------------------------------- | -------------------------------------- | --------- |
| `package.json` `.version`                                                        | `0.4.0`                                | canonical |
| `.github/workflows/{refine,dev,review,iterate}.yml`                              | `@v0.4.0`                              | match     |
| `.github/actions/*/action.yml` setup-node SHAs                                   | SHA                                    | pinned    |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.4.0`                              | match     |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.4.0`                               | match     |
| `docs/RELEASING.md`                                                              | `@v0.4.0`                              | match     |
| `docs/adr/0002-ferry-bundles-committed.md`                                       | `@v0.4.0`                              | match     |
| `README.md` SHA-pinning recipe + ops curl URLs                                   | `@v0.4.0` / `/v0.4.0/`                 | match     |
| `src/install-guide.test.ts`                                                      | `@v0.4.0`                              | match     |
| `git ls-remote --tags origin`                                                    | `v0.2.0`, `v0.3.0`, `v0.4.0`, **`v1`** | exist     |
| `npm @big-emotion/ferry`                                                         | `0.4.0`                                | published |

- **CodeQL SAST wired** (`.github/workflows/codeql.yml`) — recent run green.
- **`audit:ci` job in CI** (`scripts/npm-audit-check.mjs`).
- **Bundle-drift check in CI** (`check-bundle` job): rebuilds `.ferry/` from `src/` and fails if the diff is non-empty.
- Third-party actions pinned by SHA with version comments.
- gitleaks tarball pinned by SHA256 in `ferry-ci.yml`.
- `npm audit` clean (0 across all severities).
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped.
- **`scripts/retag-major.sh` proven** — `v1` now points at `43749a2` (the v0.4.0 commit). The first execution of the retag step in `release.yml` succeeded.
- npm publish uses `--provenance --access public`.

**Weaknesses**

- No SLSA provenance attestation on the GitHub Release artifact (npm publish has it; the GH release does not).
- No SBOM, no OSSF Scorecard.
- README's `curl` for ops stubs still pulls from a tag (good) but is a manual step — `ferry-init` could scaffold these directly to remove the curl entirely (P2).

### 4.3 GitHub Actions security — 7.5 (unchanged)

**Strengths**

- Explicit `permissions:` blocks on every job across `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`, `ferry-ci.yml`, `release.yml`, `codeql.yml`.
- Concurrency groups per ticket prevent races; `cancel-in-progress: false` on writes (dev/iterate), `true` on read-only (refine/review).
- Fallback `'ferry-invalid-payload-sinkhole'` blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.
- `release.yml` uses `id-token: write` only for npm provenance.

**Weaknesses**

- `GITHUB_TOKEN` used by reusable workflows instead of a fine-grained GitHub App. `ferry-init` provisions a GitHub App and stores `FERRY_APP_ID`/`FERRY_PRIVATE_KEY` secrets, but the reusable workflows never reference those secrets and use `github.token` directly. Either remove the App provisioning from the wizard or wire the App token through to the agent calls (P2).
- No `harden-runner` (StepSecurity) for egress allowlisting on the dev/iterate workflows that perform git push (P1).
- No OIDC for federated auth to Anthropic / Jira.
- Audit issue rotation: capped at `MAX_PAGES * 100 = 1000` comments, then silently fails (P1).

### 4.4 Tests & coverage — 8.0 (unchanged)

| Metric  | Status                                          |
| ------- | ----------------------------------------------- |
| Suite   | 83 files / **962 tests** / all passing in 1.8 s |
| Reports | text, text-summary, html, lcov                  |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`     |

**Strengths**

- Test count steady at 962 across the audit cycle (no regressions).
- Coverage threshold uniform at 75% across statements/branches/functions/lines.
- CLI module coverage closed: every check in `cli/doctor/checks/*` has a sibling `.test.ts`.
- Composite-action entrypoints (`*-action.ts`) and CLI bin entrypoints excluded from coverage with documented reason.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 8.0 (unchanged)

**Strengths**

- **Mocked end-to-end pipeline test** at `src/e2e/pipeline.test.ts` replays refine→dev→review→iterate, asserts the no-auto-merge invariant (line 377), and exercises FR18/FR24/FR28.
- **Install-guide acceptance test** at `src/install-guide.test.ts` (70 tests) covers 18 sections of the README — secret names, reusable-workflow refs, `@v0.4.0` pin, FR mentions, `event_id` schema match, audit-issue creation, smoke-test wording, no `@main` in internal workflows (issue #77 gate), ops stubs, bundle-drift CI gate, npm audit step.
- FR drift detector (`scripts/check-fr-drift.sh`) wired into CI lint job.
- The release pipeline itself (`release.yml`) is now empirically validated end-to-end by the v0.4.0 push.

**Weaknesses**

- No idempotency assertion across a full replay of the same `event_id` against the same audit issue.
- **Install-guide test does not cover what `ferry-init` actually scaffolds.** It validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts`. The previous audit's broken-stub regression slipped past this gap; adding an assertion would close it (P1).

### 4.6 CI/CD gates — 9.0 (unchanged)

**Strengths**

- Six parallel CI jobs in `ferry-ci.yml`: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `check-bundle`, `audit`; plus the gitleaks workflow, the CodeQL workflow, and the release workflow gate.
- `release.yml` runs typecheck + lint + format + tests + audit + bundle-drift before npm publish.
- All actions in CI pinned by SHA.
- Concurrency cancels superseded CI runs on the same branch.
- Husky pre-push hook re-runs the full suite locally before any push.
- Recent runs: Release ✓, CodeQL ✓, Ferry — CI ✓, Ferry — CI ✓, CodeQL ✓.

**Weaknesses**

- No `npm ci --audit-signatures` integrity check.
- No required-checks branch-protection assertion in repo metadata (push to `main` from local commit went through with a CodeQL "waiting for results" advisory; ideally protected refs would block until checks complete).

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
- Reconciler depends on the consumer wiring `ferry-reconcile.yml` from the working stub.

### 4.8 Observability — 7.0 (unchanged)

**Strengths**

- Structured JSON logger in production paths (`{level, ts, correlation_id, component, message, ...}`).
- Centralised audit issue with JSON-per-phase lines.
- Correlation by `run_id` / ULID across phases.

**Weaknesses**

- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human (mitigated only when the consumer wires the reconciler).
- Some emitters still pass `correlation_id: ""` (visible in test output) — not all entry points propagate the ID.
- 8 raw `console.log` calls remain under `src/`.

### 4.9 Consumer documentation — 8.5 (+3.0)

The major recovery. All install-flow incoherences from the previous audit are resolved.

**Strengths**

- `ferry-init` emits exactly 4 working stubs; all pin to `@v0.4.0`; all reusable workflows referenced exist on origin.
- The `ANTHROPIC_API_KEY` secret naming is consistent across README, reusable workflows, `ferry-init`, `ferry-doctor`, and `ferry-uninstall`.
- `ferry-doctor` now checks for `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID` (8 required secrets total), so a partial install is flagged rather than silently broken.
- README's "Operations setup" curls `ferry-reconcile.yml` and `ferry-cost-daily.yml` from `/v0.4.0/` (immutable tag, not mutable `main`).
- `MIGRATIONS.md` `v0.3.x → v0.4.0` section documents the two `(action)` items existing installs must apply (rename `FERRY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY`; delete stale `ferry-{reconciler,audit-daily}.yml`).
- `docs/CONFIGURATION.md` is internally consistent with the reusable workflows.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.
- `docs/adr/` (5 ADRs, README index) present.
- `docs/RELEASING.md` up-to-date with the @v0.4.0 / @v1 dual-tag scheme.
- `CHANGELOG.md [0.4.0]` is the source of truth for the GitHub Release notes (auto-extracted by `release.yml`).

**Weaknesses**

- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` instead (P2).
- No on-call runbook (`docs/RUNBOOK.md`).
- `templates.ts`-emitted stub headers say "Required secrets: ... ANTHROPIC_API_KEY" but the wizard does not collect or set transition IDs; the README does. Cross-checking these in the wizard would close the last hole.

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

- Reconciler stub `ferry-reconcile.yml` and cost-daily stub `ferry-cost-daily.yml` ship in `examples/consumer-setup/workflows/`, pinned to `v0.4.0`.
- `ferry-uninstall` CLI present (#129) — first reversible-deploy path.
- `ferry-update` CLI present (#134) — first migration path; reads `MIGRATIONS.md` and prints required actions.

**Weaknesses (unchanged from previous audit)**

- No rollback plan documented in a runbook.
- No on-call runbook (`docs/RUNBOOK.md` not yet created) — **the highest-leverage P1**.
- No proactive monitoring — audit issue pings nobody.

### 4.13 Release / distribution — 9.0 (+3.0)

The major upgrade. Release pipeline now empirically proven on a live tag push.

**Strengths**

- `release.yml` runs full quality gate, publishes `@big-emotion/ferry` to npm with `--provenance`, creates a GitHub Release with notes from `CHANGELOG.md`, and force-pushes the floating `v1` tag via `scripts/retag-major.sh`. **All 11 steps green on the v0.4.0 push.**
- Tags on origin: `v0.2.0`, `v0.3.0`, **`v0.4.0`**, **`v1`** (floating). `v1` was created for the first time by `retag-major.sh` at the end of the v0.4.0 release.
- npm: `@big-emotion/ferry@0.4.0` published with provenance.
- `package.json`: `"version": "0.4.0"`, `"publishConfig": { "access": "public" }`.
- `CHANGELOG.md` and `MIGRATIONS.md` present and feed the release pipeline.
- Four CLIs (`ferry-init`, `ferry-doctor`, `ferry-uninstall`, `ferry-update`) shipped under the `bin` field.
- `check:bundle` CI job ensures `.ferry/` matches `src/` so a tag carries a consistent payload.

**Weaknesses**

- No SLSA provenance on the GitHub Release artifact (npm publish has it).
- No documented LTS / support window.

### 4.14 Cost governance (runtime) — 7.0 (unchanged)

**Strengths**

- `src/cost-governance/daily-check.ts` written and tested.
- `examples/consumer-setup/workflows/ferry-cost-daily.yml` ships as a copy-paste stub (cron `0 6 * * *`); 50% monthly cap → auto-pause via `ferry:paused` label.
- Audit line carries `cost_eur` per execution.

**Weaknesses**

- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.
- The safety net is the consumer copying the stub; nothing validates they did.

---

## 5. Prioritized action plan (residual)

The list, ordered by what closes the score gap fastest:

| Order | Action                                                                                                                          | Domain        | Score before | Priority | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- | ------ |
| 1     | On-call runbook (`docs/RUNBOOK.md`): stalled ticket, cost spike, agent-loop runaway, rollback procedure                         | Operations    | 5.5          | **P1**   | M      |
| 2     | Audit-issue rotation when comments approach the 1000-comment cap (instead of failing silently)                                  | Reliability   | 8.0          | **P1**   | M      |
| 3     | Add `harden-runner` egress allowlist to dev/iterate workflows                                                                   | GH Actions    | 7.5          | **P1**   | S      |
| 4     | Extend `src/install-guide.test.ts` to invoke `workflowTemplates()` and assert each emitted stub's reusable-workflow + tag exist | E2E           | 8.0          | **P1**   | S      |
| 5     | Add e2e idempotency replay (same `event_id` twice → same outcome, no duplicate writes)                                          | E2E           | 8.0          | **P1**   | M      |
| 6     | `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the README curl step)                    | Consumer docs | 8.5          | **P2**   | S      |
| 7     | `ferry-init` collects the two transition IDs and sets them as secrets (currently a manual README step)                          | Consumer docs | 8.5          | **P2**   | S      |
| 8     | OSSF Scorecard + SLSA provenance on the GitHub Release artifact                                                                 | Supply chain  | 8.5          | **P2**   | M      |
| 9     | Migrate `GITHUB_TOKEN` to a fine-grained GitHub App (or remove the App provisioning from `ferry-init`)                          | GH Actions    | 7.5          | **P2**   | L      |
| 10    | Branch-protection on `main` requiring CodeQL / Ferry — CI / Release checks before merge                                         | CI/CD         | 9.0          | **P2**   | XS     |

### 5.1 Expected score after the plan

| Domain                  | Current | After P1 | After P1+P2 |
| ----------------------- | ------- | -------- | ----------- |
| Application security    | 8.5     | 8.5      | 9.0         |
| Supply-chain security   | 8.5     | 8.5      | 9.0         |
| GitHub Actions security | 7.5     | 8.5      | 9.0         |
| Tests & coverage        | 8.0     | 8.0      | 8.0         |
| E2E / acceptance        | 8.0     | 8.5      | 8.5         |
| CI/CD gates             | 9.0     | 9.0      | 9.5         |
| Reliability             | 8.0     | 8.5      | 8.5         |
| Observability           | 7.0     | 7.5      | 7.5         |
| Consumer documentation  | 8.5     | 8.5      | 9.0         |
| Code quality            | 8.5     | 8.5      | 8.5         |
| Traceability            | 7.5     | 7.5      | 7.5         |
| Operations              | 5.5     | 7.5      | 7.5         |
| Release / distribution  | 9.0     | 9.0      | 9.5         |
| Cost governance         | 7.0     | 7.0      | 8.0         |
| **Overall**             | **7.9** | **8.21** | **8.50**    |

P1 alone is sufficient to clear the 8.0 / 10 bar.

---

## 6. What changed since the previous audit (7.4 → 7.9)

| #   | Action (prev. audit P0/P1)                                                                                            | Status              | Evidence                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Cut floating `v1` tag from the latest release                                                                         | **done**            | `git ls-remote --tags origin` → `v1` → `43749a2` (force-pushed by `retag-major.sh` on the v0.4.0 push)        |
| 2   | Either ship the missing `reconciler.yml` / `audit-daily.yml` reusable workflows or remove the broken scaffolded stubs | **done** (option B) | `src/cli/init/templates.ts` emits 4 stubs (down from 6); `init.test.ts` assertion updated                     |
| 3   | Reconcile secret-naming convention                                                                                    | **done**            | `secrets.ts` sets `ANTHROPIC_API_KEY`; `doctor/checks/secrets.ts` requires it; `templates.ts` headers updated |
| 4   | Pin README `curl` URLs to a tag instead of `main`                                                                     | **done**            | `README.md` ops curl URLs point to `/v0.4.0/`                                                                 |
| 5   | Extend `src/install-guide.test.ts` to assert `workflowTemplates()` output                                             | open                | unchanged — still tests `examples/consumer-setup/workflows/` only                                             |
| 6   | Audit-issue rotation                                                                                                  | open                | still capped silently                                                                                         |
| 7   | `harden-runner` egress allowlist                                                                                      | open                | not present                                                                                                   |
| 8   | E2E idempotency replay                                                                                                | open                | not present                                                                                                   |
| 9   | On-call runbook                                                                                                       | open                | not present                                                                                                   |
| —   | New: v0.4.0 release executed end-to-end                                                                               | **landed**          | Release run: `success`; npm `@big-emotion/ferry@0.4.0` published; GH Release created; `v1` retag worked       |
| —   | New: `MIGRATIONS.md` `v0.3.x → v0.4.0` documents the two `(action)` items for existing installs                       | **landed**          | `MIGRATIONS.md`                                                                                               |
| —   | New: `ferry-doctor` checks 8 secrets including the two transition IDs                                                 | **landed**          | `src/cli/doctor/checks/secrets.ts` `REQUIRED_SECRETS`                                                         |

---

## 7. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §5 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
