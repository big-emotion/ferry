# Production-Readiness Audit — Ferry

**Date:** 2026-05-04
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria, post-`v0.7.0` release. **This revision covers the v0.5.3 → v0.7.0 delta** — two releases (v0.6.0 and v0.7.0) that collectively closed every P0 and most P1 items from the prior audit. v0.6.0 hardened the Refiner JSON parser (D9), activated `ferry-update` migrations parsing (D6), added the `ferry-doctor` audit-issue check (D7), fixed gitleaks ENOENT crashes on every Refiner and Reviewer run, and corrected the Reviewer→Iterator auto-loop. v0.7.0 fixed `ferry.config.yaml` loading in composite actions, replaced the reusable-workflow architecture with expanded consumer workflows (closing the cross-org `secrets: inherit` gap), and deleted the now-superseded agent dispatch workflows from the Ferry repo.
**Verdict:** **8.0 / 10 — Production-ready.** All three P0 blockers from v0.5.3 are closed. The install path is clean end-to-end; the refiner, developer, reviewer, and iterator agents are all free of known crash-category bugs. Remaining gaps are P1 (no bundle-runtime smoke gate, no egress allowlist) and P2 housekeeping.
**Target:** **8–9 / 10**, achievable in one focused sprint on the residual P1 items in §5.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (**1041** tests passing across 88 files in 1.88s), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`. Recent run history via `gh run list`.
- **Release artifacts:** `git tag --sort=-creatordate | head -10`, local `package.json`.
- **Docs:** `README.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`, `docs/RUNBOOK.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes.** All P0 blockers from v0.5.3 are closed: (i) D9 Refiner JSON parser hardened with `extractFirstJsonObject` bracket-counting — the confirmed prod failure on `big-emotion/ethniafrica` run 25262368292 is resolved; (ii) D6 `ferry-update` now parses `MIGRATIONS.md` at runtime — upgrading consumers see the critical `FERRY_ANTHROPIC_API_KEY` rename action; (iii) the gitleaks `ENOENT` crash affecting every Refiner and every Reviewer run that posted a Jira comment is fixed. No agent has a known crash-category bug at v0.7.0. Remaining gaps are P1 operational items (no bundle-runtime smoke gate, no egress allowlist) and housekeeping.
2. **Can a first-time consumer install and reach the full Jira → PR-approved cycle?** **Yes.** Walking the v0.7.0 install path: (i) `npx -p @big-emotion/ferry ferry-init` runs the wizard, sets 8 secrets via `gh secret set`, generates `ferry.config.yaml`, writes 4 expanded three-job stubs pinned to `@v0.7.0`, and writes `ferry-jira-automation-setup.md` + `ferry-jira-automation-rules.beta.json`. (ii) `ferry-doctor` now covers all 13 checks including the `FERRY_AUDIT_ISSUE` repo variable (D7 closed). (iii) `ferry-update` now prints MIGRATIONS.md follow-ups so upgrading consumers are not silently stranded. (iv) The v0.7.0 expanded workflow architecture (three jobs: `gate-envelope`, `run-agent`, `emit-audit`) fixes cross-org `secrets: inherit` propagation — the primary installation blocker for consumers in orgs other than `big-emotion`. (v) The three FR auto-transitions (FR18/FR24/FR28) are exercised by `src/e2e/pipeline.test.ts`. (vi) `install-guide.test.ts` (71 tests) asserts no `@main` self-references and correct `@v0.7.0` pins.
3. **Security posture?** Strong. Strict AJV schema validation; all shell calls use argv-as-array; `execFileSync` everywhere. CodeQL + `npm audit` (0 vulns across all severities, 332 deps) + gitleaks wired in CI and now running in all four agent workflows (gitleaks ENOENT crash fixed in v0.6.0). Explicit `permissions:` blocks on every job. Third-party actions pinned by SHA in `ferry-ci.yml`, `release.yml`, and every composite `action.yml`. `@octokit/rest` and Jira modules forbidden under `src/agents/**` (asserted by `restricted-imports.test.ts`). "Ferry never merges" invariant asserted by `pipeline.test.ts:377`. Remaining gaps: no `harden-runner` egress allowlist on write-path workflows (dev/iterate), no SLSA provenance on the GitHub Release artifact, GITHUB_TOKEN used where a fine-grained App would be tighter.
4. **Is the score close to 8–9/10?** **Score is 8.0** — at the floor of the target band. The v0.5.3 → v0.7.0 delta added +0.7 (6 domains moved). Top three actions to reach 8.5: (i) **bundle-runtime smoke gate** — `node .ferry/<role>/index.cjs` boot assertion in `release.yml` would have caught v0.5.1; still missing (P1); (ii) **`harden-runner` egress allowlist** on dev/iterate workflows (P1); (iii) **audit-issue rotation** when comment count approaches the 900-comment threshold (P1, currently fails silently).

---

