# Production-Readiness Audit — Ferry

**Date:** 2026-05-01
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria, with a special focus on security.
**Verdict:** **5.6 / 10 — advanced beta, not yet shippable as `v1`.**
**Target:** **8–9 / 10**, addressed by the 15 prioritized actions below (each tracked as a GitHub issue).

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run --coverage`, `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`.
- **Docs:** `docs/CONSUMER-SETUP.md`, `docs/CONFIGURATION.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`.

No runtime traffic, no GitHub/Jira API calls.

---

## 2. Overall score — **5.6 / 10**

The project has **above-average open-source foundations** (idempotency by marker, AJV strict input validation, layered IO, ESLint guardrails on agents, gitleaks pinned by SHA256). The distance to `v1` concentrates in five concrete areas:

1. **Release process** — tag `v1` does not exist; `package.json` is `0.0.1` and `private: true`.
2. **Internal supply chain** — composite actions reference `@main` (mutable).
3. **End-to-end testing** — no test replays the refine→dev→review→iterate pipeline.
4. **Traceability / governance** — no FR registry, no ADRs, no commit↔FR mapping.
5. **Wired-up runtime governance** — `reconciler` and `cost-governance/daily-check` are written and tested but **not wired to any workflow**.

---

## 3. Score per domain

| # | Domain | Score | Trend |
|---|---|---|---|
| 1 | Application security | **7.5 / 10** | strong |
| 2 | Supply-chain security | **5.5 / 10** | medium |
| 3 | GitHub Actions security | **6.0 / 10** | medium |
| 4 | Tests & coverage | **5.0 / 10** | weak |
| 5 | E2E / acceptance tests | **2.0 / 10** | absent |
| 6 | CI/CD gates | **8.0 / 10** | strong |
| 7 | Reliability (idempotency, retries) | **8.0 / 10** | strong |
| 8 | Observability / audit | **5.0 / 10** | basic |
| 9 | Consumer documentation | **8.0 / 10** | strong |
| 10 | Code quality / typing | **8.0 / 10** | strong |
| 11 | Traceability / FR governance | **2.0 / 10** | nearly absent |
| 12 | Operations / runbooks / rollback | **3.0 / 10** | weak |
| 13 | Release / distribution | **2.0 / 10** | blocker |
| 14 | Cost governance (runtime) | **3.0 / 10** | written but unwired |

---

## 4. Domain analysis

### 4.1 Application security — 7.5

**Strengths**

- Strict AJV input validation (`src/schemas/event.v1.schema.json`); `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings (e.g. `ferry/${ticketKey}` branch names) impossible by construction.
- No raw payload leak in errors (`src/lib/envelope/validate-action.ts:29` "Log only the sanitized error message — no payload values (NFR-S1)").
- `FerryError` taxonomy (`src/lib/errors/`) with typed codes: `state-invariant`, `spend-cap`, `transient`, `unknown`.
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit (`src/lib/agent-runtime/secret-scan.ts`).
- `scanWithGitleaks` deliberately **never includes raw stdout/stderr** in error messages (may contain leaked secret content).
- `@typescript-eslint/no-explicit-any: 'error'` and `no-restricted-imports` for agent code (no direct `@octokit/rest`, `node-fetch`, `undici`, Jira modules).

**Weaknesses**

- `execSync` with template strings in `src/agents/developer/dev-action.ts` and `src/agents/developer/loop.ts` (`git push origin ${branch} --force-with-lease`). Currently safe because `branchName` derives from an AJV-validated `ticket_key`, but no test pins this invariant.
- LLM-supplied `commit_message` (`dev-action.ts:177`) passed via `JSON.stringify` — safe for shell but no length/charset cap.
- No SAST (CodeQL, Semgrep, Snyk Code).
- No `eslint-plugin-security` or `eslint-plugin-no-secrets`.

### 4.2 Supply-chain security — 5.5

**Strengths**

- Third-party actions pinned by SHA (`actions/checkout@de0fac2e…`, `actions/setup-node@48b55a01…`).
- gitleaks tarball pinned by SHA256 in `ferry-ci.yml` (excellent practice).
- `npm audit` clean at audit time.
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped.

**Weaknesses**

