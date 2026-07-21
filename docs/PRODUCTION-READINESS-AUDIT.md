# Production-Readiness Audit — Ferry

**Date:** 2026-07-21
**Scope:** end-to-end, read-only audit of the Ferry codebase, CI, docs and operations against production-readiness criteria. **Subject of this revision:** the `v1.2.0` release tip — `package.json .version = 1.2.0`, HEAD = `39a42f9` (`release: v1.2.0`), working tree clean. This is the first audit of the post-`1.0.0` line; it re-checks the `v0.19.0` findings and verifies that the `1.x` releases (column-triggered Merger, packaging fixes, bundled agent-behavior defaults) did not regress any invariant.
**Verdict:** **8.9 / 10 — Production-ready.** No P0 blockers. All CI gates green, tag-pin consistency perfect at `@v1.2.0`, supply chain SHA-pinned across every consumer-facing artifact. Test coverage is now **measured** (87.3% statements) rather than asserted. Remaining items are the same P1 hardening carried over from `v0.19.0`.
**Target:** **8–9 / 10** — at the top of the band.

---

## 1. Scope and method

Read-only, local audit. No GitHub / Jira / LLM API traffic.

- **Code & tests:** `src/`, `npm test` (**2433 tests / 165 files, all passing in 16.6s**), `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:fr-drift`, `npm run check:bundle`, `npm run audit:ci`.
- **CI/CD & security:** `.github/workflows/`, `.github/actions/`, `.gitleaks.toml`, `codeql.yml`, `dependabot.yml`, `release.yml`, action pin inspection, `git grep` isolation checks.
- **Release artifacts:** `git tag`, `git ls-remote origin` (floating `v1`), `package.json`, `CHANGELOG.md`.
- **Docs:** `README`, `docs/{INSTALL,CONFIGURATION,RELEASING,RUNBOOK,COST,MCP,PRIVACY,OVERVIEW,REQUIREMENTS}.md`, `docs/adr/`, `CONTRIBUTING.md`.
- **Consumer surface:** `src/cli/{init,doctor,update,uninstall,...}`, `examples/consumer-setup/workflows/` (7 stubs + router).

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes.** Working tree clean at a tagged release; every CI gate (typecheck, lint, format, 2433 tests, `check:fr-drift`, `check:bundle`, `audit:ci`) passes locally; agent-isolation and "Ferry never merges" invariants hold in code; supply chain is SHA-pinned on every consumer-facing ref. No known crash-category defect at HEAD.

2. **Can a consumer install and reach the full Jira → PR → merge cycle?** **Yes.** `ferry-init` scaffolds the router model, `ferry-doctor` validates the config surface (including env-var bounds and transition-id resolution), and all **7 consumer stubs** are present (`refine, dev, review, iterate, merge, reconcile, cost-daily`) plus `ferry-router.yml`. All **four auto-transitions** are implemented and tested: FR18 (Dev → In Review, `developer/dev-action.ts:163`), FR24 (Reviewer → Changes Requested, `reviewer/review-action.ts:97`), FR28 (Iterator → In Review, `iterator/iterate-action.ts:139`), FR32 (Merger merges on `ferry-merge` dispatch or merge-column move, optional → Done, `merger/merge-action.ts`). Every consumer-facing ref pins to the same tag as `package.json .version`.

3. **Security posture?** **Strong.** Strict AJV (`strict: true`) envelope validation with a char cap on `instructions`; argv-array shell execution with per-command timeouts; read-file / bash-output size caps (64 KB, config-tunable) that bound prompt-injection payloads; idempotent fingerprinted external writes; `@octokit/rest` + Jira client imports forbidden under `src/agents/**` (lint-enforced, `restricted-imports.test.ts` — the only `@octokit/rest` hit is the lint fixture, and agent-side tracker imports are types + the pure `transition-match` resolver); the "Ferry never merges" ban is code-enforced for four agents and gated to the Merger alone (ADR-0005 rev. 2). Supply chain: every consumer/CI/release/composite action SHA-pinned with a version comment; gitleaks (SHA256-verified binary), CodeQL with a fail-on-high/critical gate, Dependabot, `audit:ci` clean, npm publish with provenance. **Accepted weakening:** on the `claude-code` execution path several invariants are prompt-enforced rather than code-enforced (documented in `docs/CONFIGURATION.md`).