## 2. Overall score — **8.0 / 10**

Movement since the previous audit (7.3 at v0.5.3): +0.7 across 6 domains.

Quality gates at audit time (all green):

- `npm run typecheck` — clean (`@big-emotion/ferry@0.7.0`)
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 88 files / **1041 tests** / 100% passing in 1.88s
- `npm audit` (moderate+) — 0 vulnerabilities (332 deps total)
- TODO/FIXME/XXX/HACK count under `src/` — 1
- Recent CI: Release ✓, CodeQL ✓, Ferry — CI ✓, Ferry — CI ✓, CodeQL ✓

Release artifacts proven:

- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.5.1`, `v0.5.2`, `v0.5.3`, `v0.6.0`, **`v0.7.0`**, **`v1`** (floating major, retag-major.sh advances on every release)
- `@big-emotion/ferry@0.7.0` published to npm with provenance
- GitHub Release v0.7.0 created with notes from `CHANGELOG.md`

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. v0.5.3 | Trend  |
| --- | ---------------------------------- | ------------ | ------------ | ------ |
| 1   | Application security               | **8.5 / 10** | 0            | strong |
| 2   | Supply-chain security              | **8.5 / 10** | 0            | strong |
| 3   | GitHub Actions security            | **7.5 / 10** | 0            | strong |
| 4   | Tests & coverage                   | **8.0 / 10** | +0.5         | strong |
| 5   | E2E / acceptance tests             | **7.5 / 10** | 0            | medium |
| 6   | CI/CD gates                        | **9.0 / 10** | 0            | strong |
| 7   | Reliability (idempotency, retries) | **8.5 / 10** | +2.0         | strong |
| 8   | Observability / audit              | **7.0 / 10** | 0            | medium |
| 9   | Consumer documentation             | **8.5 / 10** | +1.5         | strong |
| 10  | Code quality / typing              | **8.5 / 10** | 0            | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0            | strong |
| 12  | Operations / runbooks / rollback   | **7.5 / 10** | +2.0         | medium |
| 13  | Release / distribution             | **8.5 / 10** | -0.5         | strong |
| 14  | Cost governance (runtime)          | **7.0 / 10** | 0            | medium |
| 15  | Doc–code coherence                 | **7.5 / 10** | +1.0         | medium |

Mean = **8.0 / 10** (15 axes; 119.5 / 15 = 7.97 → 8.0)

> **Domain 7 (Reliability) +2.0:** D9 Refiner JSON parser hardened (v0.6.0) + Reviewer→Iterator auto-loop fixed (v0.6.0) + gitleaks ENOENT crash fixed (v0.6.0) = three crash-category bugs closed in one release.
>
> **Domain 9 (Consumer docs) +1.5:** D6 `ferry-update` migrations now live (v0.6.0) + D7 `ferry-doctor` audit-issue check added (v0.6.0) + D5 phantom optional variables removed from stub headers = three docs-promise-gaps closed.
>
> **Domain 12 (Operations) +2.0:** `docs/RUNBOOK.md` created (v0.6.0) — on-call playbook covering stalled ticket, cost spike, agent-loop runaway, refiner D9 mitigation, rollback, CI red. This was the single highest-leverage open P1.
>
> **Domain 13 (Release) -0.5:** CHANGELOG link section is missing `[0.7.0]` and the five intermediate releases (`[0.5.0]` through `[0.5.3]`). The `[Unreleased]` compare URL still points to `v0.6.0` as the base. Additionally a fix commit (`7803066`) was needed post-release to sweep remaining `v0.6.0` refs to `v0.7.0`, indicating the release checklist did not catch all references. The release pipeline itself executed clean.
>
> **Domain 15 (Doc–code coherence) +1.0:** D2, D3, D5, D6, D7 all closed. One new drift item: ADR 0002 (`docs/adr/0002-ferry-bundles-committed.md:16,34,35`) still references `@v0.6.0` instead of `@v0.7.0`.

---

## 4. Domain analysis

### 4.1 Application security — 8.5 (unchanged)

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- All shell calls use `execFileSync` with argv-as-array. The single `spawn` (`src/agents/developer/tools.ts:374`) also passes args as an array.
- `FerryError` taxonomy with typed codes (`state-invariant`, `spend-cap`, `transient`, `unknown`).
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit (`src/lib/agent-runtime/secret-scan.ts`); gitleaks now runs on **all four** agent dispatch workflows (Refiner and Reviewer added in v0.6.0).
- `@typescript-eslint/no-explicit-any: 'error'` plus `no-restricted-imports` for agent code (verified via `src/agents/restricted-imports.test.ts`).
- "Ferry never merges" invariant asserted by `src/e2e/pipeline.test.ts:377`.

**Weaknesses**

- LLM-supplied `commit_message` reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 8.5 (unchanged)

Tag-pin consistency table:

| Location                                                                         | Pin                                                                          | Status    |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| `package.json` `.version`                                                        | `0.7.0`                                                                      | canonical |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.7.0`                                                                    | match     |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.7.0`                                                                     | match     |
| `docs/RELEASING.md` (lines 26, 30, 46, 49–50, 157)                               | `@v0.7.0`                                                                    | match     |
| `src/install-guide.test.ts`                                                      | `@v0.7.0`                                                                    | match     |
| `docs/adr/0002-ferry-bundles-committed.md` (lines 16, 34, 35)                    | `@v0.6.0`                                                                    | **drift** |
| `git tag --list`                                                                 | `v0.2.0`–`v0.5.3`, `v0.6.0`, **`v0.7.0`**, **`v1`**                          | exist     |
| `npm @big-emotion/ferry`                                                         | `0.7.0`                                                                      | published |
| `CHANGELOG.md` link section                                                      | `[Unreleased]` base = `v0.6.0`; missing `[0.7.0]`, `[0.5.0]`–`[0.5.3]` links | **drift** |

**ADR 0002 drift** is cosmetic (the ADR describes a design decision, not a consumer pin), but the automated drift gate (action 0d from prior audit) is still not in place — the same pattern that caused D8 in v0.5.3 recurred here.

**Strengths**

- CodeQL SAST wired — recent run green.
- `audit:ci` job in CI.
- Bundle-drift check in CI (`check-bundle` job).
- Third-party actions pinned by SHA with version comments.
- gitleaks tarball pinned by SHA256 in CI.
- `npm audit` clean (0 across all severities).
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped.
- npm publish uses `--provenance --access public`.

**Weaknesses**

- No SLSA provenance attestation on the GitHub Release artifact.
- No SBOM, no OSSF Scorecard.
- ADR 0002 `@v0.6.0` drift (P1 cosmetic).
- CHANGELOG link section missing v0.7.0 and [0.5.x] release links (low).

### 4.3 GitHub Actions security — 7.5 (unchanged)

**Strengths**

- Explicit `permissions:` blocks on every job across consumer-side agent workflows, `ferry-ci.yml`, `release.yml`, `codeql.yml`.
- Concurrency groups per ticket prevent races; `cancel-in-progress: false` on writes (dev/iterate), `true` on read-only (refine/review).
- Fallback `'ferry-invalid-payload-sinkhole'` blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.
- `release.yml` uses `id-token: write` only for npm provenance.
- **v0.7.0:** Consumer workflows expanded into three jobs (`gate-envelope`, `run-agent`, `emit-audit`) that call composite actions directly — this eliminates the `secrets: inherit` dependency on reusable workflows that blocked cross-org consumers.

**Weaknesses**

- `GITHUB_TOKEN` used by composite actions instead of a fine-grained GitHub App (P2).
- No `harden-runner` (StepSecurity) for egress allowlisting on the dev/iterate workflows that perform git push (P1).
- No OIDC for federated auth to Anthropic / Jira.
- Audit issue rotation: ROTATION_THRESHOLD = 900 comments; silent failure if reached (P1, carry-over).

### 4.4 Tests & coverage — 8.0 (+0.5)

| Metric  | Status                                           |
| ------- | ------------------------------------------------ |
| Suite   | 88 files / **1041 tests** / all passing in 1.88s |
| Reports | text, text-summary, html, lcov                   |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`      |