- **Internal composite actions referenced by `@main`** in every workflow (`ferry-envelope-validate@main`, `ferry-run-refiner@main`, `ferry-emit-audit@main`). Mutable. Anyone with push access to `main` runs arbitrary code in every consumer install.
- **Tag `v1` does not exist.** `CONSUMER-SETUP.md` Phase 3.2 depends on `gh api repos/big-emotion/ferry/git/refs/tags/v1`. Listed in *Known limitations*.
- No commit signing, no SLSA provenance, no attestations.
- No `npm audit` in CI (only Dependabot offline).
- No SBOM, no OSSF Scorecard.

### 4.3 GitHub Actions security — 6.0

**Strengths**

- Concurrency groups per ticket (`ferry-${workflow}-${ticket_key}`) prevent races.
- `cancel-in-progress: false` on dev/iterate (writes), `true` on refine/review (read-only).
- Fallback `'ferry-invalid-payload-sinkhole'` in concurrency string blocks group injection via missing payload.
- Explicit `permissions:` per job on `dev/review/iterate` (`contents: write`, `pull-requests: write`, `issues: write`).
- CODEOWNERS on `.github/`, `src/schemas/`, `prompts/`.

**Weaknesses**

- **`refine.yml` has no `permissions:` block** — inherits the repo default (read-write per Phase 2.2 setup).
- **`emit-audit` jobs have no explicit permissions** — same issue, in every workflow.
- `GITHUB_TOKEN` used instead of a fine-grained GitHub App.
- No OIDC for federated auth to Anthropic / Jira.
- No `harden-runner` (StepSecurity) for egress allowlisting.
- Audit issue rotation: capped at `MAX_PAGES * 100 = 1000` comments, then silently fails.

### 4.4 Tests & coverage — 5.0

| Metric | Value | Stated target |
|---|---|---|
| Statements | 68.09 % | 75 % |
| Branches | 65.37 % | 75 % |
| Functions | 75.75 % | 75 % |
| Lines | 67.90 % | 75 % |
| Tests | 599 ✅ | — |

**Modules at 0–20 % coverage (consumer-critical paths)**

- `src/cli/init/steps/workflows.ts` — 0 %
- `src/cli/init/steps/github-app.ts` — 0 %
- `src/cli/init/steps/verify.ts` — 0 %
- `src/cli/init/steps/secrets.ts` — 4.34 %
- `src/cli/doctor/checks/dispatch.ts` — 0 %
- `src/cli/doctor/checks/jira.ts` — 0 %
- `src/cli/doctor/checks/llm.ts` — 0 %
- `src/agents/developer/loop.ts` — 0 %
- `src/agents/developer/workspace.ts` — 0 %
- `src/lib/agent-runtime/git.ts` — 0 %
- `src/lib/agent-runtime/labels.ts` — 0 %
- `src/lib/agent-runtime/secret-scan.ts` — 0 %
- `src/lib/mcp/client.ts` — 0 %
- `src/cli/http.ts` — 0 %

The CI thresholds in `vitest.config.ts` (`65/65/75/65`) are pinned **just below** current coverage — no ratchet toward the stated 75 % target.

### 4.5 E2E / acceptance tests — 2.0

**Strengths**

- `src/install-guide.test.ts`: 14 describes, ~40 structural tests linking documentation ↔ code (FR mentions, secret names, Jira columns, `event_id` format).

**Weaknesses**

- No E2E test replaying refine → dev → review → iterate (even mocked).
- No test simulating the four audit lines accumulating on a single ticket.
- No idempotency test across phases (replaying the same `event_id` must not duplicate comments or transitions).
- No runtime invariant test for "Ferry never merges" (no lint nor mock-based assertion that `octokit.rest.pulls.merge` is unreachable).
- No FR18 / FR24 / FR28 single-shot transition test.

### 4.6 CI/CD gates — 8.0

**Strengths**

- Four parallel jobs: `typecheck`, `lint+format`, `tests+coverage`, `gitleaks`.
- Coverage uploaded as artefact (7-day retention).
- gitleaks pinned by SHA256.

**Weaknesses**