4. **Is the score close to 8–9/10?** **8.9 / 10** — top of the target band, unchanged from `v0.19.0`. The three items that would push toward 9.2+: (i) `harden-runner` egress allowlist on the write-path workflows; (ii) SHA-pin the two repo-internal Claude helper workflows (`claude.yml`, `claude-code-review.yml`, still `@v1`/`@v6`); (iii) enforce a CI coverage floor now that coverage is quantified (87.3% statements / 80.8% branches).

---

## 2. Overall score — **8.9 / 10**

Quality gates at audit time (all green):

- `npm run typecheck` — **clean** (`tsc --noEmit`, exit 0)
- `npm run lint` — **clean** (`eslint src`, exit 0)
- `npm run format:check` — **clean** ("All matched files use Prettier code style!")
- `npm test` — **165 files / 2433 tests / all passing in 16.6s**
- `npm run test:coverage` — **87.27% statements** (5574/6387), **80.79% branches** (3412/4223), **86.6% functions** (821/948), **87.91% lines** (5130/5835)
- `npx vitest run` on the structural guards (`install-guide`, `templates`, `doctor` cc/codex paths, `codex config-toml`) — **5 files / 215 tests passing**
- `npm run check:fr-drift` — **clean** (every `FR\d+` tag has a `docs/REQUIREMENTS.md` entry)
- `npm run check:bundle` — **clean** (rebuild produced no `git status` delta — committed `.ferry/` matches `src/`)
- `npm run audit:ci` — **clean** (no blocking high/critical advisories; 1 moderate, non-blocking)
- TODO/FIXME/XXX/HACK under `src/` — **3**

Release artifacts:

- Tags: `v1.2.0` (latest) with a continuous semver history back to `v0.4.0`; floating `v1`.
- **Floating `v1` is current on origin:** `git ls-remote origin` → `refs/tags/v1 → 39a42f9` == the `v1.2.0` release commit. `scripts/retag-major.sh` runs in `release.yml`. (A local clone shows a stale `v1` pointing at `v1.0.1` — git does not force-update existing local tags on fetch. **This is a local artifact, not a defect**; verify against `git ls-remote`, never `git rev-parse`.)

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

Domain 3 stays at 9.0 rather than rising: coverage is now measured and healthy, but **branch coverage is 80.8%** and no CI floor enforces it, so the measurement validates the prior score rather than raising it. Domains 5 and 8 take **no hardcoded-values penalty** (0 P0, 1 P1 — below the −1 threshold of 1–3 P0 / 6–15 P1).

## 4. Strengths

- **Boundaries hold in code, not just convention.** Agents import only the IO abstraction (`lib/io/tracker/*` types + the pure `transition-match` resolver); the sole `@octokit/rest` reference under `src/agents/**` is the lint-rule fixture. Enforced by `restricted-imports.test.ts`.
- **Tunable-without-a-fork runtime.** `src/lib/config.ts` exposes a `limits` block of **~25 validated knobs** (`max_iterations`, `max_agent_iterations`, `max_tokens_per_run`, `max_cost_eur_per_run`, `bash_timeout_ms`, `grep_timeout_ms`, `jira_retry_*`, `envelope_instructions_chars`, `refiner_subtask_cap`, `reviewer_max_*`, `reconciler_stale_window_minutes`, …), each bounds-checked by `validatePosInt`/`validatePosNumber` and probed by `ferry-doctor`. Call sites read config, not constants — e.g. `iterate-action.ts:164` passes `effectiveCfg.limits.max_iterations` into `checkIterationCap`, whose `cap = 3` is only a documented fallback.
- **Supply chain is disciplined.** Every consumer-facing composite, the CI/release/router workflows and all 7 consumer stubs SHA-pin their third-party actions with a `# vX.Y.Z` comment (`claude-code-action@1dc994ee… # v1.0.127`, `checkout@de0fac2e…`, `setup-node@48b55a01…`, `upload-artifact@043fb46d…`).
- **Test breadth and depth.** 2433 tests / 165 files with all IO mocked, now backed by a measured 87.3% statement coverage; structural guards assert release-tag consistency across stubs, docs and generated templates.
- **Release automation is real.** Provenance publish, CHANGELOG-driven GitHub Release, and automated floating-major retag are all wired into `release.yml` and verified current on origin.

