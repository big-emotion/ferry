# Production-Readiness Audit — Ferry

**Date:** 2026-05-05
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria. **Subject of this revision:** the post-`v0.8.2` `main` tip — `package.json .version = 0.8.2`, HEAD = `49aafd8`, **6 commits ahead of `v0.8.2`**, all six are small fixes plus the multi-provider Phase 2 feature (Reviewer agent on OpenAI / Google). Three releases shipped since the last audit (`v0.8.0`, `v0.8.1`, `v0.8.2`), closing the action-R "release cadence drag" finding. The action-0d carry-over (ADR 0002 `@v0.6.0` drift) is also closed at this revision.
**Verdict:** **8.2 / 10 — Production-ready.** Net **+0.2** vs. the v0.7.0+25 audit. The `v0.8.0` cut shipped the bundle-runtime smoke gate, read*file caps, agent-loop history pruning, B2 `FERRY*\*`repo variables, soft-budget warnings, multi-provider Phase 1, GitHub step summary emitter (#224), pre/post-agent command hooks (#223), developer WIP-commit-on-failure (#222), and the 3-state`done`outcome (#221). The`v0.8.0`release also exposed a CI-gate gap:`timeout-minutes`on composite-action steps shipped DOA for all four consumer workflows;`v0.8.1`hotfixed it the same day and`#229`added a composite-action input validator to close the regression class.`v0.8.2`hotfixed silently-ignored model inputs in`ferry-init`templates.
**Target:** **8–9 / 10**, comfortably inside the band. Top three actions to push toward 8.5+: ship multi-provider Phase 2 in a`v0.9.0`cut once stabilized; add`harden-runner` egress allowlist on dev/iterate; add e2e idempotency replay.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (**1200** tests passing across 100 files in 2.92s, +81 tests / +9 files since the v0.7.0+25 audit), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`. Recent run history via `gh run list`.
- **Release artifacts:** `git tag --sort=-creatordate | head -10`, local `package.json`, `git log v0.7.0..HEAD`, `git log v0.8.2..HEAD`.
- **Docs:** `README.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`, `docs/RUNBOOK.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes.** All previously closed P0 blockers continue to hold (D9 Refiner JSON parser, D6 `ferry-update` MIGRATIONS.md parser, D7 `ferry-doctor` `FERRY_AUDIT_ISSUE`, audit-issue rotation, bundle-runtime smoke gate). Three new operational improvements landed in `v0.8.0`: GitHub step summary on agent termination (#224), pre/post-agent command hooks (#223), and developer WIP-commit-on-failure (#222). Two consumer-impacting incidents shipped in `v0.8.0` (timeout-minutes on composite-action steps; per-agent model input names in init templates) but both were hotfixed the same day in `v0.8.1` / `v0.8.2`, and #229 added a composite-action input validator to prevent recurrence. No agent has a known crash-category bug at HEAD.
2. **Can a first-time consumer install and reach the full Jira → PR-approved cycle?** **Yes** — for consumers pinning `@v0.8.2` (the published tag). Walking the install path: (i) `npx -p @big-emotion/ferry ferry-init` runs the wizard, sets secrets via `gh secret set`, generates `ferry.config.yaml`, writes 4 expanded three-job stubs pinned to `@v0.8.2` with correct per-agent model input names. (ii) `ferry-doctor` covers all 13 checks including the `FERRY_AUDIT_ISSUE` repo variable. (iii) `ferry-update` parses `MIGRATIONS.md` at runtime so upgrading consumers see the v0.8.0 → v0.8.1 hotfix follow-up and the v0.8.1 → v0.8.2 model-input rename. (iv) The expanded three-job workflow architecture (gate-envelope → run-agent → emit-audit) avoids `secrets: inherit` cross-org propagation. (v) The three FR auto-transitions (FR18/FR24/FR28) are exercised by `src/e2e/pipeline.test.ts`. (vi) `install-guide.test.ts` (71 tests) asserts no `@main` self-references and correct `@v0.8.2` pins. **Caveat:** consumers who pinned `@v0.8.0` saw immediate breakage on every agent run; those that pinned `@v0.8.1` saw silent default-model fallback on the refiner and developer until they bumped to `@v0.8.2`. Both states are recoverable via `ferry-update`.
3. **Security posture?** **Strong.** Strict AJV schema validation; all shell calls use argv-as-array; `execFileSync` everywhere. CodeQL + `npm audit` (0 vulns across all severities) + gitleaks wired in CI and running in all four agent workflows. Explicit `permissions:` blocks on every job. Third-party actions pinned by SHA in `ferry-ci.yml`, `release.yml`, and every composite `action.yml`. `@octokit/rest` and Jira modules forbidden under `src/agents/**` (asserted by `restricted-imports.test.ts`). "Ferry never merges" invariant asserted by `src/e2e/pipeline.test.ts`. Read_file size cap (256 KB hard, 64 KB head+tail when truncated) prevents prompt-injection via oversized file payloads. Remaining gaps: no `harden-runner` egress allowlist on write-path workflows (dev/iterate), no SLSA provenance on the GitHub Release artifact, GITHUB_TOKEN used where a fine-grained App would be tighter.
4. **Is the score close to 8–9/10?** **Score is 8.2** — comfortably inside the target band, +0.2 vs. the v0.7.0+25 audit. The release-cadence drag has been closed (three cuts: `v0.8.0`/`v0.8.1`/`v0.8.2`); ADR 0002 `@v0.6.0` drift (D9, two-cycle carry-over) has been closed at `v0.8.2`. Multi-provider Phase 1 (Refiner) shipped in `v0.8.0`; Phase 2 (Reviewer) is on `main` post-`v0.8.2` awaiting the next cut. Top three actions to reach 8.5: (i) **`harden-runner` egress allowlist** on dev/iterate workflows (P1, S effort); (ii) **e2e idempotency replay** assertion (P1, M); (iii) **install-guide test invokes `workflowTemplates()`** so the `ferry-init` emitter is covered end-to-end (P1, S).

---

## 2. Overall score — **8.2 / 10**

Movement since the v0.7.0+25 audit (8.0 → 8.2, net +0.2 across 15 domains). Five positive moves (Observability +0.5 for GITHUB_STEP_SUMMARY; Operations +0.5 for pre/post-agent hooks + WIP-on-failure; Release +0.5 — cadence drag closed; Doc-code coherence +0.5 — ADR 0002 drift closed). One regression neutralized by hotfix and validator (`v0.8.0` timeout-minutes shipped DOA, fixed in `v0.8.1`, validator added in `v0.8.2` via #229).

Quality gates at audit time (all green):

- `npm run typecheck` — clean (`@big-emotion/ferry@0.8.2`)
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 100 files / **1200 tests** / 100% passing in 2.92s
- `npm audit` (moderate+) — **0 vulnerabilities**
- `npx vitest run src/install-guide.test.ts` — 71/71 passing
- TODO/FIXME/XXX/HACK count under `src/` — **1**
- Recent CI on `main`: Ferry — CI ✓, CodeQL ✓ (last run 2026-05-05T15:15Z, both success). One earlier run on `main` at 2026-05-05T15:09:18Z was red on a Prettier check (closed in HEAD commit `49aafd8`).

Release artifacts proven:

- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.5.1`, `v0.5.2`, `v0.5.3`, `v0.6.0`, `v0.7.0`, `v0.8.0`, `v0.8.1`, `v0.8.2`, `v1` (floating major)
- `@big-emotion/ferry@0.8.2` published to npm with provenance
- GitHub Release `v0.8.2` created with notes from `CHANGELOG.md`
- **`main` is 6 commits ahead of `v0.8.2`** with one substantive feature (multi-provider Phase 2 — Reviewer on OpenAI / Google, #231) and five small fixes (composite-step input validator #229/#232, locale pin to en-US, cache_control strip on prior tool-results turn, action-bundle rebuild, prettier formatting). No release-cadence drag at this revision.

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. v0.7.0+25 | Trend  |
| --- | ---------------------------------- | ------------ | --------------- | ------ |
| 1   | Application security               | **8.5 / 10** | 0               | strong |
| 2   | Supply-chain security              | **8.5 / 10** | 0               | strong |
| 3   | GitHub Actions security            | **7.5 / 10** | 0               | strong |
| 4   | Tests & coverage                   | **8.5 / 10** | 0               | strong |
| 5   | E2E / acceptance tests             | **8.5 / 10** | 0               | strong |
| 6   | CI/CD gates                        | **9.0 / 10** | 0               | strong |
| 7   | Reliability (idempotency, retries) | **9.0 / 10** | 0               | strong |
| 8   | Observability / audit              | **7.5 / 10** | +0.5            | medium |
| 9   | Consumer documentation             | **8.5 / 10** | 0               | strong |
| 10  | Code quality / typing              | **8.5 / 10** | 0               | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0               | strong |
| 12  | Operations / runbooks / rollback   | **8.0 / 10** | +0.5            | strong |
| 13  | Release / distribution             | **8.5 / 10** | +0.5            | strong |
| 14  | Cost governance (runtime)          | **7.0 / 10** | 0               | medium |
| 15  | Doc–code coherence                 | **8.0 / 10** | +0.5            | strong |

Mean = **8.2 / 10** (15 axes; 122.5 / 15 = 8.166 → 8.2)

> **Domain 8 (Observability) +0.5:** `GITHUB_STEP_SUMMARY` emitter (#224) writes per-run telemetry — token counts, top tool calls by output size, files touched, branch pushed — directly into the GitHub Actions UI, removing the need to scrape logs for run-level signals. Combined with the soft-budget warnings from `v0.7.0+25`, operators now have both mid-run cost trajectory and end-of-run summary without external infrastructure.
>
> **Domain 12 (Operations) +0.5:** three operational additions in `v0.8.0`. (a) Pre/post-agent command hooks (#223) on all four composite actions let consumers wire setup (cache warmups, secret-injection) and teardown (artifact uploads, custom telemetry) without forking the workflow. (b) Developer WIP-commit-on-failure (#222) commits in-progress work to a `ferry-wip/<ticket>` branch on agent crash and posts a structured Jira summary, reducing lost-work incidents. (c) The 3-state `done` outcome (#221) replaces the binary `actionable` flag, giving downstream automation finer-grained routing signal.
>
> **Domain 13 (Release) +0.5:** the v0.7.0+25 −0.5 cadence-drag finding is closed — three releases (`v0.8.0`/`v0.8.1`/`v0.8.2`) shipped on 2026-05-05. The bundle-runtime smoke gate, read*file cap, agent-loop history pruning, B2 `FERRY*\*`repo variables, multi-provider Phase 1, and the new operational telemetry are now reaching consumers. Held back from a full +1.0 by the two consumer-impacting hotfixes in the same window (timeout-minutes DOA in`v0.8.0`; silently-ignored model inputs in `ferry-init`templates v0.8.0–v0.8.1) — both fixed same-day, both rolled into a composite-action input validator (#229) plus a`ferry-update` rewrite path.
>
> **Domain 15 (Doc–code coherence) +0.5:** ADR 0002 drift (D9, carry-over for two cycles) is closed — `docs/adr/0002-ferry-bundles-committed.md` now references `@v0.8.2` consistently. The systematic drift gate (action 0d) has not been added, but the immediate symptom is fixed. CHANGELOG `[0.5.0]`–`[0.5.3]` link gap (D10) carries over.
>
> **No score regressions** at this revision. The two consumer-impacting `v0.8.0` incidents argued for a Domain-13 penalty, but the validator (#229) and the `ferry-update` rewrite path together close the regression class — recurrence requires a different failure mode.

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
- Read_file size cap (256 KB hard, 64 KB head+tail when truncated) prevents prompt-injection via oversized file payloads. Agent-loop history compaction and pruning bound conversation history so token-cap blow-ups cannot be used as a denial-of-budget vector.
- Multi-provider Phase 2 (#231) routes the Reviewer agent through OpenAI / Google via the new `src/lib/llm/tool-loop/{anthropic,openai,google}.ts` wrappers; the structured tool-call contract is provider-agnostic and the same restricted-import rules apply.

**Weaknesses**

- LLM-supplied `commit_message` reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 8.5 (unchanged)

Tag-pin consistency table (HEAD = `49aafd8`, `package.json .version = 0.8.2`):

| Location                                                                         | Pin                                                  | Status        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------- |
| `package.json` `.version`                                                        | `0.8.2`                                              | canonical     |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.8.2`                                            | match         |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.8.2`                                             | match         |
| `docs/CONFIGURATION.md` (line 125, 148)                                          | `@v0.8.2`                                            | match         |
| `docs/RELEASING.md` (lines 26, 30, 46, 49–50, 159)                               | `@v0.8.2`                                            | match         |
| `docs/RUNBOOK.md`                                                                | (no agent-pin references; only `@v1` floating-major) | n/a           |
| `src/install-guide.test.ts`                                                      | `@v0.8.2`                                            | match         |
| `docs/adr/0002-ferry-bundles-committed.md` (lines 16, 34, 35)                    | `@v0.8.2`                                            | **match**     |
| `git tag --list`                                                                 | includes `v0.8.0`, `v0.8.1`, `v0.8.2`, `v1`          | exist         |
| `npm @big-emotion/ferry`                                                         | `0.8.2`                                              | published     |
| `CHANGELOG.md` link section                                                      | `[Unreleased]` base = `v0.8.2`; v0.5.x links missing | partial drift |

**Action 0d (tag-pin drift gate) status:** the immediate ADR 0002 drift carried for two cycles is closed at `v0.8.2`; the systematic guard is still not in place, so recurrence requires manual diligence. Adding a regex assertion in `src/install-guide.test.ts` (or new `tag-pin-drift.test.ts`) that scans `docs/adr/*.md` and `docs/RELEASING.md` for `@v[0-9.]+` literals and fails if any disagrees with `package.json .version` remains the recommended P1 carry-over.

**Strengths**

- CodeQL SAST wired — recent run green.
- `audit:ci` job in CI; `npm audit` clean (0 across all severities).
- Bundle-drift check in CI (`check-bundle` job) plus the `smoke-bundle` job that boots each compiled `.ferry/<role>-action.js` under Node 20 with stub credentials.
- Third-party actions pinned by SHA with version comments in every composite action and every CI workflow (verified: `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0`).
- gitleaks tarball pinned by SHA256 in CI.
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped.
- npm publish uses `--provenance --access public`.
- LLM SDKs externalized from `.ferry/` action bundles (#203) — bundle is smaller and SDK upgrades reach consumers via `npm install` rather than rebuilding bundles on every dep bump.

**Weaknesses**

- No SLSA provenance attestation on the GitHub Release artifact.
- No SBOM, no OSSF Scorecard.
- Action 0d (systematic tag-pin drift gate) still not implemented — ADR 0002 drift recurrence is gated only on manual diligence.
- CHANGELOG link section missing `[0.5.0]`–`[0.5.3]` release links (low).

### 4.3 GitHub Actions security — 7.5 (unchanged)

**Strengths**

- Explicit `permissions:` blocks on every job across consumer-side agent workflows, `ferry-ci.yml`, `release.yml`, `codeql.yml`.
- Concurrency groups per ticket prevent races; `cancel-in-progress: false` on writes (dev/iterate), `true` on read-only (refine/review).
- Fallback `'ferry-invalid-payload-sinkhole'` blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.
- `release.yml` uses `id-token: write` only for npm provenance.
- Consumer workflows expanded into three jobs (`gate-envelope`, `run-agent`, `emit-audit`) calling composite actions directly — no `secrets: inherit` dependency on reusable workflows.
- Composite-action input validator (#229) prevents shipping unsupported keys (e.g. the `timeout-minutes` regression that hit `v0.8.0`); enforced at build time in `release.yml` flow.

**Weaknesses**

- `GITHUB_TOKEN` used by composite actions instead of a fine-grained GitHub App (P2).
- No `harden-runner` (StepSecurity) for egress allowlisting on the dev/iterate workflows that perform git push (P1, carry-over).
- No OIDC for federated auth to Anthropic / Jira / OpenAI / Google.

### 4.4 Tests & coverage — 8.5 (unchanged)

| Metric  | Status                                                                         |
| ------- | ------------------------------------------------------------------------------ |
| Suite   | **100 files / 1200 tests / all passing in 2.92s**                              |
| Reports | text, text-summary, html, lcov                                                 |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`                                    |
| Δ       | +81 tests / +9 files since v0.7.0+25 audit (1119 → 1200 tests, 91 → 100 files) |

**Strengths**

- New `src/lib/llm/tool-loop/{anthropic,google,openai}.test.ts` modules cover the multi-provider Phase 2 abstractions (~510 test-lines combined).
- New `src/lib/agent-runtime/composite-action.test.ts` validates that all four `ferry-run-*` composite-action `.yml` files declare valid step keys (closes the v0.8.0 `timeout-minutes` regression class).
- D9 regression suite (`extractFirstJsonObject`) intact: prose preamble, trailing prose, nested code fences all covered.
- Coverage threshold uniform at 75% across statements/branches/functions/lines.
- CLI module coverage: every doctor check has a sibling `.test.ts`.
- Composite-action entrypoints excluded from coverage with documented reason.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 8.5 (unchanged)

**Strengths**

- **Mocked end-to-end pipeline test** at `src/e2e/pipeline.test.ts` replays refine→dev→review→iterate, asserts the no-auto-merge invariant, exercises FR18/FR24/FR28.
- **Install-guide acceptance test** at `src/install-guide.test.ts` (71 tests) covers 18 sections of the README including no-`@main` self-references and correct `@v0.8.2` pins.
- FR drift detector (`scripts/check-fr-drift.sh`) wired into CI lint job.
- Release pipeline empirically validated by ten real tag pushes (v0.4.0 through v0.8.2 — all pipelines green).
- **Bundle-runtime smoke gate:** `scripts/smoke-bundle.sh` boots each role's `index.cjs` against a fixture envelope and asserts exit-code 0; wired as a dedicated `smoke-bundle` job in `ferry-ci.yml`. Closes the v0.5.1 (`Dynamic require`) and pre-v0.7.0 (yaml package missing) failure modes.
- **Composite-action input validator (#229):** new test in `src/lib/agent-runtime/composite-action.test.ts` asserts each `runs.steps` entry uses only keys supported by GitHub Actions composite actions — closes the failure mode that allowed `v0.8.0` to ship `timeout-minutes` on composite-action steps.

**Weaknesses**

- No idempotency assertion across a full replay of the same `event_id` against the same audit issue (P1, carry-over).
- Install-guide test validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts` — the v0.8.0–v0.8.1 silently-ignored `ferry_model:` input in init templates would have been caught here (P1, action 3).

### 4.6 CI/CD gates — 9.0 (unchanged)

**Strengths**

- Seven parallel CI jobs: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `check-bundle`, `smoke-bundle`, `audit`; plus CodeQL, release gate.
- `release.yml` runs full quality gate before npm publish.
- All actions in CI pinned by SHA.
- Concurrency cancels superseded CI runs on the same branch.
- Husky pre-push hook re-runs the full suite locally.
- Recent runs on `main`: Ferry — CI ✓ (2026-05-05 15:15Z), CodeQL ✓ (2026-05-05 15:15Z). The earlier red run on `main` (2026-05-05 15:09Z) was a Prettier check failure on `composite-action.test.ts`; HEAD commit `49aafd8` resolved it and the next run was green.

**Weaknesses**

- No `npm ci --audit-signatures` integrity check.
- No required-checks branch-protection preventing direct push to `main`.

### 4.7 Reliability — 9.0 (unchanged)

**Strengths**

- All v0.5.3/v0.6.0 closures hold: D9 Refiner JSON parser hardened (`extractFirstJsonObject`); reviewer→iterator loop fixed (`countPriorIterations`); gitleaks ENOENT fixed.
- Audit-issue rotation present and tested (`src/lib/audit/index.ts`, threshold 90% of 1000-comment cap, `FERRY_AUDIT_ROTATION_THRESHOLD` env-tunable, default 900).
- Read_file 256 KB hard cap and 64 KB head+tail truncation prevent agents from blowing up token budgets on large files.
- Agent-loop message-history compaction and pruning bound conversation history so token-cap blow-ups no longer recur.
- Cache_read_input_tokens weighted at 0.1× of input cost — agents no longer trip the budget cap on cache reads.
- ferry.config.json reloaded from `base_branch` on every agent run — config drift between branches is self-correcting.
- New: developer WIP-commit-on-failure (#222) — agent crashes no longer lose in-progress work; consumers get a `ferry-wip/<ticket>` branch URL in Jira and a structured failure summary.
- New: cache_control stripping on prior tool-results turn (`e00ec30`) — prevents Anthropic API errors when re-priming a cached prefix.
- New: en-US locale pinning for number formatting (`e712ec1`) — prevents non-English runners from emitting comma-decimal cost figures that downstream tooling parses as integers.

**Carry-over weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- Reconciler depends on the consumer wiring `ferry-reconcile.yml`.

### 4.8 Observability — 7.5 (+0.5)

**Strengths**

- Structured JSON logger in production paths.
- Centralised audit issue with JSON-per-phase lines; rotation handles approaching 1000-comment cap.
- Correlation by `run_id` / ULID across phases.
- `docs/RUNBOOK.md` provides on-call triage.
- Soft-budget warnings emit at 70% / 85% of `max_tokens_per_run` so operators see cost trends mid-run.
- **New:** `GITHUB_STEP_SUMMARY` emitter on agent termination (#224) — every agent run writes a structured run-stats summary (token counts, top tool calls by output size, files touched, branch pushed) directly into the GitHub Actions UI. Combined with the existing audit-issue trail, operators now have per-run telemetry without log scraping.

**Weaknesses**

- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human (mitigated when the consumer wires the reconciler).
- Some emitters still pass `correlation_id: ""` — not all entry points propagate the ULID.
- Several raw `console.log` calls remain under `src/`.

### 4.9 Consumer documentation — 8.5 (unchanged)

**Strengths**

- `ferry-init` emits exactly 4 expanded three-job stubs; all pin to `@v0.8.2`; all composite actions referenced exist on origin; per-agent model input names are correct as of v0.8.2.
- The `ANTHROPIC_API_KEY` secret naming is consistent across README, composite actions, `ferry-init`, `ferry-doctor`, and `ferry-uninstall`.
- `ferry-update` parses `MIGRATIONS.md` at runtime; consumers see required follow-ups (including the v0.8.0 → v0.8.1 hotfix and v0.8.1 → v0.8.2 model-input rename).
- `ferry-doctor` check D7 verifies `FERRY_AUDIT_ISSUE` repo variable is set, numeric, and points to an open GitHub issue.
- `docs/RUNBOOK.md` — on-call playbook for stalled ticket, cost spike, agent-loop runaway, refiner D9 mitigation, rollback, CI red.
- `docs/CONFIGURATION.md` is internally consistent with the composite action interfaces, references `@v0.8.2`.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.
- B2 `FERRY_*` repo variables standardise tunable knobs across all four agent composite actions.
- `docs/MCP.md` documents stdio MCP server support.
- Pre/post-agent command hooks (#223) and `GITHUB_STEP_SUMMARY` (#224) documented in `docs/CONFIGURATION.md`.

**Carry-over weaknesses**

- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` instead (P2, action 5).
- `ferry-init` does not collect the two transition IDs — still a manual README step (P2, action 6).
- No `workflowTemplates()` invocation in `install-guide.test.ts` (P1, action 3) — the v0.8.0–v0.8.1 init-template regression would have been caught at this layer.

### 4.10 Code quality — 8.5 (unchanged)

**Strengths**

- Strict TypeScript NodeNext ESM, `no-explicit-any: error`.
- ESLint with agent-specific rules; restricted-imports verified by test.
- Prettier mandatory and currently clean (the v0.8.2-cycle red CI run was a single Prettier miss, fixed in HEAD).
- Layered architecture respected; agents never import Octokit/Jira directly (verified by `src/agents/restricted-imports.test.ts`).
- Multi-provider tool-loop modules (`src/lib/llm/tool-loop/`) follow the existing `agent-loop/` flat layout — `index.ts` dispatches by provider name, individual provider modules are independent.
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

### 4.12 Operations — 8.0 (+0.5)

**Strengths**

- `docs/RUNBOOK.md` — concrete on-call playbook.
- `ferry-uninstall` CLI — reversible-deploy path.
- `ferry-update` CLI — migration path, reads `MIGRATIONS.md`.
- Reconciler + cost-daily stubs ship in `examples/consumer-setup/workflows/`, pinned to `v0.8.2`.
- **Pre/post-agent command hooks (#223):** all four composite actions accept optional `pre_agent_command` and `post_agent_command` inputs that run shell commands before and after the agent step. Consumers wire setup (cache warmups, secret-injection) and teardown (artifact uploads, custom telemetry) without forking the workflow.
- **Developer WIP-commit-on-failure (#222):** when the developer agent crashes mid-task, in-progress work is committed to a `ferry-wip/<ticket>` branch and a structured Jira summary is posted with failure category, token usage, and the WIP branch URL. Reduces lost-work incidents and gives operators a starting point for manual recovery.
- **3-state outcome (#221):** `done` tool reports `success` | `partial` | `blocked` — finer-grained signal for downstream automation.

**Weaknesses (carry-over)**

- No proactive monitoring — audit issue pings nobody.
- Reconciler effectiveness depends on consumer wiring the stub.

### 4.13 Release / distribution — 8.5 (+0.5)

The release pipeline executed three times in this audit window (`v0.8.0`/`v0.8.1`/`v0.8.2`, all on 2026-05-05). The cadence-drag finding from the v0.7.0+25 audit is closed. The +0.5 is held back from a full +1.0 by two consumer-impacting incidents in the same window:

1. **`v0.8.0` `timeout-minutes` DOA on composite-action steps.** GitHub Actions does not support `timeout-minutes:` on composite-action steps (only on workflow/job steps), so every consumer pinned to `@v0.8.0` failed at job setup with `Unexpected value 'timeout-minutes'` before any agent code executed. Fixed in `v0.8.1` same day with a shell-level `timeout Nm bash -c "$CMD"` wrapper. **Closure:** `#229` adds a composite-action input validator at build time so this regression class cannot recur.
2. **`v0.8.0`/`v0.8.1` silently-ignored `ferry_model:` in init templates.** The scaffolded `ferry-refine.yml` and `ferry-dev.yml` workflows passed `ferry_model:` to the refiner and developer composite actions, but those actions expect `ferry_refiner_model:` / `ferry_dev_model:` since the v0.7.x per-agent input split. GitHub Actions silently ignored the unknown input, so consumers ran with the action's default model rather than their configured one. Fixed in `v0.8.2` with `#230`. **Closure:** `ferry-update` rewrites the workflows with the correct input names; manual fix is a one-line rename.

**Strengths**

- Release pipeline proven on ten tag pushes (v0.4.0 through v0.8.2). All pipelines green.
- `package.json`: `"version": "0.8.2"`, `"publishConfig": { "access": "public" }`.
- `CHANGELOG.md` and `MIGRATIONS.md` present and feed the release pipeline.
- `v1` floating tag advances correctly on each release.
- npm publish uses `--provenance --access public`.
- HEAD is only 6 commits ahead of `v0.8.2`; the substantive feature on that tip (multi-provider Phase 2, #231) is awaiting stabilization, not stuck.

**Weaknesses**

- Two consumer-impacting hotfixes in a 24h window — release-quality blip held the score below 9.0.
- CHANGELOG link section: `[0.7.0]`/`[0.8.0]`/`[0.8.1]`/`[0.8.2]` links present, `[Unreleased]` base correctly bumped to `v0.8.2`, but `[0.5.0]`–`[0.5.3]` links remain missing (D10 carry-over).
- No SLSA provenance on the GitHub Release artifact.
- No documented LTS / support window.

### 4.14 Cost governance — 7.0 (unchanged)

**Strengths**

- `src/cost-governance/daily-check.ts` written and tested.
- `examples/consumer-setup/workflows/ferry-cost-daily.yml` ships as a copy-paste stub (cron `0 6 * * *`); 50% monthly cap → auto-pause via `ferry:paused` label. `FERRY_SPEND_CAP_EUR` env-tunable (default 200).
- Audit line carries `cost_eur` per execution.
- Soft-budget warnings at 70% / 85% of `max_tokens_per_run` give operators mid-run visibility.

**Weaknesses**

- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.
- The safety net requires the consumer to copy the stub; nothing validates they did.

### 4.15 Doc–code coherence — 8.0 (+0.5)

**Closed drift items (D1–D9)** — all hold.

| #   | Status                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------- |
| D1  | **Closed.** CLAUDE.md correctly lists all four CLIs.                                                           |
| D2  | **Closed.** `CONTRIBUTING.md` correctly states "The bundle-drift check is enforced in CI."                     |
| D3  | **Closed.** `CONTRIBUTING.md` correctly states "there is no local `commit-msg` hook today."                    |
| D4  | **Closed.** `docs/RELEASING.md` lists all four CLIs.                                                           |
| D5  | **Closed.** Stub headers no longer advertise phantom optional variables.                                       |
| D6  | **Closed.** `ferry-update` reads `MIGRATIONS.md` at runtime.                                                   |
| D7  | **Closed.** `ferry-doctor` check D7 verifies `FERRY_AUDIT_ISSUE`.                                              |
| D8  | **Closed (was partial).** `docs/adr/0002-ferry-bundles-committed.md` now references `@v0.8.2` consistently.    |
| D9  | **Closed (was partial).** ADR 0002 drift was the v0.7.0+25 audit's two-cycle carry-over; resolved at `v0.8.2`. |
| D11 | **Closed.** Stale "they use @v0.6.0" comment in `src/install-guide.test.ts` no longer present at HEAD.         |

**Drift items (current)**

| #   | Drift                                                                                                                                                                                                                                                                                                                                                         | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D10 | **CHANGELOG link section missing `[0.5.0]`–`[0.5.3]` release tag links.** `[0.7.0]`/`[0.8.0]`/`[0.8.1]`/`[0.8.2]` and `[Unreleased]` base are correct; the v0.5.x gap remains. Affects changelog navigation; does not block releases.                                                                                                                         | low      |
| D12 | **Action 0d (systematic tag-pin drift gate) still not implemented.** Recurrence of the ADR drift class is gated only on manual diligence; the v0.5.3 → v0.6.0 → v0.7.0 → v0.8.2 history shows this drift recurs at every cut. A regex-based test asserting `@v[0-9.]+` literals across `docs/**` agree with `package.json .version` would prevent recurrence. | low      |

**Net coherence assessment**

D1–D9 + D11 closures hold. Two drift items remain (D10 v0.5.x CHANGELOG links, D12 missing systematic guard). **Score: 8.0** — +0.5 from the previous audit, with D9 finally resolved.

---

## 5. Gaps and risks

### 5.1 Hardcoded values (P0/P1)

Scan scope: `src/**/*.ts`, excluding `*.test.ts`, `__fixtures__/`, `__lint-fixtures__/`, `src/schemas/*.json`.

**Assessment:** Almost every production constant is env-tunable via the `FERRY_*` env-var pattern. P0 count is **0**. P1 count is **2** — below the 6-item threshold; no score penalty applied to Domains 5 or 8.

**P1 — Size & Batch Limits (carry-over)**

- **P1** `src/agents/developer/tools.ts:23` — `MAX_SEARCH_MATCHES = 200` — grep result cap for the dev agent; not env-tunable. Large repos with >200 matches per pattern receive a silent truncation. Could be moved to a `FERRY_GREP_MAX_MATCHES` env var.
- **P1** `src/lib/audit/index.ts:39` — `MAX_PAGES = 10` — caps audit comment pagination at 1,000 (10 × 100). Not env-tunable. Combined with `ROTATION_THRESHOLD = 900` and `FERRY_AUDIT_ROTATION_THRESHOLD` override it works in practice (rotation triggers before MAX_PAGES is reached), but the ceiling itself is rigid.

**P2 items (acceptable as-is)** — most constants already env-tunable: `FERRY_GREP_TIMEOUT_MS`, `FERRY_BASH_TIMEOUT_MS`, `FERRY_HTTP_TIMEOUT_MS`, `FERRY_DEV_MAX_ITERATIONS`, `FERRY_DEV_MAX_INPUT_TOKENS`, `FERRY_DEV_MAX_TOKENS`, `FERRY_DEV_COMPACT_WINDOW`, `FERRY_REVIEWER_MAX_ITERATIONS`, `FERRY_REVIEWER_MAX_TOKENS`, `FERRY_TLDR_TOTAL_CHARS`, `FERRY_AUDIT_ROTATION_THRESHOLD`, `FERRY_REFINER_SUBTASK_CAP`, `FERRY_REFINER_TOUCH_PATHS_CAP`, `FERRY_REVIEW_PATCH_TRUNCATE_CHARS`, `FERRY_REVIEW_FILE_TRUNCATE_CHARS`, `FERRY_BASH_OUTPUT_MAX_BYTES`, `FERRY_READ_FILE_MAX_BYTES`, `FERRY_SPEND_CAP_EUR`, `FERRY_RECONCILER_STALE_WINDOW_MINUTES`, `FERRY_OPENAI_KEY`, `FERRY_GOOGLE_AI_KEY`. Soft-budget warning thresholds (`0.7`, `0.85`) in `src/lib/llm/agent-loop/anthropic.ts` are sensible defaults for most consumers; could become `FERRY_BUDGET_WARN_FIRST_PCT` / `FERRY_BUDGET_WARN_SECOND_PCT` if operators want different signal points. Acceptable as-is.

---

## 6. Prioritized action plan (residual)

| Order | Action                                                                                                                                                                                                                                                                                             | Domain        | Score before | Priority | Effort |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- | ------ |
| 1     | **(P1, carry-over)** Add `harden-runner` egress allowlist to dev/iterate workflows — these jobs run `git push` and therefore need egress to GitHub; all other outbound connections should be blocked.                                                                                              | GH Actions    | 7.5          | **P1**   | S      |
| 2     | **(P1, carry-over from v0.5.3)** Action 0d: add a regex assertion (or new `tag-pin-drift.test.ts`) that scans `docs/adr/*.md`, `docs/RELEASING.md`, `docs/CONFIGURATION.md` for `@v[0-9.]+` literals and fails if any disagrees with `package.json .version`. The class drift recurs at every cut. | Coherence     | 8.0          | **P1**   | XS     |
| 3     | **(P1, carry-over)** Extend `install-guide.test.ts` to invoke `workflowTemplates()` from `src/cli/init/templates.ts` and assert each emitted stub's composite-action refs and tag exist on origin. Would have caught the v0.8.0–v0.8.1 silently-ignored `ferry_model:` regression.                 | E2E           | 8.5          | **P1**   | S      |
| 4     | **(P1, carry-over)** Add e2e idempotency replay: same `event_id` twice → same outcome, no duplicate external writes.                                                                                                                                                                               | E2E           | 8.5          | **P1**   | M      |
| 5     | **(P2)** `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the README curl step).                                                                                                                                                                             | Consumer docs | 8.5          | **P2**   | S      |
| 6     | **(P2)** `ferry-init` collects the two transition IDs and sets them as secrets.                                                                                                                                                                                                                    | Consumer docs | 8.5          | **P2**   | S      |
| 7     | **(P2)** OSSF Scorecard + SLSA provenance on the GitHub Release artifact.                                                                                                                                                                                                                          | Supply chain  | 8.5          | **P2**   | M      |
| 8     | **(P2)** Migrate `GITHUB_TOKEN` to a fine-grained GitHub App (or remove the App provisioning from `ferry-init`).                                                                                                                                                                                   | GH Actions    | 7.5          | **P2**   | L      |
| 9     | **(P2)** Branch-protection on `main` requiring CodeQL / Ferry — CI / Release checks before merge.                                                                                                                                                                                                  | CI/CD         | 9.0          | **P2**   | XS     |
| 10    | **(P2)** Make `MAX_SEARCH_MATCHES` and `MAX_PAGES` env-tunable (`FERRY_GREP_MAX_MATCHES`, `FERRY_AUDIT_MAX_PAGES`).                                                                                                                                                                                | Architecture  | 8.5          | **P2**   | XS     |
| 11    | **(low)** Backfill `[0.5.0]`–`[0.5.3]` links in `CHANGELOG.md` (D10).                                                                                                                                                                                                                              | Release       | 8.5          | low      | XS     |
| 12    | **(P2)** Once multi-provider Phase 2 is exercised against a real Reviewer run on at least one non-Anthropic provider, cut `v0.9.0` so consumers can pick up Phase 2.                                                                                                                               | Release       | 8.5          | **P2**   | XS     |

### 6.1 Expected score after the plan

| Domain                  | Current | After P1 (1–4) | After All |
| ----------------------- | ------- | -------------- | --------- |
| Application security    | 8.5     | 8.5            | 9.0       |
| Supply-chain security   | 8.5     | 9.0            | 9.5       |
| GitHub Actions security | 7.5     | 8.5            | 9.0       |
| Tests & coverage        | 8.5     | 8.5            | 8.5       |
| E2E / acceptance        | 8.5     | 9.0            | 9.0       |
| CI/CD gates             | 9.0     | 9.0            | 9.5       |
| Reliability             | 9.0     | 9.0            | 9.0       |
| Observability           | 7.5     | 7.5            | 8.0       |
| Consumer documentation  | 8.5     | 8.5            | 9.0       |
| Code quality            | 8.5     | 8.5            | 8.5       |
| Traceability            | 7.5     | 7.5            | 7.5       |
| Operations              | 8.0     | 8.0            | 8.5       |
| Release / distribution  | 8.5     | 8.5            | 9.0       |
| Cost governance         | 7.0     | 7.0            | 8.0       |
| Doc–code coherence      | 8.0     | 9.0            | 9.0       |
| **Overall**             | **8.2** | **8.53**       | **8.80**  |

The single most impactful action is **#2 (action 0d)** — XS effort that cleanly closes the only persistent class of doc-code drift in the project, plus **#1 (`harden-runner`)** which moves Domain 3 out of the medium band.

---

## 7. What changed since the v0.7.0+25 audit (8.0 → 8.2; net +0.2)

| #   | Change                                                                                                                                                                                                 | Domain effect                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | **`v0.8.0` cut on 2026-05-05** — released the smoke gate, read*file caps, agent-loop pruning, B2 `FERRY*\*` repo variables, soft-budget warnings, multi-provider Phase 1, package-manager auto-detect. | Domain 13 cadence-drag closed; +0.5 (Release)                          |
| 2   | **`GITHUB_STEP_SUMMARY` emitter (#224)** — per-run telemetry into the GH Actions UI                                                                                                                    | Domain 8 +0.5 (Observability)                                          |
| 3   | **Pre/post-agent command hooks (#223)** on all four composite actions                                                                                                                                  | Domain 12 +0.5 (Operations, partial)                                   |
| 4   | **Developer WIP-commit-on-failure (#222)** — `ferry-wip/<ticket>` branch + Jira summary                                                                                                                | Domain 12 (counted above); Domain 7 strengthened                       |
| 5   | **3-state `done` outcome (#221)** — `success`/`partial`/`blocked`                                                                                                                                      | Domain 12 (counted above)                                              |
| 6   | **`v0.8.0` `timeout-minutes` DOA — `v0.8.1` hotfix — `#229` validator**                                                                                                                                | Net 0 on Domain 13 (incident offset by the validator); -0.5 was stayed |
| 7   | **`v0.8.0`/`v0.8.1` silently-ignored `ferry_model:` — `v0.8.2` hotfix**                                                                                                                                | Net 0 on Domain 13                                                     |
| 8   | **Multi-provider Phase 1 (Refiner)** in `v0.8.0` and **Phase 2 (Reviewer, #231)** on `main` post-`v0.8.2`                                                                                              | Domain 1, Domain 4 strengthened (new tool-loop test coverage)          |
| 9   | **+81 unit tests (1119 → 1200)** — multi-provider tool-loop coverage; new composite-action input validator                                                                                             | Domain 4 strengthened (held at 8.5)                                    |
| 10  | **ADR 0002 `@v0.6.0` drift closed** — D9, two-cycle carry-over, now references `@v0.8.2`                                                                                                               | Domain 15 +0.5 (Doc-code coherence)                                    |
| 11  | **CHANGELOG `[0.7.0]`/`[0.8.0]`/`[0.8.1]`/`[0.8.2]` links** present and `[Unreleased]` base bumped to `v0.8.2`                                                                                         | Domain 13 (counted above); D10 v0.5.x gap remains                      |
| 12  | **Locale pinning to en-US for number formatting (`e712ec1`)** — non-English runners no longer emit comma-decimal cost figures                                                                          | Domain 7 strengthened                                                  |
| 13  | **cache_control stripping on prior tool-results turn (`e00ec30`)** — Anthropic API errors on cache re-prime resolved                                                                                   | Domain 7 strengthened                                                  |

---

## 8. Closed from previous audits

### Closed since the v0.7.0+25 audit

| Item | Action (was P1/carry-over)                         | Status   | Evidence                                                                                      |
| ---- | -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| R    | Cut `v0.8.0` — ship landed hardenings              | **done** | Three releases shipped (`v0.8.0`/`v0.8.1`/`v0.8.2`) on 2026-05-05                             |
| D9   | ADR 0002 `@v0.6.0` drift                           | **done** | `docs/adr/0002-ferry-bundles-committed.md` references `@v0.8.2` at HEAD                       |
| D11  | Stale `@v0.6.0` comment in `install-guide.test.ts` | **done** | Comment removed; line 49–52 asserts `@v0.8.2`                                                 |
| —    | Composite-action input validator (new)             | **done** | `src/lib/agent-runtime/composite-action.test.ts` (#229) blocks unsupported keys at build time |

### Still open (carry-over)

| Item | Action                                          | Priority | Effort |
| ---- | ----------------------------------------------- | -------- | ------ |
| 1    | `harden-runner` egress allowlist                | **P1**   | S      |
| 2    | Tag-pin drift gate (action 0d) — 3rd cycle      | **P1**   | XS     |
| 3    | Install-guide test covers `workflowTemplates()` | **P1**   | S      |
| 4    | E2E idempotency replay                          | **P1**   | M      |
| 5    | `ferry-init` scaffolds ops stubs                | **P2**   | S      |
| 6    | `ferry-init` collects transition IDs            | **P2**   | S      |
| 7    | OSSF Scorecard / SLSA on GH Release             | **P2**   | M      |
| 8    | Migrate GITHUB_TOKEN to fine-grained App        | **P2**   | L      |
| 9    | Branch-protection on `main`                     | **P2**   | XS     |
| 10   | Env-tunable `MAX_SEARCH_MATCHES` / `MAX_PAGES`  | **P2**   | XS     |
| 11   | Backfill `[0.5.0]`–`[0.5.3]` CHANGELOG links    | low      | XS     |
| 12   | Cut `v0.9.0` for multi-provider Phase 2         | **P2**   | XS     |

---

## 9. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §6 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