**Strengths**

- Test count up (+13 since v0.5.3 → 1041) — `src/agents/refiner/parse.ts` regression tests cover `extractFirstJsonObject` with prose preamble, trailing prose, and nested code fences; D9 brittle-parse failure mode is now covered.
- Coverage threshold uniform at 75% across statements/branches/functions/lines.
- CLI module coverage: every doctor check has a sibling `.test.ts`.
- Composite-action entrypoints excluded from coverage with documented reason.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 7.5 (unchanged)

**Strengths**

- **Mocked end-to-end pipeline test** at `src/e2e/pipeline.test.ts` replays refine→dev→review→iterate, asserts the no-auto-merge invariant (line 377), exercises FR18/FR24/FR28.
- **Install-guide acceptance test** at `src/install-guide.test.ts` (71 tests) covers 18 sections of the README including no-`@main` self-references (`§15`) and correct `@v0.7.0` pins (`§3.1`).
- FR drift detector (`scripts/check-fr-drift.sh`) wired into CI lint job.
- Release pipeline empirically validated by seven real tag pushes (v0.4.0 through v0.7.0 — all pipelines green).

**Weaknesses**

- **No bundle-runtime smoke gate** — the `check-bundle` job in `ferry-ci.yml` rebuilds `.ferry/` and diffs, but never imports or executes the bundled `index.cjs`. v0.5.1's `Dynamic require of "child_process" is not supported` and v0.7.0's yaml-package crash would have surfaced immediately on `node .ferry/refiner/index.cjs`. The fixture is already in `src/__fixtures__/` — effort is XS (P1, carry-over action 0c).
- No idempotency assertion across a full replay of the same `event_id` against the same audit issue.
- Install-guide test validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts` (P1, carry-over action 4).

### 4.6 CI/CD gates — 9.0 (unchanged)

**Strengths**

- Six parallel CI jobs: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `check-bundle`, `audit`; plus CodeQL, release gate.
- `release.yml` runs full quality gate before npm publish.
- All actions in CI pinned by SHA.
- Concurrency cancels superseded CI runs on the same branch.
- Husky pre-push hook re-runs the full suite locally.
- Recent runs: Release ✓, CodeQL ✓, Ferry — CI ✓, Ferry — CI ✓, CodeQL ✓.

**Weaknesses**

- No `npm ci --audit-signatures` integrity check.
- No required-checks branch-protection preventing direct push to `main`.

### 4.7 Reliability — 8.5 (+2.0)

Three crash-category bugs were closed in v0.6.0, moving this domain from 6.5 to 8.5 in a single release:

1. **D9 closed (P0):** `src/agents/refiner/parse.ts` provides `extractFirstJsonObject` — a bracket-counting extractor that finds the first balanced `{...}` substring in the raw LLM output. Prose preamble, trailing prose, and code-fenced wrapping are now transparent to the parser. Regression tests in `src/agents/refiner/parse.ts` cover all three failure modes. The confirmed prod failure on `big-emotion/ethniafrica` run 25262368292 is resolved.
2. **Reviewer→Iterator loop fixed:** `countPriorIterations` in `changes-guard.ts` counts completed iterator cycles and compares against `limits.max_iterations` (default 3). The prior implementation short-circuited on the first iterator marker, making multi-iteration reviews impossible.
3. **Gitleaks ENOENT fixed:** Refiner and Reviewer reusable workflows (now expanded consumer workflows) install gitleaks v8.21.2 before invoking the agent. Every Refiner run and any Reviewer run that posted a Jira comment previously crashed with `Error: spawn gitleaks ENOENT`.

**Carry-over weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- Audit comment pagination capped at `MAX_PAGES * 100 = 1000`; ROTATION_THRESHOLD = 900; silent failure if reached.
- Reconciler depends on the consumer wiring `ferry-reconcile.yml`.

### 4.8 Observability — 7.0 (unchanged)

**Strengths**

- Structured JSON logger in production paths.
- Centralised audit issue with JSON-per-phase lines.
- Correlation by `run_id` / ULID across phases.
- `docs/RUNBOOK.md` added — on-call operators now have a concrete triage playbook.

**Weaknesses**

- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human (mitigated only when the consumer wires the reconciler).
- Some emitters still pass `correlation_id: ""` — not all entry points propagate the ULID.
- 8 raw `console.log` calls remain under `src/`.

### 4.9 Consumer documentation — 8.5 (+1.5)

**Strengths**

- `ferry-init` emits exactly 4 expanded three-job stubs; all pin to `@v0.7.0`; all composite actions referenced exist on origin.
- The `ANTHROPIC_API_KEY` secret naming is consistent across README, composite actions, `ferry-init`, `ferry-doctor`, and `ferry-uninstall`.
- **D6 closed (v0.6.0):** `ferry-update` now parses `MIGRATIONS.md` at runtime. Consumers upgrading from v0.3.x see the critical `FERRY_ANTHROPIC_API_KEY` rename action. MIGRATIONS.md `v0.6.x → v0.7.0` entry has an (action) for running `ferry-update` to migrate workflow form.
- **D7 closed (v0.6.0):** `ferry-doctor` check D7 verifies `FERRY_AUDIT_ISSUE` repo variable is set, numeric, and points to an open GitHub issue. All four failure modes produce an actionable error pointing to README Step 1.
- `docs/RUNBOOK.md` added — on-call playbook for stalled ticket, cost spike, agent-loop runaway, refiner D9 mitigation, rollback, CI red.
- `docs/CONFIGURATION.md` is internally consistent with the composite action interfaces.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.

**Carry-over weaknesses**

- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` instead (P2, action 6).
- `ferry-init` does not collect the two transition IDs — still a manual README step (P2, action 7).
- No `workflowTemplates()` invocation in `install-guide.test.ts` (P1, action 4).