## 5. Gaps and risks

- **[P1] No `harden-runner` egress allowlist** on the write-path workflows (dev/iterate/merge). Carry-over from `v0.19.0`, confirmed still absent (`grep -rn harden-runner .github/ examples/` → no hits). The agents run arbitrary tool calls; an egress allowlist would bound exfiltration risk.
- **[P1] Repo-internal Claude helper workflows still float.** `claude.yml:29,35` and `claude-code-review.yml:25,31` use `actions/checkout@v6` and `anthropics/claude-code-action@v1` rather than SHAs. Not consumer-facing, but they run with repo/PR permissions.
- **[P1] Coverage is measured but not gated.** `test:coverage` reports 87.3% statements / **80.8% branches**; `ferry-ci.yml` does not run it or enforce a floor, so coverage can silently regress.
- **[P2] `codeql-action@v4` floats** — acceptable (GitHub recommends floating the CodeQL major), noted for completeness.
- **[P2] `claude-code` path invariants are prompt-enforced.** Documented and deliberate (`docs/CONFIGURATION.md`), but weaker than the code-enforced script path; consumers on that path should understand the tradeoff.
- **[Info] One moderate npm advisory** surfaced during `check:bundle`; `audit:ci` correctly treats it as non-blocking (gate is high/critical).

### Hardcoded values (P0/P1)

Scan of `src/**/*.ts` excluding tests and fixtures. Result: **0 P0, 1 P1** — below the penalty threshold, so Domains 5 and 8 are unpenalized.

**Default Parameters**

- **P1** `src/cli/init/templates.ts:1210` — `timeout-minutes: 120` — the agent-job wall-clock cap is baked into the generated router workflow. Carried over from `v0.19.0` (was line 1209). Mitigated: it lands in a consumer-owned file editable post-`ferry-init`, and the runner itself is tunable via `vars.FERRY_RUNNER`. Consider surfacing it as a `ferry.config.yaml` knob or wizard prompt for parity with the other ~25 limits.

Everything else in the scan resolved to a config knob, an env override with a literal default (`FERRY_SPEND_CAP_EUR ?? '200'`, `FERRY_GREP_TIMEOUT_MS ?? 30_000`, `FERRY_HTTP_TIMEOUT_MS ?? 15_000`, `FERRY_REFINER_MAX_ITERATIONS ?? 5`), an API constant (HTTP status codes, `per_page: 100`, `X-GitHub-Api-Version`), or a JSON-schema `maxLength` (which is contract, not tuning).

**P2 (accepted, listed for the record — not carried into the action list):** `agents/developer/tools.ts:23` `MAX_SEARCH_MATCHES = 200` and `agents/refiner/refine.ts:139` `SAMPLE_MAX = 512` are the two genuinely non-tunable constants; both are prompt-shaping truncations with no cost or correctness impact. `agents/refiner/batch.ts:25` `slice(0,12)` (fingerprint hash prefix — must stay constant for idempotency); `agents/developer/wip-finalizer.ts:42` `slice(0,200)` (log detail).

### Release-tag consistency

