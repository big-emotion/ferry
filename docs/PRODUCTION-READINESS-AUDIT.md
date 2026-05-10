# Production-Readiness Audit — Ferry

**Date:** 2026-05-10
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria. **Subject of this revision:** HEAD of `feat/255-cost-based-estimation` — `package.json .version = 0.10.3`, HEAD = `90983bb`, **13 commits ahead of `v0.10.3` tag**, all 13 are cost-based estimation features, MCP/Context7, ticket-type routing, and supporting fixes. Five releases shipped since the last audit (`v0.9.0`, `v0.10.0`, `v0.10.1`, `v0.10.2`, `v0.10.3`), completing the multi-provider expansion (all 4 agents on Anthropic / OpenAI / Google). Three consumer-impacting hotfixes in the v0.10.x window (same quality-blip pattern as v0.8.x) partially offset the major cost-governance improvement.
**Verdict:** **8.2 / 10 — Production-ready.** Net **0** vs. the v0.8.2 audit. Cost governance jumped from 7.0 → 8.5 (+1.5) on the strength of the new cost CLIs (`ferry-cost-report`, `ferry-cost-reconcile`, `ferry-cost-advice`, `ferry-cost-stats`) and the Refiner cost-estimation feature. This gain is offset by: a new npm audit HIGH vulnerability (fast-uri ≤3.1.1, regression from 0), 6 P1 hardcoded values in the new pricing / cost modules (stale EUR/USD rate, stale model pricing table, non-tunable `SOFT_THRESHOLD` and `ITERATION_FACTOR`), and the three-hotfix v0.10.x release-quality blip.
**Target:** **8–9 / 10**, comfortably inside the band. Top three actions to push toward 8.5+: (i) `npm audit fix` for fast-uri HIGH (XS); (ii) externalize pricing rates and EUR/USD exchange rate from `src/lib/llm/pricing.ts`; (iii) fix the CHANGELOG link-section drift (XS).

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (**1363** tests passing across 109 files in 2.51s, +163 tests / +9 files since the v0.8.2 audit), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`. Recent run history via `gh run list`.
- **Release artifacts:** `git tag --sort=-creatordate | head -10`, local `package.json`, `git log v0.8.2..HEAD`.
- **Docs:** `README.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`, `docs/RUNBOOK.md`, `docs/COST.md`, `docs/MCP.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/`, `src/cli/cost/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes.** All previously closed P0 blockers continue to hold. Multi-provider expansion (all four agents on Anthropic / OpenAI / Google) is complete through Phase 4. No agent has a known crash-category bug at HEAD. One new operational concern: the v0.10.x release window produced three consumer-impacting incidents (v0.10.0 crashed all Developer / Reviewer / Iterator runs with `ERR_MODULE_NOT_FOUND`; v0.10.2/v0.10.3 fixed a Refiner `GITHUB_TOKEN` wiring gap that caused every Refiner run to fail with `state-invariant: missing-env GITHUB_TOKEN`). Both were fixed same-day; both require consumers to re-run `ferry-update` or `ferry-init`. The npm audit now reports 1 HIGH vulnerability (fast-uri ≤3.1.1); it is a transitive dependency in the dev/build chain and is not present in the published CLI `dist/` output, but the fix is available via `npm audit fix`.
2. **Can a first-time consumer install and reach the full Jira → PR-approved cycle?** **Yes** — for consumers pinning `@v0.10.3` (the published tag). `install-guide.test.ts` 71/71 passing; all consumer stubs reference `@v0.10.3` consistently. `ferry-init` scaffolds correct stubs; `ferry-doctor` covers all checks. The three FR auto-transitions (FR18/FR24/FR28) are exercised by `src/e2e/pipeline.test.ts`. **Caveat:** consumers who pinned `@v0.10.0` saw immediate `ERR_MODULE_NOT_FOUND` crashes on Developer / Reviewer / Iterator; those on `@v0.10.1`/`@v0.10.2` saw every Refiner run fail with `state-invariant: missing-env GITHUB_TOKEN`. All three states are recoverable via `ferry-update`.
3. **Security posture?** **Strong with one new gap.** The npm audit now shows 1 HIGH vulnerability (fast-uri ≤3.1.1, fix available via `npm audit fix`) — regression from 0 at the v0.8.2 audit. All other controls remain strong: strict AJV schema validation, `execFileSync` everywhere, gitleaks on all four agent workflows, SHA-pinned third-party actions, CodeQL SAST, CODEOWNERS guards. MCP stdio integration (Context7 added at HEAD) extends the tool-call surface but is gated by the same agent-runtime controls. `harden-runner` egress allowlist on dev/iterate workflows remains absent (P1 carry-over).
4. **Is the score close to 8–9/10?** **Score is 8.2** — same composite as the v0.8.2 audit, but the composition has shifted. Cost governance jumped from 7.0 to 8.5 (+1.5) on the strength of the new cost CLIs and Refiner cost estimation. This gain is fully offset by: the npm audit HIGH regression (−0.5 Supply-chain), 6 P1 hardcoded values in the new pricing/cost modules (penalising Code quality and Consumer docs), the v0.10.x three-hotfix blip (−0.5 Release), and CHANGELOG link-section drift (−0.5 Doc-code coherence). Top three to reach 8.5: (i) `npm audit fix` for fast-uri (XS); (ii) externalize pricing rates and EUR/USD rate from `src/lib/llm/pricing.ts` (`FERRY_EUR_TO_USD`, `FERRY_PRICING_JSON` env overrides); (iii) fix CHANGELOG link section (XS).

