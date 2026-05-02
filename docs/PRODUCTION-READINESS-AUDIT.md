# Production-Readiness Audit — Ferry

**Date:** 2026-05-02
**Scope:** end-to-end audit of the Ferry codebase, CI, docs and operations against production-readiness criteria, post-`v0.5.2` release. **This revision focuses on the v0.5.0 → v0.5.2 patch arc** — the v0.5.1 release shipped DOA for the refiner agent (CJS dynamic-require crash from the bundled `@google/genai` SDK), and v0.5.2 (`b95526c`, two days later) shipped the `createRequire` banner fix. The release pipeline executed correctly on both pushes; what failed was the **runtime smoke gap**: nothing in CI actually executes the bundled `.ferry/` output before npm publish. §4.13 absorbs this incident; §4.15 surfaces one new doc-drift item (D8).
**Verdict:** **7.2 / 10 — Conditional. The install path itself is healthy at v0.5.2, but a real prod failure exists on the Refiner agent: `[ferry:state-invariant] refiner-output-invalid` thrown from `src/agents/refiner/refine.ts:105` when the LLM returns JSON with any prose preamble.** Reproduced on `big-emotion/ethniafrica` run 25262368292 against `ferry-run-refiner@v0.5.2` (2026-05-02 21:31:58Z, refiner-action.js exit 1). Do not pin to v0.5.1 (CJS bundling crash). v0.5.2 is the recommended pin for everything except the Refiner's first-pass robustness — see §4.7 D9 (P0, new).
**Target:** **8–9 / 10**, addressed by the residual P0/P1 items in §5 (now including a refiner-parser hardening fix and a bundle-smoke-test gate that would have blocked v0.5.1).

---

## 1. Scope and method

Read-only audit covering:

- **Code & tests:** `src/`, `vitest run` (**1025** tests passing across 86 files in 2.29s), `npm run lint`, `npm run typecheck`, `npm audit`.
- **CI/CD:** `.github/workflows/`, `.github/actions/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.gitleaks.toml`, `codeql.yml`, `release.yml`. Recent run history via `gh run list`.
- **Release artifacts:** `git ls-remote --tags origin`, `npm view @big-emotion/ferry version`.
- **Docs:** `README.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/`, `CONTRIBUTING.md`, `MIGRATIONS.md`, `CHANGELOG.md`.
- **CLI:** `src/cli/init/`, `src/cli/doctor/`, `src/cli/uninstall/`, `src/cli/update/` and their tests.
- **Schemas & contracts:** `src/schemas/event.v1.schema.json`, `src/install-guide.test.ts`, `src/e2e/pipeline.test.ts`.

No runtime traffic, no GitHub/Jira/LLM API calls.

### Top-line answers (the four canonical questions)

1. **Is the project production-ready?** **Conditional.** The install/scaffold path is healthy at v0.5.2 — all three previous P0 install-flow blockers remain closed (floating `v1` tag exists and points at v0.5.2; `templates.ts` emits four working stubs; `ANTHROPIC_API_KEY` is consistent across init / doctor / reusable workflows). v0.5.2 release pipeline ran clean (`b95526c`, full CI gate ✓, npm publish ✓, GitHub Release ✓). All 1025 unit tests pass; `npm audit` clean (0 vulns / 332 deps). **But the Refiner agent has a confirmed runtime failure on v0.5.2 in production:** `big-emotion/ethniafrica` run 25262368292 (refine job, 2026-05-02 21:31:58Z) failed with `[ferry:state-invariant] {"reason":"refiner-output-invalid"}` at `refiner-action.js` exit 1. Root cause: `src/agents/refiner/refine.ts:101–106` does `JSON.parse(stripMarkdownFences(text))` with a `stripMarkdownFences` that only matches ` ``` ` anchored at start/end (`^\`\`\`(?:json)?`and`\`\`\`\\s\*$`). Any LLM preamble ("Here is the JSON:") or trailing prose breaks the parse; the brittle `state-invariant`throw aborts the agent without a salvage path. No test in`src/agents/refiner/refine.test.ts` covers this case. **Two caveats** carried over: v0.5.1 was DOA for the refiner (CJS dynamic-require crash, fixed in v0.5.2); D6/D7 from previous audit still open. See §4.7 D9 + §5 action 0e (new P0).
2. **Can a first-time consumer install and reach the full Jira → PR-approved cycle?** **Yes, on v0.5.2.** Walking the README: (i) `npx -p @big-emotion/ferry ferry-init` runs the wizard, sets 6 secrets via `gh secret set` (verified: `src/cli/init/init.test.ts`), generates `ferry.config.yaml`, writes 4 stubs pinned to `@v0.5.2` (`templates.ts:26,58,90,122`), and writes `ferry-jira-automation-setup.md` + `ferry-jira-automation-rules.beta.json` (`jira-bundle.ts:260,263`) using the **corrected** Jira automation JSON format (fixed in v0.5.1: `{{now.jiraDate}}` replaces invalid `{{now.format(...)}}`). (ii) Steps 1–4 in the README are mechanically reachable: audit issue + variable, two transition-ID secrets, workflow permissions toggle, four Jira automation rules. (iii) Tag-pin consistency table (§4.2) is clean for the install path — every workflow / consumer-stub / README / install-guide-test reference is `@v0.5.2` and resolves on origin. Two **doc-only** drifts remain (`docs/RELEASING.md`, `docs/adr/0002-ferry-bundles-committed.md` still cite `@v0.5.0`) — see D8. (iv) The three FR auto-transitions (FR18 / FR24 / FR28) are exercised by `src/e2e/pipeline.test.ts`. (v) `install-guide.test.ts` (71 tests) gates 18 README sections including no-`@main` self-references. **Carry-over latent trap on Step 1:** if a consumer skips audit-issue creation, the agent dispatch will throw `requireEnv('FERRY_AUDIT_ISSUE')` at runtime but `ferry-doctor` reports green (D7, P1, unchanged from previous audit).
3. **Security posture?** Strong. Strict AJV schema validation against `event.v1.schema.json`; all shell calls use `execFileSync` with argv-as-array (no shell strings); the only `spawn` (`developer/tools.ts:374`) passes argv as an array. CodeQL + `npm audit` (0 vulns, all severities) + gitleaks (configured + run before every dev-agent commit) wired in CI. Every workflow job has an explicit `permissions:` block. Third-party actions pinned by SHA in `ferry-ci.yml`, `release.yml`, and every `.github/actions/*/action.yml` (verified: `actions/checkout@de0fac2…`, `actions/setup-node@39370e3…`/`48b55a0…`, `actions/upload-artifact@ea165f8…`); the only non-SHA pins are GitHub-published or Anthropic-published actions in helper workflows (`codeql.yml`, `claude.yml`, `claude-code-review.yml`). Internal Ferry composite-action references are pinned to `@v0.5.2` — no `@main` self-references (asserted by `install-guide.test.ts §15`). `@octokit/rest` and Jira modules are forbidden under `src/agents/**` (`restricted-imports.test.ts`). The "Ferry never merges" invariant is asserted by `pipeline.test.ts:377`. Defense-in-depth gaps remain — no `harden-runner` egress allowlist, no SLSA provenance on the GitHub Release artifact (npm publish has it), no audit-issue rotation tested under load.
4. **Is the score close to 8–9/10?** Computed score is **7.2** (vs. 7.7 last audit). The 0.5 movement reflects: a confirmed prod failure on the Refiner JSON parser (Domain 7 Reliability −1.5; new D9), the runtime-smoke gap surfaced by the v0.5.1 incident (Domain 5 −0.5), the missing parser-robustness test (Domain 4 Tests −0.5), and a doc-drift item (D8, Domain 15 −0.5). All P0 install-blockers from previous audits stay closed; the prod failure is in the Refiner's brittle string-parse-after-LLM, not the install path. Top four actions to clear 8.0: (i) **harden `parseJsonOrThrow` / `stripMarkdownFences`** — extract the first balanced JSON object from the LLM output (regex `/\{[\s\S]*\}/` with bracket counting) instead of demanding the entire response be a fenced or unfenced JSON document; add a regression test with prose preamble + trailing prose + nested code fences (P0, new — closes ethniafrica run 25262368292); (ii) **populate `src/cli/update/migrations.ts`** for v0.3.x → v0.4.0 (P0, carry-over); (iii) **add a bundle-runtime-smoke job** that would have caught v0.5.1 (P1, new); (iv) **add `FERRY_AUDIT_ISSUE` variable check to `ferry-doctor`** (P1, carry-over).