| Location                                                                             | Pin       | Status                 |
| ------------------------------------------------------------------------------------ | --------- | ---------------------- |
| `package.json` `.version`                                                            | `1.2.0`   | canonical              |
| `examples/…/ferry-{refine,dev,review,iterate,merge}.yml` `uses:`                     | `@v1.2.0` | match                  |
| `examples/…/ferry-router.yml` `uses:`                                                | `@v1.2.0` | match                  |
| `examples/…/ferry-*.yml` (`npx -p @big-emotion/ferry@v…`, incl. `--mcp-config` JSON) | `@v1.2.0` | match                  |
| `examples/…/ferry-{reconcile,cost-daily}.yml` `FERRY_REF`                            | `v1.2.0`  | match                  |
| `docs/{INSTALL,RELEASING,CONFIGURATION}.md`                                          | `@v1.2.0` | match                  |
| structural tests (install-guide, templates, doctor ×2, codex)                        | `@v1.2.0` | match (215 tests pass) |
| `git tag --list`                                                                     | `v1.2.0`  | exists                 |
| floating `v1` == `v1.2.0` (**on origin**)                                            | `39a42f9` | match                  |

No `MISSING`, no `drift`, no `@main`. The only historical-version reference is `docs/INSTALL.md:154`, a deliberate availability note ("the router model ships in Ferry v0.18.0 — pin `@v0.18.0` or later"), which is correct as written.

## 6. Consumer install flow — end-to-end verdict

**Viable.** `ferry-init` → `ferry-doctor` → router + 7 stubs, all pinned to `@v1.2.0`; the four FR auto-transitions are implemented and covered; `ferry-update` reads `MIGRATIONS.md`; `ferry-uninstall` removes the footprint. `INSTALL.md` reflects the router model and states the `@v0.18.0+` minimum for `ferry-run-claude-agent`. No step in the guide is untested or unexampled. The `1.0.x` packaging fixes (missing bins in `build-cli.mjs`, `yaml` promoted to a runtime dependency) closed the two install-time failure modes seen post-`1.0.0`; `src/packaging.test.ts` now guards them.

## 7. Security posture

Strong across application, supply-chain and secrets handling (see Q3 in §1). Primary residual risk is **prompt-injection / tool-call blast radius** on the `claude-code` path, partially bounded by size caps and per-command timeouts but not by an egress allowlist. The Merger widening in `v1.1.0` (a move into the merge column is now an explicit human merge order, ADR-0005 rev. 2) expands the merge trigger surface from one dispatch to two paths — it is human-gated by design, but it means **column permissions in Jira are now a security boundary**, and that should be called out in the runbook. Recommended next hardening: `harden-runner` on write-path jobs.

## 8. Prioritized action list

1. **[P1]** Add `harden-runner` egress allowlist to dev/iterate/merge workflows.
2. **[P1]** SHA-pin `claude.yml` / `claude-code-review.yml` actions (`checkout@v6`, `claude-code-action@v1`).
3. **[P1]** Run `test:coverage` in `ferry-ci.yml` and enforce a floor (suggest 85% statements / 78% branches — just under current, so it ratchets without churn).
4. **[P1]** Externalize `timeout-minutes` in the generated workflow (`templates.ts:1210`).
5. **[P2]** Document in `RUNBOOK.md` that Jira merge-column permissions are a security boundary under ADR-0005 rev. 2.
6. **[P2]** Consider config knobs for `MAX_SEARCH_MATCHES` / `SAMPLE_MAX` if agents start hitting them.

## 9. Conclusion

Ferry at `v1.2.0` scores **8.9 / 10** — production-ready and at the top of the target band, holding the `v0.19.0` score across six releases. No P0 blockers. Coverage is now quantified (87.3% statements), tag consistency is perfect, and the post-`1.0.0` packaging regressions are fixed and guarded. The open items are the same P1 hardening as the previous audit — none of them block production use.