- No `npm audit` in CI.
- No SAST (CodeQL is free for public repos).
- No `build:ferry` verification — `.ferry/` bundles are committed but nothing validates they match `src/`.
- No drift check `src/` ↔ `.ferry/`.

### 4.7 Reliability — 8.0

**Strengths**

- Idempotency markers `[ferry:role:runId]` everywhere (audit, comments, transitions).
- Centralised `retry` helper with backoff (`src/lib/io/retry.ts`).
- Spend-cap detection: 4xx classified transient/non-transient.
- `FerryError` taxonomy enables differentiated handling.
- Concurrency mutex per ticket via GitHub Actions.

**Weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- No DLQ (persistent failures = silent, save the **non-wired** reconciler).
- Audit pagination capped at 1000 with no rotation/archival.

### 4.8 Observability — 5.0

**Strengths**

- Centralised audit issue with JSON-per-phase lines (ticket, phase, run_id, tokens, cost).
- GitHub Actions run logs always available.

**Weaknesses**

- 46 `console.log/error` calls scattered, no structured logger (no levels, no systematic correlation_id beyond `run_id`).
- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human.
- No consumer dashboard (cost trend, success rate per phase).
- Audit issue is plain markdown — no native query/aggregation.

### 4.9 Consumer documentation — 8.0

**Strengths**

- `docs/CONSUMER-SETUP.md`: 7 phases, screenshot-ready, troubleshooting, quick checklist.
- `docs/CONFIGURATION.md`: full reference of 6 secrets + variable.
- Structural tests detect doc/code drift.

**Weaknesses**

- No migration guide between versions (no `v1` exists yet).
- No on-call runbook (what to do when a ticket stalls? when cost spikes?).
- No structured `CHANGELOG.md`.
- No ADRs (`docs/adr/`).

### 4.10 Code quality — 8.0

**Strengths**

- Strict TypeScript NodeNext ESM, `no-explicit-any: error`.
- ESLint with agent-specific rules.
- Prettier mandatory.
- Layered architecture respected.
- Unit tests next to implementation.

**Weaknesses**

- No complexity gates (cyclomatic, max lines).
- No `eslint-plugin-security` or `eslint-plugin-no-secrets`.
- `src/agents/reviewer/review-loop.ts` at 60 % coverage hints at complexity debt.

### 4.11 Traceability / FR governance — 2.0

**Strengths**

- Three FRs (FR18 / FR24 / FR28) cited in code, doc, and tests.
- Audit issue traces every runtime execution.

**Weaknesses**

- No FR registry — no `docs/REQUIREMENTS.md` listing FR1…FRn.
- No bidirectional FR ↔ code ↔ test ↔ commit mapping.
- No ADRs — major decisions ("why three FRs only", "why `.ferry/` committed", "why Anthropic Messages API vs Agent SDK") are unwritten.
- No FR/ticket back-reference in commits.
- "Story 8.3" cited in `CONSUMER-SETUP.md` (reconciler) is nowhere in the repo.
- No `CHANGELOG.md`.
- No drift detector — nothing prevents a future PR from introducing FR42 with no doc/test/ADR entry.

### 4.12 Operations — 3.0

**Strengths**

- Phase 7 hardening documented (manual cost cap, branch protection, SHA renewal).

**Weaknesses**

- No rollback plan documented.
- No feature flags or staged rollout.
- No on-call runbook.
- No proactive monitoring — audit issue pings nobody.
- Reconciler written but **not wired** — stalled tickets need manual re-trigger.
- `cost-governance/daily-check` written but **not wired** — no runtime cost protection.

### 4.13 Release / distribution — 2.0

**Blockers**

- Tag `v1` does not exist; `CONSUMER-SETUP.md` Phase 3.2 cannot run as written.
- No release workflow (build + version bump + tag + GitHub release notes).
- `package.json`: version `0.0.1`, `private: true`.
- No documented versioning policy (semver? floating `v1` vs pinned?).
- `.ferry/` bundles committed but no CI validation step.

**Strengths**

- `bin` exposed for `ferry-init` / `ferry-doctor` — `npx`-ready once published.

### 4.14 Cost governance (runtime) — 3.0

**Strengths**