---

## 2. Overall score — **8.2 / 10**

Movement since the v0.8.2 audit (8.2 → 8.2, net 0 across 15 domains). Five positive moves (Cost governance +1.5; Observability +0.5 for cost CLIs). Five offsetting regressions (Supply-chain −0.5 npm HIGH; Code quality −0.5 P1 hardcoded; Consumer docs −0.5 RELEASING.md + CHANGELOG; Release −0.5 hotfix blip; Doc-code coherence −0.5 CHANGELOG drift).

Quality gates at audit time:

- `npm run typecheck` — **clean** (`@big-emotion/ferry@0.10.3`)
- `npm run lint` — **clean**
- `npm run format:check` — **clean** (all 109 files Prettier-compliant)
- `npm test` — **109 files / 1363 tests / 100% passing in 2.51s** (+163 tests / +9 files since v0.8.2)
- `npm audit` (moderate+) — **1 HIGH** (fast-uri ≤3.1.1; fix available) — **regression from 0**
- `npx vitest run src/install-guide.test.ts` — **71/71 passing**
- TODO/FIXME/XXX/HACK count under `src/` — **3** (was 1 at v0.8.2)
- Recent CI on `main`: Ferry — CI ✓ (completed success); CodeQL in_progress (latest run); previous CodeQL run ✓ success.

Release artifacts proven:

- Tags: `v0.6.0` through `v0.10.3`, plus `v1` floating major (10 tags visible)
- `@big-emotion/ferry@0.10.3` published to npm with provenance
- GitHub Release `v0.10.3` created with notes from `CHANGELOG.md`
- **`feat/255-cost-based-estimation` is 13 commits ahead of `v0.10.3`** with cost CLIs (`ferry-cost-report`, `ferry-cost-reconcile`, `ferry-cost-advice`, `ferry-cost-stats`), MCP Context7 as default server, ticket-type label overrides, and supporting fixes. These features are awaiting the next cut.

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. v0.8.2 | Trend  |
| --- | ---------------------------------- | ------------ | ------------ | ------ |
| 1   | Application security               | **8.5 / 10** | 0            | strong |
| 2   | Supply-chain security              | **8.0 / 10** | −0.5         | ↓      |
| 3   | GitHub Actions security            | **7.5 / 10** | 0            | strong |
| 4   | Tests & coverage                   | **8.5 / 10** | 0            | strong |
| 5   | E2E / acceptance tests             | **8.5 / 10** | 0            | strong |
| 6   | CI/CD gates                        | **9.0 / 10** | 0            | strong |
| 7   | Reliability (idempotency, retries) | **9.0 / 10** | 0            | strong |
| 8   | Observability / audit              | **8.0 / 10** | +0.5         | ↑      |
| 9   | Consumer documentation             | **8.0 / 10** | −0.5         | ↓      |
| 10  | Code quality / typing              | **8.0 / 10** | −0.5         | ↓      |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0            | strong |
| 12  | Operations / runbooks / rollback   | **8.0 / 10** | 0            | strong |
| 13  | Release / distribution             | **8.0 / 10** | −0.5         | ↓      |
| 14  | Cost governance (runtime)          | **8.5 / 10** | +1.5         | ↑↑     |
| 15  | Doc–code coherence                 | **7.5 / 10** | −0.5         | ↓      |

Mean = **8.2 / 10** (15 axes; 122.5 / 15 = 8.167 → 8.2)

> **Domain 2 (Supply-chain) −0.5:** `npm audit` now reports 1 HIGH vulnerability (fast-uri ≤3.1.1). At the v0.8.2 audit there were 0 vulnerabilities. The affected package is a transitive dependency (not in the published CLI dist); `npm audit fix` resolves it. Held at −0.5 (not P0) because it does not affect the runtime action bundles or the published npm package's `files` entries.
>
> **Domain 8 (Observability) +0.5:** four new on-demand cost CLIs (`ferry-cost-report`, `ferry-cost-reconcile`, `ferry-cost-advice`, `ferry-cost-stats`) at HEAD give operators a complete spend-breakdown toolkit: markdown reports with sparklines, reconciliation against Anthropic CSV exports, ranked optimisation recommendations. Combined with the daily cost-check and the audit-issue `cost_eur` per execution, operators now have end-to-end cost observability without external infrastructure.
>
> **Domain 9 (Consumer docs) −0.5:** two new drift items. (a) `docs/RELEASING.md` line 159 still says "Four CLIs are exposed under the `bin` field" — but HEAD has 8 bin entries (4 cost CLIs added on `feat/255`). Must be updated before the next release. (b) CHANGELOG link section lists `[Unreleased]: compare/v0.10.1...HEAD`; `[0.10.2]` and `[0.10.3]` entries are missing from the link section, and the base should be `v0.10.3` (D13, new).
>
> **Domain 10 (Code quality) −0.5:** P1 hardcoded values rose from 2 to 6 (four new items in the pricing/cost modules; see §5 Hardcoded values). The EUR/USD exchange rate in `src/lib/llm/pricing.ts` is pinned to 2025-Q2 (now 1 year stale) and is load-bearing for all cost estimates and spend-cap enforcement. The model pricing table is equally stale. `SOFT_THRESHOLD = 0.5` and `ITERATION_FACTOR = 1.4` in the new cost modules are also not env-tunable. TODO/FIXME count rose from 1 to 3.
>
> **Domain 13 (Release) −0.5:** the v0.10.x window had three consumer-impacting incidents: (i) v0.10.0 shipped with `ERR_MODULE_NOT_FOUND: Cannot find package 'openai'` crashing all Developer/Reviewer/Iterator runs even on Anthropic-only config; (ii) v0.10.2 fixed a Refiner `GITHUB_TOKEN` wiring gap (`ferry-run-refiner/action.yml` never wired `github_token`/`github_repo`) that caused every Refiner run to fail immediately. Both were hotfixed same-day. This repeats the v0.8.x quality-blip pattern — net-zero on Domain 13 for the fixes, but the third incident underscores a pre-release action-bundle smoke-test gap for new composite-action inputs.
>
> **Domain 14 (Cost governance) +1.5:** four new cost CLIs at HEAD + Refiner cost-estimation + `docs/COST.md` complete the cost observability story. The daily-check workflow (already in consumer stubs) is now paired with on-demand tooling that consumers can run locally or in CI. The Refiner now emits a cost estimate for each ticket plan so consumers can triage expensive tickets before they reach the Developer. Score rises from 7.0 to 8.5; held back from 9.0 by the stale pricing table and non-tunable `SOFT_THRESHOLD`.
>
> **Domain 15 (Doc-code coherence) −0.5:** new D13 drift (CHANGELOG link section base `v0.10.1` instead of `v0.10.3`; missing `[0.10.2]` and `[0.10.3]` links). D10 (CHANGELOG v0.5.x links) carries over for a fourth cycle.

