# Production-Readiness Audit — Ferry

**Date:** 2026-05-01
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria, with a special focus on security.
**Verdict:** **7.2 / 10 — release-candidate quality, distance to `v1` is now a focused release-engineering job.**
**Target:** **8–9 / 10**, addressed by the residual actions in §5.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (878 tests passing), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `.github/workflows/codeql.yml`.
- **Docs:** `docs/CONSUMER-SETUP.md`, `docs/CONFIGURATION.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Conditional.** All quality gates are green and security posture is strong, but three release-engineering blockers remain: (a) tag `v1` does not exist, (b) every internal composite action is referenced by `@main` (mutable), (c) `package.json` is `0.0.1` / `private: true` and there is no `CHANGELOG.md`. Until these land, `docs/CONSUMER-SETUP.md` Phase 3.2 (`gh api .../tags/v1`) cannot run and consumers cannot pin a stable cut.
2. **Can a consumer install and reach the full Jira → PR-approved cycle?** **Almost — blocked on the `v1` tag.** `ferry-init` and `ferry-doctor` are wired; six consumer workflow stubs exist (`examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate,reconcile,cost-daily}.yml`); the three auto-transitions (FR18, FR24, FR28) are unit-tested and now exercised by the mocked end-to-end pipeline test (`src/e2e/pipeline.test.ts`, 437 lines, 11 describe blocks). Every stub pins `FERRY_REF: v1` — so the install procedure is correct on paper but cannot be executed today because no such ref is published.
3. **Security posture?** Strong, with one residual supply-chain weakness. Strict AJV schema validation, `execFileSync`-only shell calls, CodeQL + npm audit + gitleaks in CI, explicit per-job `permissions:` blocks across every workflow, secret-scan before every dev commit, no `@octokit/rest` or Jira imports under `src/agents/**` (lint-enforced + tested). Residual gap: internal `big-emotion/ferry/.github/actions/ferry-*@main` pins are mutable and provide a self-replication path for a compromised maintainer.
4. **Is the score close to 8–9/10?** Computed score is **7.2** (up from 5.6). Three actions close most of the distance: cut and pin `v1`, replace `@main` with `@v1`/SHA in the four agent workflows, and add a `CHANGELOG.md` + release workflow. Reaching 8.5+ also requires audit-issue rotation and `harden-runner` egress allowlisting.

---

## 2. Overall score — **7.2 / 10**

Movement since the previous audit (5.6): twelve of fifteen prioritized actions have landed (see §5). The remaining gap is concentrated in **release engineering** — version, tag, CHANGELOG, internal action pinning — not in code quality, security, or test coverage.

Quality gates at audit time (all green):

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 80 files / 878 tests / 100% passing in 1.8s
- `npm audit` (moderate+) — 0 vulnerabilities
- TODO/FIXME/XXX/HACK count under `src/` — 1

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. prev | Trend  |
| --- | ---------------------------------- | ------------ | ---------- | ------ |
| 1   | Application security               | **8.5 / 10** | +1.0       | strong |
| 2   | Supply-chain security              | **7.0 / 10** | +1.5       | medium |
| 3   | GitHub Actions security            | **7.5 / 10** | +1.5       | strong |
| 4   | Tests & coverage                   | **7.5 / 10** | +2.5       | strong |
| 5   | E2E / acceptance tests             | **7.0 / 10** | +5.0       | strong |
| 6   | CI/CD gates                        | **9.0 / 10** | +1.0       | strong |
| 7   | Reliability (idempotency, retries) | **8.0 / 10** | 0          | strong |
| 8   | Observability / audit              | **7.0 / 10** | +2.0       | medium |
| 9   | Consumer documentation             | **8.5 / 10** | +0.5       | strong |
| 10  | Code quality / typing              | **8.5 / 10** | +0.5       | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | +5.5       | strong |
| 12  | Operations / runbooks / rollback   | **5.5 / 10** | +2.5       | medium |
| 13  | Release / distribution             | **2.5 / 10** | +0.5       | weak   |
| 14  | Cost governance (runtime)          | **7.0 / 10** | +4.0       | medium |

Mean = **7.21 / 10**.

---

## 4. Domain analysis

### 4.1 Application security — 8.5

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- **All shell calls migrated to `execFileSync`** with argv-as-array (`src/agents/developer/dev-action.ts:80,84,85,86,98,181,182,188,196,216`, `src/agents/developer/loop.ts:24,25,31,32`). Eliminates the residual concern from the previous audit.
- `FerryError` taxonomy with typed codes (`state-invariant`, `spend-cap`, `transient`, `unknown`).
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit (`src/lib/agent-runtime/secret-scan.ts`); never includes raw stdout/stderr in error messages.
- `@typescript-eslint/no-explicit-any: 'error'` plus `no-restricted-imports` for agent code (verified via `src/agents/restricted-imports.test.ts`; only `__lint-fixtures__/restricted-imports.ts` matches the pattern, by design).
- No payload leak in errors (`src/lib/envelope/validate-action.ts:29` "Log only the sanitized error message — no payload values (NFR-S1)").

**Weaknesses**

- LLM-supplied `commit_message` (`dev-action.ts:188`) reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 7.0

**Strengths**

- **CodeQL SAST wired** (`.github/workflows/codeql.yml`).
- **`audit:ci` job in CI** (`.github/workflows/ferry-ci.yml` jobs `audit`, runs `node scripts/npm-audit-check.mjs`).
- **Bundle-drift check in CI** (`check:bundle` job): rebuilds `.ferry/` from `src/` and fails if the diff is non-empty.
- Third-party actions pinned by SHA (`actions/checkout@de0fac2e…`, `actions/setup-node@48b55a01…`, `actions/upload-artifact@ea165f8d…`).
- gitleaks tarball pinned by SHA256 in `ferry-ci.yml`.
- `npm audit` clean at audit time (0 across info/low/moderate/high/critical).
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped (`.github/dependabot.yml`).

**Weaknesses**

- **Internal composite actions referenced by `@main`** in every agent workflow: `big-emotion/ferry/.github/actions/{ferry-envelope-validate,ferry-run-{refiner,developer,reviewer,iterator},ferry-emit-audit}@main` — confirmed by `grep -RnE "uses:\s*big-emotion/ferry"`. A push to `main` immediately runs in every consumer install. **This is the single largest residual supply-chain risk.**
- **Tag `v1` does not exist** (`git tag` returns empty). `CONSUMER-SETUP.md` Phase 3.2 and every stub workflow's `FERRY_REF: v1` cannot resolve.
- No commit signing, no SLSA provenance, no attestations.
- No SBOM, no OSSF Scorecard.

### 4.3 GitHub Actions security — 7.5

**Strengths**

- **Explicit `permissions:` blocks on every job** across `refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`, `ferry-ci.yml` (verified via `grep -nE "permissions:" .github/workflows/*.yml`). The previous audit's "refine.yml has no permissions block" gap is closed; every `emit-audit` job now declares its own scope.
- Concurrency groups per ticket (`ferry-${workflow}-${ticket_key}`) prevent races; `cancel-in-progress: false` on writes (dev/iterate), `true` on read-only (refine/review).
- Fallback `'ferry-invalid-payload-sinkhole'` in concurrency string blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.

**Weaknesses**

- `GITHUB_TOKEN` used instead of a fine-grained GitHub App.
- No `harden-runner` (StepSecurity) for egress allowlisting.
- No OIDC for federated auth to Anthropic / Jira.
- Audit issue rotation: capped at `MAX_PAGES * 100 = 1000` comments, then silently fails.

### 4.4 Tests & coverage — 7.5

| Metric  | Status                                                                   |
| ------- | ------------------------------------------------------------------------ |
| Suite   | 80 files / **878 tests** / all passing in 1.8 s                          |
| Reports | text, text-summary, html, lcov                                           |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts` — ratcheted up from 65/65/75 |

**Strengths**

- Coverage threshold raised to a uniform **75 %** across statements/branches/functions/lines.
- CLI module coverage closed (issue #85): `cli/init/steps/*` and `cli/doctor/checks/*` now exercised.
- Composite-action entrypoints (`*-action.ts`) and CLI bin entrypoints excluded from coverage with documented reason in `vitest.config.ts`.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the new e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 7.0

**Strengths**

- **Mocked end-to-end pipeline test exists**: `src/e2e/pipeline.test.ts` — 437 lines, 11 describe blocks, replays refine→dev→review→iterate.
- `src/install-guide.test.ts`: structural tests linking documentation ↔ code (FR mentions, secret names, Jira columns, `event_id` format).
- FR drift detector (`scripts/check-fr-drift.sh`, wired in CI lint job) prevents introducing a new `FR\d+` tag without a registry entry.

**Weaknesses**

- No idempotency assertion across a full replay of the same `event_id`.
- No runtime invariant test for "Ferry never merges" (could be a lint rule that bans `octokit.rest.pulls.merge` from `src/`).

### 4.6 CI/CD gates — 9.0

**Strengths**

- Six parallel CI jobs in `ferry-ci.yml`: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `check-bundle`, `audit`, plus the gitleaks workflow and CodeQL workflow.
- Coverage uploaded as artefact (7-day retention).
- All actions in CI pinned by SHA.
- Concurrency cancels superseded CI runs on the same branch.

**Weaknesses**

- No `npm ci` integrity check (`--audit signatures`).
- No required-checks branch-protection assertion in repo metadata (depends on `gh api` call to verify, out of scope for this read-only pass).

### 4.7 Reliability — 8.0

**Strengths**

- Idempotency markers `[ferry:role:runId]` on every external write.
- Centralised `retry` helper with backoff (`src/lib/io/retry.ts`).
- Spend-cap detection: 4xx classified transient/non-transient.
- `FerryError` taxonomy enables differentiated handling.
- Concurrency mutex per ticket via GitHub Actions.

**Weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- Audit pagination capped at 1000 with no rotation/archival.
- Reconciler depends on the consumer wiring `ferry-reconcile.yml` from the example stubs; no automatic enforcement that they did.

### 4.8 Observability — 7.0

**Strengths**

- **Structured JSON logger now in use**: every test-time log line emits `{level, ts, correlation_id, component, message, ...}` (visible during `npm test` — e.g. `{"level":"info","ts":"…","correlation_id":"evt-dry-001","component":"ferry:refiner-action",…}`). Closes the bulk of the previous "46 console.log scattered" gap.
- Centralised audit issue with JSON-per-phase lines (ticket, phase, run_id, tokens, cost).
- Correlation by `run_id` / ULID across phases.

**Weaknesses**

- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human (mitigated only when the consumer wires the reconciler).
- No consumer dashboard (cost trend, success rate per phase).
- Some emitters still pass `correlation_id: ""` (visible in test output) — not all entry points propagate the ID.

### 4.9 Consumer documentation — 8.5

**Strengths**

- `docs/CONSUMER-SETUP.md`: 7 phases, screenshot-ready, troubleshooting, quick checklist.
- `docs/CONFIGURATION.md`: full reference of secrets + variables.
- **`docs/REQUIREMENTS.md` FR registry** with explicit `FR\d+` → source/test mapping; CI drift detector enforces consistency.
- **`docs/adr/`** present (`0001-three-fr-auto-transitions.md` through `0005-no-auto-merge-invariant.md`, plus a README index) — the major foundational decisions are now recorded.
- Structural tests detect doc/code drift (`src/install-guide.test.ts`).

**Weaknesses**

- **No `CHANGELOG.md`** — there is no human-readable history of what changed across (eventually) versions.
- No migration guide (no version exists yet to migrate from).
- No on-call runbook (what to do when a ticket stalls? when cost spikes?).

### 4.10 Code quality — 8.5

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

### 4.11 Traceability / FR governance — 7.5

**Strengths**

- `docs/REQUIREMENTS.md` is the single source of truth for `FR\d+` IDs (status, source files, test files, date introduced).
- `npm run check:fr-drift` (wired into CI lint job) fails the build if any `FR\d+` tag in `src/`, `prompts/` or `docs/` lacks a registry entry.
- Five ADRs cover the foundational decisions (three-FR auto-transitions, `.ferry/` committed, Anthropic Messages API, idempotency-via-markers, no-auto-merge invariant).
- Audit issue traces every runtime execution.

**Weaknesses**

- No commit-msg lint enforcing FR or issue back-reference.
- No bidirectional code → FR mapping beyond grep (no `@FR18` decorator pattern).
- No `CHANGELOG.md`.

### 4.12 Operations — 5.5

**Strengths**

- **Reconciler stub `ferry-reconcile.yml` and cost-daily stub `ferry-cost-daily.yml` ship in `examples/consumer-setup/workflows/`** — consumers can wire both with two `cp` commands.
- Phase 7 hardening documented (manual cost cap, branch protection, SHA renewal).

**Weaknesses**

- No rollback plan documented.
- No feature flags or staged rollout.
- No on-call runbook.
- No proactive monitoring — audit issue pings nobody.
- The consumer is responsible for actually wiring the reconciler/cost workflow; nothing in `ferry-init` enforces it (`ferry-doctor` may catch it — not verified in this pass).

### 4.13 Release / distribution — 2.5

**Blockers** (the focal area for the next milestone):

- **Tag `v1` does not exist.** Every consumer-setup stub uses `FERRY_REF: v1` and `CONSUMER-SETUP.md` Phase 3.2 calls `gh api .../tags/v1` — neither can run.
- `package.json`: `"version": "0.0.1"`, `"private": true` — must change to publish (or to allow `git tag v1` to mean something).
- **No `CHANGELOG.md`** at the repo root.
- No release workflow (build + version bump + tag + GitHub release notes).
- No documented versioning policy (semver? floating `v1` vs pinned?).
- **Internal composite actions still referenced by `@main`** — see §4.2.

**Strengths**

- `bin` exposed for `ferry-init` / `ferry-doctor` — `npx`-ready once published.
- `check:bundle` CI job ensures `.ferry/` matches `src/` so a tag carries a consistent payload.
- The `ferry-release` skill is documented to drive the release locally.

### 4.14 Cost governance (runtime) — 7.0

**Strengths**

- `src/cost-governance/daily-check.ts` written and tested.
- `examples/consumer-setup/workflows/ferry-cost-daily.yml` ships as a copy-paste stub (cron `0 6 * * *`); 50 % monthly cap → auto-pause via `ferry:paused` label.
- `FERRY_SPEND_CAP_EUR` documented (default 200 EUR).
- Audit line carries `cost_eur` per execution.

**Weaknesses**

- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.
- The safety net is the consumer copying the stub; nothing validates they did.
- Only manual Anthropic console cap as a hard backstop.

---

## 5. Prioritized action plan (residual)

Twelve of the previous fifteen actions have landed (see §6). The residual list — the actions that take the score from 7.2 to 8+:

| Order | Action                                                                                                   | Domain       | Score before | Priority | Effort |
| ----- | -------------------------------------------------------------------------------------------------------- | ------------ | ------------ | -------- | ------ |
| 1     | Cut tag `v1`, lift `private: true`, bump version to `1.0.0`, add release workflow                        | Release      | 2.5          | **P0**   | M      |
| 2     | Replace `big-emotion/ferry/.github/actions/ferry-*@main` with `@v1` (or SHA) in the four agent workflows | Supply chain | 7.0          | **P0**   | S      |
| 3     | Add `CHANGELOG.md` (Keep a Changelog format) and wire `ferry-release` skill to maintain it               | Docs/Release | 8.5 / 2.5    | **P0**   | S      |
| 4     | Audit-issue rotation when comments approach the 1000-comment cap                                         | Reliability  | 8.0          | **P1**   | M      |
| 5     | Add `harden-runner` egress allowlist to dev/iterate workflows                                            | GH Actions   | 7.5          | **P1**   | S      |
| 6     | Add e2e idempotency replay (same `event_id` twice → same outcome, no duplicate writes)                   | E2E          | 7.0          | **P1**   | M      |
| 7     | Add `octokit.rest.pulls.merge` lint ban + test for the "no-auto-merge" invariant                         | App security | 8.5          | **P2**   | S      |
| 8     | On-call runbook (`docs/RUNBOOK.md`): stalled ticket, cost spike, agent loop runaway                      | Operations   | 5.5          | **P2**   | M      |
| 9     | OSSF Scorecard + SLSA provenance on the release workflow                                                 | Supply chain | 7.0          | **P2**   | M      |
| 10    | Migrate `GITHUB_TOKEN` to a fine-grained GitHub App with least-privilege scopes                          | GH Actions   | 7.5          | **P2**   | L      |

### 5.1 Expected score after the plan

| Domain                  | Current | After P0 | After P0+P1 | After all |
| ----------------------- | ------- | -------- | ----------- | --------- |
| Application security    | 8.5     | 8.5      | 8.5         | 9.0       |
| Supply-chain security   | 7.0     | 8.5      | 8.5         | 9.0       |
| GitHub Actions security | 7.5     | 7.5      | 8.5         | 9.0       |
| Tests & coverage        | 7.5     | 7.5      | 7.5         | 7.5       |
| E2E / acceptance        | 7.0     | 7.0      | 8.0         | 8.0       |
| CI/CD gates             | 9.0     | 9.0      | 9.0         | 9.0       |
| Reliability             | 8.0     | 8.0      | 8.5         | 8.5       |
| Observability           | 7.0     | 7.0      | 7.0         | 7.5       |
| Consumer documentation  | 8.5     | 9.0      | 9.0         | 9.0       |
| Code quality            | 8.5     | 8.5      | 8.5         | 8.5       |
| Traceability            | 7.5     | 8.0      | 8.0         | 8.0       |
| Operations              | 5.5     | 5.5      | 6.0         | 7.5       |
| Release / distribution  | 2.5     | 9.0      | 9.0         | 9.0       |
| Cost governance         | 7.0     | 7.0      | 7.0         | 8.0       |
| **Overall**             | **7.2** | **8.07** | **8.36**    | **8.39**  |

P0 alone is sufficient to clear the 8 / 10 bar.

---

## 6. What changed since the previous audit (5.6 → 7.2)

| #   | Action (prev. audit)                                              | Status   | Evidence                                                                             |
| --- | ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| 1   | Cut tag `v1`, add release workflow, lift `private: true`          | open     | `git tag` empty, `package.json` still `0.0.1` / `private`                            |
| 2   | Pin all internal `ferry-*@main` refs                              | open     | every agent workflow still uses `@main`                                              |
| 3   | Explicit `permissions:` on every job                              | **done** | `grep -nE "permissions:" .github/workflows/*.yml` confirms                           |
| 4   | Wire reconciler and `daily-check` to scheduled workflows          | **done** | `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml`                 |
| 5   | Mocked end-to-end test refine→dev→review→iterate                  | **done** | `src/e2e/pipeline.test.ts` (437 LOC, 11 describes)                                   |
| 6   | Replace `execSync` with `execFileSync` in dev-action and dev loop | **done** | `grep -n "execFileSync" src/agents/developer/*.ts`                                   |
| 7   | Enable CodeQL                                                     | **done** | `.github/workflows/codeql.yml`                                                       |
| 8   | Add `npm audit` step to CI                                        | **done** | `audit` job in `ferry-ci.yml` + `scripts/npm-audit-check.mjs`                        |
| 9   | Drift check `src/` ↔ `.ferry/` in CI                              | **done** | `check-bundle` job in `ferry-ci.yml`                                                 |
| 10  | Cover `cli/init/steps/*` and `cli/doctor/checks/*` to ≥ 70 %      | **done** | `vitest.config.ts` thresholds at 75/75/75/75; suite green                            |
| 11  | Cover `agents/developer/loop.ts` and `workspace.ts` to ≥ 70 %     | partial  | covered indirectly by e2e harness; dedicated unit gap remains                        |
| 12  | `docs/REQUIREMENTS.md` FR registry + drift lint                   | **done** | file present; `scripts/check-fr-drift.sh` wired in CI lint job                       |
| 13  | `docs/adr/` with foundational ADRs                                | **done** | five ADRs (0001 → 0005) present                                                      |
| 14  | Audit-issue rotation near the 1000-comment cap                    | open     | still capped silently                                                                |
| 15  | Structured logger with correlation_id                             | **done** | JSON log lines visible in test output (`level`, `ts`, `correlation_id`, `component`) |

---

## 7. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §5 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