---

## 2. Overall score — **7.2 / 10**

Movement since the previous audit (7.7): the **confirmed prod failure on `big-emotion/ethniafrica`** (refine job, run 25262368292, v0.5.2) is the dominant signal — Refiner JSON parser is too brittle to survive normal LLM output variability. Domain 7 (Reliability) takes a −1.5 hit (D9, new); Domain 4 (Tests) −0.5 for the missing regression test on `parseJsonOrThrow`; Domain 5 −0.5 for the runtime-smoke gap exposed by v0.5.1; Domain 15 −0.5 for the new doc-drift D8. The install path itself is unchanged from the previous audit; the regression is in the agent runtime, not the scaffolding.

Quality gates at audit time (all green):

- `npm run typecheck` — clean (`@big-emotion/ferry@0.5.2`)
- `npm run lint` — clean
- `npm run format:check` — clean
- `npm test` — 86 files / **1025 tests** / 100% passing in 2.29s
- `npm audit` (moderate+) — 0 vulnerabilities (332 deps total)
- TODO/FIXME/XXX/HACK count under `src/` — 1
- Recent CI: Release ✓, CodeQL ✓, Ferry — CI ✓ (last 5 runs all `success`)

Release artifacts proven:

- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.5.1`, **`v0.5.2`**, **`v1`** (floating major, retag-major.sh advanced to v0.5.2)
- `@big-emotion/ferry@0.5.2` published to npm with provenance (`b95526c`)
- GitHub Release v0.5.2 created with notes from `CHANGELOG.md`
- Three release pipelines (v0.5.0 / v0.5.1 / v0.5.2) ran clean end-to-end as workflows; v0.5.1's **artefact** was broken at runtime (refiner CJS dynamic-require crash)

---

## 3. Score per domain

| #   | Domain                             | Score        | Δ vs. prev | Trend  |
| --- | ---------------------------------- | ------------ | ---------- | ------ |
| 1   | Application security               | **8.5 / 10** | 0          | strong |
| 2   | Supply-chain security              | **8.5 / 10** | 0          | strong |
| 3   | GitHub Actions security            | **7.5 / 10** | 0          | strong |
| 4   | Tests & coverage                   | **7.5 / 10** | −0.5       | medium |
| 5   | E2E / acceptance tests             | **7.5 / 10** | −0.5       | medium |
| 6   | CI/CD gates                        | **9.0 / 10** | 0          | strong |
| 7   | Reliability (idempotency, retries) | **6.5 / 10** | −1.5       | medium |
| 8   | Observability / audit              | **7.0 / 10** | 0          | medium |
| 9   | Consumer documentation             | **7.0 / 10** | 0          | medium |
| 10  | Code quality / typing              | **8.5 / 10** | 0          | strong |
| 11  | Traceability / FR governance       | **7.5 / 10** | 0          | strong |
| 12  | Operations / runbooks / rollback   | **5.5 / 10** | 0          | medium |
| 13  | Release / distribution             | **9.0 / 10** | 0          | strong |
| 14  | Cost governance (runtime)          | **7.0 / 10** | 0          | medium |
| 15  | Doc–code coherence                 | **6.0 / 10** | −0.5       | medium |

Mean = **7.20 / 10** (15 axes; Domain 7 −1.5 for the Refiner parser prod failure D9, Domain 4 −0.5 for the missing regression test, Domain 5 −0.5 for the runtime-smoke gap exposed by v0.5.1, Domain 15 −0.5 for new drift D8) → reported as **7.2**.

> Why is Release / distribution (Domain 13) **not** docked despite v0.5.1 shipping a broken refiner? The release pipeline did exactly what it was designed to do — full CI gate ✓, npm publish ✓, GitHub Release ✓, retag-major.sh ✓ on all four pushes (v0.4.0, v0.5.0, v0.5.1, v0.5.2). The v0.5.1 failure was a **test-coverage gap** (no integration test executes the bundled `.ferry/<role>/index.cjs`), not a release-pipeline gap. The recovery — root-cause identified, banner injected, v0.5.2 cut and shipped within ~48 h — actually demonstrates the pipeline is durable. Score the gap where the gap lives (Domain 5).
>
> Why is Application security (Domain 1) **not** docked for D9 (Refiner parser failure)? D9 is a robustness/reliability bug, not a security bug. The brittle parser fails closed (throws `state-invariant`) — there is no path-traversal, no code-execution, no secret leak. The agent aborts cleanly. It is unambiguously a Domain 7 issue.

---

## 4. Domain analysis

### 4.1 Application security — 8.5 (unchanged)

**Strengths**

- Strict AJV schema validation against `src/schemas/event.v1.schema.json`; `ticket_key` regex `^[A-Z][A-Z0-9_]+-\d+$` makes shell injection through ticket-derived strings impossible by construction.
- All shell calls use `execFileSync` with argv-as-array. The single `spawn` (`src/agents/developer/tools.ts:374`) also passes args as an array.
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

**Strengths — tag-pin consistency table is clean for the install path** (only doc-only drift remains, see D8):

| Location                                                                         | Pin                                                                      | Status         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------- |
| `package.json` `.version`                                                        | `0.5.2`                                                                  | canonical      |
| `.github/workflows/{refine,dev,review,iterate}.yml`                              | `@v0.5.2`                                                                | match          |
| `.github/actions/*/action.yml` setup-node SHAs                                   | SHA (`39370e3970…`)                                                      | pinned         |
| `examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`        | `@v0.5.2`                                                                | match          |
| `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml` `FERRY_REF` | `v0.5.2`                                                                 | match          |
| `README.md` SHA-pinning recipe + ops curl URLs                                   | `@v0.5.2` / `/v0.5.2/`                                                   | match          |
| `src/install-guide.test.ts`                                                      | `@v0.5.2`                                                                | match          |
| `docs/RELEASING.md`                                                              | `@v0.5.0` (lines 26, 30, 46, 49–50, 157)                                 | **drift (D8)** |
| `docs/adr/0002-ferry-bundles-committed.md`                                       | `@v0.5.0` (lines 16, 34, 35)                                             | **drift (D8)** |
| `git ls-remote --tags origin`                                                    | `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.5.1`, **`v0.5.2`**, **`v1`** | exist          |
| `npm @big-emotion/ferry`                                                         | `0.5.2`                                                                  | published      |

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
| Suite   | 86 files / **1025 tests** / all passing in 2.29s |
| Reports | text, text-summary, html, lcov                   |
| Gate    | **75 / 75 / 75 / 75** in `vitest.config.ts`      |

**Strengths**

- Test count steady (1025 tests at v0.5.2; +5 vs. previous audit, all in `src/cli/update/`).
- Coverage threshold uniform at 75% across statements/branches/functions/lines.
- CLI module coverage closed: every check in `cli/doctor/checks/*` has a sibling `.test.ts`.
- Composite-action entrypoints (`*-action.ts`) and CLI bin entrypoints excluded from coverage with documented reason.

**Weaknesses**

- `agents/developer/loop.ts` and `workspace.ts` still rely largely on the e2e harness rather than dedicated unit tests.
- No mutation testing (Stryker).
- No load/perf budget.

### 4.5 E2E / acceptance tests — 7.5 (−0.5)

The v0.5.1 incident exposed a real gap: `e2e/pipeline.test.ts` runs against TypeScript source via `tsx`, never against the bundled `.ferry/<role>/index.cjs` that GitHub Actions actually executes. The bundle is checked for drift (it matches source byte-for-byte) but never **booted**. Bundling-induced runtime failures (CJS dynamic-require shims, banner regressions, missing externals) are invisible to CI today.

**Strengths**

- **Mocked end-to-end pipeline test** at `src/e2e/pipeline.test.ts` replays refine→dev→review→iterate, asserts the no-auto-merge invariant (line 377), and exercises FR18/FR24/FR28.
- **Install-guide acceptance test** at `src/install-guide.test.ts` (71 tests) covers 18 sections of the README — secret names, reusable-workflow refs, `@v0.5.2` pin, FR mentions, `event_id` schema match, audit-issue creation, smoke-test wording, no `@main` in internal workflows (issue #77 gate), ops stubs, bundle-drift CI gate, npm audit step.
- FR drift detector (`scripts/check-fr-drift.sh`) wired into CI lint job.
- The release pipeline itself (`release.yml`) is now empirically validated end-to-end by four real tag pushes (v0.4.0, v0.5.0, v0.5.1, v0.5.2 — all four pipelines green).

**Weaknesses**

- **No bundle-runtime smoke gate** — the `check-bundle` job in `ferry-ci.yml:92` rebuilds `.ferry/` and diffs, but never imports or executes the bundled `index.cjs`. v0.5.1's `Dynamic require of "child_process" is not supported` would have surfaced on the first `node .ferry/refiner/index.cjs --selftest` (or equivalent). New P1 in §5 (action 0c).
- No idempotency assertion across a full replay of the same `event_id` against the same audit issue.
- **Install-guide test does not cover what `ferry-init` actually scaffolds.** It validates `examples/consumer-setup/workflows/*.yml` but never invokes `workflowTemplates()` from `src/cli/init/templates.ts`. Carry-over from previous audit (P1).

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

### 4.7 Reliability — 6.5 (−1.5)

The previous audit scored this 8.0 because the _machinery_ (idempotency markers, retry-with-backoff, spend-cap classification, FerryError taxonomy, per-ticket concurrency mutex) is genuinely well-built. The drop reflects a single new finding (D9) where the machinery is bypassed by a brittle direct-`JSON.parse` on LLM output — the Refiner is the first agent in the pipeline and currently the weakest link.

**Strengths (carry-over)**

- Idempotency markers `[ferry:role:runId]` on every external write.
- Centralised `retry` helper with backoff (`src/lib/io/retry.ts`).
- Spend-cap detection: 4xx classified transient/non-transient.
- `FerryError` taxonomy enables differentiated handling.
- Concurrency mutex per ticket via GitHub Actions.
- Developer/Reviewer/Iterator agents use the structured tool-use loop (`src/lib/llm/agent-loop/anthropic.ts`) so their LLM-output handling is type-safe.

**Weaknesses**

- **D9 (NEW, P0): Refiner JSON parser is too brittle to survive normal LLM output variability.** `src/agents/refiner/refine.ts:101–106` does `JSON.parse(stripMarkdownFences(text))`; `stripMarkdownFences` (`refine.ts:94–99`) only matches ` ``` ` anchored at start (`/^```(?:json)?\s*\n?/`) and end (`/\n?```\s*$/`). Any LLM preamble or trailing prose breaks the parse, throws `[ferry:state-invariant] {"reason":"refiner-output-invalid"}`, and aborts the agent without retry. **Reproduced in production** on `big-emotion/ethniafrica` run 25262368292 (refine job, 2026-05-02 21:31:58Z, `ferry-run-refiner@v0.5.2`, exit 1). No regression test in `src/agents/refiner/refine.test.ts` covers preamble or trailing prose. Unlike the Developer/Reviewer/Iterator agents (which use Anthropic tool-use for structured output), the Refiner uses freeform text + post-hoc JSON extraction, which is the weakest pattern of the four. **Fix shape:** extract the first balanced `{...}` substring with bracket counting (or use Anthropic structured output / OpenAI JSON mode / Google response_mime_type when available) and add at least three regression tests: (a) prose preamble, (b) trailing prose, (c) JSON without fences.
- No circuit breaker (LLM provider down → retries to ceiling).
- Audit pagination capped at 1000 with no rotation/archival.
- Reconciler depends on the consumer wiring `ferry-reconcile.yml` from the working stub.
- `correlation_id: ""` on the failing log line in run 25262368292 confirms the Domain 8 weakness ("Some emitters still pass `correlation_id: ""`") propagates into prod telemetry — debugging this incident is harder than it should be because the run_id never made it into the structured log.

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

- `ferry-init` emits exactly 4 working stubs; all pin to `@v0.5.2`; all reusable workflows referenced exist on origin.
- The `ANTHROPIC_API_KEY` secret naming is consistent across README, reusable workflows, `ferry-init`, `ferry-doctor`, and `ferry-uninstall`.
- `ferry-doctor` now checks for `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID` (8 required secrets total), so a partial install is flagged rather than silently broken.
- README's "Operations setup" curls `ferry-reconcile.yml` and `ferry-cost-daily.yml` from `/v0.5.2/` (immutable tag, not mutable `main`).
- `MIGRATIONS.md` `v0.3.x → v0.4.0` section documents the two `(action)` items existing installs must apply (rename `FERRY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY`; delete stale `ferry-{reconciler,audit-daily}.yml`). **Note:** these entries exist in the markdown file but are **not** wired into `ferry-update` — see §4.15 D6.
- `docs/CONFIGURATION.md` is internally consistent with the reusable workflows.
- `docs/REQUIREMENTS.md` FR registry intact; CI drift detector enforces consistency.
- `docs/adr/` (5 ADRs, README index) present.
- `docs/RELEASING.md` documents the dual-tag scheme correctly, but its concrete `@v0.5.0` examples are stale (D8 — needs sed bump to `@v0.5.2`).
- `CHANGELOG.md [0.5.2]` is the source of truth for the GitHub Release notes (auto-extracted by `release.yml`); `[0.5.1]` and `[0.5.0]` entries also present and accurate.

**Weaknesses**

- **`ferry-update` does not actually print MIGRATIONS.md follow-ups** — the in-code `MIGRATIONS` object is empty (`src/cli/update/migrations.ts:8–14`, only commented-out example), but the README, `MIGRATIONS.md` itself, and `CLAUDE.md` all promise consumers it will. Result: a v0.3.x consumer running `npx -p @big-emotion/ferry@0.5.2 ferry-update` silently misses the critical `FERRY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` rename and ends up with broken auth. **Does not affect first-time installers.** Carry-over P0 from previous audit.
- **`ferry-doctor` does not check the `FERRY_AUDIT_ISSUE` repo variable** — every agent run requires it (`src/lib/audit/emit-audit-action.ts:12`, `requireEnv('FERRY_AUDIT_ISSUE')`), the README dedicates Step 1 to setting it, but `src/cli/doctor/index.ts:139–172` runs 12 checks that never read it. A consumer who skips Step 1 gets a green doctor + a runtime crash on first dispatch. P1.
- README still asks the user to manually `curl` the ops stubs — could be scaffolded by `ferry-init` instead (P2).
- README example warning at line 268 may still reference older versions (cosmetic — verify against `v0.5.x` series).
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

- Reconciler stub `ferry-reconcile.yml` and cost-daily stub `ferry-cost-daily.yml` ship in `examples/consumer-setup/workflows/`, pinned to `v0.5.2` via `FERRY_REF` env (verified at `examples/consumer-setup/workflows/ferry-{reconcile,cost-daily}.yml:24`).
- `ferry-uninstall` CLI present (#129) — first reversible-deploy path.
- `ferry-update` CLI present (#134) — first migration path; reads `MIGRATIONS.md` and prints required actions.

**Weaknesses (unchanged from previous audit)**

- No rollback plan documented in a runbook.
- No on-call runbook (`docs/RUNBOOK.md` not yet created) — **the highest-leverage P1**.
- No proactive monitoring — audit issue pings nobody.

### 4.13 Release / distribution — 9.0 (unchanged)

Release pipeline empirically proven on **four** tag pushes (v0.4.0, v0.5.0, v0.5.1, v0.5.2). The v0.5.1 incident is a Domain-5 issue, not a Domain-13 one: the pipeline never failed; the artefact it shipped was broken because no smoke test executed the bundle.

**Strengths**

- `release.yml` runs full quality gate, publishes `@big-emotion/ferry` to npm with `--provenance`, creates a GitHub Release with notes from `CHANGELOG.md`, and force-pushes the floating `v1` tag via `scripts/retag-major.sh`. **All 11 steps green on all four pushes.**
- Tags on origin: `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.5.1`, **`v0.5.2`**, **`v1`** (floating, advanced to v0.5.2).
- npm: `@big-emotion/ferry@0.5.2` published with provenance.
- `package.json`: `"version": "0.5.2"`, `"publishConfig": { "access": "public" }`.
- `CHANGELOG.md` and `MIGRATIONS.md` present and feed the release pipeline; both have v0.5.1 and v0.5.2 entries with the right detail.
- Four CLIs (`ferry-init`, `ferry-doctor`, `ferry-uninstall`, `ferry-update`) shipped under the `bin` field.
- `check:bundle` CI job ensures `.ferry/` matches `src/` so a tag carries a consistent payload.
- Recovery proven: v0.5.1 → root-cause analysis → `createRequire` banner injected (`scripts/build-ferry-actions.mjs`) → v0.5.2 cut and shipped within ~48 h.

**Weaknesses**

- **v0.5.1 is a known-bad release; consumers must skip it.** `MIGRATIONS.md v0.5.1 → v0.5.2` calls this out and notes that `ferry-update` re-pins automatically. Anyone who ran `ferry-init` against `@v0.5.1` (rather than the floating `@v1` or the latest published version) is now stranded on a refiner that crashes on first dispatch. Mitigation works for upgrades, but a pre-publish bundle smoke would have prevented v0.5.1 entirely.
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

### 4.15 Doc–code coherence — 6.0 (−0.5)

A targeted sweep of every concrete claim in `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/CONFIGURATION.md`, `docs/RELEASING.md`, `docs/REQUIREMENTS.md`, `docs/adr/0001…0005`, `MIGRATIONS.md`, `CHANGELOG.md` against the actual filesystem and `git grep` of `src/`, `.github/`, `examples/`, `prompts/`, `scripts/`. Method: walk every file path, command, env var, secret, label, FR id, workflow name, composite-action name, default value and version pin in the docs and verify it exists in code; then reverse-walk the code surface (`bin` entries, `FERRY_*` env vars, agent file structure, husky hooks) to find anything user-visible that no doc covers.

**Verified coherent (high-signal claims that pass)**

- All 8 README-listed install secrets (`FERRY_APP_ID`, `FERRY_PRIVATE_KEY`, `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`, `ANTHROPIC_API_KEY`, `FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`) are referenced by `examples/consumer-setup/workflows/*.yml`, `src/cli/init/steps/secrets.ts`, and `src/cli/doctor/checks/secrets.ts`.
- All 16 FRs in `docs/REQUIREMENTS.md` (FR1, FR6, FR10, FR12, FR15, FR16, FR18, FR24, FR28, FR29, FR45, FR46, FR50, FR51, FR55, FR60) appear at the file paths the registry claims; `scripts/check-fr-drift.sh` confirms every `FR\d+` in `src/`/`prompts/`/`docs/` is registered.
- Every file path cited in ADRs 0001–0005 exists (12/12): `dev-action.ts`, `iterate-action.ts`, `transition.ts`, `agent-loop/anthropic.ts`, `llm/anthropic.ts`, `llm/call.ts`, `llm/call.test.ts`, `lib/agent-runtime/idempotency.ts`, `refiner/idempotency.ts`, `developer/sandbox.ts`, `developer/sandbox.test.ts`, `reviewer/review-action.ts`.
- Default LLM models in `docs/CONFIGURATION.md` match `src/lib/config.ts:80–91` (refiner / review / iterate = `claude-sonnet-4-6`, dev = `claude-opus-4-5`).
- Default Jira columns documented in the README (`Refinement` / `In Development` / `In Review` / `Changes Requested` / `Ready to Merge`) match `src/cli/init/index.ts:145–154` and `src/cli/init/steps/jira-bundle.ts:67–70`.
- `prompts/<agent>.extra.md` mechanism exists (`src/lib/prompts/resolve.ts:63`); `ferry-doctor` warns on full-prompt overrides as the README claims (`src/cli/doctor/checks/prompts.ts:38`).
- `ferry-init`-generated artefacts (`ferry-jira-automation-setup.md`, `ferry-jira-automation-rules.beta.json`) are written by `src/cli/init/steps/jira-bundle.ts:260,263`.
- Tag-pin consistency table (§4.2) — every install-path reference (`@v0.5.2`) matches `package.json` `.version`; `git tag` lists `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.5.1`, `v0.5.2` and the floating `v1`. Two doc-only references still cite `@v0.5.0` — see D8.
- README's draft-PR claim (PR opens as draft, flips to ready on approval) is real: `src/lib/dispatch/runner/github-actions/index.ts:139` (`draft: true`) + `:161` (`markPullRequestReadyForReview` mutation).
- README's `AGENT_MCP_SERVERS` documentation (`url`, `authorization_token`, `allowed_tools`, `denied_tools`) is wired in `src/lib/agent-runtime/`.
- `CHANGELOG.md` claim that `release.yml` invokes `scripts/retag-major.sh` is real (`.github/workflows/release.yml:106`).

**Confirmed drift (8 items — D1–D7 carry from previous audit; D6 and D7 still open at v0.5.2; D8 is new in this revision)**

| #   | Drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Severity |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D1  | **`CLAUDE.md` "Two consumer-facing CLIs … `ferry-init` and `ferry-doctor`"** — `package.json` `bin` exposes **four** (`ferry-init`, `ferry-doctor`, `ferry-uninstall`, `ferry-update`). The CLAUDE.md "CLI Entrypoints" section pre-dates v0.4.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | low      |
| D2  | **`CONTRIBUTING.md:42` claims `pre-push` runs `… && check:bundle`** — actual `.husky/pre-push` runs `typecheck && lint && format:check && test` only, no `check:bundle`. CI still enforces bundle drift, so consumers are not affected — but the contributor-facing promise is wrong.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | medium   |
| D3  | **`CONTRIBUTING.md:43` claims a `commit-msg` hook enforces `(FRn)` references** — `.husky/` contains only `pre-commit` and `pre-push`; `.husky/commit-msg` does not exist. The FR drift detector (`check-fr-drift.sh`) provides repo-wide enforcement, but the per-commit hook described in CONTRIBUTING.md is not installed by `husky install`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | medium   |
| D4  | **`docs/RELEASING.md:154` "CLIs are exposed under their original bin names — `ferry-init` and `ferry-doctor`"** — outdated since v0.4.0 (which the same audit doc on §4.13 already lists as four CLIs). Same root cause as D1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | low      |
| D5  | **`src/cli/init/templates.ts` advertises four phantom "Optional variables" in the `ferry-dev.yml` stub header** — `FERRY_DEV_MAX_ITERATIONS`, `FERRY_DEV_MAX_INPUT_TOKENS`, `FERRY_ANTHROPIC_BASE_URL`, `FERRY_PROMPTS_DIR`. Investigation: `FERRY_ANTHROPIC_BASE_URL` is **not read anywhere** in `src/`; the other three are read at runtime (`config.ts:531–538`, `agent-loop/anthropic.ts:117–120`, `prompts/resolve.ts`) but **none are piped through `.github/actions/ferry-run-developer/action.yml`**. A consumer setting any of them as a repo variable per the stub header gets a silent no-op. (`FERRY_ITER_MAX_INPUT_TOKENS` IS functional — the iter composite action aliases it to `FERRY_DEV_MAX_INPUT_TOKENS` internally.)                                                                                                                           | medium   |
| D6  | **`ferry-update` does not consume `MIGRATIONS.md`** — `src/cli/update/migrations.ts:8–14` defines an in-code `MIGRATIONS: Record<string, MigrationNote[]> = {}` with only a commented-out example. `getRelevantMigrations()` returns `[]` for **every** version pair. Yet `MIGRATIONS.md:4` says "ferry-update reads the relevant section(s) and prints them as **Manual follow-ups required** after upgrading", README line 272 directs users to `MIGRATIONS.md`, and `CLAUDE.md` says ferry-update "reads `MIGRATIONS.md` and prints required follow-ups". Result: any consumer upgrading from `v0.3.x` runs `ferry-update`, sees pins re-rendered, and silently misses the critical `(action)` to rename `FERRY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` — landing them in broken-auth territory on the next dispatch. **Does not affect first-time installers.** | **P0**   |
| D7  | **`ferry-doctor` does not check the `FERRY_AUDIT_ISSUE` repo variable** — README Step 1 dedicates an entire section to creating the audit issue and running `gh variable set FERRY_AUDIT_ISSUE`. Every agent run reads it via `requireEnv('FERRY_AUDIT_ISSUE')` (`src/lib/audit/emit-audit-action.ts:12`). Doctor runs 12 checks (`src/cli/doctor/index.ts:139–172`); none check this variable. A first-time installer who skips Step 1 sees a green `ferry-doctor` and a runtime crash on the first Jira column move. The smoke-test step then surfaces the issue — but the doctor is the canonical pre-smoke-test gate and should catch it. **Still open at v0.5.2.**                                                                                                                                                                                              | **P1**   |
| D8  | **`docs/RELEASING.md` and `docs/adr/0002-ferry-bundles-committed.md` reference `@v0.5.0`** while every other consumer-facing surface moved to `@v0.5.2` across two releases. `RELEASING.md:26,30,46,49–50,157` and `adr/0002:16,34,35` still cite `@v0.5.0` as the recommended pin and as the example URL in the SHA-pinning recipe. Doc-only — the install path is unaffected (workflows, README, install-guide test, examples/consumer-setup all moved cleanly to `@v0.5.2`) — but a contributor reading `RELEASING.md` sees stale guidance. Root cause: neither file has an automated drift gate; `install-guide.test.ts` covers README + examples, not these. Add either a generic `@v[0-9.]+` consistency check to the install-guide test or a `sed` step to the release pipeline.                                                                              | low      |

**Reverse-coverage gaps (code surfaces with no doc mention)**

- The four cost-governance / dev-internal env vars `FERRY_ACTIVE_COLUMNS`, `FERRY_BUNDLED_PROMPTS_DIR`, `FERRY_DRY_RUN`, `FERRY_LLM_CONFIG` are pass-through internals between workflow → composite-action → src; intentionally undocumented but no comment in `docs/CONFIGURATION.md` declares "what is internal vs consumer-tunable" beyond the existing "What is hardcoded" table. A one-line note pointing readers at the `Optional variables` block in the generated stubs would close the loop.
- Minor: ADR 0002 says action source files follow `<agent>-action.ts`; actual convention is `<phase>-action.ts` (`dev-action`, `refiner-action`, `review-action`, `iterate-action`). Doc reads slightly off; code is consistent.

**Net coherence assessment**

D1–D5 are _stale_ text outpaced by a release. D6 and D7 are different in kind: a docs-promised feature that **never matched code** (D6 — ferry-update was always silent on migrations, despite three docs claiming otherwise) and a doctor-coverage hole that a consumer can fall through (D7). D8 is new in this revision — the v0.5.0 → v0.5.2 patch arc moved every install-path reference but missed two contributor-facing docs. For a **first-time installer at v0.5.2**, only D5 and D7 matter, and both are containable: D5's phantom variables are silent no-ops, not failures; D7 surfaces at smoke-test time so a careful operator catches it. For an **upgrading consumer**, D6 is the single biggest user-visible breakage in the v0.3.x → v0.5.2 path; D8 only affects contributors reading `RELEASING.md`. **Score: 6.0 / 10** — D6 (P0, carry-over) and D7 (P1, carry-over) are still open at v0.5.2; D8 ticks the score down a further 0.5 because the v0.5.0 → v0.5.2 patch arc had two opportunities to catch it and didn't.

---

## 5. Prioritized action plan (residual)

The list, ordered by what closes the score gap fastest:

| Order | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Domain        | Score before | Priority                                                                                                                                                                                                                                                                                                             | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --- | ------ | --- |
| 0     | **(D9 — P0, NEW)** Harden `src/agents/refiner/refine.ts` JSON extraction. Replace `parseJsonOrThrow` with a routine that either (a) extracts the first balanced `{...}` substring with bracket counting, or (b) switches the Refiner to Anthropic structured output / OpenAI JSON mode / Google `response_mime_type`. Add regression tests covering prose preamble, trailing prose, and unfenced JSON. **Repro:** ethniafrica run 25262368292 fails with `refiner-output-invalid` on v0.5.2; the bug exists in every Ferry version that has shipped the freeform-text refiner. Without this fix, the first agent in the pipeline cannot reliably complete on tickets where the LLM emits any preamble. | Reliability   | 6.5          | **P0**                                                                                                                                                                                                                                                                                                               | S      |
| 0a    | **(D6 — P0, carry-over)** Populate `src/cli/update/migrations.ts` with the `v0.3.x → v0.4.0` entries from `MIGRATIONS.md` (or rewrite `getRelevantMigrations()` to parse `MIGRATIONS.md` directly). Add a regression test that asserts a v0.3.x → v0.5.2 upgrade returns the `FERRY_ANTHROPIC_API_KEY` rename note. Without this, every v0.3.x consumer upgrading via `ferry-update` lands in broken auth.                                                                                                                                                                                                                                                                                             | Coherence     | 6.0          | **P0**                                                                                                                                                                                                                                                                                                               | S      |
| 0b    | **(D7 — P1, carry-over)** Add a `checkAuditIssue()` to `src/cli/doctor/checks/` that reads `FERRY_AUDIT_ISSUE` via `gh variable list` and verifies the referenced GitHub Issue exists and is open. Wire it into `src/cli/doctor/index.ts`. Without this, a first-time installer who skips README Step 1 gets a green doctor and a runtime crash.                                                                                                                                                                                                                                                                                                                                                       | Coherence     | 6.0          | **P1**                                                                                                                                                                                                                                                                                                               | S      |
| 0c    | **(NEW — P1)** Add a bundle-runtime smoke job to `release.yml` (and ideally `ferry-ci.yml`) that, for each role in `refiner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | developer     | reviewer     | iterator`, runs `node .ferry/<role>/index.cjs`with`FERRY_DRY_RUN=1`and a fixture envelope and asserts exit-code 0 and no`Dynamic require`/`Cannot find module`strings on stderr. This would have caught v0.5.1's CJS-bundling failure before publish. Effort is small; the fixture is already in`src/**fixtures**/`. | E2E    | 7.5 | **P1** | S   |
| 0d    | **(D8 — low)** Update `docs/RELEASING.md` and `docs/adr/0002-ferry-bundles-committed.md` `@v0.5.0` references to `@v0.5.2`. Add a regex assertion to `src/install-guide.test.ts` (or a new `tag-pin-drift.test.ts`) that scans `docs/RELEASING.md` and `docs/adr/*.md` for `@v[0-9.]+` literals and fails if any disagrees with `package.json` `.version`.                                                                                                                                                                                                                                                                                                                                             | Coherence     | 6.0          | low                                                                                                                                                                                                                                                                                                                  | XS     |
| 1     | On-call runbook (`docs/RUNBOOK.md`): stalled ticket, cost spike, agent-loop runaway, rollback procedure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Operations    | 5.5          | **P1**                                                                                                                                                                                                                                                                                                               | M      |
| 2     | Audit-issue rotation when comments approach the 1000-comment cap (instead of failing silently)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Reliability   | 8.0          | **P1**                                                                                                                                                                                                                                                                                                               | M      |
| 3     | Add `harden-runner` egress allowlist to dev/iterate workflows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | GH Actions    | 7.5          | **P1**                                                                                                                                                                                                                                                                                                               | S      |
| 4     | Extend `src/install-guide.test.ts` to invoke `workflowTemplates()` and assert each emitted stub's reusable-workflow + tag exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | E2E           | 8.0          | **P1**                                                                                                                                                                                                                                                                                                               | S      |
| 5     | Add e2e idempotency replay (same `event_id` twice → same outcome, no duplicate writes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | E2E           | 8.0          | **P1**                                                                                                                                                                                                                                                                                                               | M      |
| 6     | `ferry-init` scaffolds `ferry-reconcile.yml` and `ferry-cost-daily.yml` directly (drop the README curl step)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Consumer docs | 8.5          | **P2**                                                                                                                                                                                                                                                                                                               | S      |
| 7     | `ferry-init` collects the two transition IDs and sets them as secrets (currently a manual README step)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Consumer docs | 8.5          | **P2**                                                                                                                                                                                                                                                                                                               | S      |
| 8     | OSSF Scorecard + SLSA provenance on the GitHub Release artifact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Supply chain  | 8.5          | **P2**                                                                                                                                                                                                                                                                                                               | M      |
| 9     | Migrate `GITHUB_TOKEN` to a fine-grained GitHub App (or remove the App provisioning from `ferry-init`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | GH Actions    | 7.5          | **P2**                                                                                                                                                                                                                                                                                                               | L      |
| 10    | Branch-protection on `main` requiring CodeQL / Ferry — CI / Release checks before merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | CI/CD         | 9.0          | **P2**                                                                                                                                                                                                                                                                                                               | XS     |
| 11    | **Done.** D1–D5 fixed (CLAUDE.md + RELEASING.md CLI lists; CONTRIBUTING.md hook claims; phantom optional-vars removed from `templates.ts:41–44`). Carry-over: optionally remove the runtime fallbacks in `src/lib/config.ts:531–538` and `src/lib/llm/agent-loop/anthropic.ts:117–120` for `FERRY_DEV_MAX_*`, plus the `FERRY_PROMPTS_DIR` override in `src/lib/prompts/resolve.ts` (5 tests rely on the env injection). Defer to a deliberate refactor PR — touches the agent-loop signature contract.                                                                                                                                                                                                | Documentation | 8.0          | **P2**                                                                                                                                                                                                                                                                                                               | S      |

### 5.1 Expected score after the plan

| Domain                  | Current | After P0+P1 | After P0+P1+P2 |
| ----------------------- | ------- | ----------- | -------------- |
| Application security    | 8.5     | 8.5         | 9.0            |
| Supply-chain security   | 8.5     | 8.5         | 9.0            |
| GitHub Actions security | 7.5     | 8.5         | 9.0            |
| Tests & coverage        | 7.5     | 8.5         | 8.5            |
| E2E / acceptance        | 7.5     | 8.5         | 9.0            |
| CI/CD gates             | 9.0     | 9.0         | 9.5            |
| Reliability             | 6.5     | 8.5         | 8.5            |
| Observability           | 7.0     | 7.5         | 7.5            |
| Consumer documentation  | 7.0     | 8.5         | 9.0            |
| Code quality            | 8.5     | 8.5         | 8.5            |
| Traceability            | 7.5     | 7.5         | 7.5            |
| Operations              | 5.5     | 7.5         | 7.5            |
| Release / distribution  | 9.0     | 9.0         | 9.5            |
| Cost governance         | 7.0     | 7.0         | 8.0            |
| Doc–code coherence      | 6.0     | 8.5         | 9.0            |
| **Overall**             | **7.2** | **8.30**    | **8.60**       |

P0+P1 alone is sufficient to clear the 8.0 / 10 bar. The single highest-leverage item is **0 (D9 — harden the Refiner JSON parser)**: it raises Reliability from 6.5 → 8.5 (+2.0 on a single domain), and is the only finding in this audit with a confirmed prod-failure repro. **Until 0 lands, treat v0.5.2 as a beta on real Jira tickets** — the install path is fine, but the first agent has a concrete failure mode in the wild.

---

## 6. What changed since the previous audit (7.7 → 7.2)

| #   | Change since v0.5.0 audit                                                                                                                                                                                                                                                                    | Effect                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **v0.5.1 release shipped** (`e8d3414`) — fixed Jira automation custom-body JSON format (`{{now.format(...)}}` → `{{now.jiraDate}}`); removed unresolvable `actor` field; added `version` and `event_id` fields                                                                               | Net positive for the install path; **but** v0.5.1 ALSO introduced `@google/genai` for refiner per-phase provider selection, which silently broke the bundle (next row) |
| 2   | **v0.5.1 refiner action shipped DOA** — `@google/genai` pulls `google-auth-library`, which uses CJS dynamic-require; esbuild ESM-bundled it into a throwing shim. Every refiner dispatch crashed with `Dynamic require of "child_process" is not supported`                                  | Surfaced the runtime-smoke-gap in CI (Domain 5 −0.5); informs new P1 action 0c                                                                                         |
| 3   | **v0.5.2 release shipped** (`b95526c`, `b254038`) — `scripts/build-ferry-actions.mjs` now injects a `createRequire` banner so transitive CJS deps resolve dynamic requires through Node's real `require`                                                                                     | Restores refiner functionality; v0.5.2 is the recommended pin                                                                                                          |
| 4   | **`954bd5b`** — `ferry-update` now auto-regenerates `ferry-jira-automation-setup.md` when the consumer has it, picking up the v0.5.1 JSON-format fix without manual re-run                                                                                                                   | Closes a coherence gap for upgrading consumers (jira-bundle changes propagate via `ferry-update`); D6 (the `MIGRATIONS.md` follow-ups path) remains open               |
| 5   | **+5 unit tests** (1020 → **1025**) since the v0.5.0 audit                                                                                                                                                                                                                                   | Coverage stable; bulk of the new tests are in `src/cli/update/`                                                                                                        |
| 6   | **D8 surfaced** — `docs/RELEASING.md` and `docs/adr/0002-ferry-bundles-committed.md` still cite `@v0.5.0` after two patch releases moved everything else to `@v0.5.2`                                                                                                                        | −0.5 on Domain 15 (Doc–code coherence)                                                                                                                                 |
| 7   | **D9 surfaced (PROD REPRO)** — `big-emotion/ethniafrica` run 25262368292 (`@v0.5.2`, 2026-05-02 21:31:58Z) failed with `[ferry:state-invariant] refiner-output-invalid` from `src/agents/refiner/refine.ts:105`. Brittle `JSON.parse(stripMarkdownFences(text))` cannot survive LLM preamble | −1.5 on Domain 7 (Reliability), −0.5 on Domain 4 (no regression test); dominant signal in this audit                                                                   |
| —   | **D6 / D7 carry over** — `ferry-update` still silent on migrations; `ferry-doctor` still blind to `FERRY_AUDIT_ISSUE`                                                                                                                                                                        | No score movement; both items remain in the residual action plan (§5 0a, 0b)                                                                                           |

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
