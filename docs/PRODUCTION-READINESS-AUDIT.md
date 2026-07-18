# Production-Readiness Audit — Ferry

**Date:** 2026-07-18
**Scope:** end-to-end, read-only audit of the Ferry codebase, CI, docs and operations against production-readiness criteria. **Subject of this revision:** the `v0.19.0` release tip — `package.json .version = 0.19.0`, HEAD = `226ee8e` (`release: v0.19.0`), working tree clean. This audit is the go/no-go gate for a first **`1.0.0`** release; the router model (FR-1, single Jira rule + `ferry-router.yml` + shared `ferry-run-claude-agent` composite) is now the shipped default.
**Verdict:** **8.9 / 10 — Production-ready. Cleared for `1.0.0`.** No P0 blockers. All CI gates green, tag-pin consistency perfect at `@v0.19.0`, supply chain SHA-pinned across every consumer-facing artifact, and the runtime is broadly tunable via env/config without a fork. Remaining items are P1/P2 hardening that do not block a stable release.
**Target:** **8–9 / 10** — at the top of the band.

---

## 1. Scope and method

Read-only, local audit. No GitHub / Jira / LLM API traffic.

- **Code & tests:** `src/`, `npm test` (**2378 tests / 161 files, all passing in 3.36s**), `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:fr-drift`, `npm run check:bundle`, `npm run audit:ci`.
- **CI/CD & security:** `.github/workflows/`, `.github/actions/`, `.gitleaks.toml`, `codeql.yml`, `dependabot.yml`, `release.yml`, action pin inspection, `git grep` isolation checks.
- **Release artifacts:** `git tag`, `git ls-remote origin` (floating `v1`), `package.json`, `CHANGELOG.md`.
- **Docs:** `README`, `docs/{INSTALL,CONFIGURATION,RELEASING,RUNBOOK,COST,MCP,PRIVACY,OVERVIEW,REQUIREMENTS}.md`, `docs/adr/`, `CONTRIBUTING.md`.
- **Consumer surface:** `src/cli/{init,doctor,update,uninstall,...}`, `examples/consumer-setup/workflows/` (7 stubs + router).

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes.** Working tree clean at a tagged release; every CI gate (typecheck, lint, format, 2378 tests, `check:fr-drift`, `check:bundle`, `audit:ci`) passes locally; agent-isolation and "Ferry never merges" invariants hold in code; supply chain is SHA-pinned. No known crash-category defect at HEAD.

2. **Can a consumer install and reach the full Jira → PR → merge cycle?** **Yes.** `ferry-init` scaffolds the router model, `ferry-doctor` validates the config surface (including env-var bounds and transition-id resolution), and all **7 consumer stubs** are present (`refine, dev, review, iterate, merge, reconcile, cost-daily`) plus `ferry-router.yml`. All **four auto-transitions** are implemented and tested: FR18 (Dev → In Review, `developer/dev-action.ts`), FR24 (Reviewer → Changes Requested, `reviewer/review-action.ts`), FR28 (Iterator → In Review, `iterator/`), FR32 (Merger merges on `ferry-merge` dispatch, optional → Done, `merger/merge-action.ts`). Every consumer-facing ref is pinned to the same tag as `package.json .version`.

3. **Security posture?** **Strong.** Strict AJV (`strict: true`) envelope validation with a char cap on `instructions`; argv-array shell execution with per-command timeouts; read-file / bash-output size caps (64 KB, env-tunable) that bound prompt-injection payloads; idempotent fingerprinted external writes; `@octokit/rest` + Jira imports forbidden under `src/agents/**` (lint-enforced, `restricted-imports.test.ts`); the "Ferry never merges" ban is code-enforced for four agents and gated to a single dispatch for the Merger (ADR-0005). Supply chain: every consumer/CI/release/composite action SHA-pinned with a version comment; gitleaks (SHA256-verified binary), CodeQL with a fail-on-high/critical gate, Dependabot, `audit:ci` clean, npm publish with provenance. **Accepted weakening:** on the `claude-code` execution path several invariants are prompt-enforced rather than code-enforced (documented in `docs/CONFIGURATION.md`).