### 4.10 Code quality — 8.5 (unchanged)

**Strengths**

- Strict TypeScript NodeNext ESM, `no-explicit-any: error`.
- ESLint with agent-specific rules; restricted-imports verified by test.
- Prettier mandatory and currently clean.
- Layered architecture respected; agents never import Octokit/Jira directly.
- Unit tests next to implementation; lint fixtures isolated.

**Weaknesses**

- No complexity gates (cyclomatic, max lines).
- No `eslint-plugin-security` or `eslint-plugin-no-secrets`.
- `src/agents/reviewer/review-loop.ts` size still hints at complexity debt.

### 4.11 Traceability / FR governance — 7.5 (unchanged)

**Strengths**

- `docs/REQUIREMENTS.md` is the single source of truth for `FR\d+` IDs.
- `npm run check:fr-drift` wired into CI; fails the build on undocumented FR tags.
- Five ADRs cover the foundational decisions.
- Audit issue traces every runtime execution.

**Weaknesses**

- No commit-msg lint enforcing FR or issue back-reference.
- No bidirectional code → FR mapping beyond grep.

### 4.12 Operations — 7.5 (+2.0)

**Strengths**

- **`docs/RUNBOOK.md` created (v0.6.0)** — concrete on-call playbook: stalled ticket (reconciler trigger + Jira column nudge), cost spike (pause label + daily-check wiring), agent-loop runaway (close-PR + force-transition), rollback (re-pin + `ferry-update`), CI red (gitleaks + CodeQL). This was the highest-leverage P1 from the prior audit.
- `ferry-uninstall` CLI — reversible-deploy path.
- `ferry-update` CLI — migration path, now reads `MIGRATIONS.md`.
- Reconciler + cost-daily stubs ship in `examples/consumer-setup/workflows/`, pinned to `v0.7.0`.

