# Production-Readiness Audit — Ferry

**Date:** 2026-05-21
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria. **Subject of this revision:** the `v0.13.0` release tip — `package.json .version = 0.13.0`, HEAD = `9f8c564` (`release: v0.13.0`), working tree clean, all of the v0.9 → v0.13 release train landed. Eight releases shipped since the v0.8.2 audit (`v0.9.0`, `v0.10.0`, `v0.10.1`, `v0.10.2`, `v0.10.3`, `v0.11.0`, `v0.12.0`, `v0.13.0`), closing the cc-path execution rollout (ADR-0006), the GitLab forge adapter (#210/#214), and the per-ticket label-override system (#236–#243).
**Verdict:** **8.4 / 10 — Production-ready.** Net **+0.2** vs. the v0.8.2 audit. The cc-path rollout (Refiner end-to-end, dev/review/iterate scaffold) shipped in `v0.13.0` along with the secret-scan-gate + tool-policy + per-job permissions hardening (#303 / #349). GitLab forge support shipped behind an "experimental" flag with full wizard / doctor probes / uninstall coverage. Test surface grew from 1200 → **2232** tests across **152** files (+1032 / +52 since v0.8.2 audit). Tag-pin consistency is perfect at `@v0.13.0` across every consumer-facing artifact.
**Target:** **8–9 / 10**, comfortably inside the band. Top three actions to push toward 8.7+: pin the `.github/workflows/claude.yml` and `claude-code-review.yml` actions by SHA (currently `@v1`/`@v6`); add `harden-runner` egress allowlist on dev/iterate workflows; promote the GitLab adapter out of "experimental" after a real consumer exercises the full Jira→MR cycle.

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `npx vitest run` (**2232 tests passing across 152 files in 3.25s**, +1032 tests / +52 files since v0.8.2 audit), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`, `audit-ci.json`. Recent run history via `gh run list` (last 5: all green).
- **Release artifacts:** `git tag --sort=-creatordate | head -10`, local `package.json`, `git log v0.8.2..HEAD` (211 commits including 8 release commits).
- **Docs:** `README.md` (now 79 lines), `docs/CONFIGURATION.md` (90 KB), `docs/INSTALL.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/RUNBOOK.md`, `docs/COST.md`, `docs/MCP.md`, `docs/PRIVACY.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`.
- **CLI:** `src/cli/{init,doctor,uninstall,update,cost,agent}/` plus the GitLab branch (`src/cli/init/gitlab/`, `src/cli/doctor/gitlab/`, `src/cli/update/gitlab/`).
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts` (71 tests), `src/e2e/pipeline.test.ts`.
- **Execution paths (ADR-0006):** script path (in-process Node loop) and claude-code path (`anthropics/claude-code-action@v1` job) — both wired through `src/lib/dispatch/route-action.ts` (`ferry-route` composite action).

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Yes.** All previously closed P0 blockers continue to hold (D9 Refiner JSON parser, D6 `ferry-update` MIGRATIONS.md parser, D7 `ferry-doctor` `FERRY_AUDIT_ISSUE`, audit-issue rotation, bundle-runtime smoke gate, composite-action input validator). The two consumer-impacting incidents from the v0.8 cycle (`timeout-minutes` DOA; silently-ignored `ferry_model:` input) remain closed — neither has recurred across the eight subsequent releases. The cc-path rollout (ADR-0006) ships in `v0.13.0` with `anthropicOnly` as a **hard gate** in `resolveExecutionPath` (#329 / #341), token-exclusivity checks (`CLAUDE_CODE_OAUTH_TOKEN` ↔ `ANTHROPIC_API_KEY`) in `ferry-doctor` (#342), and `requires-secrets` migration gating in `ferry-update` (#316 / #340). No agent has a known crash-category bug at HEAD.
2. **Can a first-time consumer install and reach the full Jira → PR-approved cycle?** **Yes** — for consumers pinning `@v0.13.0` (the published tag, available on npm and as a moving `@v1` floating major). Walking the install path: (i) `npx -p @big-emotion/ferry ferry-init` runs the wizard, sets secrets via `gh secret set`, generates `ferry.config.yaml`, writes 4 expanded multi-job stubs pinned to `@v0.13.0` with correct per-agent model input names, and presents an install-time execution-path choice (script vs. claude-code per ADR-0006 §6). (ii) `ferry-doctor` covers 22 distinct checks including the cc-path token-exclusivity check, GitLab live probes, the GitHub-App JWT check, claude-code workflow shape, and the `FERRY_AUDIT_ISSUE` repo variable. (iii) `ferry-update` parses `MIGRATIONS.md` at runtime and now enforces a `requires-secrets:` credential gate so the v0.12.x → v0.13.0 upgrade is blocked until `CLAUDE_CODE_OAUTH_TOKEN` is rotated (when the consumer has opted into the cc-path). (iv) The expanded three-job workflow architecture (gate-envelope → route → run-agent → emit-audit) avoids `secrets: inherit` cross-org propagation; the cc-path adds a `run-agent-claude-code` branch that the `route` job selects via the `path` output. (v) The three FR auto-transitions (FR18/FR24/FR28) are exercised by `src/e2e/pipeline.test.ts`. (vi) `src/install-guide.test.ts` (71 tests) asserts no `@main` self-references and correct `@v0.13.0` pins across all four agent stubs plus the reconcile / cost-daily stubs. **GitLab branch:** `ferry-init --forge gitlab` runs a full wizard (project detection, six template install, scope checklist); `ferry-doctor --forge gitlab` runs five live probes; `ferry-update --forge gitlab` rewrites the `FERRY_VERSION` pin; `ferry-uninstall --forge gitlab` cleans up. Marked **experimental** until a real consumer exercises the full Jira→MR cycle.
3. **Security posture?** **Strong.** Strict AJV schema validation; all shell calls use argv-as-array; `execFileSync` everywhere. CodeQL + `npm audit` (CI gate with documented allowlist for transitive advisories with no upstream fix) + gitleaks wired in CI. **CodeQL now has a fail-on-high/critical gate step** (`codeql.yml:48–60`) — SARIF level `error` blocks the PR; medium/low findings are visible but non-blocking. Explicit `permissions:` blocks on every job. Third-party actions pinned by SHA in `ferry-ci.yml`, `release.yml`, and every Ferry composite `action.yml`. `@octokit/rest` and Jira modules forbidden under `src/agents/**` (asserted by `restricted-imports.test.ts`). "Ferry never merges" invariant asserted by `src/e2e/pipeline.test.ts`. Read_file size cap (256 KB hard, 64 KB head+tail when truncated) prevents prompt-injection via oversized file payloads. cc-path hardening primitives (#303 / #349): `secret-scan-gate`, `tool-policy` enforcement, and per-job `permissions` are wired into the Claude Code branch so the action cannot approve or merge on the consumer's behalf even when its default permissions would allow it. **Remaining gaps:** `.github/workflows/claude.yml`, `claude-code-review.yml` use `@v1`/`@v6` (mutable tags) rather than SHAs for `anthropics/claude-code-action` and `actions/checkout`; `codeql.yml` uses `@v4` for `github/codeql-action` (GitHub-published, lower risk but inconsistent with project standard); no `harden-runner` egress allowlist on write-path workflows (dev/iterate); no SLSA provenance on the GitHub Release artifact.
4. **Is the score close to 8–9/10?** **Score is 8.4** — comfortably inside the target band, +0.2 vs. the v0.8.2 audit. The cadence drag has stayed closed (eight cuts in the audit window — `v0.9.0` through `v0.13.0`, all green). ADR-0006 (claude-code-action execution path) and the GitLab forge adapter (#210) are the two substantive cross-cutting features that landed in this window. Top three actions to reach 8.7: (i) **SHA-pin `claude.yml` / `claude-code-review.yml` actions** (P1, XS effort); (ii) **`harden-runner` egress allowlist** on dev/iterate workflows (P1, S effort, carry-over); (iii) **e2e idempotency replay** assertion (P1, M, carry-over).

---

## 2. Overall score — **8.4 / 10**

Movement since the v0.8.2 audit (8.2 → 8.4, net +0.2 across 15 domains). Six positive moves (Tests +0.5 — +1032 tests; CI/CD +0.5 — CodeQL gate step + gitlab-adapter job; Consumer docs +0.5 — INSTALL.md, COST.md, MCP.md, RUNBOOK.md; Release +0.5 — eight cuts in 15 days, cadence sustained; Cost governance +1.0 — three new CLI tools; Doc-code coherence +0.5 — perfect tag alignment). One regression (GitHub Actions security −0.5 — repo-development workflows use `@v1`/`@v6` instead of SHA pins).

Quality gates at audit time:

- `npm run typecheck` — **clean** (`@big-emotion/ferry@0.13.0`)
- `npm run lint` — **clean** (eslint on `src/` exits 0 with no findings)
- `npm run format:check` — **clean** ("All matched files use Prettier code style!")
- `npx vitest run` — **152 files / 2232 tests / all passing in 3.25s**
- `npm audit --omit=dev` (CI gate) — **0 unblocked high/critical** (4 raw advisories — 2 high in `fast-uri` and `protobufjs`, fully covered by `audit-ci.json` allowlist with documented rationale; 2 moderate in `brace-expansion` and `ws` are dev-only and below the CI's high/critical bar). CI's `audit:ci` job is green.
- `npx vitest run src/install-guide.test.ts` — **71 / 71 passing**, asserting `@v0.13.0` and no `@main` refs across all four agent stubs
- TODO/FIXME/XXX/HACK count under `src/` — **3** (1 fixture-text, 2 acknowledged in `src/cli/cost/format.ts:248,251` waiting on #251)
- Recent CI on `main`: Release ✓, Ferry — CI ✓, CodeQL ✓ (last 5 runs all `success`)

Release artifacts proven:

- Tags on origin (most recent first): `v0.13.0`, `v0.12.0`, `v0.11.0`, `v0.10.3`, `v0.10.2`, `v0.10.1`, `v0.10.0`, `v0.9.0`, `v0.8.2`, `v0.8.1` … (plus `v1` floating major)
- `@big-emotion/ferry@0.13.0` published to npm with provenance
- GitHub Release `v0.13.0` created with notes from `CHANGELOG.md` (2026-05-20)
- **HEAD = `v0.13.0`** (working tree clean) — no release-cadence drag at this revision

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. v0.8.2 | Trend  |
| --- | ---------------------------------- | ------------ | ------------ | ------ |
| 1   | Application security               | **8.5 / 10** | 0            | strong |
| 2   | Supply-chain security              | **8.5 / 10** | 0            | strong |
| 3   | GitHub Actions security            | **7.0 / 10** | −0.5         | medium |
| 4   | Tests & coverage                   | **9.0 / 10** | +0.5         | strong |
| 5   | E2E / acceptance tests             | **8.5 / 10** | 0            | strong |
| 6   | CI/CD gates                        | **9.5 / 10** | +0.5         | strong |
| 7   | Reliability (idempotency, retries) | **9.0 / 10** | 0            | strong |
| 8   | Observability / audit              | **7.5 / 10** | 0            | medium |
| 9   | Consumer documentation             | **9.0 / 10** | +0.5         | strong |
| 10  | Code quality / typing              | **8.5 / 10** | 0            | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0            | strong |
| 12  | Operations / runbooks / rollback   | **8.0 / 10** | 0            | strong |
| 13  | Release / distribution             | **9.0 / 10** | +0.5         | strong |
| 14  | Cost governance (runtime)          | **8.0 / 10** | +1.0         | strong |
| 15  | Doc–code coherence                 | **8.5 / 10** | +0.5         | strong |

Mean = **8.4 / 10** (15 axes; 126 / 15 = 8.4)

> **Domain 3 (GitHub Actions security) −0.5:** `.github/workflows/claude.yml` and `.github/workflows/claude-code-review.yml` reference `actions/checkout@v6` and `anthropics/claude-code-action@v1` — mutable major-version tags rather than SHA pins. `claude.yml` has `contents: write`, `pull-requests: write`, `issues: write`, `id-token: write` — a successful supply-chain compromise on `anthropics/claude-code-action` would have full write access to the Ferry repo. `codeql.yml` similarly uses `github/codeql-action/{init,autobuild,analyze}@v4` (GitHub-published, lower trust risk, but inconsistent with the project's pinning standard). The four Ferry-owned composite actions and the consumer-facing CI / release workflows remain pinned by SHA, so consumer-facing surfaces are not regressed; this is a pin-discipline gap on the Ferry repo's own automation.
>
> **Domain 4 (Tests & coverage) +0.5:** 1200 → 2232 tests, 100 → 152 files. New coverage areas: cc-path execution (`src/lib/dispatch/`, `src/agents/{refiner,developer,reviewer,iterator}/*-action.ts`, `claude-code-path.ts`); GitLab adapter (`src/lib/dispatch/runner/gitlab/`, `src/cli/{init,doctor,update,uninstall}/gitlab/`); cost-governance CLIs (`src/cli/cost/{advice,reconcile,format,stats}.ts`); label-override resolver (`src/lib/labels/`); ADR-0006 resolver (`src/lib/dispatch/resolve-execution-path.ts`).
>
> **Domain 6 (CI/CD gates) +0.5:** two additions in this window. (a) **CodeQL gate step** (`codeql.yml:48–60`) — SARIF level `error` blocks the PR; jq counts high/critical findings and `exit 1`s if any are present. Closes the gap where CodeQL only surfaced findings in the Security tab without blocking merge. (b) **`gitlab-adapter` job** in `ferry-ci.yml` — runs the GitLab adapter unit tests + fixture-replay + runner-factory + CLI forge-flag tests in isolation so GitLab-only regressions surface under a clearly-named gate.
>
> **Domain 9 (Consumer docs) +0.5:** README trimmed to 79 lines (closes #328) with content moved to `docs/`. New consumer-facing docs landed: `docs/INSTALL.md` (8.6 KB), `docs/COST.md` (17.6 KB), `docs/MCP.md` (8.0 KB), `docs/RUNBOOK.md` (22 KB), `docs/PRIVACY.md`. `docs/CONFIGURATION.md` grew to 90 KB and is internally consistent at `@v0.13.0`. ADR-0006 (claude-code-action execution path, 14 KB) documents the script vs cc-path split, the resolver precedence, the `anthropicOnly` hard gate, and the per-role accepted-divergence invariants.
>
> **Domain 13 (Release) +0.5:** eight releases in 15 days — `v0.9.0` (2026-05-05), `v0.10.0–v0.10.3` (2026-05-05), `v0.11.0` (2026-05-19), `v0.12.0` (2026-05-20), `v0.13.0` (2026-05-20). Every release green on the pipeline; CHANGELOG `[Unreleased]` base now points at `v0.13.0`. `package.json .version` matches `git tag` matches every doc reference matches `src/install-guide.test.ts` assertion — perfect tag-pin consistency. Held back from a full +1.0 only because four of the cuts (`v0.10.1`/`v0.10.2`/`v0.10.3`) were rapid hotfix bumps on the same day, suggesting some release-quality polish opportunity on the v0.10 line.
>
> **Domain 14 (Cost governance) +1.0:** three new CLI tools landed in this window — `ferry-cost-report` (CSV / Markdown reporting from `audit-log.jsonl`), `ferry-cost-reconcile` (compares Ferry's emitted `cost_eur` against provider CSV exports with a `--tolerance` flag), `ferry-cost-advice` (heuristics on cache-hit rate, max_iterations hits, Refiner context-blow-up patterns). The `ferry-cost-stats` CLI provides aggregate stats. Combined with the pre-existing daily-check pause loop and soft-budget warnings, cost governance moves from "stub-ships, consumer-wires" to "first-class CLI surface."
>
> **Domain 15 (Doc–code coherence) +0.5:** the systematic drift gate (action 0d, two-cycle carry-over) is still not formalized as a test, but the immediate symptom is closed at this revision — every `@v[0-9.]+` literal in `docs/RELEASING.md`, `docs/CONFIGURATION.md`, `docs/INSTALL.md`, `docs/adr/0002-ferry-bundles-committed.md`, `docs/adr/0006-claude-code-action-execution-path.md`, `examples/consumer-setup/workflows/`, `src/cli/init/templates.ts`, and `src/install-guide.test.ts` agrees with `package.json .version = 0.13.0`. CHANGELOG `[0.5.0]`–`[0.5.3]` link gap (D10) carries over.
>
> **No other score regressions** at this revision.

---

## 4. Domain analysis

### 4.1 Application security — 8.5 (unchanged)

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- All shell calls use `execFileSync` with argv-as-array. The single `spawn` (`src/agents/developer/tools.ts`) also passes args as an array.
- `FerryError` taxonomy with typed codes (`state-invariant`, `spend-cap`, `transient`, `unknown`).
- Mandatory `secret-scan` (gitleaks) before every dev-agent commit; gitleaks runs on **all four** agent dispatch workflows and `ferry-ci.yml`.
- `@typescript-eslint/no-explicit-any: 'error'` plus `no-restricted-imports` for agent code (verified via `src/agents/restricted-imports.test.ts`).
- "Ferry never merges" invariant asserted by `src/e2e/pipeline.test.ts`.
- Read_file size cap (256 KB hard, 64 KB head+tail when truncated) prevents prompt-injection via oversized file payloads. Agent-loop history compaction and pruning bound conversation history so token-cap blow-ups cannot be used as a denial-of-budget vector.
- **cc-path hardening primitives** (#303 / #349): `secret-scan-gate`, `tool-policy` enforcement, and per-job `permissions` are wired into the Claude Code branch so the action cannot approve or merge on the consumer's behalf even when its default permissions would allow it.
- **`anthropicOnly` hard gate** in `resolveExecutionPath` (#329 / #341) — the resolver refuses to route to `claude-code` unless the configured LLM provider is Anthropic, surfacing misconfigurations at install time instead of mid-run.

**Weaknesses**

- LLM-supplied `commit_message` reaches `git commit -m` via argv; safe from injection but no length/charset cap.
- No `eslint-plugin-security` or `eslint-plugin-no-secrets` (defense-in-depth only).
- Prompt-injection surface in agent tool calls is not formally modeled (no allow-list of file paths the dev agent can read/write).

### 4.2 Supply-chain security — 8.5 (unchanged)

Tag-pin consistency table (HEAD = `9f8c564`, `package.json .version = 0.13.0`):

| Location                                                                         | Pin                                                   | Status        |
| -------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------- |
| `package.json` `.version`                                                        | `0.13.0`                                              | canonical     |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.13.0`                                            | match         |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.13.0`                                             | match         |
| `docs/CONFIGURATION.md` (lines 127, 150)                                         | `@v0.13.0`                                            | match         |
| `docs/RELEASING.md` (lines 26, 30, 46, 50, 159)                                  | `@v0.13.0`                                            | match         |
| `docs/INSTALL.md`                                                                | `@v0.13.0`                                            | match         |
| `docs/RUNBOOK.md`                                                                | (no agent-pin references; only `@v1` floating-major)  | n/a           |
| `src/install-guide.test.ts` (line 54)                                            | `@v0.13.0`                                            | match         |
| `src/cli/init/templates.ts` (multiple lines)                                     | `@v0.13.0`                                            | match         |
| `docs/adr/0002-ferry-bundles-committed.md` (lines 16, 34, 35)                    | `@v0.13.0`                                            | match         |
| `docs/adr/0006-claude-code-action-execution-path.md`                             | `@v1` (refers to `claude-code-action`, not Ferry)     | n/a           |
| `git tag --list`                                                                 | includes `v0.13.0`, `v0.12.0`, `v0.11.0`, `v1`        | exist         |
| `npm @big-emotion/ferry`                                                         | `0.13.0`                                              | published     |
| `CHANGELOG.md` link section                                                      | `[Unreleased]` base = `v0.13.0`; v0.5.x links missing | partial drift |

**Action 0d (tag-pin drift gate) status:** the immediate alignment is **perfect** at `@v0.13.0` — eight successive releases without drift. The systematic guard is still not in place, so recurrence requires manual diligence; adding a regex assertion in `src/install-guide.test.ts` (or new `tag-pin-drift.test.ts`) that scans `docs/adr/*.md` and `docs/RELEASING.md` for `@v[0-9.]+` literals and fails if any disagrees with `package.json .version` remains the recommended P1 carry-over.

**Strengths**

- CodeQL SAST wired with the new fail-on-high/critical gate — recent run green.
- `audit:ci` job in CI uses `npm audit --omit=dev` with a documented allowlist in `audit-ci.json` (rationale per advisory ID). Currently allowlists: fast-uri 1117870/1117884 (transitive via ajv, no patched 3.x), protobufjs 1118632/1118639/1118641/1118643/1118645/1118647/1118649/1118924/1118926/1118928/1118930/1118932/1118935/1119378 (transitive via @google/genai, no upstream fix). All allowlist entries have rationales explaining why the advisory does not affect Ferry's actual surface.
- Bundle-drift check in CI (`check-bundle` job) plus the `smoke-bundle` job that boots each compiled `.ferry/<role>-action.js` under Node 20 with stub credentials.
- Third-party actions pinned by SHA with version comments in every Ferry composite action and every CI workflow (verified: `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0`, `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`, `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`). `anthropics/claude-code-action` is pinned by SHA in the generated consumer templates (`src/cli/init/templates.ts`: `@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127`).
- gitleaks tarball pinned by SHA256 in CI.
- Dependabot configured for `github-actions` AND `npm`, weekly, grouped.
- npm publish uses `--provenance --access public`.
- LLM SDKs externalized from `.ferry/` action bundles (#203) — SDK upgrades reach consumers via `npm install` rather than rebuilding bundles on every dep bump.

**Weaknesses**

- No SLSA provenance attestation on the GitHub Release artifact.
- No SBOM, no OSSF Scorecard.
- Action 0d (systematic tag-pin drift gate) still not implemented — recurrence is gated only on manual diligence (held by eight successive cuts so far without drift).
- CHANGELOG link section missing `[0.5.0]`–`[0.5.3]` release links (D10, low).

### 4.3 GitHub Actions security — 7.0 (−0.5)

The −0.5 is driven by the pin discipline gap on the Ferry repo's own automation workflows. Composite actions and consumer-facing workflows are unchanged.

**Findings (pin discipline gap, new in this window):**

| File                                          | Pin                                | Severity |
| --------------------------------------------- | ---------------------------------- | -------- |
| `.github/workflows/claude.yml:29`             | `actions/checkout@v6`              | P1       |
| `.github/workflows/claude.yml:35`             | `anthropics/claude-code-action@v1` | **P0**   |
| `.github/workflows/claude-code-review.yml:25` | `actions/checkout@v6`              | P1       |
| `.github/workflows/claude-code-review.yml:31` | `anthropics/claude-code-action@v1` | **P0**   |
| `.github/workflows/codeql.yml:29,38,41`       | `github/codeql-action/*@v4`        | P2       |

`claude.yml` runs on `issue_comment` and `pull_request_review_comment` with `contents: write`, `pull-requests: write`, `issues: write`, `id-token: write`, `actions: read`. A supply-chain compromise on `anthropics/claude-code-action@v1` (mutable major tag) would give full write access to the Ferry repo via any `@claude` mention in an issue or PR comment. `codeql.yml` uses `github/codeql-action/{init,autobuild,analyze}@v4` (GitHub-published, lower risk; the project's own consumer-facing pins do SHA-pin GitHub's own actions for consistency).

**Strengths**

- Explicit `permissions:` blocks on every job across consumer-side agent workflows, `ferry-ci.yml`, `release.yml`, `codeql.yml`.
- Concurrency groups per ticket prevent races; `cancel-in-progress: false` on writes (dev/iterate), `true` on read-only (refine/review).
- Fallback `'ferry-invalid-payload-sinkhole'` blocks group injection.
- CODEOWNERS guards `.github/`, `src/schemas/`, `prompts/`.
- `release.yml` uses `id-token: write` only for npm provenance.
- Consumer workflows expanded into multi-job (`gate-envelope` → `route` → `run-agent` / `run-agent-claude-code` → `emit-audit`) calling Ferry composite actions directly — no `secrets: inherit` dependency on reusable workflows.
- Composite-action input validator (#229) prevents shipping unsupported keys (e.g. the `timeout-minutes` regression that hit `v0.8.0`); enforced at build time.
- **`route` job** (#327 / #348) — every consumer workflow now runs a `route` step before the agent step, returning `path: script | claude-code` and a `reason` based on Jira labels + `ferry.config.json`. Misconfigurations (e.g. cc-path requested but no `CLAUDE_CODE_OAUTH_TOKEN`) fail at the route step, not mid-agent.
- **Hardening primitives on the cc-path** (#303 / #349): `secret-scan-gate`, `tool-policy` enforcement, and per-job `permissions` are wired into the Claude Code branch.

**Weaknesses**

- `claude.yml` / `claude-code-review.yml` use `@v1` / `@v6` mutable tags (P0/P1 above) — new in this window.
- `codeql.yml` uses `@v4` for `github/codeql-action` (P2).
- `GITHUB_TOKEN` used by composite actions instead of a fine-grained GitHub App (P2).
- No `harden-runner` (StepSecurity) for egress allowlisting on the dev/iterate workflows that perform git push (P1, carry-over).
- No OIDC for federated auth to Anthropic / Jira / OpenAI / Google.

### 4.4 Tests & coverage — 9.0 (+0.5)

| Metric  | Status                                                                          |
| ------- | ------------------------------------------------------------------------------- |
| Suite   | **152 files / 2232 tests / all passing in 3.25s**                               |
| Reports | text, text-summary, html, lcov                                                  |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`                                     |
| Δ       | +1032 tests / +52 files since v0.8.2 audit (1200 → 2232 tests, 100 → 152 files) |

**Strengths**

- New cc-path coverage (`src/lib/dispatch/cc-prepare-action.test.ts`, `src/lib/dispatch/cc-apply-action.test.ts`, `src/lib/dispatch/route-action.test.ts`, `src/lib/dispatch/resolve-execution-path.test.ts`, `src/cli/doctor/checks/claude-code-path.test.ts`).
- New GitLab adapter coverage (`src/lib/dispatch/runner/gitlab/`, including a `fixtures.test.ts` replay suite over `src/__fixtures__/gitlab/`).
- New label-override coverage (`src/lib/labels/`) — every override family has dedicated unit tests.
- New cost-governance CLI coverage (`src/cli/cost/{advice,reconcile,format,stats}.test.ts`).
- D9 regression suite (`extractFirstJsonObject`) intact: prose preamble, trailing prose, nested code fences all covered.
- Coverage threshold uniform at 75% across statements/branches/functions/lines.
- CLI module coverage: every doctor check has a sibling `.test.ts`.
- Composite-action entrypoints excluded from coverage with documented reason.
- Multi-provider tool-loop modules covered (`src/lib/llm/tool-loop/{anthropic,openai,google}.test.ts`).

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests (carry-over).
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 8.5 (unchanged)

**Strengths**

- **Mocked end-to-end pipeline test** at `src/e2e/pipeline.test.ts` replays refine→dev→review→iterate, asserts the no-auto-merge invariant, exercises FR18/FR24/FR28.
- **Install-guide acceptance test** at `src/install-guide.test.ts` (71 tests) covers 18 sections of the README and `docs/INSTALL.md` including no-`@main` self-references and correct `@v0.13.0` pins across all four agent stubs + reconcile + cost-daily.
- FR drift detector (`scripts/check-fr-drift.sh`) wired into CI lint job.
- Release pipeline empirically validated by **eighteen** real tag pushes (v0.4.0 through v0.13.0 — all pipelines green).
- **Bundle-runtime smoke gate:** `scripts/smoke-bundle.sh` boots each role's `index.cjs` against a fixture envelope and asserts exit-code 0; wired as a dedicated `smoke-bundle` job in `ferry-ci.yml`. Closes the v0.5.1 (`Dynamic require`) and pre-v0.7.0 (yaml package missing) failure modes.
- **Composite-action input validator (#229):** test in `src/lib/agent-runtime/composite-action.test.ts` asserts each `runs.steps` entry uses only keys supported by GitHub Actions composite actions.
- **GitLab fixture-replay suite:** `src/lib/dispatch/runner/gitlab/fixtures.test.ts` feeds each captured GitLab REST shape through the adapter to catch contract drift.

**Weaknesses**

- No idempotency assertion across a full replay of the same `event_id` against the same audit issue (P1, carry-over).
- Install-guide test validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts` (P1, carry-over from v0.8.2 — would have caught the v0.8.0–v0.8.1 silently-ignored `ferry_model:` input regression).

### 4.6 CI/CD gates — 9.5 (+0.5)

**Strengths**

- Eight parallel CI jobs: `typecheck`, `lint+format+fr-drift`, `test+coverage`, `gitlab-adapter`, `check-bundle`, `smoke-bundle`, `audit`, `gitleaks`; plus CodeQL with fail-on-high/critical gate, release gate.
- **CodeQL fail-on-high/critical gate** (`codeql.yml:48–60`) — SARIF level `error` blocks the PR; medium/low are visible but non-blocking. Closes the gap where CodeQL findings only surfaced in the Security tab without blocking merge.
- **`gitlab-adapter` job** in `ferry-ci.yml` — runs GitLab adapter unit tests, fixture-replay, runner-factory, and CLI forge-flag tests in isolation so GitLab-only regressions surface under a clearly-named gate.
- `release.yml` runs full quality gate (`typecheck` → `lint` → `format:check` → `test` → `audit:ci` → `build:ferry` → bundle-drift assertion → `build:cli`) before npm publish.
- All actions in CI / release / Ferry composite actions pinned by SHA. Repo-development helper workflows (claude.yml, claude-code-review.yml, codeql.yml) are not pinned by SHA — see Domain 3.
- Concurrency cancels superseded CI runs on the same branch.
- Husky pre-push hook re-runs the full suite locally.
- Recent runs on `main`: Release ✓, Ferry — CI ✓, CodeQL ✓ (last 5 runs all `success`).

**Weaknesses**

- No `npm ci --audit-signatures` integrity check.
- No required-checks branch-protection preventing direct push to `main` (P2, carry-over).

### 4.7 Reliability — 9.0 (unchanged)

**Strengths**

- All v0.5.3/v0.6.0/v0.8.2 closures hold: D9 Refiner JSON parser hardened (`extractFirstJsonObject`); reviewer→iterator loop fixed (`countPriorIterations`); gitleaks ENOENT fixed.
- Audit-issue rotation present and tested (`src/lib/audit/index.ts`, threshold 90% of 1000-comment cap, `FERRY_AUDIT_ROTATION_THRESHOLD` env-tunable, default 900).
- Read_file 256 KB hard cap and 64 KB head+tail truncation prevent agents from blowing up token budgets on large files.
- Agent-loop message-history compaction and pruning bound conversation history so token-cap blow-ups no longer recur.
- Cache_read_input_tokens weighted at 0.1× of input cost — agents no longer trip the budget cap on cache reads.
- ferry.config.json reloaded from `base_branch` on every agent run — config drift between branches is self-correcting.
- Developer WIP-commit-on-failure (#222) — agent crashes no longer lose in-progress work; consumers get a `ferry-wip/<ticket>` branch URL in Jira and a structured failure summary.
- en-US locale pinning for number formatting prevents non-English runners from emitting comma-decimal cost figures that downstream tooling parses as integers.
- **`anthropicOnly` hard gate** (#329 / #341) surfaces cc-path misconfigurations at install time rather than as runtime failures.
- **`requires-secrets` migration gate** (#316 / #340) — `ferry-update` blocks upgrades that need a new secret until the consumer rotates it (the v0.12.x → v0.13.0 entry declares `CLAUDE_CODE_OAUTH_TOKEN`).
- **Idempotent `route` step** — the route decision is pure; rerunning the same envelope yields the same path.

**Carry-over weaknesses**

- No circuit breaker (LLM provider down → retries to ceiling).
- Reconciler depends on the consumer wiring `ferry-reconcile.yml`.

### 4.8 Observability — 7.5 (unchanged)

**Strengths**

- Structured JSON logger in production paths.
- Centralised audit issue with JSON-per-phase lines; rotation handles approaching 1000-comment cap.
- Correlation by `run_id` / ULID across phases.
- `docs/RUNBOOK.md` (22 KB) provides extensive on-call triage including the cc-path failure modes.
- Soft-budget warnings emit at 70% / 85% of `max_tokens_per_run` so operators see cost trends mid-run.
- `GITHUB_STEP_SUMMARY` emitter on agent termination (#224) — every agent run writes a structured run-stats summary directly into the GitHub Actions UI.
- **`ferry-cost-stats`, `ferry-cost-report`** CLIs surface per-run / aggregate spend from `audit-log.jsonl` — no infra required.

**Weaknesses**

- No exported metrics (Prometheus, OpenTelemetry).
- No alerting on runtime failure — a stuck ticket waits silently for a human (mitigated when the consumer wires the reconciler).
- Some emitters still pass `correlation_id: ""` — not all entry points propagate the ULID.

### 4.9 Consumer documentation — 9.0 (+0.5)

**Strengths**

- `ferry-init` emits exactly 4 expanded multi-job stubs; all pin to `@v0.13.0`; all composite actions referenced exist on origin; per-agent model input names are correct as of `v0.13.0`; install-time choice of execution path (script / claude-code) per ADR-0006 §6.
- The `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` secret naming is consistent across `README.md`, `docs/INSTALL.md`, composite actions, `ferry-init`, `ferry-doctor`, and `ferry-uninstall`.
- `ferry-update` parses `MIGRATIONS.md` at runtime and enforces `requires-secrets:` credential gating.
- `ferry-doctor` has 22 distinct checks covering audit issue, audit log, claude-code path (token exclusivity, provider gate, workflow shape), config limits, dispatch round-trip, env vars, GitHub App, Jira API, LLM verification, prompts, secrets, update availability, workflow columns, workflows.
- `docs/RUNBOOK.md` — on-call playbook for stalled ticket, cost spike, agent-loop runaway, refiner D9 mitigation, rollback, CI red, cc-path failures.
- `docs/CONFIGURATION.md` (90 KB) is internally consistent with the composite action interfaces, references `@v0.13.0`.
- `docs/INSTALL.md` (8.6 KB) — dedicated install guide separate from the trimmed README.
- `docs/COST.md` (17.6 KB) — cost governance reference covering CLIs, reconciliation, advisory heuristics.
- `docs/MCP.md` (8.0 KB) — documents GitHub, Atlassian, Prismic MCP servers (Phase 1 of #319).
- `docs/PRIVACY.md` — data-handling disclosure.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.
- 6 ADRs (`0001`–`0006`); ADR-0006 (14 KB) documents the cc-path / script-path split, resolver precedence, `anthropicOnly` gate, and accepted-divergence invariants.
- GitLab consumer-setup templates ship in `examples/consumer-setup-gitlab/`; the `--forge gitlab` branch of every CLI is documented in `docs/CONFIGURATION.md`.

**Carry-over weaknesses**

- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` instead (P2, action 5).
- `ferry-init` does not collect the two transition IDs — still a manual `docs/INSTALL.md` step (P2, action 6).
- No `workflowTemplates()` invocation in `install-guide.test.ts` (P1, action 3).

### 4.10 Code quality — 8.5 (unchanged)

**Strengths**

- Strict TypeScript NodeNext ESM, `no-explicit-any: error`.
- ESLint with agent-specific rules; restricted-imports verified by test; layering invariant (`src/lib/agent-runtime/**` cannot reach into `src/agents/**`) enforced via `no-restricted-imports`.
- Prettier mandatory and currently clean.
- Layered architecture respected; agents never import Octokit/Jira directly (verified by `src/agents/restricted-imports.test.ts`).
- Multi-provider tool-loop modules (`src/lib/llm/tool-loop/`) follow the existing `agent-loop/` flat layout — `index.ts` dispatches by provider name, individual provider modules are independent.
- Per-role pre-loop setup extracted into shared `prepare` functions (`src/lib/agent-runtime/prepare-*.ts`, #330 / #345) — reduces duplication across the four agent entrypoints and makes the cc-path / script-path split surgical.
- Unit tests next to implementation; lint fixtures isolated.

**Weaknesses**

- No complexity gates (cyclomatic, max lines).
- No `eslint-plugin-security` or `eslint-plugin-no-secrets`.
- `src/agents/reviewer/review-loop.ts` size still hints at complexity debt.

### 4.11 Traceability / FR governance — 7.5 (unchanged)

**Strengths**

- `docs/REQUIREMENTS.md` is the single source of truth for `FR\d+` IDs.
- `npm run check:fr-drift` wired into CI lint job; fails the build on undocumented FR tags.
- Six ADRs cover the foundational decisions including ADR-0006 (cc-path execution).
- Audit issue traces every runtime execution.
- `decisions/` directory adds non-ADR design-record artifacts (e.g. `decisions/0002` referenced by the `requires-secrets` credential gate).

**Weaknesses**

- No commit-msg lint enforcing FR or issue back-reference.
- No bidirectional code → FR mapping beyond grep.

### 4.12 Operations — 8.0 (unchanged)

**Strengths**

- `docs/RUNBOOK.md` (22 KB) — concrete on-call playbook including cc-path failure modes.
- `ferry-uninstall` CLI — reversible-deploy path; cleans up new cc-path composite dirs and handles interactive OAuth secret-removal flow.
- `ferry-update` CLI — migration path, reads `MIGRATIONS.md`, enforces `requires-secrets:` credential gate.
- Reconciler + cost-daily stubs ship in `examples/consumer-setup/workflows/`, pinned to `v0.13.0`.
- Pre/post-agent command hooks (#223) on all four composite actions.
- Developer WIP-commit-on-failure (#222).
- 3-state outcome (#221).
- **GitLab forge support** (experimental): `ferry-init`, `ferry-doctor`, `ferry-update`, `ferry-uninstall` all have working `--forge gitlab` branches with project detection, scope checklist, six template install, live probes, version rewriter, and idempotent uninstall.

**Weaknesses (carry-over)**

- No proactive monitoring — audit issue pings nobody.
- Reconciler effectiveness depends on consumer wiring the stub.
- GitLab forge support is marked **experimental** until a real consumer exercises the full Jira→MR cycle.

### 4.13 Release / distribution — 9.0 (+0.5)

The release pipeline executed **eight** times in this audit window (`v0.9.0`/`v0.10.0`/`v0.10.1`/`v0.10.2`/`v0.10.3`/`v0.11.0`/`v0.12.0`/`v0.13.0`). All pipelines green. The cadence-drag finding remains closed. The +0.5 is held back from a full +1.0 by the rapid hotfix sequence on the v0.10 line (four cuts on the same day), suggesting some release-quality polish opportunity — though none were consumer-impacting in the way the v0.8.0 `timeout-minutes` and `ferry_model:` regressions were.

**Strengths**

- Release pipeline proven on **eighteen** tag pushes (v0.4.0 through v0.13.0). All pipelines green.
- `package.json`: `"version": "0.13.0"`, `"publishConfig": { "access": "public" }`.
- `CHANGELOG.md` (Keep a Changelog format) and `MIGRATIONS.md` present and feed the release pipeline.
- `v1` floating tag advances correctly on each release (`scripts/retag-major.sh`).
- npm publish uses `--provenance --access public`.
- HEAD is `v0.13.0`; working tree clean — no release-cadence drag.
- `decisions/0002` formalises the `requires-secrets` credential gate so future MIGRATIONS entries can declare required secrets and block upgrades cleanly.

**Weaknesses**

- Four hotfix cuts on the v0.10 line in a single day — release-quality polish opportunity (no consumer-impacting regressions, but tighter rehearsal before tagging would close the bunched-hotfix pattern).
- CHANGELOG link section: `[0.5.0]`–`[0.5.3]` links remain missing (D10 carry-over).
- No SLSA provenance on the GitHub Release artifact.
- No documented LTS / support window.

### 4.14 Cost governance — 8.0 (+1.0)

The +1.0 reflects the three new CLI tools and the maturation of the cost-governance surface from "stub-ships, consumer-wires" to "first-class CLI surface" with reconciliation against provider CSVs.

**Strengths**

- `src/cost-governance/daily-check.ts` written and tested.
- `examples/consumer-setup/workflows/ferry-cost-daily.yml` ships as a copy-paste stub (cron `0 6 * * *`); 50% monthly cap → auto-pause via `ferry:paused` label. `FERRY_SPEND_CAP_EUR` env-tunable (default 200 EUR).
- Audit line carries `cost_eur` per execution.
- Soft-budget warnings at 70% / 85% of `max_tokens_per_run` give operators mid-run visibility.
- **`ferry-cost-report`** — CSV / Markdown reporting from `audit-log.jsonl`.
- **`ferry-cost-reconcile`** — compares Ferry's emitted `cost_eur` against provider CSV exports (Anthropic, OpenAI, Google) with a `--tolerance` flag (default 10%). Surfaces drift between Ferry's internal accounting and provider-of-truth billing.
- **`ferry-cost-advice`** — heuristics on cache-hit rate (warn when cache_read / (cache_read + input) < 0.3), max_iterations hits, Refiner context-blow-up patterns, p90 cost outliers. Outputs actionable recommendations referencing `docs/CONFIGURATION.md` knobs.
- **`ferry-cost-stats`** — aggregate stats.
- **Per-ticket budget overrides** via Jira labels (`ferry:budget:<usd>`, `ferry:max-iterations:<n>`, `ferry:max-tokens:<n>`) from #238 — consumers can throttle a single misbehaving ticket without editing `ferry.config`.
- **Multi-model pricing table** in `src/lib/llm/pricing.ts` covers Anthropic (Opus 4.5/4.7, Sonnet 4.6, Haiku 4.5), OpenAI (4.1-nano/mini, 4./5.), Google (Gemini 2.5 flash/pro).

**Weaknesses**

- No pre-execution check — a single ticket can consume arbitrarily before the daily check runs (mitigated by per-ticket labels but still relies on operator labeling).
- USD-to-EUR conversion is pinned at `0.93` in `src/cli/cost/reconcile.ts` and `src/lib/llm/pricing.ts` — documented as deliberate but means cost reports drift from spot rates over time (P1; could be a daily fetch or an env-tunable constant).
- The safety net requires the consumer to copy the daily-check stub; nothing validates they did (carry-over).

### 4.15 Doc–code coherence — 8.5 (+0.5)

**Closed drift items (D1–D11)** — all hold.

| #   | Status                                                                                          |
| --- | ----------------------------------------------------------------------------------------------- |
| D1  | **Closed.** CLAUDE.md correctly lists all four CLIs.                                            |
| D2  | **Closed.** `CONTRIBUTING.md` correctly states "The bundle-drift check is enforced in CI."      |
| D3  | **Closed.** `CONTRIBUTING.md` correctly states "there is no local `commit-msg` hook today."     |
| D4  | **Closed.** `docs/RELEASING.md` lists all four CLIs.                                            |
| D5  | **Closed.** Stub headers no longer advertise phantom optional variables.                        |
| D6  | **Closed.** `ferry-update` reads `MIGRATIONS.md` at runtime.                                    |
| D7  | **Closed.** `ferry-doctor` check D7 verifies `FERRY_AUDIT_ISSUE`.                               |
| D8  | **Closed.** `docs/adr/0002-ferry-bundles-committed.md` references `@v0.13.0`.                   |
| D9  | **Closed.** ADR 0002 drift resolved (now references `@v0.13.0` consistently).                   |
| D11 | **Closed.** No stale `@v0.X.Y` comments in `src/install-guide.test.ts` — current at `@v0.13.0`. |

**Drift items (current)**

| #   | Drift                                                                                                                                                                                                                                                                                                                                                             | Severity |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D10 | **CHANGELOG link section missing `[0.5.0]`–`[0.5.3]` release tag links.** `[0.9.0]`/`[0.10.x]`/`[0.11.0]`/`[0.12.0]`/`[0.13.0]` and `[Unreleased]` base are correct; the v0.5.x gap remains. Affects changelog navigation; does not block releases.                                                                                                               | low      |
| D12 | **Action 0d (systematic tag-pin drift gate) still not implemented.** Eight successive releases without drift, but recurrence is gated only on manual diligence. A regex-based test asserting `@v[0-9.]+` literals across `docs/**` agree with `package.json .version` would prevent recurrence and is now an XS-effort win given the file set is already aligned. | low      |

**Net coherence assessment**

D1–D11 closures hold; D8/D9 (ADR 0002 drift) carry forward as closed for the third successive cycle. Two drift items remain (D10 v0.5.x CHANGELOG links, D12 missing systematic guard). **Score: 8.5** — +0.5 from the previous audit, driven by perfect alignment at `@v0.13.0` across every doc and code reference.

---

## 5. Gaps and risks

### 5.1 Hardcoded values (P0/P1)

Scan scope: `src/**/*.ts`, excluding `*.test.ts`, `__fixtures__/`, `__lint-fixtures__/`, `src/schemas/*.json`.

**Assessment:** Almost every production constant is env-tunable via the `FERRY_*` env-var pattern or the `ferry.config.{yaml,json}` `limits.*` keys. P0 count is **0**. P1 count is **3** — below the 6-item threshold; no score penalty applied to Domains 5 or 8.

**P1 — Cost & Budget Thresholds (new)**

- **P1** `src/cli/cost/reconcile.ts:5` and `src/lib/llm/pricing.ts` — `USD_TO_EUR = 0.93` — pinned FX rate; documented as deliberate, but drifts from spot over time. Affects `cost_eur` reporting accuracy across all four agents. Could be an env-tunable `FERRY_USD_TO_EUR` with a daily-fetch fallback. The reconcile CLI exists to detect divergence against provider-of-truth billing, so the operational impact is bounded.

**P1 — Size & Batch Limits (carry-over)**

- **P1** `src/agents/developer/tools.ts:23` — `MAX_SEARCH_MATCHES = 200` — grep result cap for the dev agent; not env-tunable. Large repos with >200 matches per pattern receive a silent truncation. Could be moved to a `FERRY_GREP_MAX_MATCHES` env var.
- **P1** `src/lib/audit/index.ts:40` — `MAX_PAGES = 10` — caps audit comment pagination at 1,000 (10 × 100). Not env-tunable. Combined with `ROTATION_THRESHOLD = 900` and `FERRY_AUDIT_ROTATION_THRESHOLD` override it works in practice (rotation triggers before MAX_PAGES is reached), but the ceiling itself is rigid.

**P2 items (acceptable as-is)** — most constants already env-tunable via the central `DEFAULT_FERRY_CONFIG` in `src/lib/config.ts:172–202` (`max_iterations`, `max_agent_iterations`, `max_tokens_per_run`, `max_tokens_per_message`, `max_cost_eur_per_run`, `bash_timeout_ms`, `bash_timeout_max_ms`, `grep_timeout_ms`, `anthropic_verify_timeout_ms`, `jira_retry_base_delay_ms`, `jira_retry_max_attempts`, `envelope_instructions_chars`, `project_snippet_bytes`, `agent_extension_bytes`, `tldr_total_chars`, `tldr_verdict_chars`, `file_display_chars`, `refiner_subtask_cap`, `refiner_touch_paths_cap`, `reviewer_max_iterations`, `reviewer_max_tokens`, `reconciler_stale_window_minutes`) or via `FERRY_*` env-var override. Soft-budget warning thresholds (`0.7`, `0.85`) in `src/lib/llm/agent-loop/{anthropic,openai,google}.ts` are sensible defaults; could become `FERRY_BUDGET_WARN_FIRST_PCT` / `FERRY_BUDGET_WARN_SECOND_PCT`. Internal tuning constants (`jitterRatio = 0.5`, `backoffFactor = 2` in `src/lib/io/retry.ts`; `ITERATION_FACTOR = 1.4` in cost-estimate; `SAMPLE_MAX = 512` in refine; `SOFT_THRESHOLD = 0.5` in cost-daily) are acceptable as-is.

### 5.2 GitHub Actions pin discipline (new in this window)

See Domain 3 (4.3) for full details. Summary:

- **P0** `claude.yml:35` and `claude-code-review.yml:31` — `anthropics/claude-code-action@v1` (mutable major tag) on a write-path workflow with `contents: write`, `pull-requests: write`, `issues: write`. SHA-pin to the same release the consumer-side templates use (`@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127`) for consistency.
- **P1** `claude.yml:29` and `claude-code-review.yml:25` — `actions/checkout@v6`. SHA-pin to `@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2` to match every other workflow in the repo.
- **P2** `codeql.yml:29,38,41` — `github/codeql-action/{init,autobuild,analyze}@v4`. GitHub-published, low-risk but inconsistent with project standard.

### 5.3 Supply-chain advisories

`npm audit` raw output shows 4 advisories (2 high transitive, 2 moderate transitive — all in dev or as transitive deps of production SDKs):

| Advisory                                    | Severity | Path                           | Status                                                              |
| ------------------------------------------- | -------- | ------------------------------ | ------------------------------------------------------------------- |
| `fast-uri` (path traversal, host confusion) | high     | `ajv` → `fast-uri`             | Allowlisted (`audit-ci.json` 1117870/1117884), rationale documented |
| `protobufjs` (8 advisories)                 | high     | `@google/genai` → `protobufjs` | Allowlisted (`audit-ci.json` 14 IDs), rationale documented          |
| `brace-expansion` (DoS)                     | moderate | `eslint` (dev only)            | Below CI gate; `npm audit fix` available                            |
| `ws` (mem disclosure)                       | moderate | `vitest`/`vite` (dev only)     | Below CI gate; `npm audit fix` available                            |

CI's `audit:ci` job uses `--omit=dev` and blocks only on **unallowlisted high/critical**, so all four pass. The two moderate dev-only items should be cleared by routine `npm audit fix` on the next Dependabot pass; tracked as housekeeping, not a finding.

### 5.4 Other carry-overs

- No idempotency assertion across a full replay of the same `event_id` against the same audit issue (Domain 5, P1).
- No `harden-runner` egress allowlist on dev/iterate workflows (Domain 3, P1).
- `install-guide.test.ts` never invokes `workflowTemplates()` from `src/cli/init/templates.ts` (Domain 5, P1).
- Several raw `console.log` calls remain under `src/` (Domain 8).
- No proactive monitoring on the audit issue (Domain 12).

---

## 6. Prioritized action plan (residual)

| Order | Action                                                                                                                                                                                                                                                                                                                                                                | Domain        | Score before | Priority | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------- | ------ |
| 1     | **(P0, new)** SHA-pin `anthropics/claude-code-action` and `actions/checkout` in `.github/workflows/claude.yml` and `claude-code-review.yml`. Reuse the existing template pin (`@1dc994ee7a008f0ecc866d9ac23ef036b7229f84 # v1.0.127`).                                                                                                                                | GH Actions    | 7.0          | **P0**   | XS     |
| 2     | **(P1, carry-over)** Add `harden-runner` egress allowlist to dev/iterate workflows — these jobs run `git push` and therefore need egress to GitHub; all other outbound connections should be blocked.                                                                                                                                                                 | GH Actions    | 7.0          | **P1**   | S      |
| 3     | **(P1, carry-over)** Action 0d: add a regex assertion (or new `tag-pin-drift.test.ts`) that scans `docs/adr/*.md`, `docs/RELEASING.md`, `docs/CONFIGURATION.md`, `docs/INSTALL.md` for `@v[0-9.]+` literals and fails if any disagrees with `package.json .version`. The file set is currently aligned, so this is an XS effort that closes the drift class for good. | Coherence     | 8.5          | **P1**   | XS     |
| 4     | **(P1, carry-over)** Extend `install-guide.test.ts` to invoke `workflowTemplates()` from `src/cli/init/templates.ts` and assert each emitted stub's composite-action refs and tag exist on origin.                                                                                                                                                                    | E2E           | 8.5          | **P1**   | S      |
| 5     | **(P1, carry-over)** Add e2e idempotency replay: same `event_id` twice → same outcome, no duplicate external writes.                                                                                                                                                                                                                                                  | E2E           | 8.5          | **P1**   | M      |
| 6     | **(P1, new)** Make `USD_TO_EUR` env-tunable (`FERRY_USD_TO_EUR`) or daily-fetched; document the source of truth.                                                                                                                                                                                                                                                      | Cost          | 8.0          | **P1**   | S      |
| 7     | **(P2)** `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the manual curl step).                                                                                                                                                                                                                                                | Consumer docs | 9.0          | **P2**   | S      |
| 8     | **(P2)** `ferry-init` collects the two transition IDs and sets them as secrets.                                                                                                                                                                                                                                                                                       | Consumer docs | 9.0          | **P2**   | S      |
| 9     | **(P2)** OSSF Scorecard + SLSA provenance on the GitHub Release artifact.                                                                                                                                                                                                                                                                                             | Supply chain  | 8.5          | **P2**   | M      |
| 10    | **(P2)** SHA-pin `github/codeql-action` in `codeql.yml`.                                                                                                                                                                                                                                                                                                              | GH Actions    | 7.0          | **P2**   | XS     |
| 11    | **(P2)** Migrate `GITHUB_TOKEN` to a fine-grained GitHub App (or remove the App provisioning from `ferry-init`).                                                                                                                                                                                                                                                      | GH Actions    | 7.0          | **P2**   | L      |
| 12    | **(P2)** Branch-protection on `main` requiring CodeQL / Ferry — CI / Release checks before merge.                                                                                                                                                                                                                                                                     | CI/CD         | 9.5          | **P2**   | XS     |
| 13    | **(P2)** Make `MAX_SEARCH_MATCHES` and `MAX_PAGES` env-tunable (`FERRY_GREP_MAX_MATCHES`, `FERRY_AUDIT_MAX_PAGES`).                                                                                                                                                                                                                                                   | Architecture  | 8.5          | **P2**   | XS     |
| 14    | **(low)** Backfill `[0.5.0]`–`[0.5.3]` links in `CHANGELOG.md` (D10).                                                                                                                                                                                                                                                                                                 | Release       | 9.0          | low      | XS     |
| 15    | **(P2)** Promote GitLab forge support out of "experimental" after one real consumer exercises the full Jira→MR cycle.                                                                                                                                                                                                                                                 | Operations    | 8.0          | **P2**   | M      |

### 6.1 Expected score after the plan

| Domain                  | Current | After P0/P1 (1–6) | After All |
| ----------------------- | ------- | ----------------- | --------- |
| Application security    | 8.5     | 8.5               | 9.0       |
| Supply-chain security   | 8.5     | 9.0               | 9.5       |
| GitHub Actions security | 7.0     | 8.5               | 9.0       |
| Tests & coverage        | 9.0     | 9.0               | 9.0       |
| E2E / acceptance        | 8.5     | 9.0               | 9.0       |
| CI/CD gates             | 9.5     | 9.5               | 9.5       |
| Reliability             | 9.0     | 9.0               | 9.0       |
| Observability           | 7.5     | 7.5               | 8.0       |
| Consumer documentation  | 9.0     | 9.0               | 9.5       |
| Code quality            | 8.5     | 8.5               | 8.5       |
| Traceability            | 7.5     | 7.5               | 7.5       |
| Operations              | 8.0     | 8.0               | 8.5       |
| Release / distribution  | 9.0     | 9.0               | 9.0       |
| Cost governance         | 8.0     | 8.5               | 9.0       |
| Doc–code coherence      | 8.5     | 9.0               | 9.0       |
| **Overall**             | **8.4** | **8.70**          | **8.93**  |

The single most impactful action is **#1 (SHA-pin Claude helper workflows)** — XS effort that closes the only P0 finding in this audit. Combined with **#3 (action 0d)** and **#6 (`FERRY_USD_TO_EUR`)**, both XS-to-S, the project crosses 8.7 with one focused PR cluster.

---

## 7. What changed since the v0.8.2 audit (8.2 → 8.4; net +0.2)

| #   | Change                                                                                                                                                                                                      | Domain effect                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **Eight releases shipped** (`v0.9.0` → `v0.13.0`) over 2026-05-05 to 2026-05-20 — cadence drag closed                                                                                                       | Domain 13 +0.5 (Release)                                                         |
| 2   | **ADR-0006 cc-path execution rollout** — `ferry-route`, `ferry-cc-prepare`, `ferry-cc-apply` composite actions; `anthropicOnly` hard gate; `requires-secrets` migration gate; `ferry-doctor` cc-path checks | Domain 1 strengthened; Domain 7 strengthened; Domain 9 +0.5 (ADR-0006 doc)       |
| 3   | **GitLab forge support (experimental)** — `--forge gitlab` wiring across all four CLIs; six template install; five live probes; version rewriter; idempotent uninstall                                      | Domain 12 strengthened; Domain 4 +0.5 (1032 new tests including GitLab fixtures) |
| 4   | **Per-ticket label-override system (#236–#243)** — model/provider/budget/iterations/phase/thinking/rubric/branch/draft/dry-run/read-only overrides via Jira labels                                          | Domain 14 +1.0 (Cost gov per-ticket); Domain 7 strengthened                      |
| 5   | **Three new cost-governance CLIs** — `ferry-cost-report`, `ferry-cost-reconcile`, `ferry-cost-advice`, `ferry-cost-stats`; multi-model pricing table                                                        | Domain 14 (counted above)                                                        |
| 6   | **CodeQL fail-on-high/critical gate** (`codeql.yml:48–60`) + **`gitlab-adapter` CI job**                                                                                                                    | Domain 6 +0.5 (CI/CD gates)                                                      |
| 7   | **+1032 unit tests** (1200 → 2232 across 100 → 152 files) — cc-path, GitLab, label overrides, cost-governance CLIs all covered                                                                              | Domain 4 +0.5 (Tests)                                                            |
| 8   | **README trimmed to 79 lines** (closes #328); new long-form docs (`INSTALL.md`, `COST.md`, `MCP.md`, `RUNBOOK.md`, `PRIVACY.md`); ADR-0006 added                                                            | Domain 9 (counted above)                                                         |
| 9   | **`claude.yml` / `claude-code-review.yml` regress to `@v1`/`@v6`** for `anthropics/claude-code-action` and `actions/checkout` — pin discipline gap on Ferry's own automation                                | Domain 3 −0.5 (GH Actions sec)                                                   |
| 10  | **Multi-provider Phase 1 (Refiner) and Phase 2 (Reviewer) shipped** — `src/lib/llm/tool-loop/{anthropic,openai,google}.ts` modules                                                                          | Domain 4 (counted above)                                                         |
| 11  | **Per-role pre-loop setup extracted** (`src/lib/agent-runtime/prepare-*.ts`, #330/#345) — reduces duplication across the four agents                                                                        | Domain 10 strengthened                                                           |
| 12  | **MCP server catalog (Phase 1 of #319)** — GitHub, Atlassian, Prismic documented in `docs/MCP.md`; Figma deferred (#325)                                                                                    | Domain 9 (counted above)                                                         |
| 13  | **Perfect tag-pin consistency at `@v0.13.0`** across all consumer-facing artifacts                                                                                                                          | Domain 15 +0.5 (Doc-code coherence)                                              |

---

## 8. Closed from previous audits

### Closed since the v0.8.2 audit

| Item  | Action (was P1/carry-over)        | Status   | Evidence                                                                                                                      |
| ----- | --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| —     | Multi-provider Phase 2 (Reviewer) | **done** | Shipped in `v0.9.0` — `src/lib/llm/tool-loop/{anthropic,openai,google}.test.ts`                                               |
| —     | ADR-0006 cc-path rollout          | **done** | `docs/adr/0006-claude-code-action-execution-path.md`; `ferry-route` / `ferry-cc-prepare` / `ferry-cc-apply` composite actions |
| —     | `anthropicOnly` hard gate         | **done** | `src/lib/dispatch/resolve-execution-path.ts` — refuses cc-path unless provider is Anthropic                                   |
| —     | `requires-secrets` migration gate | **done** | `src/cli/update/credential-gate.ts` — `MIGRATIONS.md` entries can declare required secrets                                    |
| —     | GitLab forge support              | **done** | `--forge gitlab` wiring across all four CLIs; `examples/consumer-setup-gitlab/`; experimental flag retained                   |
| —     | Cost-governance CLI surface       | **done** | `ferry-cost-report`/`-reconcile`/`-advice`/`-stats` CLIs                                                                      |
| —     | Per-ticket label overrides        | **done** | `src/lib/labels/`; eight override families (#236–#243)                                                                        |
| —     | CodeQL fail-on-high/critical gate | **done** | `codeql.yml:48–60`                                                                                                            |
| —     | README trimmed                    | **done** | 79 lines at HEAD; content moved to `docs/`                                                                                    |
| D8/D9 | ADR 0002 drift                    | **done** | References `@v0.13.0` consistently for the third successive cycle                                                             |

### Still open (carry-over)

| Item | Action                                                  | Priority | Effort |
| ---- | ------------------------------------------------------- | -------- | ------ |
| 1    | SHA-pin `claude.yml` / `claude-code-review.yml` actions | **P0**   | XS     |
| 2    | `harden-runner` egress allowlist                        | **P1**   | S      |
| 3    | Tag-pin drift gate (action 0d) — 4th cycle              | **P1**   | XS     |
| 4    | Install-guide test covers `workflowTemplates()`         | **P1**   | S      |
| 5    | E2E idempotency replay                                  | **P1**   | M      |
| 6    | `FERRY_USD_TO_EUR` env-tunable                          | **P1**   | S      |
| 7    | `ferry-init` scaffolds ops stubs                        | **P2**   | S      |
| 8    | `ferry-init` collects transition IDs                    | **P2**   | S      |
| 9    | OSSF Scorecard / SLSA on GH Release                     | **P2**   | M      |
| 10   | SHA-pin `github/codeql-action`                          | **P2**   | XS     |
| 11   | Migrate GITHUB_TOKEN to fine-grained App                | **P2**   | L      |
| 12   | Branch-protection on `main`                             | **P2**   | XS     |
| 13   | Env-tunable `MAX_SEARCH_MATCHES` / `MAX_PAGES`          | **P2**   | XS     |
| 14   | Backfill `[0.5.0]`–`[0.5.3]` CHANGELOG links            | low      | XS     |
| 15   | Promote GitLab forge out of "experimental"              | **P2**   | M      |

---

## 9. How to read this document

- **Do not edit manually as a substitute for fixing the underlying issue.** Each row in §6 should be mirrored as a GitHub issue with acceptance criteria. Close the issue when its criteria pass; refresh this audit at the next review cycle.
- **Scores are point-in-time.** Re-run the audit before each `vN` release.
- **The 8 / 10 threshold is consumer-readiness**, not perfection. P2 items are not a precondition.
