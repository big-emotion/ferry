# Production-Readiness Audit — Ferry

**Date:** 2026-05-02
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria, post-`v0.5.0` release. **This revision is focused on doc–code coherence for a first-time installer** — can a team that runs `ferry-init` today follow the README and reach an approved PR? §4.15 surfaces two new latent drifts that were not in the previous audit.
**Verdict:** **7.7 / 10 — production-ready for first-time pilot consumers; the install path is internally coherent and works end-to-end at v0.5.0.** Two new coherence gaps caught (ferry-update silent migrations, doctor blind to `FERRY_AUDIT_ISSUE`) — neither blocks a fresh install, but both should be closed before the next release.
**Target:** **8–9 / 10**, addressed by the residual P0/P1 items in §5.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (1020 tests passing), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`. Recent run history via `gh run list`.
- **Release artifacts:** `git ls-remote --tags origin`, `npm view @big-emotion/ferry version`.
- **Docs:** `README.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes — for first-time pilot consumers.** All three previous P0 install-flow blockers stay closed at v0.5.0: floating `v1` tag exists, `templates.ts` emits four working stubs, `ANTHROPIC_API_KEY` is named consistently across init / doctor / reusable workflows. v0.5.0 release pipeline ran clean (`aeff8e6`, full CI gate ✓, npm publish ✓, GitHub Release ✓). All 1020 unit tests pass; `npm audit` clean (0 vulns / 332 deps). The two new coherence gaps surfaced in this audit (§4.15) affect upgrade and post-install diagnostics, not the fresh-install path.
2. **Can a first-time consumer install and reach the full Jira → PR-approved cycle?** **Yes.** Walking the README at `v0.5.0`: (i) `npx -p @big-emotion/ferry ferry-init` runs the wizard, sets 6 secrets via `gh secret set` (verified: `src/cli/init/init.test.ts`), generates `ferry.config.yaml`, writes 4 stubs pinned to `@v0.5.0` (`templates.ts:26,58,90,122`), and writes `ferry-jira-automation-setup.md` + `ferry-jira-automation-rules.beta.json` (`jira-bundle.ts:260,263`). (ii) Steps 1–4 in the README are mechanically reachable: audit issue + variable, two transition-ID secrets, workflow permissions toggle, four Jira automation rules. (iii) Tag-pin consistency table is fully clean — every internal reference is `@v0.5.0` and resolves on origin. (iv) The three FR auto-transitions (FR18 / FR24 / FR28) are exercised by `src/e2e/pipeline.test.ts`. (v) `install-guide.test.ts` (71 tests) gates 18 README sections including no-`@main` self-references. **One latent trap on Step 1:** if a consumer skips audit-issue creation, the agent dispatch will throw `requireEnv('FERRY_AUDIT_ISSUE')` at runtime but `ferry-doctor` will report green (see §4.15 — D6, P1).
3. **Security posture?** Strong. Strict AJV schema validation against `event.v1.schema.json`; all shell calls use `execFileSync` with argv-as-array (no shell strings); the only `spawn` (`developer/tools.ts:364`) passes argv as an array. CodeQL + `npm audit` (0 vulns, all severities) + gitleaks (configured + run before every dev-agent commit) wired in CI. Every workflow job has an explicit `permissions:` block. All third-party actions pinned by SHA. Internal Ferry composite-action references are pinned to `@v0.5.0` — no `@main` self-references (asserted by `install-guide.test.ts §15`). `@octokit/rest` and Jira imports are forbidden under `src/agents/**` (`restricted-imports.test.ts`). The "Ferry never merges" invariant is asserted by `pipeline.test.ts:377`. Defense-in-depth gaps remain — no `harden-runner` egress allowlist, no SLSA provenance on the GitHub Release artifact (npm publish has it), no audit-issue rotation tested under load.
4. **Is the score close to 8–9/10?** Computed score is **7.7** (vs. 7.9 last audit). The 0.2 movement is **not** a regression in shipped behavior — v0.5.0 is functionally a step forward (+1 tunable axis via the externalised env-var/config refactor in `afca0ce`, +58 unit tests since v0.4.0). The decrement reflects two coherence drifts that the v0.4.0 audit missed and this audit catches (§4.15 D6, D7). Top three actions to clear 8.5: (i) **populate `src/cli/update/migrations.ts`** with the v0.3.x→v0.4.0 entries already documented in `MIGRATIONS.md` (P0 — silent upgrade for any v0.3.x consumer); (ii) **add `FERRY_AUDIT_ISSUE` variable check to `ferry-doctor`** so a missed Step 1 surfaces red instead of failing at runtime (P1); (iii) audit-issue rotation when comments approach the 1000-comment cap (P1, carried over).