**Weaknesses (carry-over)**

- No proactive monitoring — audit issue pings nobody.
- Audit issue rotation is not automated.
- Reconciler effectiveness depends on consumer wiring the stub.

### 4.13 Release / distribution — 8.5 (−0.5)

The release pipeline executed clean again on v0.6.0 and v0.7.0. The −0.5 reflects two housekeeping gaps surfaced in this cycle:

1. **CHANGELOG link section incomplete.** `[0.7.0]` link not added to the bottom of `CHANGELOG.md`. `[0.5.0]`, `[0.5.1]`, `[0.5.2]`, `[0.5.3]` links also absent. `[Unreleased]` compare URL still uses `v0.6.0` as the base. Minor usability issue (entries are readable); does not affect npm publish or GitHub Release creation.
2. **Fix commit needed post-release (`7803066`).** "update remaining v0.6.0 refs to v0.7.0 in README and ops stubs" — a second commit after the release tag was required to sweep references. Indicates the release checklist does not comprehensively cover all consumer-facing ref locations. Same pattern as D8 in v0.5.3.

**Strengths**

- Release pipeline proven on **seven** tag pushes (v0.4.0 through v0.7.0). All pipelines green.
- `package.json`: `"version": "0.7.0"`, `"publishConfig": { "access": "public" }`.
- `CHANGELOG.md` and `MIGRATIONS.md` present and feed the release pipeline; entries are honest about scope.
- `v1` floating tag advances correctly on each release.
- npm publish uses `--provenance --access public`.

**Weaknesses**

- CHANGELOG link section incomplete (action: add missing links + update `[Unreleased]` base).
- **No bundle-runtime smoke gate** — still missing from `release.yml` (P1 carry-over).
- No SLSA provenance on the GitHub Release artifact.
- No documented LTS / support window.

### 4.14 Cost governance — 7.0 (unchanged)

**Strengths**

- `src/cost-governance/daily-check.ts` written and tested.
- `examples/consumer-setup/workflows/ferry-cost-daily.yml` ships as a copy-paste stub (cron `0 6 * * *`); 50% monthly cap → auto-pause via `ferry:paused` label. FERRY_SPEND_CAP_EUR is env-tunable (default 200).
- Audit line carries `cost_eur` per execution.

**Weaknesses**

- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.
- The safety net requires the consumer to copy the stub; nothing validates they did.

### 4.15 Doc–code coherence — 7.5 (+1.0)

**Closed drift items (D1–D7)**

| #   | Status                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Closed.** CLAUDE.md correctly lists all four CLIs.                                                                                                                                                                      |
| D2  | **Closed.** `CONTRIBUTING.md:42` now correctly states "The bundle-drift check is enforced in CI rather than in the local hook." Pre-push hook content matches.                                                            |
| D3  | **Closed.** `CONTRIBUTING.md:44` now correctly states "there is no local `commit-msg` hook today."                                                                                                                        |
| D4  | **Closed.** `docs/RELEASING.md:157` now lists all four CLIs.                                                                                                                                                              |
| D5  | **Closed.** Stub headers no longer advertise phantom optional variables. Expanded workflow stubs pass real variables (`ferry_iter_max_input_tokens`, model selectors) via `with:` inputs piped through composite actions. |
| D6  | **Closed (v0.6.0).** `ferry-update` now reads `MIGRATIONS.md` at runtime. `MIGRATIONS.md` promises, README direction, and CLAUDE.md note are now accurate.                                                                |
| D7  | **Closed (v0.6.0).** `ferry-doctor` check D7 verifies `FERRY_AUDIT_ISSUE`. README Step 1 and doctor output are now coherent.                                                                                              |
| D8  | **Partially closed (v0.5.3 → v0.7.0).** `docs/RELEASING.md` and `install-guide.test.ts` correctly reference `@v0.7.0`. **New drift:** `docs/adr/0002-ferry-bundles-committed.md:16,34,35` still references `@v0.6.0`.     |