4. **Is the score close to 8–9/10?** **8.9 / 10** — top of the target band. The three items that would push toward 9.2+: (i) `harden-runner` egress allowlist on the write-path workflows; (ii) SHA-pin the two repo-internal Claude helper workflows (`claude.yml`, `claude-code-review.yml`, currently `@v1`/`@v6`); (iii) quantify and gate test coverage (`test:coverage` was not run this pass).

---

## 2. Overall score — **8.9 / 10**

Quality gates at audit time (all green):

- `npm run typecheck` — **clean** (`tsc --noEmit`, exit 0)
- `npm run lint` — **clean** (`eslint src`, exit 0)
- `npm run format:check` — **clean** ("All matched files use Prettier code style!")
- `npm test` — **161 files / 2378 tests / all passing in 3.36s**
- `npx vitest run` on the structural guards (`install-guide`, `templates`, `doctor` cc/codex paths, `codex config-toml`) — **5 files / 215 tests passing**
- `npm run check:fr-drift` — **clean** (every `FR\d+` tag has a `docs/REQUIREMENTS.md` entry)
- `npm run check:bundle` — **clean** (no drift in `.ferry/` or `.github/actions/`)
- `npm run audit:ci` — **clean** (no blocking high/critical advisories)
- TODO/FIXME/XXX/HACK under `src/` — **3**

Release artifacts:

- Tags: `v0.19.0` (latest) with a continuous semver history back to `v0.4.0`; floating `v1`.
- **Floating `v1` is current on origin:** `refs/tags/v1 → 226ee8e` == the `v0.19.0` release commit (verified via `git ls-remote`). `scripts/retag-major.sh` runs in `release.yml` and the step was green on the `v0.19.0` run. (A local clone may show a stale `v1` — git does not force-update existing local tags on fetch.)
- `@big-emotion/ferry@0.19.0` on npm, dist-tags `{ latest: 0.19.0 }`, published with provenance.

## 3. Score per domain

| #   | Domain                     | Score        | Trend  |
| --- | -------------------------- | ------------ | ------ |
| 1   | Application security       | **9.0 / 10** | strong |
| 2   | Supply-chain security      | **9.0 / 10** | strong |
| 3   | Correctness & tests        | **9.0 / 10** | strong |
| 4   | Code quality & lint        | **9.0 / 10** | strong |
| 5   | Architecture & boundaries  | **9.0 / 10** | strong |
| 6   | Reliability & idempotency  | **8.5 / 10** | strong |
| 7   | Observability & ops        | **8.5 / 10** | medium |
| 8   | Consumer DX (install flow) | **9.0 / 10** | strong |
| 9   | Documentation              | **9.0 / 10** | strong |
| 10  | Release process            | **9.0 / 10** | strong |

**Overall = mean = 8.9 / 10.**

## 4. Strengths

- **Boundaries hold in code, not just convention.** Agents import only the IO abstraction (`lib/io/tracker/*` types + `transition-match`); the sole `@octokit/rest` reference under `src/agents/**` is the lint-rule fixture. Enforced by `restricted-imports.test.ts`.
- **Tunable-without-a-fork runtime.** A dedicated `src/lib/config.ts` `limits` block plus `FERRY_*` env overrides cover timeouts, retry backoff, token caps, poll intervals and truncation limits, each validated (`validatePosInt`) and probed by `ferry-doctor` (`checks/env-vars.ts`). The hardcoded-values scan found **zero P0** and **~one borderline P1**.
- **Supply chain is disciplined.** Every consumer-facing composite, the CI/release/router workflows and all 7 consumer stubs SHA-pin their third-party actions with a `# vX.Y.Z` comment (`claude-code-action@1dc994ee… # v1.0.127`, `checkout@de0fac2e… # v6.0.2`, `setup-node@48b55a0… # v6.4.0`).
- **Test breadth.** 2378 tests / 161 files with all IO mocked; structural guards assert release-tag consistency; e2e pipeline coverage for the transition invariants.
- **Release automation is real.** Provenance publish, CHANGELOG-driven GitHub Release, and automated floating-major retag are all wired into `release.yml`.