---

## 4. Domain analysis

### 4.1 Application security — 8.5 (unchanged)

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- All shell calls use `execFileSync` with argv-as-array. The single `spawn` (`src/agents/developer/tools.ts`) also passes args as an array.
- `FerryError` taxonomy with typed codes (`state-invariant`, `spend-cap`, `transient`, `unknown`).
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit; gitleaks runs on **all four** agent dispatch workflows.
- `@typescript-eslint/no-explicit-any: 'error'` plus `no-restricted-imports` for agent code (verified via `src/agents/restricted-imports.test.ts`).
- "Ferry never merges" invariant asserted by `src/e2e/pipeline.test.ts`.
- Read_file size cap (256 KB hard, 64 KB head+tail truncation), agent-loop history compaction and pruning.
- Multi-provider complete across all 4 agents; the same restricted-import rules apply to all provider paths.
- MCP stdio integration (Context7 at HEAD): agent-runtime gates which MCP servers are activated per ticket via label mapping; no arbitrary server injection.

**Weaknesses**

- LLM-supplied `commit_message` reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 8.0 (−0.5)

Tag-pin consistency table (HEAD = `90983bb`, `package.json .version = 0.10.3`):

| Location                                                                         | Pin                                                  | Status        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------- |
| `package.json` `.version`                                                        | `0.10.3`                                             | canonical     |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.10.3`                                           | match         |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.10.3`                                            | match         |
| `docs/CONFIGURATION.md` (lines 127, 150)                                         | `@v0.10.3`                                           | match         |
| `docs/RELEASING.md` (lines 26, 30, 46, 50, 159)                                  | `@v0.10.3`                                           | match         |
| `src/install-guide.test.ts` (line 49)                                            | `@v0.10.3`                                           | match         |
| `docs/adr/0002-ferry-bundles-committed.md` (lines 16, 34, 35)                    | `@v0.10.3`                                           | match         |
| `CHANGELOG.md` link section                                                      | `[Unreleased]` base = `v0.10.1`; `[0.10.2]`/`[0.10.3]` links missing | **DRIFT** |
| `git tag --list`                                                                 | includes `v0.10.0`–`v0.10.3`, `v1`                  | exist         |
| `npm @big-emotion/ferry`                                                         | `0.10.3`                                             | published     |
| `npm audit` (moderate+)                                                          | fast-uri ≤3.1.1 — **1 HIGH**                         | **VULN**      |

**Action 0d (tag-pin drift gate) status:** CHANGELOG link section drift (D13) is a new recurrence of the drift class. The systematic guard (regex assertion in `src/install-guide.test.ts` that scans docs for `@v[0-9.]+` literals and fails if any disagrees with `package.json .version`) remains unimplemented — now entering its **4th cycle** as a carry-over.

**Strengths**

- CodeQL SAST wired — recent run green.
- `audit:ci` job in CI; all actions SHA-pinned with version comments.
- Bundle-drift check + smoke-bundle gate in CI.
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped.
- npm publish uses `--provenance --access public`.
- No `@main` refs found anywhere in `.github/workflows/` or `examples/consumer-setup/workflows/`.

**Weaknesses**

- **1 HIGH npm vulnerability: fast-uri ≤3.1.1** — fix available via `npm audit fix`. Not in published dist but should be cleared before the next release.
- CHANGELOG link section: `[Unreleased]` base is `v0.10.1`; entries for `v0.10.2` and `v0.10.3` missing from the link section (D13, new).
- Action 0d (systematic tag-pin drift gate) still not implemented — 4th cycle carry-over.
- No SLSA provenance on the GitHub Release artifact.
- No SBOM, no OSSF Scorecard.

### 4.3 GitHub Actions security — 7.5 (unchanged)

**Strengths**

- Explicit `permissions:` blocks on every job.
- Concurrency groups per ticket prevent races; `cancel-in-progress: false` on writes, `true` on read-only.
- Fallback `'ferry-invalid-payload-sinkhole'` blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.
- Consumer workflows expanded into three jobs calling composite actions directly — no `secrets: inherit`.
- Composite-action input validator (`src/lib/agent-runtime/composite-action.test.ts`) prevents shipping unsupported keys.