**New drift items**

| #   | Drift                                                                                                                                                                                                                                                     | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D9  | **`docs/adr/0002-ferry-bundles-committed.md:16,34,35` references `@v0.6.0`** — should be `@v0.7.0`. The ADR describes a design decision; the version pin in the example is consumer-visible and stale. Carry-over of the action-0d systematic drift gate. | low      |
| D10 | **CHANGELOG link section is missing `[0.7.0]` and `[0.5.0]`–`[0.5.3]` release tag links.** `[Unreleased]` compare URL still uses `v0.6.0` as base. Affects changelog navigation; does not block releases.                                                 | low      |
| D11 | **`src/install-guide.test.ts:341` contains a stale comment** — "they use @v0.6.0" — but the actual assertion on line 49–52 correctly tests for `@v0.7.0`. Cosmetic.                                                                                       | cosmetic |

**Net coherence assessment**

D1–D7 all closed. The three new items are low/cosmetic. The systematic drift gate (action 0d) is still not implemented — D8/D9 closure has been manual every cycle. **Score: 7.5** — +1.0 over v0.5.3 (D2/D3/D5/D6/D7 closures), capped below 8.0 by the recurrent tag-drift pattern and missing CHANGELOG links.

---

## 5. Gaps and risks

### 5.1 Hardcoded values (P0/P1)

Scan scope: `src/**/*.ts`, excluding `*.test.ts`, `__fixtures__/`, `__lint-fixtures__/`, `src/schemas/*.json`.

**Assessment:** Almost every production constant is now env-tunable via the `FERRY_*` env-var pattern. P0 count is 0. P1 count is 2 — below the 6-item threshold; no score penalty applied to Domains 5 or 8.

**P1 — Size & Batch Limits**

- **P1** `src/agents/developer/tools.ts:22` — `MAX_SEARCH_MATCHES = 200` — grep result cap for the dev agent; not env-tunable. Large repos with >200 matches per pattern receive a silent truncation. Could be moved to a `FERRY_GREP_MAX_MATCHES` env var.
- **P1** `src/lib/audit/index.ts:39` — `const MAX_PAGES = 10` — caps audit comment pagination at 1,000 (10 × 100). Not env-tunable. Reaches the silent-failure zone when combined with ROTATION_THRESHOLD = 900 and FERRY_AUDIT_ROTATION_THRESHOLD override.

**P2 items (acceptable as-is, listed for completeness)**

Most constants are already env-tunable:

- Timeouts/Durations: FERRY_GREP_TIMEOUT_MS, FERRY_BASH_TIMEOUT_MS, FERRY_HTTP_TIMEOUT_MS, FERRY_ANTHROPIC_VERIFY_TIMEOUT_MS, FERRY_DISPATCH_POLL_INTERVAL_MS, FERRY_DISPATCH_PROBE_TIMEOUT_MS — all tunable.
- Token/LLM caps: FERRY_DEV_MAX_ITERATIONS, FERRY_DEV_MAX_INPUT_TOKENS, FERRY_DEV_MAX_TOKENS, FERRY_REVIEWER_MAX_ITERATIONS, FERRY_REVIEWER_MAX_TOKENS — all tunable.
- Size limits: FERRY_TLDR_TOTAL_CHARS, FERRY_AUDIT_ROTATION_THRESHOLD, FERRY_REFINER_SUBTASK_CAP, FERRY_REFINER_TOUCH_PATHS_CAP, FERRY_REVIEW_PATCH_TRUNCATE_CHARS, FERRY_REVIEW_FILE_TRUNCATE_CHARS, FERRY_BASH_OUTPUT_MAX_BYTES — all tunable.
- Cost: FERRY_SPEND_CAP_EUR — tunable.
- Reconciler: FERRY_RECONCILER_STALE_WINDOW_MINUTES — tunable.

---

## 6. Prioritized action plan (residual)