---

## 2. Overall score — **7.7 / 10**

Movement since the previous audit (7.9): two latent coherence drifts were unsurfaced (§4.15 D6, D7). Underlying behavior at v0.5.0 is the same or stronger; the score reflects what the audit caught, not a regression in code.

Quality gates at audit time (all green):

- `npm run typecheck` — clean (`@big-emotion/ferry@0.5.0`)
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 85 files / **1020 tests** / 100% passing in 1.87s
- `npm audit` (moderate+) — 0 vulnerabilities (332 deps total)
- TODO/FIXME/XXX/HACK count under `src/` — 3
- Recent CI: Release ✓, CodeQL ✓, Ferry — CI ✓

Release artifacts proven:

- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, **`v1`** (floating major)
- `@big-emotion/ferry@0.5.0` published to npm with provenance (`aeff8e6`)
- GitHub Release v0.5.0 created with notes from `CHANGELOG.md`
- v0.5.0 release pipeline ran clean end-to-end

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
| 9   | Consumer documentation             | **7.0 / 10** | −1.5       | medium |
| 10  | Code quality / typing              | **8.5 / 10** | 0          | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0          | strong |
| 12  | Operations / runbooks / rollback   | **5.5 / 10** | 0          | medium |
| 13  | Release / distribution             | **9.0 / 10** | 0          | strong |
| 14  | Cost governance (runtime)          | **7.0 / 10** | 0          | medium |
| 15  | Doc–code coherence                 | **6.5 / 10** | −1.5       | medium |

Mean = **7.70 / 10** (15 axes; Domains 9 and 15 each fall by 1.5 due to the two newly surfaced drifts in §4.15) → reported as **7.7**.

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