**Weaknesses**

- `GITHUB_TOKEN` used by composite actions instead of a fine-grained GitHub App (P2).
- No `harden-runner` (StepSecurity) for egress allowlisting on dev/iterate workflows that perform git push (P1, carry-over — 3rd cycle).
- No OIDC for federated auth to Anthropic / Jira / OpenAI / Google.

### 4.4 Tests & coverage — 8.5 (unchanged)

| Metric  | Status                                                                              |
| ------- | ----------------------------------------------------------------------------------- |
| Suite   | **109 files / 1363 tests / all passing in 2.51s**                                   |
| Reports | text, text-summary, html, lcov                                                      |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`                                         |
| Δ       | +163 tests / +9 files since v0.8.2 audit (1200 → 1363 tests, 100 → 109 files)      |

**Strengths**

- New cost CLI modules: `src/cli/cost/*.test.ts` covers `ferry-cost-report`, `ferry-cost-stats`, `ferry-cost-advice`, `ferry-cost-reconcile`.
- New cost estimation module: `src/agents/refiner/cost-estimate.test.ts` and `src/agents/refiner/refiner-action.cost-estimate.test.ts`.
- D9 regression suite (`extractFirstJsonObject`) intact.
- CLI module coverage: every doctor check has a sibling `.test.ts`.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).

### 4.5 E2E / acceptance tests — 8.5 (unchanged)

**Strengths**

- **Mocked end-to-end pipeline test** (`src/e2e/pipeline.test.ts`) replays refine→dev→review→iterate, asserts no-auto-merge invariant, exercises FR18/FR24/FR28.
- **Install-guide acceptance test** (`src/install-guide.test.ts`, 71 tests) covers 18 sections of the README including no-`@main` refs and correct `@v0.10.3` pins.
- Bundle-runtime smoke gate wired as a CI job.
- Composite-action input validator closes the `timeout-minutes` regression class.

**Weaknesses**

- No idempotency assertion across a full replay of the same `event_id` (P1, carry-over — 4th cycle).
- Install-guide test validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts` (P1, carry-over — 3rd cycle). The v0.10.x `ferry_model:` regression would have been caught at this layer.

### 4.6 CI/CD gates — 9.0 (unchanged)

**Strengths**

- Parallel CI jobs: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `check-bundle`, `smoke-bundle`, `audit`; plus CodeQL, release gate.
- All actions SHA-pinned (`actions/checkout@de0fac2e4500...`, `actions/setup-node@48b55a011bda...`).
- Concurrency cancels superseded CI runs.
- Husky pre-push hook re-runs the full suite locally.
- Recent CI runs on `main`: Ferry — CI ✓ (completed success).

**Weaknesses**

- No `npm ci --audit-signatures` integrity check.
- No required-checks branch-protection preventing direct push to `main`.

### 4.7 Reliability — 9.0 (unchanged)

**Strengths**

- All v0.8.x closures hold: D9 Refiner JSON parser, reviewer→iterator loop, gitleaks ENOENT.
- Audit-issue rotation tested and wired (`FERRY_AUDIT_ROTATION_THRESHOLD` env-tunable, default 900).
- Read_file caps, agent-loop compaction, cache_control stripping on prior tool-results.
- Developer WIP-commit-on-failure, 3-state `done` outcome.
- `v0.10.2`: iterator re-keyed idempotency on PR head SHA to recover stuck transitions.
- Locale pinned to en-US for all number formatting.

**Weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- Reconciler depends on the consumer wiring `ferry-reconcile.yml`.

### 4.8 Observability — 8.0 (+0.5)

**Strengths**

- **New (HEAD):** `ferry-cost-report` — reads `ferry-audit.jsonl` and renders markdown tables (per-phase, per-model, per-ticket, per-day) with ASCII sparklines.
- **New (HEAD):** `ferry-cost-stats` — computes per-phase statistical baselines (median, p90, window runs) from the audit log; outputs `cost-baseline.json` consumed by the Refiner.
- **New (HEAD):** `ferry-cost-advice` — ranked list of optimisation recommendations derived from the audit log.
- **New (HEAD):** `ferry-cost-reconcile` — diffs local audit log against Anthropic CSV export to surface billing discrepancies.
- **New (HEAD):** Refiner emits a `cost_estimate` field in its output (low/medium/high confidence, USD range) so consumers can see expected ticket cost before the Developer runs.
- Existing: `GITHUB_STEP_SUMMARY` emitter, audit-issue trail, structured JSON logger, soft-budget warnings at 70%/85% of `max_tokens_per_run`, daily cost-check workflow.
- `docs/COST.md` documents the full cost toolchain.

**Weaknesses**

- EUR/USD rate and model pricing table are stale (see §5); cost estimates drift as real prices change.
- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — stalled ticket waits silently (mitigated if consumer wires reconciler).
- Some raw `console.log` calls remain under `src/`.

### 4.9 Consumer documentation — 8.0 (−0.5)

**Strengths**

- `ferry-init` emits 4 expanded three-job stubs pinned to `@v0.10.3` with correct per-agent model input names.
- `ferry-doctor` covers all checks including `FERRY_AUDIT_ISSUE`.
- `ferry-update` parses `MIGRATIONS.md` at runtime; consumers see v0.10.x follow-ups (including the `github_token`/`github_repo` addition for Refiner).
- `docs/CONFIGURATION.md` documents MCP configuration (label mapping, stdio/HTTP transport constraints, Context7 as default).
- Ticket-type label overrides (`ferry:type:enable-task`, `force-*`) documented in `docs/CONFIGURATION.md` §4.
- `docs/COST.md` documents all four cost CLIs end-to-end.
- `docs/MCP.md` provides a full MCP registry table.

**Weaknesses**

- **D13 (new):** `CHANGELOG.md` link section base is `v0.10.1`; `[0.10.2]` and `[0.10.3]` entries missing from the link section. `[Unreleased]` base should be `v0.10.3`.
- **D14 (pending release):** `docs/RELEASING.md` line 159 documents "Four CLIs are exposed under the `bin` field" — but HEAD has 8 bin entries (4 cost CLIs). Must be updated before the next release cut.
- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` (P2, carry-over).
- `ferry-init` does not collect the two transition IDs — still a manual README step (P2, carry-over).
- No `workflowTemplates()` invocation in `install-guide.test.ts` (P1, carry-over — 3rd cycle).

### 4.10 Code quality — 8.0 (−0.5)

**Strengths**

- Strict TypeScript NodeNext ESM, `no-explicit-any: error`.
- ESLint with agent-specific rules; restricted-imports verified by test.
- Prettier mandatory and currently clean.
- Layered architecture respected; agents never import Octokit/Jira directly (verified by `src/agents/restricted-imports.test.ts`).
- Cost CLI modules follow the existing flat-layout convention; clean separation between parse, format, run.

**Weaknesses**

- **6 P1 hardcoded values** — four new in pricing/cost modules (see §5); threshold triggers −1 penalty on this domain.
- TODO/FIXME count increased from 1 to 3.
- No complexity gates (cyclomatic, max lines).
- `src/agents/reviewer/review-loop.ts` size still hints at complexity debt.

### 4.11 Traceability / FR governance — 7.5 (unchanged)

**Strengths**

- `docs/REQUIREMENTS.md` is the single source of truth for `FR\d+` IDs.
- `npm run check:fr-drift` wired into CI; fails on undocumented FR tags.
- Five ADRs cover the foundational decisions.
- Audit issue traces every runtime execution.

**Weaknesses**

- No commit-msg lint enforcing FR or issue back-reference.
- No bidirectional code → FR mapping beyond grep.

### 4.12 Operations — 8.0 (unchanged)

**Strengths**

- `docs/RUNBOOK.md` — concrete on-call playbook.
- `ferry-uninstall` CLI — reversible-deploy path.
- `ferry-update` CLI — migration path, reads `MIGRATIONS.md`.
- Reconciler + cost-daily stubs ship in `examples/consumer-setup/workflows/`, pinned to `v0.10.3`.
- Pre/post-agent command hooks on all four composite actions.
- Developer WIP-commit-on-failure.
- 3-state outcome (`success` / `partial` / `blocked`).

**Weaknesses**

- No proactive monitoring — audit issue pings nobody.
- Reconciler effectiveness depends on consumer wiring the stub.

### 4.13 Release / distribution — 8.0 (−0.5)

Five releases shipped in this audit window (`v0.9.0`, `v0.10.0`, `v0.10.1`, `v0.10.2`, `v0.10.3`, all on 2026-05-05). Three consumer-impacting incidents:

1. **`v0.10.0` `ERR_MODULE_NOT_FOUND`:** all Developer / Reviewer / Iterator runs crashed before any agent code executed, even when configured for Anthropic only. Root cause: `build-ferry-actions.mjs` only declared `@anthropic-ai/sdk` in per-action `package.json` files after the multi-provider port (#234). Fixed in `v0.10.1` by shipping all three provider SDKs in every action bundle.
2. **`v0.10.2` / `v0.10.3` Refiner `GITHUB_TOKEN` gap:** `ferry-run-refiner/action.yml` was the only agent action missing `github_token`/`github_repo` inputs; every Refiner run failed immediately with `state-invariant: missing-env GITHUB_TOKEN`. Fixed in `v0.10.3` (`e80058d`). Note: the CHANGELOG entry is listed under `## [0.10.3]` which is correct — the fix is in v0.10.3, not v0.10.2 as initially suggested by the release sequence.

This repeats the v0.8.x quality-blip pattern (two consumer-impacting hotfixes per minor cycle). The composite-action input validator (#229) prevents `timeout-minutes`-style regressions but does not catch missing required inputs (GITHUB_TOKEN) or missing runtime dependencies (npm packages).

**Strengths**

- Release pipeline proven on fifteen tag pushes (v0.4.0 through v0.10.3). All pipelines green.
- `v1` floating tag advances correctly.
- npm publish uses `--provenance --access public`.
- `MIGRATIONS.md` maintained; `ferry-update` consumers see required follow-ups.
- HEAD is 13 commits ahead of `v0.10.3` with substantial features (cost CLIs, MCP, routing) awaiting the next cut. No cadence drag.

**Weaknesses**

- Three consumer-impacting hotfixes in the v0.10.x window — quality-blip pattern.
- CHANGELOG link section drift (D13): `[Unreleased]` base is `v0.10.1`; `[0.10.2]` and `[0.10.3]` links missing.
- D10 carry-over: `[0.5.0]`–`[0.5.3]` links still absent (4th cycle).
- No SLSA provenance on the GitHub Release artifact.

### 4.14 Cost governance — 8.5 (+1.5)

**Strengths**

- **`ferry-cost-report`** reads `ferry-audit.jsonl` and renders per-phase, per-model, per-ticket, per-day tables with ASCII sparklines. Supports `--format md/json/csv` and `--out`.
- **`ferry-cost-stats`** computes per-phase baselines (median, p90, window run count) and outputs `cost-baseline.json`.
- **`ferry-cost-advice`** produces ranked cost-optimisation recommendations from the audit log.
- **`ferry-cost-reconcile`** diffs the audit log against an Anthropic CSV export to surface billing discrepancies.
- **Refiner cost estimation:** if `cost-baseline.json` exists in the repo root, the Refiner emits a `cost_estimate` (low/high USD range, confidence level) with every plan.
- Existing: daily-check workflow auto-pauses via `ferry:paused` label at 50% of `FERRY_SPEND_CAP_EUR`; soft-budget warnings at 70%/85% of `max_tokens_per_run`; audit line carries `cost_eur` per execution.
- `docs/COST.md` documents the full toolchain.

**Weaknesses**

- EUR/USD exchange rate pinned to 2025-Q2 (`src/lib/llm/pricing.ts:8`) — now 1 year stale. All cost estimates drift as the real rate changes. Should be `FERRY_EUR_TO_USD` env-tunable.
- Model pricing table in `src/lib/llm/pricing.ts` is equally stale — rates noted "2025-Q2" and some model names in the table may not reflect current offerings.
- `SOFT_THRESHOLD = 0.5` in `src/cost-governance/daily-check.ts:34` is hardcoded — consumers who want to pause at 40% or 60% must fork the file. Should be `FERRY_PAUSE_THRESHOLD_RATIO`.
- `ITERATION_FACTOR = 1.4` in `src/agents/refiner/cost-estimate.ts:10` is hardcoded — higher-iteration workflows will systematically underestimate. Should be `FERRY_COST_ITERATION_FACTOR`.
- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.

### 4.15 Doc–code coherence — 7.5 (−0.5)

**Closed drift items (D1–D9, D11)** — all hold at this revision.

**Drift items (current)**

| #   | Drift                                                                                                                                                                                                      | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D10 | **CHANGELOG link section missing `[0.5.0]`–`[0.5.3]` release tag links.** 4th-cycle carry-over.                                                                                                           | low      |
| D12 | **Action 0d (systematic tag-pin drift gate) still not implemented.** 4th-cycle carry-over.                                                                                                                 | low      |
| D13 | **CHANGELOG link section stale.** `[Unreleased]` base is `v0.10.1`; `[0.10.2]` and `[0.10.3]` links are missing. D-class drift introduced between v0.10.1 and v0.10.3 cuts.                               | medium   |
| D14 | **`docs/RELEASING.md` line 159 lists four CLIs**, but HEAD has 8 bin entries. Must be updated before the next release cut when the cost CLIs ship.                                                         | medium (pre-release) |

**Net coherence assessment**

D1–D9, D11 closures hold. D13 (CHANGELOG link section drift) is new and medium-severity — it affects CHANGELOG navigation for `v0.10.2`/`v0.10.3` consumers. D14 is a pending pre-release checklist item, not yet a shipped drift. **Score: 7.5** (−0.5 from v0.8.2 for D13).

---

## 5. Gaps and risks

### 5.1 Hardcoded values (P0/P1)

Scan scope: `src/**/*.ts`, excluding `*.test.ts`, `__fixtures__/`, `__lint-fixtures__/`, `src/schemas/*.json`.

**Assessment:** P0 count is **0**. P1 count is **6** — at the 6-item threshold; −1 penalty applied to Code quality (D10) and Consumer DX (D9 proxy).

**P1 — Cost & Budget Thresholds (new)**

- **P1** `src/lib/llm/pricing.ts:8` — `EUR_TO_USD = 1 / 0.93` — exchange rate pinned to 2025-Q2, now 1 year stale. All cost estimates and spend-cap enforcement drift with this value. Should become `FERRY_EUR_TO_USD` env-tunable (default `0.93`).
- **P1** `src/lib/llm/pricing.ts:12–21` — `RATES` table — token-cost rates for all providers/models pinned to 2025-Q2. Some model names may not match current offerings. Should support `FERRY_PRICING_OVERRIDES_JSON` for consumer overrides without forking.
- **P1** `src/cost-governance/daily-check.ts:34` — `SOFT_THRESHOLD = 0.5` — the 50% cap threshold that triggers ticket pausing. Not env-tunable. Should become `FERRY_PAUSE_THRESHOLD_RATIO` (default `0.5`).
- **P1** `src/agents/refiner/cost-estimate.ts:10` — `ITERATION_FACTOR = 1.4` — multiplier applied to developer/iterator p90s in cost estimation. Workflows with more revision cycles will systematically underestimate. Should become `FERRY_COST_ITERATION_FACTOR` (default `1.4`).

**P1 — Size & Batch Limits (carry-over)**

- **P1** `src/agents/developer/tools.ts:23` — `MAX_SEARCH_MATCHES = 200` — grep result cap for the dev agent; silent truncation on large repos. Should become `FERRY_GREP_MAX_MATCHES`.
- **P1** `src/lib/audit/index.ts:40` — `MAX_PAGES = 10` — caps audit comment pagination at 1,000. Not env-tunable. Works in practice because rotation triggers at 900, but the ceiling is rigid.

**P2 items (acceptable as-is):** All existing `FERRY_*` env-tunable constants remain in place. New: `ITERATION_FACTOR`'s confidence thresholds (`< 10 → low`, `< 50 → medium`, `>= 50 → high` in `cost-estimate.ts:54–58`) are reasonable defaults unlikely to need per-consumer tuning. `SAMPLE_MAX = 512` in `src/agents/refiner/refine.ts:123` (JSON sample truncation in dry-run) is a log hint, not load-bearing.

---

## 6. Prioritized action plan (residual)

| Order | Action                                                                                                                                                                                                                                                                                             | Domain        | Score before | Priority | Effort |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- | ------ |
| 1     | **(P0 → quick win)** `npm audit fix` to resolve fast-uri ≤3.1.1 HIGH. Run before the next release cut.                                                                                                                                                                                            | Supply-chain  | 8.0          | **P0**   | XS     |
| 2     | **(P1, new)** Externalize `EUR_TO_USD` and `RATES` table from `src/lib/llm/pricing.ts` — add `FERRY_EUR_TO_USD` env var (default `0.93`) and a `FERRY_PRICING_OVERRIDES_JSON` opt-in for consumers with custom models or contracts. Update the table to current 2026-Q2 rates.                   | Cost / Arch   | 8.5          | **P1**   | S      |
| 3     | **(P1, new)** Fix CHANGELOG link section (D13): update `[Unreleased]` base to `v0.10.3` and add `[0.10.2]` + `[0.10.3]` links. XS effort; needed before any consumer links to the CHANGELOG.                                                                                                      | Coherence     | 7.5          | **P1**   | XS     |
| 4     | **(P1, carry-over — 4th cycle)** Action 0d: add a regex assertion that scans `docs/adr/*.md`, `docs/RELEASING.md`, `docs/CONFIGURATION.md` for `@v[0-9.]+` literals and fails CI if any disagrees with `package.json .version`.                                                                    | Coherence     | 7.5          | **P1**   | XS     |
| 5     | **(P1, carry-over — 3rd cycle)** Add `harden-runner` egress allowlist to dev/iterate workflows.                                                                                                                                                                                                    | GH Actions    | 7.5          | **P1**   | S      |
| 6     | **(P1, new)** Externalize `SOFT_THRESHOLD = 0.5` in `daily-check.ts` as `FERRY_PAUSE_THRESHOLD_RATIO` and `ITERATION_FACTOR = 1.4` in `cost-estimate.ts` as `FERRY_COST_ITERATION_FACTOR`.                                                                                                        | Cost          | 8.5          | **P1**   | XS     |
| 7     | **(P1, carry-over — 3rd cycle)** Extend `install-guide.test.ts` to invoke `workflowTemplates()` from `src/cli/init/templates.ts` and assert each emitted stub's composite-action refs and tag.                                                                                                     | E2E           | 8.5          | **P1**   | S      |
| 8     | **(P1, carry-over — 4th cycle)** Add e2e idempotency replay: same `event_id` twice → same outcome, no duplicate external writes.                                                                                                                                                                   | E2E           | 8.5          | **P1**   | M      |
| 9     | **(pre-release checklist)** Update `docs/RELEASING.md` line 159 to reflect 8 CLIs; add a "verify `ferry-cost-*` CLIs" step to the release checklist.                                                                                                                                               | Consumer docs | 8.0          | **P1**   | XS     |
| 10    | **(P2)** `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the README curl step).                                                                                                                                                                             | Consumer docs | 8.0          | **P2**   | S      |
| 11    | **(P2)** `ferry-init` collects the two transition IDs and sets them as secrets.                                                                                                                                                                                                                    | Consumer docs | 8.0          | **P2**   | S      |
| 12    | **(P2)** OSSF Scorecard + SLSA provenance on the GitHub Release artifact.                                                                                                                                                                                                                          | Supply chain  | 8.0          | **P2**   | M      |
| 13    | **(P2)** Env-tunable `MAX_SEARCH_MATCHES` / `MAX_PAGES` (`FERRY_GREP_MAX_MATCHES`, `FERRY_AUDIT_MAX_PAGES`).                                                                                                                                                                                       | Architecture  | 8.0          | **P2**   | XS     |
| 14    | **(low)** Backfill `[0.5.0]`–`[0.5.3]` links in `CHANGELOG.md` (D10, 4th cycle).                                                                                                                                                                                                                   | Release       | 8.0          | low      | XS     |
| 15    | **(P2)** Branch-protection on `main` requiring CodeQL / Ferry — CI checks before merge.                                                                                                                                                                                                            | CI/CD         | 9.0          | **P2**   | XS     |

### 6.1 Expected score after the plan

| Domain                  | Current | After P1 (1–9) | After All |
| ----------------------- | ------- | -------------- | --------- |
| Application security    | 8.5     | 8.5            | 9.0       |
| Supply-chain security   | 8.0     | 9.0            | 9.5       |
| GitHub Actions security | 7.5     | 8.5            | 9.0       |
| Tests & coverage        | 8.5     | 8.5            | 8.5       |
| E2E / acceptance        | 8.5     | 9.0            | 9.0       |
| CI/CD gates             | 9.0     | 9.0            | 9.5       |
| Reliability             | 9.0     | 9.0            | 9.0       |
| Observability           | 8.0     | 8.0            | 8.5       |
| Consumer documentation  | 8.0     | 8.5            | 9.0       |
| Code quality            | 8.0     | 8.5            | 9.0       |
| Traceability            | 7.5     | 7.5            | 7.5       |
| Operations              | 8.0     | 8.0            | 8.5       |
| Release / distribution  | 8.0     | 8.5            | 9.0       |
| Cost governance         | 8.5     | 9.0            | 9.0       |
| Doc–code coherence      | 7.5     | 8.5            | 9.0       |
| **Overall**             | **8.2** | **8.67**       | **8.93**  |

The single most impactful cluster is **#1 + #2 + #3 + #4** (XS efforts): `npm audit fix`, pricing externalization, CHANGELOG drift fix, and action 0d — four small tasks that close two persistent drift classes and the new npm regression, pushing the overall score above 8.5.

---

## 7. What changed since the v0.8.2 audit (8.2 → 8.2; net 0, composition shifted)

| #   | Change                                                                                                                                                                             | Domain effect                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | **`v0.9.0` cut** — multi-provider Phase 3/4: all four agents configurable on Anthropic / OpenAI / Google                                                                           | Domain 1, Domain 4 strengthened; Domain 13 cadence ✓            |
| 2   | **`v0.10.0` cut** — multi-provider agent-loop port (#234); `ERR_MODULE_NOT_FOUND` incident for Dev/Reviewer/Iterator                                                               | Domain 13 −0.5 (quality blip, partially offset by fix)          |
| 3   | **`v0.10.1` hotfix** — provider SDKs added to all action bundles                                                                                                                   | Domain 13 (hotfix counted)                                      |
| 4   | **`v0.10.2` hotfix + `v0.10.3` fix** — Refiner GITHUB_TOKEN/GITHUB_REPO wiring gap                                                                                                 | Domain 13 (second hotfix)                                       |
| 5   | **Cost CLIs at HEAD** — `ferry-cost-report`, `ferry-cost-stats`, `ferry-cost-advice`, `ferry-cost-reconcile`                                                                        | Domain 8 +0.5; Domain 14 +1.5                                   |
| 6   | **Refiner cost estimation** — `cost-estimate.ts` reads `cost-baseline.json`, emits USD range + confidence with every plan                                                          | Domain 14 (counted above)                                       |
| 7   | **MCP Context7 as default** — all agents gain documentation retrieval via Context7 stdio server; `docs/MCP.md` added                                                               | Domain 1, Domain 9 strengthened                                 |
| 8   | **Ticket-type label overrides** — `ferry:type:enable-task`, `force-bug/spike/story`; documented in `docs/CONFIGURATION.md` §4                                                     | Domain 9, Domain 12 strengthened                                |
| 9   | **+163 unit tests** — cost CLI coverage, cost-estimate tests, multi-provider tests                                                                                                 | Domain 4 strengthened (held at 8.5)                             |
| 10  | **npm audit HIGH regression** — fast-uri ≤3.1.1                                                                                                                                    | Domain 2 −0.5                                                   |
| 11  | **6 P1 hardcoded values** — 4 new in pricing/cost modules; EUR/USD rate stale                                                                                                       | Domain 10 −0.5; Domain 9 partial                                |
| 12  | **CHANGELOG link section drift** (D13) — `[Unreleased]` base `v0.10.1`, missing v0.10.2/v0.10.3 links                                                                              | Domain 15 −0.5; Domain 13 partial                               |
| 13  | **TODO count** 1 → 3                                                                                                                                                               | Domain 10 minor                                                 |

---

## 8. Closed from previous audits

### Closed since the v0.8.2 audit

| Item | Action (was P1/carry-over)                   | Status   | Evidence                                                                              |
| ---- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| R    | Cut `v0.9.0` / `v0.10.x` — ship multi-provider Phase 2/3/4 | **done** | Five releases shipped: v0.9.0, v0.10.0, v0.10.1, v0.10.2, v0.10.3         |
| —    | CHANGELOG links for v0.8.x                   | **done** | `[0.8.0]`, `[0.8.1]`, `[0.8.2]`, `[0.9.0]`, `[0.10.0]`, `[0.10.1]` all present     |

### Still open (carry-over)

| Item | Action                                                   | Priority | Effort | Cycle |
| ---- | -------------------------------------------------------- | -------- | ------ | ----- |
| 1    | `npm audit fix` (fast-uri HIGH) — **new**                | **P0**   | XS     | 1     |
| 2    | Externalize EUR/USD rate + pricing table — **new**       | **P1**   | S      | 1     |
| 3    | Fix CHANGELOG link section (D13) — **new**               | **P1**   | XS     | 1     |
| 4    | Tag-pin drift gate (action 0d)                           | **P1**   | XS     | 4     |
| 5    | `harden-runner` egress allowlist                         | **P1**   | S      | 3     |
| 6    | Externalize SOFT_THRESHOLD + ITERATION_FACTOR — **new**  | **P1**   | XS     | 1     |
| 7    | Install-guide test covers `workflowTemplates()`          | **P1**   | S      | 3     |
| 8    | E2E idempotency replay                                   | **P1**   | M      | 4     |
| 9    | Update RELEASING.md for 8 CLIs                           | **P1**   | XS     | 1     |
| 10   | `ferry-init` scaffolds ops stubs                         | **P2**   | S      |       |
| 11   | `ferry-init` collects transition IDs                     | **P2**   | S      |       |
| 12   | OSSF Scorecard / SLSA on GH Release                      | **P2**   | M      |       |
| 13   | Env-tunable `MAX_SEARCH_MATCHES` / `MAX_PAGES`           | **P2**   | XS     |       |
| 14   | Backfill `[0.5.0]`–`[0.5.3]` CHANGELOG links (D10)       | low      | XS     | 4     |
| 15   | Branch-protection on `main`                              | **P2**   | XS     |       |

---

## 9. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §6 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