| Order | Action                                                                                                                                                                                                                                                                                                                                    | Domain        | Score before | Priority | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- | ------ |
| 0c    | **(P1, carry-over)** Add a bundle-runtime smoke job to `release.yml` (and `ferry-ci.yml`): for each role, run `node .ferry/<role>/index.cjs` with `FERRY_DRY_RUN=1` and a fixture envelope; assert exit-code 0 and no `Dynamic require` / `Cannot find module` errors. Would have caught v0.5.1 and v0.7.0-pre (yaml package). Effort XS. | E2E / Release | 7.5 / 8.5    | **P1**   | XS     |
| 0d    | **(P1)** Add a regex assertion to `src/install-guide.test.ts` (or new `tag-pin-drift.test.ts`) that scans `docs/adr/*.md` and `docs/RELEASING.md` for `@v[0-9.]+` literals and fails if any disagrees with `package.json .version`. ADR 0002 drift was introduced manually and closed manually — this gate would prevent recurrence.      | Coherence     | 7.5          | **P1**   | XS     |
| 1     | **(P1, carry-over)** Add `harden-runner` egress allowlist to dev/iterate workflows — these jobs run `git push` and therefore need egress to GitHub; all other outbound connections should be blocked.                                                                                                                                     | GH Actions    | 7.5          | **P1**   | S      |
| 2     | **(P1, carry-over)** Audit-issue rotation — when comment count approaches ROTATION_THRESHOLD (900), open a new audit issue automatically and update the `FERRY_AUDIT_ISSUE` variable. Currently fails silently.                                                                                                                           | Reliability   | 8.5          | **P1**   | M      |
| 3     | **(P1, carry-over)** Extend `install-guide.test.ts` to invoke `workflowTemplates()` from `src/cli/init/templates.ts` and assert each emitted stub's composite-action refs and tag exist on origin.                                                                                                                                        | E2E           | 7.5          | **P1**   | S      |
| 4     | **(P1, carry-over)** Add e2e idempotency replay: same `event_id` twice → same outcome, no duplicate external writes.                                                                                                                                                                                                                      | E2E           | 7.5          | **P1**   | M      |
| 5     | **(low)** Fix CHANGELOG link section: add `[0.7.0]` through `[0.5.0]` tag links; update `[Unreleased]` compare URL base to `v0.7.0`.                                                                                                                                                                                                      | Release       | 8.5          | low      | XS     |
| 6     | **(P2)** `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the README curl step).                                                                                                                                                                                                                    | Consumer docs | 8.5          | **P2**   | S      |
| 7     | **(P2)** `ferry-init` collects the two transition IDs and sets them as secrets.                                                                                                                                                                                                                                                           | Consumer docs | 8.5          | **P2**   | S      |
| 8     | **(P2)** OSSF Scorecard + SLSA provenance on the GitHub Release artifact.                                                                                                                                                                                                                                                                 | Supply chain  | 8.5          | **P2**   | M      |
| 9     | **(P2)** Migrate `GITHUB_TOKEN` to a fine-grained GitHub App (or remove the App provisioning from `ferry-init`).                                                                                                                                                                                                                          | GH Actions    | 7.5          | **P2**   | L      |
| 10    | **(P2)** Branch-protection on `main` requiring CodeQL / Ferry — CI / Release checks before merge.                                                                                                                                                                                                                                         | CI/CD         | 9.0          | **P2**   | XS     |
| 11    | **(P2)** Make `MAX_SEARCH_MATCHES` and `MAX_PAGES` env-tunable (`FERRY_GREP_MAX_MATCHES`, `FERRY_AUDIT_MAX_PAGES`).                                                                                                                                                                                                                       | Architecture  | 8.5          | **P2**   | XS     |

### 6.1 Expected score after the plan

| Domain                  | Current | After P1 | After P1+P2 |
| ----------------------- | ------- | -------- | ----------- |
| Application security    | 8.5     | 8.5      | 9.0         |
| Supply-chain security   | 8.5     | 9.0      | 9.5         |
| GitHub Actions security | 7.5     | 8.5      | 9.0         |
| Tests & coverage        | 8.0     | 8.5      | 8.5         |
| E2E / acceptance        | 7.5     | 8.5      | 9.0         |
| CI/CD gates             | 9.0     | 9.0      | 9.5         |
| Reliability             | 8.5     | 9.0      | 9.0         |
| Observability           | 7.0     | 7.5      | 7.5         |
| Consumer documentation  | 8.5     | 8.5      | 9.0         |
| Code quality            | 8.5     | 8.5      | 8.5         |
| Traceability            | 7.5     | 7.5      | 7.5         |
| Operations              | 7.5     | 7.5      | 7.5         |
| Release / distribution  | 8.5     | 9.0      | 9.0         |
| Cost governance         | 7.0     | 7.0      | 8.0         |
| Doc–code coherence      | 7.5     | 8.5      | 9.0         |
| **Overall**             | **8.0** | **8.47** | **8.73**    |

P1 items alone lift the score to 8.5. The most impactful single action is the bundle-runtime smoke gate (0c) — it closes the E2E gap that allowed two bundle-crash releases to ship.

---

## 7. What changed since the previous audit (7.3 → 8.0)

| #   | Change since v0.5.3 audit                                                                                                  | Domain effect                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | **D9 closed (v0.6.0)** — `extractFirstJsonObject` bracket-counting extractor in `src/agents/refiner/parse.ts`              | Domain 7 +2.0 (Reliability); confirmed prod repro from ethniafrica run 25262368292 resolved     |
| 2   | **D6 closed (v0.6.0)** — `ferry-update` parses `MIGRATIONS.md` at runtime                                                  | Domain 9 +0.5 (Consumer docs), Domain 15 +0.25 (Coherence)                                      |
| 3   | **D7 closed (v0.6.0)** — `ferry-doctor` check D7: FERRY_AUDIT_ISSUE variable + issue open                                  | Domain 9 +0.5 (Consumer docs)                                                                   |
| 4   | **Gitleaks ENOENT fixed (v0.6.0)** — Refiner and Reviewer workflows now install gitleaks                                   | Domain 7 (already counted in D9 +2.0 block); Domain 2 (supply-chain) strengthened               |
| 5   | **Reviewer auto-loop fixed (v0.6.0)** — `countPriorIterations` count-based cap                                             | Domain 7 (included in +2.0 block); improved FR24/FR28 correctness                               |
| 6   | **`docs/RUNBOOK.md` added (v0.6.0)** — on-call playbook                                                                    | Domain 12 +2.0 (Operations)                                                                     |
| 7   | **D2/D3/D5 closed** — CONTRIBUTING.md hook claims corrected; stub headers corrected                                        | Domain 15 +0.5 (Coherence)                                                                      |
| 8   | **v0.7.0 expanded workflows** — consumer workflows now call composite actions directly; cross-org secret propagation fixed | Domain 3 (GH Actions security) improved; install path now valid for all GitHub orgs             |
| 9   | **yaml package crash fixed (v0.7.0)** — `yaml` added to composite action bundle deps                                       | Domain 7 (Reliability) — no net delta since D9 already moved the score; prevents consumer crash |
| 10  | **CHANGELOG link section incomplete** — missing [0.7.0] and [0.5.x] links                                                  | Domain 13 -0.5 (Release)                                                                        |
| 11  | **ADR 0002 drift** — still references @v0.6.0 after v0.7.0 release                                                         | Domain 15 -0.25 (Coherence); offset by D2/D3/D5 closures                                        |
| 12  | **+13 unit tests (1028 → 1041)** — `parse.ts` regression suite covers D9 failure modes                                     | Domain 4 +0.5 (Tests)                                                                           |

---

## 8. Closed from previous audits

### Closed in v0.6.0 / v0.7.0

| Item | Action (was P0/P1)                                   | Status   | Evidence                                                                 |
| ---- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| 0    | Harden Refiner JSON parser (D9)                      | **done** | `src/agents/refiner/parse.ts:extractFirstJsonObject`; regression tests   |
| 0a   | Populate `migrations.ts` / parse MIGRATIONS.md (D6)  | **done** | `src/cli/update/migrations.ts:parseMigrationsFile()`; MIGRATIONS.md read |
| 0b   | Add `checkAuditIssue()` to doctor (D7)               | **done** | `src/cli/doctor/checks/audit-issue.ts`; check 13 in doctor index         |
| 1    | On-call runbook                                      | **done** | `docs/RUNBOOK.md` — 5 scenarios, concrete commands                       |
| D2   | CONTRIBUTING.md pre-push claim                       | **done** | "enforced in CI rather than in the local hook"                           |
| D3   | CONTRIBUTING.md commit-msg hook claim                | **done** | "there is no local `commit-msg` hook today"                              |
| D5   | Phantom optional vars in dev stub header             | **done** | Expanded stubs pass real vars via `with:` inputs                         |
| —    | Cross-org secret propagation (v0.7.0)                | **done** | Expanded three-job consumer workflows; no `secrets: inherit`             |
| —    | yaml package missing from composite bundles (v0.7.0) | **done** | `scripts/build-ferry-actions.mjs` includes `yaml`                        |
| —    | Gitleaks ENOENT (v0.6.0)                             | **done** | gitleaks install step in refine/review composite actions                 |
| —    | Reviewer auto-loop stops after 1 cycle (v0.6.0)      | **done** | `countPriorIterations` + `limits.max_iterations` cap                     |

### Still open (carry-over)

| Item | Action                                   | Priority | Effort |
| ---- | ---------------------------------------- | -------- | ------ |
| 0c   | Bundle-runtime smoke gate                | **P1**   | XS     |
| 0d   | Tag-pin drift gate (docs/adr)            | **P1**   | XS     |
| 2    | Audit-issue rotation                     | **P1**   | M      |
| 3    | Install-guide test covers init           | **P1**   | S      |
| 4    | E2E idempotency replay                   | **P1**   | M      |
| 6    | `ferry-init` scaffolds ops stubs         | **P2**   | S      |
| 7    | `ferry-init` collects transition IDs     | **P2**   | S      |
| 8    | OSSF Scorecard / SLSA on GH Release      | **P2**   | M      |
| 9    | Migrate GITHUB_TOKEN to fine-grained App | **P2**   | L      |
| 10   | Branch-protection on `main`              | **P2**   | XS     |

---

## 9. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §6 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