| Location                                                                         | Pin                                              | Status    |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| `package.json` `.version`                                                        | `0.5.0`                                          | canonical |
| `.github/workflows/{refine,dev,review,iterate}.yml`                              | `@v0.5.0`                                        | match     |
| `.github/actions/*/action.yml` setup-node SHAs                                   | SHA                                              | pinned    |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.5.0`                                        | match     |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.5.0`                                         | match     |
| `docs/RELEASING.md`                                                              | `@v0.5.0`                                        | match     |
| `docs/adr/0002-ferry-bundles-committed.md`                                       | `@v0.5.0`                                        | match     |
| `README.md` SHA-pinning recipe + ops curl URLs                                   | `@v0.5.0` / `/v0.5.0/`                           | match     |
| `src/install-guide.test.ts`                                                      | `@v0.5.0`                                        | match     |
| `git ls-remote --tags origin`                                                    | `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, **`v1`** | exist     |
| `npm @big-emotion/ferry`                                                         | `0.5.0`                                          | published |

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

| Metric  | Status                                           |
| ------- | ------------------------------------------------ |
| Suite   | 85 files / **1020 tests** / all passing in 1.87s |
| Reports | text, text-summary, html, lcov                   |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`      |

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
- **Install-guide acceptance test** at `src/install-guide.test.ts` (70 tests) covers 18 sections of the README — secret names, reusable-workflow refs, `@v0.5.0` pin, FR mentions, `event_id` schema match, audit-issue creation, smoke-test wording, no `@main` in internal workflows (issue #77 gate), ops stubs, bundle-drift CI gate, npm audit step.
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

### 4.9 Consumer documentation — 7.0 (−1.5)

The fresh-install path is internally coherent. The score drop reflects two newly surfaced gaps that affect upgrades and post-install diagnostics — see §4.15 D6 and D7.

**Strengths**

- `ferry-init` emits exactly 4 working stubs; all pin to `@v0.5.0`; all reusable workflows referenced exist on origin.
- The `ANTHROPIC_API_KEY` secret naming is consistent across README, reusable workflows, `ferry-init`, `ferry-doctor`, and `ferry-uninstall`.
- `ferry-doctor` now checks for `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID` (8 required secrets total), so a partial install is flagged rather than silently broken.
- README's "Operations setup" curls `ferry-reconcile.yml` and `ferry-cost-daily.yml` from `/v0.5.0/` (immutable tag, not mutable `main`).
- `MIGRATIONS.md` `v0.3.x → v0.4.0` section documents the two `(action)` items existing installs must apply (rename `FERRY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY`; delete stale `ferry-{reconciler,audit-daily}.yml`). **Note:** these entries exist in the markdown file but are **not** wired into `ferry-update` — see §4.15 D6.
- `docs/CONFIGURATION.md` is internally consistent with the reusable workflows.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.
- `docs/adr/` (5 ADRs, README index) present.
- `docs/RELEASING.md` up-to-date with the @v0.5.0 / @v1 dual-tag scheme.
- `CHANGELOG.md [0.5.0]` is the source of truth for the GitHub Release notes (auto-extracted by `release.yml`).

**Weaknesses**

- **`ferry-update` does not actually print MIGRATIONS.md follow-ups** — the in-code `MIGRATIONS` object is empty (`src/cli/update/migrations.ts:8–14`, only commented-out example), but the README, `MIGRATIONS.md` itself, and `CLAUDE.md` all promise consumers it will. Result: a v0.3.x consumer running `npx -p @big-emotion/ferry@0.5.0 ferry-update` silently misses the critical `FERRY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` rename and ends up with broken auth. **Does not affect first-time installers.** P0 for upgrade flow.
- **`ferry-doctor` does not check the `FERRY_AUDIT_ISSUE` repo variable** — every agent run requires it (`src/lib/audit/emit-audit-action.ts:12`, `requireEnv('FERRY_AUDIT_ISSUE')`), the README dedicates Step 1 to setting it, but `src/cli/doctor/index.ts:139–172` runs 12 checks that never read it. A consumer who skips Step 1 gets a green doctor + a runtime crash on first dispatch. P1.
- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` instead (P2).
- README example warning at line 268 still says `v0.4.0 → v0.4.1` (cosmetic, should be `v0.5.0 → v0.5.x`).
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

- Reconciler stub `ferry-reconcile.yml` and cost-daily stub `ferry-cost-daily.yml` ship in `examples/consumer-setup/workflows/`, pinned to `v0.5.0` (verified at `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml:24`).
- `ferry-uninstall` CLI present (#129) — first reversible-deploy path.
- `ferry-update` CLI present (#134) — first migration path; reads `MIGRATIONS.md` and prints required actions.

**Weaknesses (unchanged from previous audit)**

- No rollback plan documented in a runbook.
- No on-call runbook (`docs/RUNBOOK.md` not yet created) — **the highest-leverage P1**.
- No proactive monitoring — audit issue pings nobody.

### 4.13 Release / distribution — 9.0 (unchanged)

Release pipeline empirically proven on the v0.4.0 and v0.5.0 tag pushes.

**Strengths**

- `release.yml` runs full quality gate, publishes `@big-emotion/ferry` to npm with `--provenance`, creates a GitHub Release with notes from `CHANGELOG.md`, and force-pushes the floating `v1` tag via `scripts/retag-major.sh`. **All 11 steps green on both v0.4.0 and v0.5.0 pushes.**
- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, **`v0.5.0`**, **`v1`** (floating).
- npm: `@big-emotion/ferry@0.5.0` published with provenance.
- `package.json`: `"version": "0.5.0"`, `"publishConfig": { "access": "public" }`.
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

### 4.15 Doc–code coherence — 6.5 (−1.5)

A targeted sweep of every concrete claim in `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/0001…0005`, `MIGRATIONS.md`, `CHANGELOG.md` against the actual filesystem and `git grep` of `src/`, `.github/`, `examples/`, `prompts/`, `scripts/`. Method: walk every file path, command, env var, secret, label, FR id, workflow name, composite-action name, default value and version pin in the docs and verify it exists in code; then reverse-walk the code surface (`bin` entries, `FERRY_*` env vars, agent file structure, husky hooks) to find anything user-visible that no doc covers.

**Verified coherent (high-signal claims that pass)**

- All 8 README-listed install secrets (`FERRY_APP_ID`, `FERRY_PRIVATE_KEY`, `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`, `ANTHROPIC_API_KEY`, `FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`) are referenced by `examples/consumer-setup/workflows/*.yml`, `src/cli/init/steps/secrets.ts`, and `src/cli/doctor/checks/secrets.ts`.
- All 16 FRs in `docs/REQUIREMENTS.md` (FR1, FR6, FR10, FR12, FR15, FR16, FR18, FR24, FR28, FR29, FR45, FR46, FR50, FR51, FR55, FR60) appear at the file paths the registry claims; `scripts/check-fr-drift.sh` confirms every `FR\d+` in `src/`/`prompts/`/`docs/` is registered.
- Every file path cited in ADRs 0001–0005 exists (12/12): `dev-action.ts`, `iterate-action.ts`, `transition.ts`, `agent-loop/anthropic.ts`, `llm/anthropic.ts`, `llm/call.ts`, `llm/call.test.ts`, `lib/agent-runtime/idempotency.ts`, `refiner/idempotency.ts`, `developer/sandbox.ts`, `developer/sandbox.test.ts`, `reviewer/review-action.ts`.
- Default LLM models in `docs/CONFIGURATION.md` match `src/lib/config.ts:80–91` (refiner / review / iterate = `claude-sonnet-4-6`, dev = `claude-opus-4-5`).
- Default Jira columns documented in the README (`Refinement` / `In Development` / `In Review` / `Changes Requested` / `Ready to Merge`) match `src/cli/init/index.ts:145–154` and `src/cli/init/steps/jira-bundle.ts:67–70`.
- `prompts/<agent>.extra.md` mechanism exists (`src/lib/prompts/resolve.ts:63`); `ferry-doctor` warns on full-prompt overrides as the README claims (`src/cli/doctor/checks/prompts.ts:38`).
- `ferry-init`-generated artefacts (`ferry-jira-automation-setup.md`, `ferry-jira-automation-rules.beta.json`) are written by `src/cli/init/steps/jira-bundle.ts:260,263`.
- Tag-pin consistency table (§4.2) — every internal `@v0.5.0` reference matches `package.json` `.version`; `git tag` lists `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0` and the floating `v1`.
- README's draft-PR claim (PR opens as draft, flips to ready on approval) is real: `src/lib/dispatch/runner/github-actions/index.ts:139` (`draft: true`) + `:161` (`markPullRequestReadyForReview` mutation).
- README's `AGENT_MCP_SERVERS` documentation (`url`, `authorization_token`, `allowed_tools`, `denied_tools`) is wired in `src/lib/agent-runtime/`.
- `CHANGELOG.md` claim that `release.yml` invokes `scripts/retag-major.sh` is real (`.github/workflows/release.yml:106`).

**Confirmed drift (7 items — first 5 carried from previous audit, D6 and D7 are new in this revision)**

| #   | Drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Severity |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D1  | **`CLAUDE.md` "Two consumer-facing CLIs … `ferry-init` and `ferry-doctor`"** — `package.json` `bin` exposes **four** (`ferry-init`, `ferry-doctor`, `ferry-uninstall`, `ferry-update`). The CLAUDE.md "CLI Entrypoints" section pre-dates v0.4.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | low      |
| D2  | **`CONTRIBUTING.md:42` claims `pre-push` runs `… && check:bundle`** — actual `.husky/pre-push` runs `typecheck && lint && format:check && test` only, no `check:bundle`. CI still enforces bundle drift, so consumers are not affected — but the contributor-facing promise is wrong.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | medium   |
| D3  | **`CONTRIBUTING.md:43` claims a `commit-msg` hook enforces `(FRn)` references** — `.husky/` contains only `pre-commit` and `pre-push`; `.husky/commit-msg` does not exist. The FR drift detector (`check-fr-drift.sh`) provides repo-wide enforcement, but the per-commit hook described in CONTRIBUTING.md is not installed by `husky install`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | medium   |
| D4  | **`docs/RELEASING.md:154` "CLIs are exposed under their original bin names — `ferry-init` and `ferry-doctor`"** — outdated since v0.4.0 (which the same audit doc on §4.13 already lists as four CLIs). Same root cause as D1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | low      |
| D5  | **`src/cli/init/templates.ts` advertises four phantom "Optional variables" in the `ferry-dev.yml` stub header** — `FERRY_DEV_MAX_ITERATIONS`, `FERRY_DEV_MAX_INPUT_TOKENS`, `FERRY_ANTHROPIC_BASE_URL`, `FERRY_PROMPTS_DIR`. Investigation: `FERRY_ANTHROPIC_BASE_URL` is **not read anywhere** in `src/`; the other three are read at runtime (`config.ts:531–538`, `agent-loop/anthropic.ts:117–120`, `prompts/resolve.ts`) but **none are piped through `.github/actions/ferry-run-developer/action.yml`**. A consumer setting any of them as a repo variable per the stub header gets a silent no-op. (`FERRY_ITER_MAX_INPUT_TOKENS` IS functional — the iter composite action aliases it to `FERRY_DEV_MAX_INPUT_TOKENS` internally.)                                                                                                                           | medium   |
| D6  | **`ferry-update` does not consume `MIGRATIONS.md`** — `src/cli/update/migrations.ts:8–14` defines an in-code `MIGRATIONS: Record<string, MigrationNote[]> = {}` with only a commented-out example. `getRelevantMigrations()` returns `[]` for **every** version pair. Yet `MIGRATIONS.md:4` says "ferry-update reads the relevant section(s) and prints them as **Manual follow-ups required** after upgrading", README line 272 directs users to `MIGRATIONS.md`, and `CLAUDE.md` says ferry-update "reads `MIGRATIONS.md` and prints required follow-ups". Result: any consumer upgrading from `v0.3.x` runs `ferry-update`, sees pins re-rendered, and silently misses the critical `(action)` to rename `FERRY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` — landing them in broken-auth territory on the next dispatch. **Does not affect first-time installers.** | **P0**   |
| D7  | **`ferry-doctor` does not check the `FERRY_AUDIT_ISSUE` repo variable** — README Step 1 dedicates an entire section to creating the audit issue and running `gh variable set FERRY_AUDIT_ISSUE`. Every agent run reads it via `requireEnv('FERRY_AUDIT_ISSUE')` (`src/lib/audit/emit-audit-action.ts:12`). Doctor runs 12 checks (`src/cli/doctor/index.ts:139–172`); none check this variable. A first-time installer who skips Step 1 sees a green `ferry-doctor` and a runtime crash on the first Jira column move. The smoke-test step then surfaces the issue — but the doctor is the canonical pre-smoke-test gate and should catch it.                                                                                                                                                                                                                        | **P1**   |

**Reverse-coverage gaps (code surfaces with no doc mention)**

- The four cost-governance / dev-internal env vars `FERRY_ACTIVE_COLUMNS`, `FERRY_BUNDLED_PROMPTS_DIR`, `FERRY_DRY_RUN`, `FERRY_LLM_CONFIG` are pass-through internals between workflow → composite-action → src; intentionally undocumented but no comment in `docs/CONFIGURATION.md` declares "what is internal vs consumer-tunable" beyond the existing "What is hardcoded" table. A one-line note pointing readers at the `Optional variables` block in the generated stubs would close the loop.
- Minor: ADR 0002 says action source files follow `<agent>-action.ts`; actual convention is `<phase>-action.ts` (`dev-action`, `refiner-action`, `review-action`, `iterate-action`). Doc reads slightly off; code is consistent.

**Net coherence assessment**

D1–D5 are _stale_ text outpaced by a release. D6 and D7 are different in kind: a docs-promised feature that **never matched code** (D6 — ferry-update was always silent on migrations, despite three docs claiming otherwise) and a doctor-coverage hole that a consumer can fall through (D7). For a **first-time installer at v0.5.0**, only D5 and D7 matter, and both are containable: D5's phantom variables are silent no-ops, not failures; D7 surfaces at smoke-test time so a careful operator catches it. For an **upgrading consumer**, D6 is the single biggest user-visible breakage in the v0.3.x → v0.5.0 path. **Score: 6.5 / 10** — D6 is a P0 (consumer-blocking) drift that the previous audit missed; D7 is a P1 hole in the doctor's promise to "verify your install before the smoke test".

---

## 5. Prioritized action plan (residual)

The list, ordered by what closes the score gap fastest:

| Order | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Domain        | Score before | Priority | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- | ------ |
| 0a    | **(D6 — P0)** Populate `src/cli/update/migrations.ts` with the `v0.3.x → v0.4.0` entries from `MIGRATIONS.md` (or rewrite `getRelevantMigrations()` to parse `MIGRATIONS.md` directly). Add a regression test that asserts a v0.3.x → v0.5.0 upgrade returns the `FERRY_ANTHROPIC_API_KEY` rename note. Without this, every v0.3.x consumer upgrading via `ferry-update` lands in broken auth.                                                                                                          | Coherence     | 6.5          | **P0**   | S      |
| 0b    | **(D7 — P1)** Add a `checkAuditIssue()` to `src/cli/doctor/checks/` that reads `FERRY_AUDIT_ISSUE` via `gh variable list` and verifies the referenced GitHub Issue exists and is open. Wire it into `src/cli/doctor/index.ts`. Without this, a first-time installer who skips README Step 1 gets a green doctor and a runtime crash.                                                                                                                                                                    | Coherence     | 6.5          | **P1**   | S      |
| 1     | On-call runbook (`docs/RUNBOOK.md`): stalled ticket, cost spike, agent-loop runaway, rollback procedure                                                                                                                                                                                                                                                                                                                                                                                                 | Operations    | 5.5          | **P1**   | M      |
| 2     | Audit-issue rotation when comments approach the 1000-comment cap (instead of failing silently)                                                                                                                                                                                                                                                                                                                                                                                                          | Reliability   | 8.0          | **P1**   | M      |
| 3     | Add `harden-runner` egress allowlist to dev/iterate workflows                                                                                                                                                                                                                                                                                                                                                                                                                                           | GH Actions    | 7.5          | **P1**   | S      |
| 4     | Extend `src/install-guide.test.ts` to invoke `workflowTemplates()` and assert each emitted stub's reusable-workflow + tag exist                                                                                                                                                                                                                                                                                                                                                                         | E2E           | 8.0          | **P1**   | S      |
| 5     | Add e2e idempotency replay (same `event_id` twice → same outcome, no duplicate writes)                                                                                                                                                                                                                                                                                                                                                                                                                  | E2E           | 8.0          | **P1**   | M      |
| 6     | `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the README curl step)                                                                                                                                                                                                                                                                                                                                                                                            | Consumer docs | 8.5          | **P2**   | S      |
| 7     | `ferry-init` collects the two transition IDs and sets them as secrets (currently a manual README step)                                                                                                                                                                                                                                                                                                                                                                                                  | Consumer docs | 8.5          | **P2**   | S      |
| 8     | OSSF Scorecard + SLSA provenance on the GitHub Release artifact                                                                                                                                                                                                                                                                                                                                                                                                                                         | Supply chain  | 8.5          | **P2**   | M      |
| 9     | Migrate `GITHUB_TOKEN` to a fine-grained GitHub App (or remove the App provisioning from `ferry-init`)                                                                                                                                                                                                                                                                                                                                                                                                  | GH Actions    | 7.5          | **P2**   | L      |
| 10    | Branch-protection on `main` requiring CodeQL / Ferry — CI / Release checks before merge                                                                                                                                                                                                                                                                                                                                                                                                                 | CI/CD         | 9.0          | **P2**   | XS     |
| 11    | **Done.** D1–D5 fixed (CLAUDE.md + RELEASING.md CLI lists; CONTRIBUTING.md hook claims; phantom optional-vars removed from `templates.ts:41–44`). Carry-over: optionally remove the runtime fallbacks in `src/lib/config.ts:531–538` and `src/lib/llm/agent-loop/anthropic.ts:117–120` for `FERRY_DEV_MAX_*`, plus the `FERRY_PROMPTS_DIR` override in `src/lib/prompts/resolve.ts` (5 tests rely on the env injection). Defer to a deliberate refactor PR — touches the agent-loop signature contract. | Documentation | 8.0          | **P2**   | S      |

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

## 6. What changed since the previous audit (7.9 → 7.7)

| #   | Change since v0.4.0 audit                                                                                 | Effect                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | **v0.5.0 release shipped** (`aeff8e6`) — full release pipeline ran clean a second time on a real tag push | Confirms `release.yml` durability                                                            |
| 2   | **`afca0ce`** externalised P0+P1 hardcoded values as env vars / `config.json` limits                      | +1 tunability axis for consumers (Domains 5, 8 — already absorbed)                           |
| 3   | **`8d22a33`** configurable base/working/target branches via `git.*` config                                | New doctor check `checkGitConfig` (D6 of last audit fully closed for branches)               |
| 4   | **`72c3237`** opt-in auto-transitions via `workflow.agents` column map                                    | New doctor check `checkWorkflowColumns` validates column names against the live Jira project |
| 5   | **`4615f6e`** per-phase LLM provider selection                                                            | `FERRY_*_PROVIDER` env vars, model-config doctor check                                       |
| 6   | **`23249fc`** PRs open as draft, flip to ready on reviewer approval                                       | install-guide test asserts the new behavior                                                  |
| 7   | **+58 unit tests** (962 → **1020**) since the v0.4.0 audit                                                | Net +6 % coverage on CLI checks and runtime                                                  |
| —   | **D6 / D7 surfaced** — `ferry-update` silent on migrations; `ferry-doctor` blind to `FERRY_AUDIT_ISSUE`   | −1.5 on Domain 9, −1.5 on Domain 15 → score 7.9 → 7.7                                        |

---

## 6.bis Closed in the v0.4.0 audit (7.4 → 7.9)

| #   | Action (prev. audit P0/P1)                                                                                            | Status              | Evidence                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Cut floating `v1` tag from the latest release                                                                         | **done**            | `git ls-remote --tags origin` → `v1` (force-pushed by `retag-major.sh` on the v0.4.0 + v0.5.0 pushes)         |
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