- `src/cost-governance/daily-check.ts` written, tested.
- `ferry:paused` label mechanism documented (50 % monthly cap → auto-pause).
- Audit line carries `cost_eur` per execution.

**Weaknesses**

- Module **not wired** to any workflow (CLAUDE.md confirms).
- Only safety net is the manual Anthropic console cap (Phase 7).
- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs.

---

## 5. Prioritized action plan (15 items)

Each row corresponds to a GitHub issue. Priority drives which release the action belongs to:

- **P0** — release-blocker (must ship before `v1`)
- **P1** — should ship before `v1.1` / first stable consumer release
- **P2** — quality-of-life / hardening, can land later

Order is the recommended execution order (dependencies and quick wins first).

| Order | Action | Domain | Score before | Priority | Effort |
|---|---|---|---|---|---|
| 1 | Cut tag `v1`, add release workflow, lift `private: true` | Release | 2.0 | **P0** | M |
| 2 | Pin all internal `ferry-*@main` refs to `@v1` or SHA | Supply chain | 5.5 | **P0** | S |
| 3 | Add explicit `permissions:` to every job (refine, all `emit-audit` jobs) | GH Actions | 6.0 | **P0** | S |
| 4 | Wire reconciler and `daily-check` to scheduled workflows | Operations / cost | 3.0 | **P0** | M |
| 5 | Add mocked end-to-end test refine→dev→review→iterate | E2E | 2.0 | **P0** | L |
| 6 | Replace `execSync` with `execFileSync` in dev-action and dev loop | App security | 7.5 | **P1** | S |
| 7 | Enable CodeQL (free SAST) | Supply chain | 5.5 | **P1** | S |
| 8 | Add `npm audit --omit=dev` step to CI | Supply chain | 5.5 | **P1** | S |
| 9 | Drift check `src/` ↔ `.ferry/` in CI (rebuild + diff) | CI/CD | 8.0 | **P1** | S |
| 10 | Cover `cli/init/steps/*` and `cli/doctor/checks/*` to ≥ 70 % | Tests | 5.0 | **P1** | L |
| 11 | Cover `agents/developer/loop.ts` and `workspace.ts` to ≥ 70 % | Tests | 5.0 | **P1** | M |
| 12 | Create `docs/REQUIREMENTS.md` FR registry + commit-msg lint | Traceability | 2.0 | **P1** | M |
| 13 | Create `docs/adr/` with 4–5 foundational ADRs | Traceability | 2.0 | **P1** | M |
| 14 | Audit-issue rotation when comments approach the 1000-comment cap | Reliability | 8.0 | **P2** | M |
| 15 | Structured logger (`pino` or minimal JSON) with correlation_id | Observability | 5.0 | **P2** | M |

### 5.1 Expected score after the plan

| Domain | Before | After P0 | After P0+P1 | After all |
|---|---|---|---|---|
| Application security | 7.5 | 7.5 | 8.5 | 8.5 |
| Supply-chain security | 5.5 | 7.0 | 8.5 | 8.5 |
| GitHub Actions security | 6.0 | 8.0 | 8.0 | 8.5 |
| Tests & coverage | 5.0 | 5.0 | 7.5 | 7.5 |
| E2E / acceptance | 2.0 | 7.0 | 7.5 | 8.0 |
| CI/CD gates | 8.0 | 8.0 | 9.0 | 9.0 |
| Reliability | 8.0 | 8.0 | 8.0 | 8.5 |
| Observability | 5.0 | 5.0 | 5.5 | 7.0 |
| Consumer documentation | 8.0 | 8.5 | 9.0 | 9.0 |
| Code quality | 8.0 | 8.0 | 8.5 | 8.5 |
| Traceability | 2.0 | 2.0 | 7.5 | 7.5 |
| Operations | 3.0 | 7.0 | 7.5 | 8.0 |
| Release / distribution | 2.0 | 8.5 | 9.0 | 9.0 |
| Cost governance | 3.0 | 7.5 | 7.5 | 8.0 |
| **Overall** | **5.6** | **7.4** | **8.2** | **8.4** |

P0+P1 is enough to clear the 8/10 bar; P2 lifts the project toward 8.5+.

---

## 6. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §5 is mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit (or a delta version) before each `vN` release.
- **The 8/10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
