# Production-Readiness Audit — Ferry

**Date:** 2026-05-05
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria. **Subject of this revision:** the post-`v0.7.0` `main` tip — `package.json .version = 0.7.0`, HEAD = `fa17be5`, **25 commits ahead of `v0.7.0`**, no new tag yet. The delta since the last audit is mostly hardening (bundle-runtime smoke gate, agent-loop history compaction/pruning, read*file size caps, externalized LLM SDKs from action bundles, soft-budget warnings, content-aware re-trigger dedup, ferry.config base-branch reload).
**Verdict:** **8.0 / 10 — Production-ready.** No regressions versus v0.7.0; one P1 carry-over (bundle-runtime smoke gate) closed, one (audit-issue rotation) was already in place at v0.7.0 and was incorrectly listed as open. New surface is one mid-sized release worth of unreleased work on `main` — recommendation is to cut `v0.8.0` so consumers can pick up the smoke gate, the read_file cap (issue #185), and the cross-org `B2 FERRY*\*`repo variables.
**Target:** **8–9 / 10**, achievable in one focused sprint on the residual P1 items in §6 plus a`v0.8.0` cut.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (**1119** tests passing across 91 files in 2.99s, +78 tests / +3 files since v0.7.0 audit), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`. Recent run history via `gh run list`.
- **Release artifacts:** `git tag --sort=-creatordate | head -10`, local `package.json`, `git log v0.7.0..HEAD`.
- **Docs:** `README.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`, `docs/RUNBOOK.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes.** All v0.5.3 P0 blockers remain closed at HEAD: D9 Refiner JSON parser hardened; D6 `ferry-update` parses `MIGRATIONS.md` at runtime; D7 `ferry-doctor` covers `FERRY_AUDIT_ISSUE`. No agent has a known crash-category bug. Several reliability hardenings have landed since v0.7.0 (read_file 256KB cap with head+tail truncation, agent-loop message-history compaction, cache_read_input_tokens reweighted at 0.1× to stop false token-cap blow-ups, bash output truncation marker). Remaining gaps are P1/P2 operational items.
2. **Can a first-time consumer install and reach the full Jira → PR-approved cycle?** **Yes** — for consumers pinning `@v0.7.0` (the published tag). Walking the install path: (i) `npx -p @big-emotion/ferry ferry-init` runs the wizard, sets secrets via `gh secret set`, generates `ferry.config.yaml`, writes 4 expanded three-job stubs pinned to `@v0.7.0`. (ii) `ferry-doctor` covers all 13 checks including the `FERRY_AUDIT_ISSUE` repo variable. (iii) `ferry-update` prints `MIGRATIONS.md` follow-ups so upgrading consumers are not silently stranded. (iv) The expanded workflow architecture (gate-envelope → run-agent → emit-audit) avoids `secrets: inherit` cross-org propagation. (v) The three FR auto-transitions (FR18/FR24/FR28) are exercised by `src/e2e/pipeline.test.ts:377`. (vi) `install-guide.test.ts` (71 tests) asserts no `@main` self-references and correct `@v0.7.0` pins. **Caveat:** consumers pinning `@v0.7.0` do **not** receive the post-v0.7.0 hardenings (read*file size cap, smoke gate, soft-budget warnings, B2 FERRY*\* variables) — recommendation in §6 is to cut `v0.8.0`.
3. **Security posture?** Strong. Strict AJV schema validation; all shell calls use argv-as-array; `execFileSync` everywhere. CodeQL + `npm audit` (0 vulns across all severities, 332 deps) + gitleaks wired in CI and now running in all four agent workflows. Explicit `permissions:` blocks on every job. Third-party actions pinned by SHA in `ferry-ci.yml`, `release.yml`, and every composite `action.yml`. `@octokit/rest` and Jira modules forbidden under `src/agents/**` (asserted by `restricted-imports.test.ts`). "Ferry never merges" invariant asserted by `pipeline.test.ts:377`. Remaining gaps: no `harden-runner` egress allowlist on write-path workflows (dev/iterate), no SLSA provenance on the GitHub Release artifact, GITHUB_TOKEN used where a fine-grained App would be tighter.
4. **Is the score close to 8–9/10?** **Score is 8.0** — at the floor of the target band, unchanged from the v0.7.0 audit. The post-v0.7.0 deltas are net-zero on the score table: +0.5 on Tests (more coverage), +1.0 on E2E (smoke gate landed), +0.5 on Reliability (rotation correctly accounted; new crash mitigations), −0.5 on Release (25 unreleased commits accumulating on `main`). Top three actions to reach 8.5: (i) **cut `v0.8.0`** so the bundle-runtime smoke gate, read*file cap, and B2 FERRY*\* improvements ship to consumers (XS effort); (ii) **`harden-runner` egress allowlist** on dev/iterate workflows (P1, S); (iii) **systematic tag-pin drift gate** (action 0d) — close ADR 0002's stale `@v0.6.0` references and prevent recurrence (P1, XS).

---

## 2. Overall score — **8.0 / 10**

Movement since the v0.7.0 audit (8.0): net 0.0 across 15 domains. Three positive moves (Tests +0.5, E2E +1.0, Reliability +0.5) offset by one negative (Release −0.5 due to release cadence drag).

Quality gates at audit time (all green):

- `npm run typecheck` — clean (`@big-emotion/ferry@0.7.0`)
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 91 files / **1119 tests** / 100% passing in 2.99s
- `npm audit` (moderate+) — **0 vulnerabilities** (332 deps total)
- `npx vitest run src/install-guide.test.ts` — 71/71 passing
- TODO/FIXME/XXX/HACK count under `src/` — **1**
- Recent CI on `main`: Ferry — CI ✓, CodeQL ✓ (last run 2026-05-05T10:22Z, both success)

Release artifacts proven:

- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.5.1`, `v0.5.2`, `v0.5.3`, `v0.6.0`, `v0.7.0`, `v1` (floating major)
- `@big-emotion/ferry@0.7.0` published to npm with provenance
- GitHub Release v0.7.0 created with notes from `CHANGELOG.md`
- **`main` is 25 commits ahead of `v0.7.0` with no successor tag.** Substantive feature commits awaiting release: bundle-runtime smoke gate (#162/#172), agent-loop history compaction (`d0962f2`), read*file caps (#197, #200), agent-loop message pruning (#198), cache_read weighting (#196), externalized LLM SDKs from bundles (#203), B2 FERRY*\* repo variables (#207/#164), content-aware re-trigger dedup (#204), iterator boundary tightening (#206), ferry.config reload from base_branch (#199), soft-budget warnings (#208), package-manager auto-detect (#209).

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. v0.7.0 | Trend  |
| --- | ---------------------------------- | ------------ | ------------ | ------ |
| 1   | Application security               | **8.5 / 10** | 0            | strong |
| 2   | Supply-chain security              | **8.5 / 10** | 0            | strong |
| 3   | GitHub Actions security            | **7.5 / 10** | 0            | strong |
| 4   | Tests & coverage                   | **8.5 / 10** | +0.5         | strong |
| 5   | E2E / acceptance tests             | **8.5 / 10** | +1.0         | strong |
| 6   | CI/CD gates                        | **9.0 / 10** | 0            | strong |
| 7   | Reliability (idempotency, retries) | **9.0 / 10** | +0.5         | strong |
| 8   | Observability / audit              | **7.0 / 10** | 0            | medium |
| 9   | Consumer documentation             | **8.5 / 10** | 0            | strong |
| 10  | Code quality / typing              | **8.5 / 10** | 0            | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0            | strong |
| 12  | Operations / runbooks / rollback   | **7.5 / 10** | 0            | medium |
| 13  | Release / distribution             | **8.0 / 10** | -0.5         | medium |
| 14  | Cost governance (runtime)          | **7.0 / 10** | 0            | medium |
| 15  | Doc–code coherence                 | **7.5 / 10** | 0            | medium |

Mean = **8.0 / 10** (15 axes; 120.5 / 15 = 8.03 → 8.0)

> **Domain 4 (Tests) +0.5:** suite grew from 1041/88 to 1119/91 — +78 tests / +3 files. New coverage notably for `src/lib/llm/agent-loop/anthropic.ts` (+312 lines / +486 in test file) covering compaction and budget warnings; `src/lib/agent-runtime/config-reload.ts` is a new module with a dedicated test (108 lines).
>
> **Domain 5 (E2E) +1.0:** the bundle-runtime smoke gate (P1 carry-over action 0c) is **closed**. `scripts/smoke-bundle.sh` and `npm run smoke:bundle` are wired as a CI job (`ferry-ci.yml:113-135` `smoke-bundle`). This is the single largest pre-release safety net Ferry has gained since v0.7.0 — it boots `node .ferry/<role>/index.cjs` and asserts no `Dynamic require`/`Cannot find module` errors. Would have caught v0.5.1 and pre-v0.7.0 yaml-package crashes.
>
> **Domain 7 (Reliability) +0.5:** correction — `rotateAuditIssue()` already exists in `src/lib/audit/index.ts:62` (and was present at the v0.7.0 commit). The prior audit listed audit-issue rotation as a carry-over P1; that was incorrect. Plus three new crash mitigations since v0.7.0: read_file 256 KB cap (#197), read_file 64 KB head+tail truncation (#200), agent-loop message-history compaction (`d0962f2`) + pruning (#198). Cache_read_input_tokens now weighted at 0.1× to stop false token-cap blow-ups (#196).
>
> **Domain 13 (Release) −0.5:** `main` is 25 commits ahead of `v0.7.0` with no successor tag. Substantive consumer-facing improvements (smoke gate, read*file cap, B2 FERRY** variables, soft-budget warnings, content-aware re-trigger dedup) are not yet shipping. CHANGELOG `[Unreleased]` block accumulates further. CHANGELOG link section is *partially\* fixed since the last audit — `[0.7.0]` now appears and `[Unreleased]` base is correctly `v0.7.0` — but the `[0.5.0]`–`[0.5.3]` links are still missing.

---

## 4. Domain analysis

### 4.1 Application security — 8.5 (unchanged)

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- All shell calls use `execFileSync` with argv-as-array. The single `spawn` (`src/agents/developer/tools.ts:399`) also passes args as an array.
- `FerryError` taxonomy with typed codes (`state-invariant`, `spend-cap`, `transient`, `unknown`).
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit; gitleaks runs on **all four** agent dispatch workflows.
- `@typescript-eslint/no-explicit-any: 'error'` plus `no-restricted-imports` for agent code (verified via `src/agents/restricted-imports.test.ts`).
- "Ferry never merges" invariant asserted by `src/e2e/pipeline.test.ts:377`.
- Read_file size cap (256 KB hard, 64 KB head+tail when truncated) prevents prompt-injection via oversized file payloads (#197, #200).

**Weaknesses**

- LLM-supplied `commit_message` reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 8.5 (unchanged)

Tag-pin consistency table:

| Location                                                                         | Pin                                                         | Status        |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------- |
| `package.json` `.version`                                                        | `0.7.0`                                                     | canonical     |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.7.0`                                                   | match         |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.7.0`                                                    | match         |
| `docs/RELEASING.md` (lines 26, 30, 46, 49–50, 159)                               | `@v0.7.0`                                                   | match         |
| `docs/RUNBOOK.md` (lines 101, 373, 385)                                          | `v0.7.0`                                                    | match         |
| `src/install-guide.test.ts:51-52`                                                | `@v0.7.0`                                                   | match         |
| `docs/adr/0002-ferry-bundles-committed.md` (lines 16, 34, 35)                    | `@v0.6.0`                                                   | **drift**     |
| `git tag --list`                                                                 | `v0.2.0`–`v0.5.3`, `v0.6.0`, `v0.7.0`, `v1`                 | exist         |
| `npm @big-emotion/ferry`                                                         | `0.7.0`                                                     | published     |
| `CHANGELOG.md` link section                                                      | `[Unreleased]` base = `v0.7.0`; `[0.5.0]`–`[0.5.3]` missing | partial drift |

**ADR 0002 drift** is cosmetic (the ADR describes a design decision, not a consumer pin), but the automated drift gate (action 0d) is still not in place — this drift was carried from the v0.7.0 audit, not introduced.

**Strengths**

- CodeQL SAST wired — recent run green.
- `audit:ci` job in CI; `npm audit` clean (0 across all severities, 332 deps).
- Bundle-drift check in CI (`check-bundle` job) plus the new `smoke-bundle` job.
- Third-party actions pinned by SHA with version comments in every composite action and every CI workflow (verified: `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0`).
- gitleaks tarball pinned by SHA256 in CI.
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped.
- npm publish uses `--provenance --access public`.
- LLM SDKs externalized from `.ferry/` action bundles (#203) — bundle is smaller and SDK upgrades reach consumers via npm install rather than rebuilding bundles on every dep bump.

**Weaknesses**

- No SLSA provenance attestation on the GitHub Release artifact.
- No SBOM, no OSSF Scorecard.
- ADR 0002 `@v0.6.0` drift (low, cosmetic).
- CHANGELOG link section missing `[0.5.0]`–`[0.5.3]` release links (low).

### 4.3 GitHub Actions security — 7.5 (unchanged)

**Strengths**

- Explicit `permissions:` blocks on every job across consumer-side agent workflows, `ferry-ci.yml`, `release.yml`, `codeql.yml`.
- Concurrency groups per ticket prevent races; `cancel-in-progress: false` on writes (dev/iterate), `true` on read-only (refine/review).
- Fallback `'ferry-invalid-payload-sinkhole'` blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.
- `release.yml` uses `id-token: write` only for npm provenance.
- Consumer workflows expanded into three jobs (`gate-envelope`, `run-agent`, `emit-audit`) calling composite actions directly — no `secrets: inherit` dependency on reusable workflows.

**Weaknesses**

- `GITHUB_TOKEN` used by composite actions instead of a fine-grained GitHub App (P2).
- No `harden-runner` (StepSecurity) for egress allowlisting on the dev/iterate workflows that perform git push (P1).
- No OIDC for federated auth to Anthropic / Jira.

### 4.4 Tests & coverage — 8.5 (+0.5)

| Metric  | Status                                           |
| ------- | ------------------------------------------------ |
| Suite   | **91 files / 1119 tests / all passing in 2.99s** |
| Reports | text, text-summary, html, lcov                   |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`      |

**Strengths**

- +78 tests / +3 files since v0.7.0. Notable additions: `src/lib/llm/agent-loop/anthropic.test.ts` (+486 lines) covering message compaction, history pruning, cache_read weighting, and budget warnings; `src/lib/llm/agent-loop/compact.test.ts` (175 lines, new module); `src/lib/agent-runtime/config-reload.test.ts` (108 lines, new module).
- D9 regression suite (`extractFirstJsonObject`) intact: prose preamble, trailing prose, nested code fences all covered.
- Coverage threshold uniform at 75% across statements/branches/functions/lines.
- CLI module coverage: every doctor check has a sibling `.test.ts`.
- Composite-action entrypoints excluded from coverage with documented reason.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 8.5 (+1.0)

**Strengths**

- **Mocked end-to-end pipeline test** at `src/e2e/pipeline.test.ts` replays refine→dev→review→iterate, asserts the no-auto-merge invariant (line 377), exercises FR18/FR24/FR28.
- **Install-guide acceptance test** at `src/install-guide.test.ts` (71 tests) covers 18 sections of the README including no-`@main` self-references and correct `@v0.7.0` pins.
- FR drift detector (`scripts/check-fr-drift.sh`) wired into CI lint job.
- Release pipeline empirically validated by seven real tag pushes (v0.4.0 through v0.7.0 — all pipelines green).
- **Bundle-runtime smoke gate (P1 carry-over action 0c — closed):** `scripts/smoke-bundle.sh` boots each role's `index.cjs` against a fixture envelope and asserts exit-code 0; wired as a dedicated `smoke-bundle` job in `ferry-ci.yml:113-135`. This closes the failure mode that allowed v0.5.1 (`Dynamic require of "child_process"`) and pre-v0.7.0 (yaml package missing) to ship.

**Weaknesses**

- No idempotency assertion across a full replay of the same `event_id` against the same audit issue.
- Install-guide test validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts` (P1, action 3).

### 4.6 CI/CD gates — 9.0 (unchanged)

**Strengths**

- Seven parallel CI jobs: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `check-bundle`, `smoke-bundle` (new), `audit`; plus CodeQL, release gate.
- `release.yml` runs full quality gate before npm publish.
- All actions in CI pinned by SHA.
- Concurrency cancels superseded CI runs on the same branch.
- Husky pre-push hook re-runs the full suite locally.
- Recent runs on `main`: Ferry — CI ✓ (2026-05-05), CodeQL ✓ (2026-05-05).

**Weaknesses**

- No `npm ci --audit-signatures` integrity check.
- No required-checks branch-protection preventing direct push to `main`.

### 4.7 Reliability — 9.0 (+0.5)

**Strengths**

- All v0.5.3/v0.6.0 closures hold: D9 Refiner JSON parser hardened (`extractFirstJsonObject`); reviewer→iterator loop fixed (`countPriorIterations`); gitleaks ENOENT fixed.
- **Audit-issue rotation present and tested** (`src/lib/audit/index.ts:62 rotateAuditIssue`, threshold 90% of 1000-comment cap, `FERRY_AUDIT_ROTATION_THRESHOLD` env-tunable, default 900). The v0.7.0 audit incorrectly listed this as P1 carry-over — it was already implemented.
- Read_file 256 KB hard cap (#197) and 64 KB head+tail truncation (#200) prevent agents from blowing up token budgets on large files.
- Agent-loop message-history compaction (`d0962f2`) and pruning (#198) bound conversation history so token-cap blow-ups stop being a recurring failure mode.
- Cache_read_input_tokens weighted at 0.1× of input cost (#196) — agents no longer trip the budget cap on cache reads.
- ferry.config.json reloaded from `base_branch` on every agent run (#199) — config drift between branches is now self-correcting.

**Carry-over weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- Reconciler depends on the consumer wiring `ferry-reconcile.yml`.

### 4.8 Observability — 7.0 (unchanged)

**Strengths**

- Structured JSON logger in production paths.
- Centralised audit issue with JSON-per-phase lines; rotation handles approaching 1000-comment cap.
- Correlation by `run_id` / ULID across phases.
- `docs/RUNBOOK.md` provides on-call triage.
- Soft-budget warnings (#208) emit at 70% / 85% of `max_tokens_per_run` so operators see cost trends mid-run.

**Weaknesses**

- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human (mitigated only when the consumer wires the reconciler).
- Some emitters still pass `correlation_id: ""` — not all entry points propagate the ULID.
- 8 raw `console.log` calls remain under `src/`.

### 4.9 Consumer documentation — 8.5 (unchanged)

**Strengths**

- `ferry-init` emits exactly 4 expanded three-job stubs; all pin to `@v0.7.0`; all composite actions referenced exist on origin.
- The `ANTHROPIC_API_KEY` secret naming is consistent across README, composite actions, `ferry-init`, `ferry-doctor`, and `ferry-uninstall`.
- `ferry-update` parses `MIGRATIONS.md` at runtime; consumers see required follow-ups during upgrade.
- `ferry-doctor` check D7 verifies `FERRY_AUDIT_ISSUE` repo variable is set, numeric, and points to an open GitHub issue.
- `docs/RUNBOOK.md` — on-call playbook for stalled ticket, cost spike, agent-loop runaway, refiner D9 mitigation, rollback, CI red.
- `docs/CONFIGURATION.md` is internally consistent with the composite action interfaces.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.
- B2 FERRY\_\* repo variables (#207/#164) standardise tunable knobs across all four agent composite actions.
- `docs/MCP.md` documents stdio MCP server support (#201).

**Carry-over weaknesses**

- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` instead (P2, action 5).
- `ferry-init` does not collect the two transition IDs — still a manual README step (P2, action 6).
- No `workflowTemplates()` invocation in `install-guide.test.ts` (P1, action 3).

### 4.10 Code quality — 8.5 (unchanged)

**Strengths**

- Strict TypeScript NodeNext ESM, `no-explicit-any: error`.
- ESLint with agent-specific rules; restricted-imports verified by test.
- Prettier mandatory and currently clean.
- Layered architecture respected; agents never import Octokit/Jira directly (verified by `src/agents/restricted-imports.test.ts`).
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

### 4.12 Operations — 7.5 (unchanged)

**Strengths**

- `docs/RUNBOOK.md` — concrete on-call playbook: stalled ticket, cost spike, agent-loop runaway, refiner D9 mitigation, rollback, CI red.
- `ferry-uninstall` CLI — reversible-deploy path.
- `ferry-update` CLI — migration path, reads `MIGRATIONS.md`.
- Reconciler + cost-daily stubs ship in `examples/consumer-setup/workflows/`, pinned to `v0.7.0`.

**Weaknesses (carry-over)**

- No proactive monitoring — audit issue pings nobody.
- Reconciler effectiveness depends on consumer wiring the stub.

### 4.13 Release / distribution — 8.0 (−0.5)

The release pipeline executed clean on v0.6.0 and v0.7.0. The −0.5 reflects release cadence drag: `main` has accumulated 25 commits ahead of `v0.7.0` with substantive consumer-facing improvements that are not shipping yet.

**Unreleased on `main`** (commits since `v0.7.0`):

- Bundle-runtime smoke gate (#162/#172) — a CI safety net consumers cannot benefit from until they pin a new tag.
- read_file 256 KB cap + bash truncation marker (#197) and 64 KB head+tail truncation (#200) — closes issue #185 (read_file output explosion).
- Agent-loop message-history compaction (`d0962f2`) and pruning (#198) — token-cap blow-up mitigations.
- Cache_read_input_tokens weighted at 0.1× (#196) — false token-cap exits no longer occur.
- ferry.config.json reload from `base_branch` (#199) — fixes config drift across branches.
- Externalize LLM SDKs from action bundles (#203) — smaller bundles, faster cold start.
- B2 FERRY\_\* repo variables (#207/#164) — standardised tunables across all four composite actions.
- Soft-budget warnings (#208) — operator visibility at 70%/85% of cap.
- Auto-detect package manager and inject hint into system prompt (#209) — better dev-agent output for non-npm consumers.
- Content-aware re-trigger dedup for refiner & developer (#204) — fewer wasted runs on duplicate dispatches.
- Iterator boundary tightening (#206) — fewer false explorations into framework internals.
- 4 chore(deps) bumps and 2 ci action SHA refreshes.

**Strengths**

- Release pipeline proven on seven tag pushes (v0.4.0 through v0.7.0). All pipelines green.
- `package.json`: `"version": "0.7.0"`, `"publishConfig": { "access": "public" }`.
- `CHANGELOG.md` and `MIGRATIONS.md` present and feed the release pipeline.
- `v1` floating tag advances correctly on each release.
- npm publish uses `--provenance --access public`.

**Weaknesses**

- **Release cadence drag** — 25 commits ahead of `v0.7.0`, no successor tag. Consumers pinning `@v0.7.0` do not receive landed hardenings.
- CHANGELOG link section: `[0.7.0]` link present and `[Unreleased]` base correctly bumped to `v0.7.0` since the last audit, but `[0.5.0]`–`[0.5.3]` links are still missing.
- No SLSA provenance on the GitHub Release artifact.
- No documented LTS / support window.

### 4.14 Cost governance — 7.0 (unchanged)

**Strengths**

- `src/cost-governance/daily-check.ts` written and tested.
- `examples/consumer-setup/workflows/ferry-cost-daily.yml` ships as a copy-paste stub (cron `0 6 * * *`); 50% monthly cap → auto-pause via `ferry:paused` label. `FERRY_SPEND_CAP_EUR` env-tunable (default 200).
- Audit line carries `cost_eur` per execution.
- Soft-budget warnings (#208) at 70% / 85% of `max_tokens_per_run` give operators mid-run visibility.

**Weaknesses**

- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.
- The safety net requires the consumer to copy the stub; nothing validates they did.

### 4.15 Doc–code coherence — 7.5 (unchanged)

**Closed drift items (D1–D7)** — all hold.

| #   | Status                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------- |
| D1  | **Closed.** CLAUDE.md correctly lists all four CLIs.                                                      |
| D2  | **Closed.** `CONTRIBUTING.md:42` correctly states "The bundle-drift check is enforced in CI."             |
| D3  | **Closed.** `CONTRIBUTING.md:44` correctly states "there is no local `commit-msg` hook today."            |
| D4  | **Closed.** `docs/RELEASING.md:159` lists all four CLIs.                                                  |
| D5  | **Closed.** Stub headers no longer advertise phantom optional variables.                                  |
| D6  | **Closed.** `ferry-update` reads `MIGRATIONS.md` at runtime.                                              |
| D7  | **Closed.** `ferry-doctor` check D7 verifies `FERRY_AUDIT_ISSUE`.                                         |
| D8  | **Partial (carry-over).** `docs/adr/0002-ferry-bundles-committed.md:16,34,35` still references `@v0.6.0`. |

**Drift items (current)**

| #   | Drift                                                                                                                                                                                                                        | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D9  | **`docs/adr/0002-ferry-bundles-committed.md:16,34,35` references `@v0.6.0`** — should be `@v0.7.0`. Carry-over of action-0d systematic drift gate.                                                                           | low      |
| D10 | **CHANGELOG link section missing `[0.5.0]`–`[0.5.3]` release tag links.** `[0.7.0]` and `[Unreleased]` base are correct since the last audit; the v0.5.x gap remains. Affects changelog navigation; does not block releases. | low      |
| D11 | **`src/install-guide.test.ts:341` contains a stale comment** — "they use @v0.6.0" — but the actual assertion on line 49–52 correctly tests for `@v0.7.0`. Cosmetic.                                                          | cosmetic |

**Net coherence assessment**

D1–D7 closures hold. Three drift items remain (D9 ADR pin, D10 CHANGELOG v0.5.x links, D11 stale comment). The systematic drift gate (action 0d) is still not implemented — the ADR drift has now persisted across **two** audit cycles. **Score: 7.5** — unchanged.

---

## 5. Gaps and risks

### 5.1 Hardcoded values (P0/P1)

Scan scope: `src/**/*.ts`, excluding `*.test.ts`, `__fixtures__/`, `__lint-fixtures__/`, `src/schemas/*.json`.

**Assessment:** Almost every production constant is env-tunable via the `FERRY_*` env-var pattern. P0 count is **0**. P1 count is **2** — below the 6-item threshold; no score penalty applied to Domains 5 or 8.

**P1 — Size & Batch Limits (carry-over)**

- **P1** `src/agents/developer/tools.ts:23` — `MAX_SEARCH_MATCHES = 200` — grep result cap for the dev agent; not env-tunable. Large repos with >200 matches per pattern receive a silent truncation. Could be moved to a `FERRY_GREP_MAX_MATCHES` env var.
- **P1** `src/lib/audit/index.ts:39` — `const MAX_PAGES = 10` — caps audit comment pagination at 1,000 (10 × 100). Not env-tunable. Combined with `ROTATION_THRESHOLD = 900` and `FERRY_AUDIT_ROTATION_THRESHOLD` override it works in practice (rotation triggers before MAX_PAGES is reached), but the ceiling itself is rigid.

**P2 — new since v0.7.0**

- `src/lib/llm/agent-loop/anthropic.ts:302,313` — soft-budget warning thresholds `0.7` and `0.85` (#208). Sensible defaults for most consumers; could become `FERRY_BUDGET_WARN_FIRST_PCT`/`FERRY_BUDGET_WARN_SECOND_PCT` if operators want different signal points. Acceptable as-is.

**P2 items (acceptable as-is)** — most constants already env-tunable: `FERRY_GREP_TIMEOUT_MS`, `FERRY_BASH_TIMEOUT_MS`, `FERRY_HTTP_TIMEOUT_MS`, `FERRY_DEV_MAX_ITERATIONS`, `FERRY_DEV_MAX_INPUT_TOKENS`, `FERRY_DEV_MAX_TOKENS`, `FERRY_REVIEWER_MAX_ITERATIONS`, `FERRY_REVIEWER_MAX_TOKENS`, `FERRY_TLDR_TOTAL_CHARS`, `FERRY_AUDIT_ROTATION_THRESHOLD`, `FERRY_REFINER_SUBTASK_CAP`, `FERRY_REFINER_TOUCH_PATHS_CAP`, `FERRY_REVIEW_PATCH_TRUNCATE_CHARS`, `FERRY_REVIEW_FILE_TRUNCATE_CHARS`, `FERRY_BASH_OUTPUT_MAX_BYTES`, `FERRY_READ_FILE_MAX_BYTES`, `FERRY_SPEND_CAP_EUR`, `FERRY_RECONCILER_STALE_WINDOW_MINUTES`.

---

## 6. Prioritized action plan (residual)

| Order | Action                                                                                                                                                                                                                                                                                                                                          | Domain        | Score before | Priority | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- | ------ |
| **R** | **Cut `v0.8.0`.** 25 commits worth of consumer-facing hardenings on `main`. Use `ferry-release`. Updates `package.json`, CHANGELOG, ADR 0002 references (kills D9), and re-pins all consumer-stub references in one tag-cycle. The single highest-leverage action — moves Release domain back to 8.5+ and ships smoke gate to consumers.        | Release       | 8.0          | **P1**   | XS     |
| 0d    | **(P1, carry-over from v0.5.3)** Add a regex assertion to `src/install-guide.test.ts` (or new `tag-pin-drift.test.ts`) that scans `docs/adr/*.md` and `docs/RELEASING.md` for `@v[0-9.]+` literals and fails if any disagrees with `package.json .version`. ADR 0002 drift persists across two audit cycles — a guard would prevent recurrence. | Coherence     | 7.5          | **P1**   | XS     |
| 1     | **(P1, carry-over)** Add `harden-runner` egress allowlist to dev/iterate workflows — these jobs run `git push` and therefore need egress to GitHub; all other outbound connections should be blocked.                                                                                                                                           | GH Actions    | 7.5          | **P1**   | S      |
| 3     | **(P1, carry-over)** Extend `install-guide.test.ts` to invoke `workflowTemplates()` from `src/cli/init/templates.ts` and assert each emitted stub's composite-action refs and tag exist on origin.                                                                                                                                              | E2E           | 8.5          | **P1**   | S      |
| 4     | **(P1, carry-over)** Add e2e idempotency replay: same `event_id` twice → same outcome, no duplicate external writes.                                                                                                                                                                                                                            | E2E           | 8.5          | **P1**   | M      |
| 5     | **(P2)** `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the README curl step).                                                                                                                                                                                                                          | Consumer docs | 8.5          | **P2**   | S      |
| 6     | **(P2)** `ferry-init` collects the two transition IDs and sets them as secrets.                                                                                                                                                                                                                                                                 | Consumer docs | 8.5          | **P2**   | S      |
| 7     | **(P2)** OSSF Scorecard + SLSA provenance on the GitHub Release artifact.                                                                                                                                                                                                                                                                       | Supply chain  | 8.5          | **P2**   | M      |
| 8     | **(P2)** Migrate `GITHUB_TOKEN` to a fine-grained GitHub App (or remove the App provisioning from `ferry-init`).                                                                                                                                                                                                                                | GH Actions    | 7.5          | **P2**   | L      |
| 9     | **(P2)** Branch-protection on `main` requiring CodeQL / Ferry — CI / Release checks before merge.                                                                                                                                                                                                                                               | CI/CD         | 9.0          | **P2**   | XS     |
| 10    | **(P2)** Make `MAX_SEARCH_MATCHES` and `MAX_PAGES` env-tunable (`FERRY_GREP_MAX_MATCHES`, `FERRY_AUDIT_MAX_PAGES`).                                                                                                                                                                                                                             | Architecture  | 8.5          | **P2**   | XS     |
| 11    | **(low)** Backfill `[0.5.0]`–`[0.5.3]` links in CHANGELOG.md.                                                                                                                                                                                                                                                                                   | Release       | 8.0          | low      | XS     |

### 6.1 Expected score after the plan

| Domain                  | Current | After R+0d+P1 | After All |
| ----------------------- | ------- | ------------- | --------- |
| Application security    | 8.5     | 8.5           | 9.0       |
| Supply-chain security   | 8.5     | 9.0           | 9.5       |
| GitHub Actions security | 7.5     | 8.5           | 9.0       |
| Tests & coverage        | 8.5     | 8.5           | 8.5       |
| E2E / acceptance        | 8.5     | 9.0           | 9.0       |
| CI/CD gates             | 9.0     | 9.0           | 9.5       |
| Reliability             | 9.0     | 9.0           | 9.0       |
| Observability           | 7.0     | 7.0           | 7.5       |
| Consumer documentation  | 8.5     | 8.5           | 9.0       |
| Code quality            | 8.5     | 8.5           | 8.5       |
| Traceability            | 7.5     | 7.5           | 7.5       |
| Operations              | 7.5     | 7.5           | 7.5       |
| Release / distribution  | 8.0     | 9.0           | 9.0       |
| Cost governance         | 7.0     | 7.0           | 8.0       |
| Doc–code coherence      | 7.5     | 8.5           | 9.0       |
| **Overall**             | **8.0** | **8.47**      | **8.73**  |

The single most impactful action is **R (cut `v0.8.0`)** — it ships the smoke gate to consumers and offers a forcing function to close D9 (ADR drift) at the same time.

---

## 7. What changed since the v0.7.0 audit (8.0 → 8.0; net 0.0)

| #   | Change since v0.7.0 (commits on `main`)                                                                                                              | Domain effect                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **Bundle-runtime smoke gate (#162/#172)** — `npm run smoke:bundle` and `smoke-bundle` CI job                                                         | Domain 5 +1.0 (E2E); closes carry-over P1 action 0c                              |
| 2   | **read_file caps (#197, #200)** — 256 KB hard, 64 KB head+tail when truncated                                                                        | Domain 1 strengthened; Domain 7 +0.25                                            |
| 3   | **Agent-loop history compaction (`d0962f2`) + pruning (#198)**                                                                                       | Domain 7 +0.25 (Reliability)                                                     |
| 4   | **Cache_read_input_tokens weighted at 0.1× (#196)**                                                                                                  | Domain 7 (counted above)                                                         |
| 5   | **`ferry.config.json` reload from base_branch (#199)**                                                                                               | Domain 7 (counted above)                                                         |
| 6   | **+78 unit tests (1041 → 1119)** — agent-loop coverage; new compact and config-reload modules                                                        | Domain 4 +0.5 (Tests)                                                            |
| 7   | **Audit-issue rotation correctly accounted** — `rotateAuditIssue` was already present at v0.7.0; prior audit listed it as carry-over in error        | Domain 7 +0.5 (Reliability)                                                      |
| 8   | **Externalize LLM SDKs from action bundles (#203)**                                                                                                  | Domain 2 (Supply-chain) strengthened; bundle CI drift "permanently" fixed (#205) |
| 9   | **B2 FERRY\_\* repo variables (#207/#164)** — standardised tunables across all four composite actions                                                | Domain 9 (Consumer docs) strengthened                                            |
| 10  | **Soft-budget warnings (#208)** at 70% / 85% of `max_tokens_per_run`                                                                                 | Domain 8 (Observability) strengthened; Domain 14 strengthened                    |
| 11  | **Content-aware re-trigger dedup (#204)** — refiner + developer                                                                                      | Domain 7 strengthened                                                            |
| 12  | **Iterator boundary tightening (#206)**                                                                                                              | Domain 7 strengthened                                                            |
| 13  | **CHANGELOG link section partial fix** — `[0.7.0]` link now present, `[Unreleased]` base correctly `v0.7.0`. `[0.5.0]`–`[0.5.3]` links still missing | Domain 13 partially fixed; Domain 15 unchanged                                   |
| 14  | **25 commits accumulated on `main` ahead of `v0.7.0`** with no successor tag                                                                         | Domain 13 −0.5 (Release cadence drag)                                            |

---

## 8. Closed from previous audits

### Closed since the v0.7.0 audit

| Item | Action (was P1)           | Status           | Evidence                                                             |
| ---- | ------------------------- | ---------------- | -------------------------------------------------------------------- |
| 0c   | Bundle-runtime smoke gate | **done**         | `scripts/smoke-bundle.sh`; `ferry-ci.yml:113-135` `smoke-bundle` job |
| 2    | Audit-issue rotation      | **already done** | `src/lib/audit/index.ts:62 rotateAuditIssue` — present at v0.7.0     |

### Still open (carry-over)

| Item | Action                                    | Priority | Effort |
| ---- | ----------------------------------------- | -------- | ------ |
| R    | Cut `v0.8.0` — ship landed hardenings     | **P1**   | XS     |
| 0d   | Tag-pin drift gate (docs/adr) — 2nd cycle | **P1**   | XS     |
| 1    | `harden-runner` egress allowlist          | **P1**   | S      |
| 3    | Install-guide test covers init            | **P1**   | S      |
| 4    | E2E idempotency replay                    | **P1**   | M      |
| 5    | `ferry-init` scaffolds ops stubs          | **P2**   | S      |
| 6    | `ferry-init` collects transition IDs      | **P2**   | S      |
| 7    | OSSF Scorecard / SLSA on GH Release       | **P2**   | M      |
| 8    | Migrate GITHUB_TOKEN to fine-grained App  | **P2**   | L      |
| 9    | Branch-protection on `main`               | **P2**   | XS     |

---

## 9. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §6 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