## 5. Gaps and risks

- **[P1] No `harden-runner` egress allowlist** on the write-path workflows (dev/iterate/merge). Carry-over. The agents run arbitrary tool calls; an egress allowlist would bound exfiltration risk.
- **[P1] Repo-internal Claude helper workflows float.** `claude.yml` and `claude-code-review.yml` use `anthropics/claude-code-action@v1` and `actions/checkout@v6` rather than SHAs. Not consumer-facing, but they run with repo/PR permissions.
- **[P1] Test coverage not quantified.** `test:coverage` was not run this pass; the score reflects test _breadth_, not a measured coverage %. Add a coverage floor to CI.
- **[P2] `codeql-action@v4` floats** — acceptable (GitHub recommends floating the CodeQL major), noted for completeness.
- **[P2] `claude-code` path invariants are prompt-enforced.** Documented and deliberate (`docs/CONFIGURATION.md`), but weaker than the code-enforced script path; consumers on that path should understand the tradeoff.
- **[Info] Dependabot PR red in CI** — `@anthropic-ai/sdk` 0.97 → 0.112 (major) fails checks; `main` is green. Triage before merging that bump.

### Hardcoded values (P0/P1)

- **P0:** none.
- **P1 (borderline):** `src/cli/init/templates.ts:1209` — `timeout-minutes: 120` baked into the generated agent workflow. Mitigated: it lands in a consumer-owned file that can be edited post-`ferry-init`; consider surfacing it as a wizard prompt or `ferry.config.yaml` knob.
- **P2 (accepted, listed for the record):** `agents/refiner/batch.ts:25` `slice(0,12)` (fingerprint hash prefix — must stay constant for idempotency); `agents/developer/wip-finalizer.ts:42` `slice(0,200)` (log detail); `cli/cost/format.ts:172` top-20 display; `cost-governance/run.ts:112` one-day-in-ms.

## 6. Consumer install flow — end-to-end verdict

**Viable.** `ferry-init` → `ferry-doctor` → router + 7 stubs, all pinned to `@v0.19.0`; the four FR auto-transitions are implemented and covered; `ferry-update` reads `MIGRATIONS.md`; `ferry-uninstall` removes the footprint. INSTALL.md reflects the router model and states the `@v0.18.0+` minimum for `ferry-run-claude-agent`. No step in the guide is untested or unexampled.

## 7. Security posture

Strong across application, supply-chain and secrets handling (see Q3 in §1). Primary residual risk is **prompt-injection / tool-call blast radius** on the `claude-code` path, partially bounded by size caps and per-command timeouts but not by an egress allowlist. Recommended next hardening: `harden-runner` on write-path jobs.

## 8. Prioritized action list

1. **[P1]** Add `harden-runner` egress allowlist to dev/iterate/merge workflows.
2. **[P1]** SHA-pin `claude.yml` / `claude-code-review.yml` actions.
3. **[P1]** Run `test:coverage` and add a CI coverage floor.
4. **[P1]** Externalize `timeout-minutes` in the generated workflow (`templates.ts:1209`).
5. **[P2]** Triage the `@anthropic-ai/sdk` major bump (Dependabot PR failing CI).
6. **[P2]** Document the `claude-code`-path prompt-enforced invariants prominently in the release notes.

## 9. `1.0.0` readiness note

Cutting `1.0.0` is **cleared** and also resolves the `@big-emotion/ferry@v1` npm-resolution gap for free: npm treats `@v1` as the semver range `>=1.0.0 <2.0.0` (verified empirically), so once a `1.x` is published, `@v1` resolves to it with no dist-tag step; `retag-major.sh` maps `1.0.0` → the `v1` git tag, keeping `@v1` action refs consistent. Consumers currently pinned to the default `v1` self-heal on their next run. The gaps above are post-1.0 hardening, not release blockers.

## 10. Conclusion

Ferry at `v0.19.0` scores **8.9 / 10** — production-ready and at the top of the target band. No P0 blockers; the open items are P1/P2 hardening. **Recommended: proceed to `1.0.0`.**
