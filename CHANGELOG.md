# Changelog

All notable changes to Ferry are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Ferry uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **GitLab runner adapter (experimental)** (#212, part of #210) — `FERRY_FORGE=gitlab` now resolves to a working `GitLabRunner` that implements the full `CIRunner` surface against the GitLab REST API v4 (native fetch; no SDK dependency). Vocabulary mapping: GitLab merge request ↔ pull request; `Draft:` title prefix ↔ draft PR; latest pipeline status ↔ aggregated commit status (success/skipped/manual → green; failed/canceled → red; everything else → pending). `dispatch()` triggers a downstream pipeline via the pipeline-trigger token, passing the envelope as `FERRY_ENVELOPE_PAYLOAD`. Required env vars: `FERRY_GITLAB_API_BASE` (defaults to `https://gitlab.com/api/v4`), `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`, `FERRY_GITLAB_TRIGGER_REF`. Marked **experimental** until at least one consumer has exercised the full cycle in production — see #210 for the promotion checklist.

### Changed

- **Runner factory + unified `ferry-agent` CLI** (#211, prerequisite for #210) — the runner layer is now resolved through `createRunnerFromEnv()` (`src/lib/dispatch/runner/factory.ts`), switching on a new `FERRY_FORGE` env var (default `github`; `gitlab` throws a clear "not yet implemented" error pointing at #210). The four agent composite actions (`ferry-run-{refiner,developer,reviewer,iterator}`) now invoke a single `ferry-agent run --role <role>` CLI; the per-role `.ferry/{refiner,dev,review,iterate}-action.js` bundles are replaced by a unified `.ferry/agent.js`. **No behaviour change for consumers** — the composite action interface is unchanged.

### Added

- **Configurable working branch prefix per issue type** (`git.working_branch_prefix` mapping) — `working_branch_prefix` now accepts either a plain string (existing behaviour, default `"ferry/"`) or a mapping object whose keys are Jira issue type names and whose `default` key covers unmatched types. At runtime the prefix is resolved by checking for a `ferry:type:<name>` label on the ticket first, then the ticket's Jira issue type, then `mapping.default`. This enables [Conventional Branch](https://conventional-branch.github.io/) naming out of the box — see `docs/CONFIGURATION.md` for a copy-pasteable recipe. Existing consumers are unaffected; the default remains `"ferry/"`.

### Fixed

- **Reviewer agent was ignoring `git.working_branch_prefix` config** — `review-action.ts` hardcoded the PR branch lookup as `` `ferry/${ticketKey}` `` instead of reading the resolved prefix from `ferry.config`. Consumers who overrode `working_branch_prefix` found the Reviewer unable to locate the PR. The Reviewer now resolves the prefix from the reloaded base-branch config, consistent with the Developer and Iterator agents.

- **`ferry-cost-stats` CLI** — `npx -p @big-emotion/ferry ferry-cost-stats` reads `ferry-audit.jsonl` and writes `cost-baseline.json` with per-phase median and p90 cost in USD. Flags: `--audit-log`, `--repo`, `--out`. Commit the baseline to your repo root so the Refiner can read it at runtime. See [`docs/COST.md`](docs/COST.md) for full usage.
- **Refiner cost estimation** — when `cost-baseline.json` is present, the Refiner now computes a `$lo–$hi` cost range after producing its plan, posts it as a Jira comment (`[ferry:refiner-estimate:<id>]`), and applies a `ferry:cost-estimate:<lo>-<hi>` label. Set `COST_TICKET_MAX_USD` to refuse tickets whose estimated high exceeds the cap (posts a `[ferry:refiner-cap:<id>]` comment and exits without creating subtasks). See [`docs/COST.md`](docs/COST.md) for configuration details.
- **`ferry-cost-report` CLI** — `npx -p @big-emotion/ferry ferry-cost-report` reads `ferry-audit.jsonl` and renders a spend breakdown with per-phase, per-model, per-ticket (top 20), and daily tables plus ASCII sparklines for daily spend and tokens/run trends. Supports `--from`, `--to`, `--ticket`, `--phase`, `--format` (`md`/`json`/`csv`), `--out`, and `--audit-log` flags. An anomalies section flags runs above p95 cost. See [`docs/COST.md`](docs/COST.md) for full usage.
- **`ferry-doctor` audit-log check** — a new check (#14) warns when `ferry-audit.jsonl` is missing, empty, or has fewer than 5 entries, so consumers know the file is ready before running `ferry-cost-report`.

---

## [0.10.3] — 2026-05-05

### Fixed

- **Refiner composite action wires `GITHUB_TOKEN` and `GITHUB_REPO`** — the Refiner agent calls `createGitHubContext()` which requires both env vars (used by the agent runtime to read repo metadata and resolve the configured base branch), but `ferry-run-refiner/action.yml` was the only agent action missing the `github_token` / `github_repo` inputs and the corresponding env wiring. Every Refiner run on a v0.10.x consumer therefore failed immediately with `[ferry:state-invariant] missing-env GITHUB_TOKEN` before any LLM call. The action now matches the developer / reviewer / iterator pattern. Consumers must update `ferry-refine.yml` to pass `github_token: ${{ github.token }}` and `github_repo: ${{ github.repository }}` (or re-run `ferry-init` / `ferry-update`) when bumping to `@v0.10.3`.

---

## [0.10.2] — 2026-05-05

### Fixed

- **Iterator idempotency re-keyed on PR head SHA + recovery for stuck transitions** — the Iterator's idempotency fingerprint previously keyed on the dispatch run-id alone, which let two concurrent iterations on the same PR de-duplicate against unrelated state and miss the FR28 transition back to _In Review_. Re-keying on the PR head SHA scopes the fingerprint to the actual code under iteration, and a recovery path now detects tickets stuck mid-transition and completes the move on the next reconciler sweep.
- **Refiner / Developer / Iterator composite actions accept `openai_api_key` and `google_api_key` inputs** — the multi-provider Phase 4 plumbing wired the new secrets through `ferry-run-reviewer` only; the other three composite actions still rejected the inputs with a "not declared" warning when consumers selected OpenAI or Google for those phases. All four agent composite actions now accept the same provider-key inputs.

### Changed

- **Iterator action bundle rebuilt** to match committed source after the idempotency-key fix; no behavior change beyond the fix above.

---

## [0.10.1] — 2026-05-05

### Fixed

- **Provider SDKs missing from Developer / Reviewer / Iterator action bundles** — after the multi-provider agent-loop port (#234), `dev-action.js`, `review-action.js`, and `iterate-action.js` statically import `openai` and `@google/genai` (the agent-loop modules are evaluated at import time, not lazily), but the per-action `package.json` files for `ferry-run-developer`, `ferry-run-reviewer`, and `ferry-run-iterator` only declared `@anthropic-ai/sdk`. Action runtime `npm ci` therefore omitted those packages, and every Developer / Reviewer / Iterator run on a v0.10.0 consumer crashed with `ERR_MODULE_NOT_FOUND: Cannot find package 'openai'` before reaching any provider-routing code — even when the configured provider was Anthropic. `scripts/build-ferry-actions.mjs` now ships all three provider SDKs in every agent action's `package.json`.

---

## [0.10.0] — 2026-05-05

### Added

- **Multi-provider agent loop ported to OpenAI and Google (Developer + Iterator agents)** — `src/lib/llm/agent-loop/openai.ts` and `agent-loop/google.ts` implement the full agent loop (multi-turn tool use, `commit_progress`, soft-budget warnings at 70 % / 85 %, commit-and-stop tool filter, message pruning, stdio MCP dispatch with HTTP MCP rejection) for OpenAI `chat.completions` function-calling and Google `generateContent` `functionDeclarations`. A `createAgentLoop()` factory dispatches by provider. The `provider !== 'anthropic'` guards in `dev-action.ts` and `iterate-action.ts` are removed, so the Developer and Iterator agents now run on all three providers, completing the rollout that began with the Refiner (Phase 1) and Reviewer (Phase 2). Adds 40 tests across `openai.test.ts` / `google.test.ts` (#219, #234).
- **Multi-provider consumer ergonomics — Phase 4** — the four example consumer workflows (`ferry-refine.yml`, `ferry-dev.yml`, `ferry-iterate.yml`, `ferry-review.yml`) now pass `OPENAI_API_KEY` and `GOOGLE_API_KEY` alongside `ANTHROPIC_API_KEY` and document conditional secret requirements in their headers. `ferry-init` asks which LLM provider to use per phase (default: anthropic), collects the matching API key, and emits a `models:` block in `ferry.config.yaml` only when a non-default provider is selected. `ferry-doctor` cross-checks repo secrets via the GitHub API when a local key is absent and accepts both canonical (`OPENAI_API_KEY` / `GOOGLE_API_KEY`) and legacy (`FERRY_OPENAI_KEY` / `FERRY_GOOGLE_AI_KEY`) names. Closes #220 (#233).

### Changed

- **`docs/CONFIGURATION.md` provider matrix expanded** — replaces the previous "Anthropic only (in progress)" notes with a full provider × phase matrix, documenting HTTP MCP support (Anthropic-only), prompt caching (Anthropic-only), and the cost delta for OpenAI / Google long runs.

---

## [0.9.0] — 2026-05-05

### Added

- **Multi-provider support for Reviewer agent (Phase 2)** — the Reviewer can now run on OpenAI and Google in addition to Anthropic, completing the multi-provider rollout begun with the Developer agent. Provider selection follows the same precedence as the other agents (per-agent override → global default → bundled default), and the per-agent `FERRY_REVIEWER_*` repo variables are now plumbed end-to-end through the `ferry-run-reviewer` composite action (#231).

### Fixed

- **Agent runtime number formatting pinned to `en-US` locale** — token counts, byte sizes, and other numeric values rendered in agent step summaries and structured logs are now formatted with `Intl.NumberFormat('en-US')` instead of the runner's default locale. Removes locale-sensitive separators (e.g. `1.234.567` on de_DE runners) that broke downstream parsers and made grep-driven log triage inconsistent across runners.
- **Agent loop strips `cache_control` from all blocks in the prior tool-results turn** — previously only the trailing block was sanitized, so multi-block tool-result turns left stale cache-control markers on earlier blocks, occasionally tripping `cache_control` validation errors on subsequent Anthropic calls.
- **`timeout-minutes` removed from remaining composite-action steps + validation test added** — completes the v0.8.1 fix by stripping `timeout-minutes:` from any remaining composite-action steps in the bundled actions and adding a structural test (`composite-action.test.ts`) that fails CI if a composite step ever reintroduces the unsupported key (#232, follow-up to #229).

---

## [0.8.2] — 2026-05-05

### Fixed

- **`ferry-init` templates use per-agent model inputs** — the scaffolded `ferry-refine.yml` and `ferry-dev.yml` workflows passed `ferry_model:` to the refiner and developer composite actions, but those actions expect `ferry_refiner_model:` and `ferry_dev_model:` since the v0.7.x per-agent input split (#207). GitHub Actions silently ignored the unknown input (warning only), so consumers ran with the action's default model rather than their configured one. Re-running `ferry-update` against a Ferry pin ≥ v0.8.2 rewrites the workflows with the correct input names; manual fix is a one-line rename in each of the two workflow files.

---

## [0.8.1] — 2026-05-05

### Fixed

- **`timeout-minutes` removed from composite action steps** — v0.8.0 set `timeout-minutes:` on the `Pre-agent setup` step inside all four `ferry-run-{developer,refiner,reviewer,iterator}` composite actions. GitHub Actions does not support that key on composite-action steps (only on workflow/job steps), so every consumer pinned to `@v0.8.0` failed at job setup with `Unexpected value 'timeout-minutes'` before any agent code executed. Replaced with a shell-level `timeout Nm bash -c "$CMD"` wrapper. The `pre_agent_timeout_minutes` input still caps the pre-agent step (default `'3'`); behavior is preserved for consumers whose pre-agent command completes within the cap. Consumer impact: bump from `@v0.8.0` to `@v0.8.1` to unblock all four agent workflows.

---

## [0.8.0] — 2026-05-05

### Added

- **GitHub step summary on agent termination** — every agent now writes a structured run-stats summary (token counts, top tool calls by output size, files touched, branch pushed) to `$GITHUB_STEP_SUMMARY`, surfacing per-run telemetry directly in the GitHub Actions UI without scraping logs (#224).
- **Pre/post-agent command hooks** — all four composite actions (`ferry-run-{refiner,developer,reviewer,iterator}`) accept optional `pre_agent_command` and `post_agent_command` inputs that run shell commands before and after the agent step. Enables consumers to wire setup (cache warmups, secret-injection) and teardown (artifact uploads, custom telemetry) without forking the workflow (#223).
- **Developer commits WIP and posts Jira summary on agent failure** — when the developer agent crashes mid-task, it now commits any in-progress work to a `ferry-wip/<ticket>` branch, pushes it, and posts a structured Jira comment summarizing the failure category, token usage, and the WIP branch URL. Reduces "lost work" incidents and gives operators a starting point for manual recovery (#222).
- **3-state outcome in done tool** — agents' `done` tool now reports a 3-state `outcome` (`success` | `partial` | `blocked`) instead of a binary `actionable` flag, giving downstream automation finer-grained signal for routing decisions (#221).
- **Developer auto-detects package manager** — the developer agent inspects `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` and injects the detected package manager into the system prompt, eliminating mis-`npm install` runs on pnpm/yarn/bun repos (#209).
- **Soft budget warnings at 70% / 85% of `max_tokens_per_run`** — agent loop emits warnings as it approaches the token cap, so operators see the trajectory before the cap-induced hard stop (#208).
- **B2 FERRY\_\* repo variables wired across all agent composite actions** — selective per-agent overrides (`FERRY_DEV_MAX_INPUT_TOKENS`, `FERRY_DEV_MODEL`, provider overrides, retry/cost controls) are now plumbed through the four `ferry-run-*` composite actions. Existing consumers continue to work unchanged; new inputs default to safe empty strings (#164, #207).
- **Content-aware re-trigger deduplication** for refiner & developer — Ferry now hashes the relevant inputs (ticket description for refiner; sub-task batch for developer) and skips re-runs that would produce the same output, cutting duplicate spend on Jira-side noisy column flips (#204).
- **`read_file` output capped at 64 KB** with head+tail truncation — agents that grep/read large files now see a clearly-marked truncated view instead of blowing the conversation budget on a single tool call (#200).
- **Agent-loop history pruning** — message history is now compacted (#198) and bounded by progressive tool-result compaction (d0962f2) so long-running agent runs no longer hit token-cap blow-ups from accumulated context.
- **Bundle-runtime smoke gate** (`scripts/smoke-bundle.sh`, `npm run smoke:bundle`) — boots each compiled `.ferry/<role>-action.js` under Node 20 with stub credentials and asserts stderr contains none of the v0.5.1 DOA failure signatures (`Dynamic require of`, `Cannot find module`, `is not a function`). Bridges the gap between the bundle drift check (verifies the bundle is current) and real execution (verifies the bundle actually runs). Wired into `release.yml` after bundle drift check and before `npm publish`; runs in parallel in `ferry-ci.yml`. Surfaced by the v0.5.1 incident (#162, #172).

### Changed

- **LLM SDKs externalized from action bundles** — `@anthropic-ai/sdk`, `openai`, and `@google/genai` are now declared as runtime dependencies inside `.ferry/package.json` instead of being bundled into each composite-action `.js`. Cuts bundle size, speeds up CI bundle-drift checks, and lets `npm install` resolve the SDKs once per agent runtime instead of duplicating them across four bundles (#203).

### Fixed

- **Iterator stays inside the project** — explore boundaries tightened to prevent the iterator from spelunking into framework internals (`node_modules/`, vendored code) when applying review feedback (#206).
- **`ferry.config.json` reloaded from `base_branch` on every agent run** — previously the config was cached from the dispatch event, so consumer-side config edits between runs were silently ignored (#199).
- **Bundle CI drift resolved permanently** — `npm run build:ferry` now produces deterministic output across runners; CI no longer trips on whitespace-only or ordering deltas (#205).
- **`cache_read_input_tokens` weighted at 0.1×** in the agent-loop budget cap — previously cache reads counted at full price against the per-run cap, causing premature termination on prompts with heavy cached context (#196).
- **`read_file` capped at 256 KB with bash truncation marker** — second-tier safety net that prevents catastrophic memory blow-ups on adversarial inputs (#197, issue #185).
- **Refiner JSON parser hardened against LLM prose preamble and trailing prose (D9)** — replaced the previous fence-strip-then-parse approach with a bracket-counting extractor (`src/agents/refiner/parse.ts`) that finds the first balanced `{...}` substring in the raw LLM output. Any preamble ("Here is the plan:"), trailing prose, or code-fenced wrapping is now transparent to the parser. Resolves the confirmed prod failure from run `25262368292` (`big-emotion/ethniafrica`, 2026-05-02, `ferry-run-refiner@v0.5.2`).
- **`ferry-update` now prints manual follow-ups from `MIGRATIONS.md`** — `getRelevantMigrations()` previously returned an empty array for every upgrade because `MIGRATIONS` was a stub object. It now parses `MIGRATIONS.md` at runtime, collecting all entries whose target version falls between `fromVersion` and `toVersion` (multi-hop upgrades are handled in a single pass). Consumers upgrading from v0.3.x will now see the critical `FERRY_ANTHROPIC_API_KEY → ANTHROPIC_API_KEY` rename action they previously missed silently. Closes #161 (D6).

### Dependencies

- Bumped `@anthropic-ai/sdk` (0.91.1 → 0.93.0), `openai` (6.34.0 → 6.36.0), `@google/genai` (1.50.1 → 1.52.0), and the typescript-toolchain group.
- Bumped CI actions: `actions/checkout@v4 → @v6`, `actions/setup-node@v4.1.0 → @v6.4.0`, `actions/upload-artifact@v4.6.2 → @v7.0.1`, `github/codeql-action@v3 → @v4`.

---

## [0.7.0] — 2026-05-04

### Changed

- **Consumer workflows now call composite actions directly** — `ferry-init` generates expanded three-job workflows (`gate-envelope`, `run-agent`, `emit-audit`) that call Ferry's composite actions via `with:` inputs instead of delegating to a reusable workflow with `secrets: inherit`. This fixes cross-org secret propagation: GitHub does not forward `secrets: inherit` when the caller and the reusable workflow belong to different organisations.

### Fixed

- **`ferry.config.yaml` config now loads correctly in composite actions** — the `yaml` package was missing from the runtime dependencies of all four `ferry-run-*` composite actions (`scripts/build-ferry-actions.mjs`), causing every agent to crash with `'YAML config requires the "yaml" package'` when the consumer used a YAML config file. The `yaml` package is now included in all composite action bundles. Consumers using `ferry.config.json` are unaffected.

### Removed

- **Reusable workflows deleted** — `.github/workflows/refine.yml`, `dev.yml`, `review.yml`, and `iterate.yml` are removed from the Ferry repository. Consumers pinned to `@v0.6.0` continue to work; run `ferry-update` to migrate to the v0.7.0 expanded form.

---

## [0.6.0] — 2026-05-04

### Added

- **`ferry-doctor` check D7: audit issue (FERRY_AUDIT_ISSUE)** — new check verifies the `FERRY_AUDIT_ISSUE` repo variable is set, holds a positive integer, and that the referenced GitHub issue exists and is open. Previously a first-time installer who skipped README Step 1 would see a green doctor output and hit a runtime crash on the first Jira column move. All four failure modes (variable missing, non-numeric, issue not found, issue closed) produce an actionable error pointing to README Step 1 (#159).

### Fixed

- **Refiner and Reviewer workflows now install `gitleaks` on the runner** — `refine.yml` and `review.yml` were missing the install step that `dev.yml` and `iterate.yml` already had, so every Refiner run and any Reviewer run that posted a Jira comment crashed with `Error: spawn gitleaks ENOENT`. Both workflows now install `gitleaks` v8.21.2 from the official release tarball before invoking the agent, matching the dev/iterate pattern. Affected consumers pinned to `@v0.5.3` (or earlier) — upgrade to `@v0.6.0`.
- **Reviewer Review↔Iterate auto-loop now uses count-based cap check** — the previous implementation stopped after the first reviewer→iterator cycle because it short-circuited on a single iterator marker. The reviewer now counts prior completed iterator cycles via `countPriorIterations` (`changes-guard.ts`) and compares against `limits.max_iterations` (default 3), auto-transitioning until the cap is reached. Reviewer comments now also include an "iteration N/M" hint. Closes #168 (PR #175).

---

## [0.5.3] — 2026-05-03

### Fixed

- **Refiner state-invariant errors now surface a sample of the raw LLM text** — when the Refiner's JSON parse fails (`refiner-output-invalid`), the thrown error includes a trimmed snippet of the LLM response so operators can diagnose preamble / fence drift from logs without reproducing the run. Helps triage cases where the model wraps the JSON plan in prose. Hardening of the parser itself is tracked separately.

---

## [0.5.2] — 2026-05-02

### Fixed

- **Refiner agent crash on consumer repos pinned to v0.5.1** — `@google/genai` (added in v0.5.1) pulls `google-auth-library`, which performs a dynamic `require('child_process')`. esbuild bundled the SDK in ESM mode and replaced the dynamic require with a shim that throws `Dynamic require of "child_process" is not supported`. The action bundles now ship a `createRequire` banner so transitive CJS dependencies resolve dynamic requires through Node's real `require` instead of the throwing shim. Affects all four agent actions (refiner, developer, reviewer, iterator); pinning consumers to `@v0.5.2` (or later) restores the refiner. See issue #158 for the cleaner externalization follow-up.

---

## [0.5.1] — 2026-05-02

### Fixed

- **Jira Automation custom body JSON format corrected** — The `{{now.format(...)}}` smart value was invalid Jira syntax and caused empty timestamp fields. Now uses `{{now.jiraDate}}`. The `actor` field (which failed to resolve in column triggers) has been removed. Added `version: "v1"` and `event_id` fields to match the working format.
- **`ferry-update` now regenerates Jira automation setup file** — When upgrading Ferry, the `ferry-jira-automation-setup.md` file is automatically regenerated with corrected JSON format, ensuring consumers get the fix without manual intervention.

---

## [0.5.0] — 2026-05-02

### Added

- **Configurable Jira column → agent mapping with opt-in auto-transitions** — consumers can now map any Jira status name to each agent and choose whether Ferry auto-transitions tickets on FR18 / FR24 / FR28 (#154).
- **Configurable base / working / target branches** — workflows no longer hardcode `main`; consumers set their own base/working/target branch names per project (#144, #155).
- **Per-phase LLM provider selection** — each agent (Refiner / Developer / Reviewer / Iterator) can now pick its own provider among Anthropic, OpenAI, and Google (#152).
- **Draft PR flow** — Developer opens PRs as draft and the Reviewer flips them to "ready for review" on approval (#150).
- **Secret masking in `ferry-init` wizard** — credentials entered during onboarding are now masked in the terminal; README Step 2 clarified accordingly (#148).

### Changed

- **P0+P1 hardcoded values externalized** — magic numbers and limits now live in env vars and `config.json` so consumers can tune Ferry without forking (#157).
- **`limits.max_iterations` surfaced as configurable** — documented as a first-class consumer setting (#147).
- **Consumer install docs coherence sweep** — README, `CONFIGURATION.md`, and operator-facing docs aligned with code reality across the P0/P1/P2 surface.

### Fixed

- **`ferry.config` is never auto-generated by `ferry-init`** — clarified in docs to remove a misconception about the wizard's behavior (#153).
- **README Step 4 (Jira automation)** — dropped the broken Jira automation import flow and rewrote the step against the real Jira UI (#149).
- **Developer branch name format** — clarified in the README (#146).

### Removed

- **Google AI / OpenAI mentions in Requirements & privacy notice** — these were stale and made the section provider-specific; per-phase provider selection means the requirements section is now provider-neutral (#145).

---

## [0.4.0] — 2026-05-02

### Added

- **`ferry-uninstall` CLI** — removes Ferry workflows, secrets, and variables from a consumer repo (#129).
- **`ferry-update` CLI** — upgrades pinned Ferry versions in consumer workflow files; prints migration notes from `MIGRATIONS.md` (#134).
- **Configurable Jira status names** — `ferry-init` now prompts for Jira column names with sensible defaults (Refinement / In Development / In Review / Changes Requested / Ready to Merge) instead of requiring exact names (#132).
- **Workspace ARI + project ID auto-detection** — `ferry-init` wizard automatically resolves the Jira workspace ARI and project ID via the API (#126).
- **Floating major tag** — `scripts/retag-major.sh` keeps a moving `v1` tag pointing at the latest `0.x.y` release; `release.yml` invokes it after every successful release (#133).

### Changed

- **`docs/CONSUMER-SETUP.md` deleted** — the install story now lives entirely in the README quick-install block. A volunteer with no prior Ferry knowledge can install end-to-end from the README in ≤ 10 minutes (#131, #135).
- **`MIGRATIONS.md` added** — documents consumer-visible changes between releases; `ferry-update` reads it to print manual follow-ups after an upgrade.
- **README "Operations setup" curl URLs pinned to a release tag** — replaces the previous `raw.githubusercontent.com/.../main/...` references with `/v0.4.0/...` to remove the mutable supply-chain pull.

### Fixed

- **Install-flow incoherence between `ferry-init` and the reusable workflows** — `ferry-init` previously scaffolded `ferry-reconciler.yml` and `ferry-audit-daily.yml` stubs that called reusable workflows (`reconciler.yml`, `audit-daily.yml`) which did not exist in `.github/workflows/`. Both broken stubs are now removed; consumers add the working scheduled workflows from `examples/consumer-setup/workflows/` per the README's Operations setup step.
- **Anthropic API key secret renamed** — `ferry-init` previously stored the key as `FERRY_ANTHROPIC_API_KEY`, but the reusable agent workflows read `ANTHROPIC_API_KEY`. Wizard, `ferry-doctor`, and `ferry-uninstall` now use `ANTHROPIC_API_KEY` consistently. See `MIGRATIONS.md` for the manual rename step required for existing installs.
- **`ferry-doctor` now checks for `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID`** — these were always required by the agents (FR18 / FR24 / FR28) but the doctor previously did not flag them as missing.
- **Default ferry workflow ref** — `ferry-init` now defaults the workflow pin to the package version rather than a hardcoded `v1` (#124).
- **Jira automation bundle schema** — fixed bundle schema, added beta label and manual fallback flow (#127).

### Breaking (docs)

- `docs/CONSUMER-SETUP.md` no longer exists. Any bookmarks or links to it should be updated to point to the README.

---

## [0.3.0] — 2026-05-01

### Changed

- **Package renamed to `@big-emotion/ferry`** — The npm package is now scoped under the `big-emotion` org. Bin names (`ferry-init`, `ferry-doctor`) are unchanged; consumers invoke the CLIs via `npx -p @big-emotion/ferry ferry-init` and `npx -p @big-emotion/ferry ferry-doctor`. The unscoped `ferry-init` name was never published — `0.3.0` is the first npm release.
- **Internal composite-action pinning bumped to `@v0.3.0`** — Agent workflows and consumer stubs now reference `big-emotion/ferry/.github/{actions,workflows}/...@v0.3.0`.
- **Consumer install guide updated** — `docs/CONSUMER-SETUP.md` and `docs/RELEASING.md` reflect the new package name and version pin.

### Notes

- `0.2.0` was tagged but never reached npm — the release workflow failed at the publish step (token authorization). All 0.2.0 changes below are included in 0.3.0.

---

## [0.2.0] — 2026-05-01

> Tagged but unpublished — the npm publish step failed due to a token authorization issue. The changes below ship as part of `0.3.0`.

### Added

- **npm publish workflow** — `release.yml` now publishes the CLI package to npm with provenance and creates a GitHub Release on every `v*.*.*` tag push, with full CI gate and `.ferry/` bundle drift check.
- **`ferry-init` / `ferry-doctor` on npm** — CLIs are shipped via the `@big-emotion/ferry` package and runnable as `npx -p @big-emotion/ferry ferry-init` / `npx -p @big-emotion/ferry ferry-doctor` (#63).
- **CodeQL SAST workflow** — `.github/workflows/codeql.yml` adds static analysis on every push and PR.
- **Structured logger** — JSON logger with `correlation_id` propagation across agents and IO helpers.
- **FR registry & drift detector** — `check:fr-drift` script + commit-msg hook ensure FR numbers in code, prompts, and docs stay in sync.
- **Audit issue auto-rotation** — When the audit issue approaches the 1000-comment GitHub cap, Ferry automatically rotates to a new issue and links the previous one.
- **CI gates** — `audit:ci` (npm audit on high/critical), `check-bundle` (`.ferry/` drift), `check:fr-drift`, and explicit per-job `permissions:` blocks on every workflow.
- **Scheduled consumer workflows** — `examples/consumer-setup/workflows/ferry-reconcile.yml` and `ferry-cost-daily.yml` wire the reconciler and cost daily-check on cron.
- **End-to-end pipeline test** — Mocked `refine → dev → review → iterate` flow exercising the three Jira auto-transitions (FR18, FR24, FR28).
- **Architecture decision records** — Foundational ADRs under `docs/adr/`, including ADR-0002 documenting why `.ferry/` bundles are committed.
- **Production-readiness audit** — `docs/PRODUCTION-READINESS-AUDIT.md` with multi-axis scoring (now 7.2 / 10).

### Changed

- **Internal composite-action pinning** — Agent workflows (`refine.yml`, `dev.yml`, `review.yml`, `iterate.yml`) reference `big-emotion/ferry/.github/actions/ferry-*@v0.2.0` instead of `@main`, closing the supply-chain self-replication risk.
- **Consumer install guide** — `docs/CONSUMER-SETUP.md` refreshed with the `@v0.2.0` pin, SHA-pinning recipe, and updated troubleshooting tables.

### Security

- **`execFileSync` migration** — Replaced `execSync` template strings with `execFileSync` in the developer agent loop, removing shell-injection surface on commit/branch operations.

---

## [0.1.0] — 2026-04-30

### Added

- **Four-agent pipeline** — Refiner, Developer, Reviewer, Iterator — orchestrated via GitHub Actions `repository_dispatch` events triggered by Jira column transitions.
- **Envelope validation** — AJV strict-mode validation of all incoming `repository_dispatch` payloads against `event.v1.schema.json`.
- **IO abstraction layer** — Shared GitHub, Jira, and LLM helpers; agent code never imports provider SDKs directly.
- **CI gate** — Reviewer agent blocks on PR CI status before posting a verdict.
- **Idempotent external writes** — All comments and file operations are fingerprinted (`[ferry:<role>:<run-id>]`).
- **Jira auto-transitions** — FR18 (Dev → In Review), FR24 (Reviewer → Changes Requested or ferry:approved label), FR28 (Iterator → In Review).
- **Cost governance** — `src/cost-governance/daily-check.ts` monitors provider spend; `ferry:paused` label auto-applied at 50 % of monthly cap.
- **Reconciler** — `src/reconciler/reconcile.ts` sweeps for missed/stalled tickets.
- **CLIs** — `ferry-init` scaffolds Ferry into a consumer repo; `ferry-doctor` diagnoses configuration issues.
- **Multi-provider LLM support** — Anthropic, OpenAI, and Google providers wired through a single `createLlmCall` entry point.
- **Prompt composition** — Layered system-prompt resolution: bundled prompt + `prompts/<agent>.extra.md` + `prompts/_project.md`.
- **Consumer install guide** — `docs/CONSUMER-SETUP.md` with end-to-end setup in ≤ 25 minutes.
- **Release tooling** — `npm version` lifecycle hook rebuilds `.ferry/` bundles automatically; `docs/RELEASING.md` documents tag strategy and manual cutting steps.

### Changed

- `package.json` `version` set to `0.1.0`; `private: true` removed to allow npm distribution.

---

[Unreleased]: https://github.com/big-emotion/ferry/compare/v0.10.1...HEAD
[0.10.1]: https://github.com/big-emotion/ferry/releases/tag/v0.10.1
[0.10.0]: https://github.com/big-emotion/ferry/releases/tag/v0.10.0
[0.9.0]: https://github.com/big-emotion/ferry/releases/tag/v0.9.0
[0.8.2]: https://github.com/big-emotion/ferry/releases/tag/v0.8.2
[0.8.1]: https://github.com/big-emotion/ferry/releases/tag/v0.8.1
[0.8.0]: https://github.com/big-emotion/ferry/releases/tag/v0.8.0
[0.7.0]: https://github.com/big-emotion/ferry/releases/tag/v0.7.0
[0.6.0]: https://github.com/big-emotion/ferry/releases/tag/v0.6.0
[0.4.0]: https://github.com/big-emotion/ferry/releases/tag/v0.4.0
[0.3.0]: https://github.com/big-emotion/ferry/releases/tag/v0.3.0
[0.2.0]: https://github.com/big-emotion/ferry/releases/tag/v0.2.0
[0.1.0]: https://github.com/big-emotion/ferry/releases/tag/v0.1.0
