# Changelog

All notable changes to Ferry are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Ferry uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.17.0] — 2026-06-07

### Added

- **Merger agent (FR32)** — a new fifth agent triggered by a `repository_dispatch` event of type `ferry-merge`, dispatched automatically by the Reviewer agent on a passing review. Consumers wire it by adding `ferry-merge.yml` to `.github/workflows/` (added automatically by `ferry-update`). The merge strategy is configurable (`FERRY_MERGE_STRATEGY`: `squash` / `merge` / `rebase`; default: `squash`). Model and provider are overrideable via `FERRY_MERGER_MODEL` / `FERRY_MERGER_PROVIDER`. An optional `FERRY_MERGE_DONE_TRANSITION_ID` secret moves the Jira ticket into a configured column after a successful merge. **Branch-protection caveat:** the Reviewer sets the `ferry:approved` label but does not post a formal GitHub PR review — see `docs/CONFIGURATION.md` → Merger agent → Branch-protection caveat for implications when "Require approvals" is enabled.
- **`codex-cli` execution path** (PR #372) — a third execution path alongside `script` and `claude-code`, running each agent as an `openai/codex-action` call. Adds routing, the `ferry:codex-cli` label override, per-agent `prompts/*.codex-cli.md` defaults, and `ferry-cc-prompt --agent <role>` resolution. See `docs/decisions/0003-codex-cli-action-plan.md`.
- **`ferry.local.yml` consumer-side overlay** (PR #380) — a consumer-managed override file merged on top of the tracked Ferry config, so local tweaks survive `ferry-update` upgrades without editing generated files.

### Changed

- **Reviewer migrated from a tool-loop to the shared agent-loop** (MCP Phase 2, PR #381) — the Reviewer now runs on the common agent-runtime loop, consolidating tool-call handling and structured output with the other agents.
- **Refiner migrated to the shared agent-loop** (MCP Phase 3, PR #394) — completes the agent-loop unification; the Refiner gains a structured `schema.ts` and the shared MCP tool-call path.

### Fixed

- **Reviewer script-path now dispatches `ferry-merge` on approve with `contents: write`** (PR #379) — the bundled/script reviewer emits the FR32 `ferry-merge` `repository_dispatch` best-effort on approve, and the consumer example `ferry-review.yml` now grants the script-path job `contents: write` (it previously pinned `contents: read`, which made the dispatch fail silently). Documentation (`CLAUDE.md`, `docs/OVERVIEW.md`, `docs/CONFIGURATION.md`, `docs/INSTALL.md`, `docs/adr/0001`) was aligned with the now-shipped Merger and the gated-merge boundary.

---

## [0.16.0] — 2026-05-25

### Added

- **`FERRY_RUNNER` variable for self-hosted runner labels** (PR #365) — all four agent workflow templates now render `runs-on: ${{ fromJSON(vars.FERRY_RUNNER || '"ubuntu-latest"') }}` instead of a hardcoded `ubuntu-latest`. Consumers on self-hosted runners set the `FERRY_RUNNER` repo/org variable to a JSON string (e.g. `"ubuntu-latest"`) or array (e.g. `["self-hosted","Linux","X64"]`); the default is unchanged. The six static example workflows under `examples/consumer-setup/` and the `ferry-init` templates carry the same shape, with a regression test in `templates.test.ts` and the new variable documented in `docs/CONFIGURATION.md`. Closes #364.
- **`ferry-cc-prompt` agent-prompt resolver** (PR #363) — a new `ferry-cc-prompt` bin resolves the claude-code-path system prompt for each agent, preferring the consumer's `prompts/<agent>.claude-code.md` override over Ferry's bundled default and substituting runtime tokens. The four claude-code workflow stubs now run `npx -p @big-emotion/ferry@v0.16.0 ferry-cc-prompt` as a pre-step instead of inlining ~40 lines of YAML prompt, so consumers customise prompts by editing one Markdown file. Bundled defaults ship inlined into `dist/cli/` via the esbuild text loader (npm package size unchanged). See `docs/CONFIGURATION.md` → Prompt customization → claude-code path.

---

## [0.15.1] — 2026-05-21

### Fixed

- **Claude Code agent workflows are now scaffolded with `--permission-mode bypassPermissions`** (PR #362) — `ferry-init` previously scaffolded the four claude-code agent workflows with `--permission-mode acceptEdits`, which only auto-approves file edits. In a non-interactive (SDK) run there is no human to grant permission, so every Jira MCP tool call (and `Bash` / `git` / `gh`) was denied — the agent finished with permission denials and did no work (e.g. a refine run ended with 4 denials: no sub-tasks created, no transition). The `--disallowedTools` list still blocks `gh pr merge` / `gh pr close`, so Ferry's never-merge guardrail is preserved. `templates.test.ts` now asserts `bypassPermissions` and rejects a regression to `acceptEdits`.

### Security

- **Patched transitive dependencies** — bumped `brace-expansion`, `fast-uri`, `protobufjs`, and `ws` to their patched versions.

---

## [0.15.0] — 2026-05-21

### Added

- **`ferry-jira-mcp`: a Ferry-owned stdio MCP server** (PR #361) — `src/jira-mcp/` exposes `get_issue` / `list_subtasks` / `create_subtask` / `get_transitions` / `transition_issue` / `post_comment` and is published as a package `bin`. On the `ferry:claude-code` path each agent now does its own Jira work through this MCP server instead of the `ferry-cc-apply` reconcile step.
- **`ferry-ci-gate` composite action** (PR #361) — a deterministic reviewer CI pre-gate that reuses `gateCi()` to skip the paid reviewer agent when CI is pending or red. A failed Jira transition stays non-fatal but now emits a workflow warning annotation and a job-summary line instead of being silently swallowed.
- **Tool-driven `prompts/*.claude-code.md`** for the four roles, used by the single-step claude-code execution path.

### Changed

- **The `ferry:claude-code` path now runs each agent as one direct `anthropics/claude-code-action` call** (PR #361) — replacing the `ferry-cc-prepare → claude-code-action → ferry-cc-apply` wrapper chain. The agent does its own Jira work via `ferry-jira-mcp` and its own GitHub work via `claude-code-action`'s native git/gh tools. The four consumer workflow templates (`examples/consumer-setup/` and the `ferry-init` `templates.ts`) are rewritten to this single-step shape, with the `ferry-jira-mcp` package version-pinned to the workflow's pinned Ferry release. The per-agent `FERRY_*_MODEL` variable is now honoured on the claude-code path (default `claude-sonnet-4-6`) instead of a hardcoded `--model`.
- On the claude-code path, idempotency, audit lines, and column-transition restraint are now prompt-enforced; the code-enforced invariant kept is never-merge (`--disallowedTools` plus the now-required consumer branch protection). The script execution path is unchanged.

### Removed

- **The `ferry-cc-prepare` and `ferry-cc-apply` composite actions, `src/lib/claude-code/`, the `cc-wrappers/{contract,apply,agent-output}` modules, the `cc-*-action.ts` entrypoints, and the agent-output schema** (PR #361) — roughly 2,500 lines deleted now that the claude-code path is a single direct action call.

---

## [0.14.0] — 2026-05-21

### Added

- **Claude Code session logs are now uploaded as workflow artifacts** (closes #355, PR #359) — all four consumer workflow templates (refiner, developer, reviewer, iterator) now wrap the `Run claude-code-action` step with an observability bracket: the step gets `id: cc-run` so its `execution_file` output is referenceable, and the session JSON is uploaded as a `ferry-<role>-<ticket>-session` artifact with 7-day retention (`if: always()` so failed runs are captured too). `actions/upload-artifact` is pinned to a SHA matching the existing `ferry-ci.yml` pin. `docs/CONFIGURATION.md` gains a "Session log artifact" subsection covering the artifact name pattern, retention, secret-exposure risk, and `gh run download` usage.

### Fixed

- **claude-code-path refiner now creates Jira sub-tasks** (PR #360) — the claude-code execution path for the refiner was broken end-to-end: `claude-code-action` exited successfully without writing `.ferry/cc-output.json`, so `ferry-cc-apply` failed with `ENOENT`, and three refiner schemas disagreed so nothing created the sub-tasks. `outcomePromptSuffix('refiner')` now overrides the bundled "reply with JSON only" instruction and spells out the full `RefinerOutput` plan schema and the Write-tool contract; `ferry-cc-apply` gains `applyRefinerCcArtifact`, which validates the artifact and runs the same `applyActions` reconcile the script path uses (the LLM never writes to Jira); `ferry-cc-prepare` creates `.ferry/` deterministically so a read-only agent can write the artifact. The dead `RefinerAgentOutput` schema variant is removed.

---

## [0.13.2] — 2026-05-21

### Fixed

- **claude-code path: `claude_args` is now a shell-quoted string, not a JSON array** (closes #354) — `ferry-cc-prepare` emitted the `claude_args` output as a JSON array, but `anthropics/claude-code-action@v1` word-splits that input with `shell-quote`. The JSON array was mis-tokenized and every flag — including the `Write(.ferry/cc-output.json)` grant added in #358 — was silently dropped, so the agent could not write its output artifact (`permission_denials_count: 3`) and `ferry-cc-apply` failed with `ENOENT` on `.ferry/cc-output.json` despite `claude-code-action` reporting success. This broke the entire claude-code execution path for all four roles. `cc-prepare` now serializes the token list into a single-line, single-quoted shell string via `serializeClaudeArgs`.
- **claude-code path: the system prompt is delivered via the `prompt:` input, not `claude_args`** (#354) — `claude-code-action` runs `stripShellComments` over `claude_args` before parsing it, deleting every line whose first non-whitespace character is `#`. Passing `buildSystem(<role>)` through `claude_args --append-system-prompt` would have silently dropped the Markdown headings of every agent prompt. The system prompt is now concatenated, verbatim, into the action's `prompt:` input ahead of the initial prompt. ADR-0006 §2 and decisions/0002 are amended accordingly.

---

## [0.13.1] — 2026-05-21

### Fixed

- **Claude Code workflow stubs now include `id-token: write`** (closes #353, PRs #357 / #358) — `anthropics/claude-code-action@v1` unconditionally calls `core.getIDToken()` during `setupGitHubToken`. When a job had an explicit `permissions:` block that omitted `id-token`, GitHub Actions denied the OIDC fetch and every consumer dispatch failed with "Could not fetch an OIDC token". The `id-token: write` scope is now wired into all four bundled stubs (`examples/consumer-setup/workflows/ferry-{refine,dev,review,iterate}.yml`), into the `ferry-init` templates (`src/cli/init/templates.ts`), into `CLAUDE_CODE_JOB_PERMISSIONS` / `REQUIRED_WRITE_SCOPES` (so `renderPermissionsYaml` and `assertLeastPrivilege` stay in sync with reality), and asserted per-role in `templates.test.ts` so the missing scope cannot recur. Existing consumers pinned to `@v0.13.0` need to add the scope by hand or wait for `ferry-update` to apply the v0.13.x → v0.14.0 migration entry.
- **`ferry-cc-prepare` now ships its own bundled prompts** (closes #352, PR #356) — the action claimed to be "self-contained; no `.ferry/` needed" but failed with `ENOENT` on the bundled prompt files because `build-ferry-actions.mjs` copied prompts to every `ferry-run-*` action dir but not to `ferry-cc-prepare/`, and `ferry-cc-prepare/action.yml` never set `FERRY_BUNDLED_PROMPTS_DIR`. `resolvePromptPath` fell back to `<consumer-repo>/.ferry/prompts/`, which doesn't exist in a fresh consumer workspace. The build step now copies all five prompts into `.github/actions/ferry-cc-prepare/prompts/` and the action exposes `FERRY_BUNDLED_PROMPTS_DIR` pointing there — mirroring the pattern used by every `ferry-run-*` composite action.
- **Narrow `Write(.ferry/cc-output.json)` grant for read-only roles on the claude-code path** (PR #358) — `ferry-cc-prepare` emits a `cc-output.json` sidecar that `ferry-cc-apply` later reads. On the reviewer / refiner branches the role's tool policy is read-only by default, which blocked the write. The tool policy now grants a narrow `Write` permission on exactly `.ferry/cc-output.json` so the cc-chain works for read-only roles without widening the surface for arbitrary writes.

---

## [0.13.0] — 2026-05-20

### Added

- **Claude Code execution path wired end-to-end** (ADR-0006 §2/§3, closes #280, #328, #330, #331, #350, refs #302, #303, #333). Three new composite actions ship the missing primitives on top of the resolver introduced in 0.12.0:
  - `ferry-route` (#302, entry point `src/lib/dispatch/route-action.ts`) — wraps the pure `resolveExecutionPath` resolver, fetches the ticket's Jira labels, loads `ferry.config`, and exposes `path` (`script` | `claude-code`) + `reason` outputs. Heuristic-driven escalation (`priorRoundTrips`) is intentionally stubbed to 0; label + config-driven routing land first.
  - `ferry-cc-prepare` (#347, #351, entry point `src/lib/dispatch/cc-prepare-action.ts`) — renders the per-role system prompt, tool allow-list, MCP servers, and `direct_prompt` for `anthropics/claude-code-action@v1`, with full coverage for refiner / developer / reviewer / iterator. Surfaces `pr_number` as a structured output for contracts that require it (e.g. reviewer's `requireCtx(ctx.prNumber, …)`).
  - `ferry-cc-apply` (#330) — handles the claude-code-action exit and propagates outputs back into the workflow.
- **Consumer workflow stubs now route at job level** — the four templates in `examples/consumer-setup/workflows/` and `src/cli/init/templates.ts` run a `route` job, then dispatch to `run-agent` (`if: path == 'script'`) or `run-agent-claude-code` (`if: path == 'claude-code'`). The refiner branch is exercisable end-to-end (#348); the dev / review / iterate branches are now live for the cc-path too — the fail-loud "cc-path not yet wired" guard step has been removed.
- **Hardening primitives on the cc-path** (#349, refs #303) — `secret-scan-gate`, `tool-policy` enforcement, and minimal per-job `permissions` are wired into the Claude Code branch so the action cannot approve or merge on the consumer's behalf even when its default permissions would allow it.
- **`anthropicOnly` is now a hard gate** in `resolveExecutionPath` (closes #280) — the resolver refuses to route to `claude-code` unless the configured LLM provider is Anthropic, surfacing misconfigurations at install time instead of mid-run.
- **`ferry-doctor` claude-code path checks** — token-exclusivity (`CLAUDE_CODE_OAUTH_TOKEN` ↔ `ANTHROPIC_API_KEY`) and provider routing alignment are validated when the consumer has opted into the cc-path.
- **`ferry-update` `requires-secrets` migration gate** — `MIGRATIONS.md` entries can now declare required secrets; upgrades are blocked until the consumer has rotated them. The 0.12.0 entry declares `CLAUDE_CODE_OAUTH_TOKEN`.

### Changed

- **Agent runtime**: per-role pre-loop setup extracted into a shared `prepare` step in `src/lib/agent-runtime/`, reducing duplication across the four agent entrypoints and making the cc-path / script-path split surgical.
- **`ferry-uninstall`**: now cleans up the new composite-action directories and handles the interactive OAuth token-removal flow.
- **Docs**: `README.md` trimmed to 79 lines (closes #328); long-form content moved into `docs/` so the README stays scannable.

---

## [0.12.0] — 2026-05-20

### Added

- **Claude Code execution path for Ferry agents** (closes #300, #302, #303) — agents can now run inside `anthropics/claude-code-action@v1` instead of (or alongside) the standalone TypeScript loop. A deterministic execution-path resolver (#315) chooses between the two paths from a single `FERRY_EXECUTION_PATH` input per role with explicit fallbacks; the Claude Code action job ships with prompt reuse and per-agent tool/MCP allow-list mapping (#314); no-auto-merge hardening primitives (#312) prevent the Claude Code path from approving or merging on the consumer's behalf even when the action's default permissions would allow it.
- **CLI support for the Claude Code execution path** — `ferry-init` adds an install-time execution-path choice and wires `CLAUDE_CODE_OAUTH_TOKEN` into the generated stubs; `ferry-doctor` and `ferry-uninstall` understand the new path and validate / clean it up correctly (closes #317); `ferry-update` adds a `requires-secrets` credential gate so MIGRATIONS entries that need a new secret block the upgrade until the consumer rotates it (closes #316).
- **MCP server catalog — GitHub, Atlassian, Prismic** (#326, Phase 1 of #319) — `docs/MCP.md` now documents three production-ready servers (`github` HTTP with fine-grained PAT, `atlassian` HTTP with Rovo API token, `prismic` stdio via `@prismicio/mcp-server`). The README Quick-install end-to-end example is swapped from Figma to Atlassian to match what is actually runnable headlessly today.

### Fixed

- **CI**: allowlist `npm audit` advisory 1119378 for `protobufjs` (#318) — transitive-only, no fixed version upstream yet.

### Changed

- **Docs**: document the accepted-divergence invariants for the Claude Code execution path — both the contract decision (#301, #313) and the per-role notes — so the two execution paths can drift in non-essential surface (logging shape, retry knobs) without breaking Ferry's behavioural contract.
- **Docs (#326)**: remove the misleading Figma entry from `docs/MCP.md` — the `mcp.figma.com/mcp` endpoint rejects PATs and the required `mcp:connect` OAuth scope is whitelist-only, so headless use from GitHub Actions is not viable today. Tracked in #325 with a re-open trigger.
- **Deps**: bump `@anthropic-ai/sdk` 0.95.2 → 0.97.0 (#296), `@google/genai` 2.0.1 → 2.4.0 (#295), `openai` 6.37.0 → 6.38.0 (#298), the `typescript-toolchain` group (5 updates, #294), and `lint-staged` 17.0.4 → 17.0.5 (#297).

---

## [0.11.0] — 2026-05-19

### Added

- **`ferry-init --forge gitlab` full wizard (experimental)** (part of #214, follow-up to #283) — the GitLab branch of `ferry-init` is no longer a pointer to the docs. It now detects the GitLab project (host + namespaced path; subgroups supported) from `git remote get-url origin`, scaffolds the six GitLab CI templates (`refine`, `dev`, `review`, `iterate`, `reconcile`, `cost-daily`) under `ci/ferry/`, and prints the required project-access-token scopes (`api`) plus the CI/CD variables consumers must create in **Settings → CI/CD → Variables** (`FERRY_VERSION`, `FERRY_JIRA_BASE_URL`, `FERRY_JIRA_EMAIL`, `FERRY_JIRA_API_TOKEN`, `FERRY_GITLAB_TOKEN`, `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`, `FERRY_REVIEW_TRANSITION_ID`, `FERRY_ITER_TRANSITION_ID`, `FERRY_APPROVE_TRANSITION_ID`, `FERRY_AUDIT_ISSUE`, plus one LLM key). The wizard is **idempotent**: re-running on an initialised repo leaves matching files untouched and reports user-edited ones as "would overwrite"; `--force` replaces them, `--dry-run` previews without writing, `--project namespace/project` overrides remote detection. Tokens are never accepted on the command line or written to disk. The GitHub path is byte-identical — only the `gitlab` branch grew new behaviour. First of four deferred follow-ups noted in #283.

- **`ferry-update --forge gitlab` version rewriter** (#214, part of #210) — `ferry-update --forge gitlab` now rewrites the pinned Ferry version across `.gitlab-ci.yml` and per-role `*.gitlab-ci.yml` includes (previously it only printed a manual-bump instruction). The rewriter handles both pinning conventions: a `FERRY_VERSION: <ver>` YAML assignment under `variables:` (quoted or unquoted) and a literal `@big-emotion/ferry@<ver>` pin inside a `script:` line. The `${FERRY_VERSION}` interpolation form is intentionally left alone — that value lives in CI/CD UI variables. The flow prints a unified diff, prompts for confirmation (skip with `--yes`), and supports `--dry-run`. Idempotent: rerunning after convergence produces zero diff. The GitHub path is byte-identical to before.

- **`forge:` field in `MIGRATIONS.md`** (#214, part of #210) — each `## <from> → <to>` section can now declare `forge: github | gitlab | both` directly under the heading. Default is `both` (backwards-compatible — existing entries are unaffected). `ferry-update` filters the notes it prints based on the active `--forge` flag, so GitLab consumers no longer see GitHub-only follow-ups and vice versa. Documented in `MIGRATIONS.md` and `docs/CONFIGURATION.md`.

- **GitLab runner adapter (experimental)** (#212, part of #210) — `FERRY_FORGE=gitlab` now resolves to a working `GitLabRunner` that implements the full `CIRunner` surface against the GitLab REST API v4 (native fetch; no SDK dependency). Vocabulary mapping: GitLab merge request ↔ pull request; `Draft:` title prefix ↔ draft PR; latest pipeline status ↔ aggregated commit status (success/skipped/manual → green; failed/canceled → red; everything else → pending). `dispatch()` triggers a downstream pipeline via the pipeline-trigger token, passing the envelope as `FERRY_ENVELOPE_PAYLOAD`. Required env vars: `FERRY_GITLAB_API_BASE` (defaults to `https://gitlab.com/api/v4`), `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`, `FERRY_GITLAB_TRIGGER_REF`. Marked **experimental** until at least one consumer has exercised the full cycle in production — see #210 for the promotion checklist.

- **GitLab adapter CI job + fixture set** (#215, part of #210) — a dedicated `gitlab-adapter` job in `.github/workflows/ferry-ci.yml` runs the GitLab adapter unit tests, the fixture-replay tests, the runner-factory tests, and the CLI forge-flag tests in isolation on every PR — so GitLab-only regressions surface under a clearly-named gate instead of being buried in the main test job. New fixture set under `src/__fixtures__/gitlab/` captures the GitLab REST shapes the adapter consumes (project, MR, changes, commits, pipeline statuses, notes, label PUT, raw file content, trigger response). New `fixtures.test.ts` replay suite feeds each fixture through the adapter to catch contract drift. `CONTRIBUTING.md` documents the fixture-refresh workflow.

- **`ferry-uninstall --forge gitlab` cleanup** (#214, part of #210) — the GitLab branch of `ferry-uninstall` is no longer a print-only stub. It now scans the repo for the canonical Ferry templates listed in `examples/consumer-setup-gitlab/` (`refine.gitlab-ci.yml`, `dev.gitlab-ci.yml`, `review.gitlab-ci.yml`, `iterate.gitlab-ci.yml`, `reconcile.gitlab-ci.yml`, `cost-daily.gitlab-ci.yml`), removes only the `include:` entries in `.gitlab-ci.yml` that reference those filenames (user-authored includes are never touched), and deletes the corresponding stub files. Dry-run by default — `--apply` is required to mutate the filesystem. Idempotent — a second run on an already-uninstalled repo prints "nothing to remove" and exits 0. When stripping the Ferry includes would leave `.gitlab-ci.yml` with no meaningful content, the CLI keeps the file on disk and prints a notice (deletion is left to the user). The CLI never deletes GitLab CI/CD variables, project access tokens, or pipeline-trigger tokens (irreversible, require API auth); instead it prints deep-link URLs to the project Settings → Access Tokens / CI/CD → Triggers / CI/CD → Variables pages and lists every variable shipped by `ferry-init --forge gitlab` for manual revocation. The GitHub path is byte-identical to v0.10.3.

- **`--forge` flag in ferry-init / doctor / update / uninstall** (#214, part of #210) — every consumer CLI now accepts `--forge <github|gitlab>` (and `--forge=<value>`). When the flag is omitted, the forge auto-detects from `git remote get-url origin` (github.com → github; gitlab.com or self-managed `gitlab.*` hosts → gitlab) and falls back to `github`. The shared `src/cli/lib/forge.ts` helper is unit-tested. The GitHub path is unchanged. The GitLab path prints actionable instructions pointing at `examples/consumer-setup-gitlab/` and the manual GitLab setup steps — the full GitLab wizard / health probes / update flow / uninstall flow are tracked as follow-up work under #214.

- **`ferry-doctor --forge gitlab` live probes** (partial #214, part of #210) — the GitLab branch of `ferry-doctor` now runs five real probes instead of printing manual instructions. (1) `GET /projects/:id` confirms the project access token can be exchanged for the project (scopes: `api`, `read_repository`). (2) `GET /personal_access_tokens/self` introspects token scopes and fails loudly if `api` is missing; project-access tokens (which can't self-introspect) get a `[WARN]` line. (3) `GET /projects/:id/triggers` verifies the configured `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN` is registered on the project. (4) `GET /projects/:id/variables` checks every required CI/CD variable from `examples/consumer-setup-gitlab/README.md` and surfaces missing keys with `[FAIL] <NAME>`. (5) The Jira-Automation → pipeline-trigger webhook is documented as `[MANUAL]` (cannot be probed from this process). Output format mirrors the GitHub-side `[OK] / [WARN] / [FAIL] / [MANUAL]` style; exit code is 0 unless any probe is red. New CLI options: `--api-base`, `--token`, `--project`, `--trigger-token` (env fallbacks: `FERRY_GITLAB_API_BASE`, `FERRY_GITLAB_TOKEN`, `FERRY_GITLAB_PROJECT_PATH`, `FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN`). The GitHub path is unchanged.

- **GitLab consumer-setup templates (experimental)** (#213, part of #210) — `examples/consumer-setup-gitlab/` now ships seven copy-pasteable GitLab CI files (one per role + reconcile + cost-daily + a top-level `.gitlab-ci.yml`). Each role's job is ~10 lines: installs Node 20, `npm install -g @big-emotion/ferry@${FERRY_VERSION}`, runs `ferry-agent run --role <role>`. `rules:` clauses match on `$FERRY_DISPATCH_TYPE` so the same pipeline trigger handles all four agents. A new GitLab section in `docs/CONFIGURATION.md` documents the Jira Automation → pipeline-trigger webhook payload, required CI/CD variables, project-token scopes, and the pipeline-status collapse rules. The README's Quick install gains a forge selector noting GitLab is experimental.

- **Per-ticket label-override system** (#236 foundation; #237–#243) — a new label resolver (`src/lib/labels/`) lets operators steer an individual ticket by adding Jira labels, without touching `ferry.config`. The foundation (#236) defines the precedence chain (per-ticket label → per-agent config → global config → bundled default), conflict rules (last-writer-wins within a family, hard error on contradictory pairs), and an audit line so every applied override is traceable in the run log. Override families shipped on top of it: **model / provider per ticket** (`ferry:model:<id>`, `ferry:provider:<name>`, #237); **budget / iterations / tokens per ticket** (`ferry:max-iterations:<n>`, `ferry:max-tokens:<n>`, `ferry:budget:<usd>`, #238); **phase control / no-auto-transition** (`ferry:no-auto-transition`, per-phase enable/disable, #239); **thinking / review rubric** (`ferry:thinking:<level>`, `ferry:rubric:<name>`, #240); **git base / target / draft** (`ferry:base:<branch>`, `ferry:target:<branch>`, `ferry:draft`, #241); **ticket typing** (`ferry:as/<type>` forces the issue-type used for branch-prefix and routing resolution, #242); and **dry-run / read-only safety** (`ferry:dry-run`, `ferry:read-only` short-circuit all external writes for a single ticket, #243). Unknown or malformed labels are ignored with a warning rather than failing the run.

- **Ticket-type routing label overrides** (#routing) — `ferry:type:enable-<type>` and `ferry:type:force-<type>` labels let a ticket opt into or force a routing type (e.g. `enable-task`) independent of its Jira issue type, complementing the per-issue-type working-branch-prefix mapping below.

- **`ferry-cost-advice` CLI** (#254) — `npx -p @big-emotion/ferry ferry-cost-advice` reads `ferry-audit.jsonl` and prints a ranked list of cost-optimisation recommendations (e.g. phases that would be cheaper on a smaller model, tickets with runaway iteration counts, cache-hit opportunities), each with an estimated monthly saving. Supports `--audit-log`, `--repo`, and `--format` (`md`/`json`). Also exposed as the `/ferry-cost-advice` skill. See [`docs/COST.md`](docs/COST.md).

- **`ferry-cost-reconcile` CLI** (#254) — `npx -p @big-emotion/ferry ferry-cost-reconcile` diffs Ferry's own per-run spend (`ferry-audit.jsonl`) against an Anthropic Console CSV export so operators can verify the audit log against the provider's billing of record and surface drift (untracked runs, model-price changes). Flags: `--audit-log`, `--csv`, `--from`, `--to`, `--format`.

- **`ferry-cost-stats` CLI** — `npx -p @big-emotion/ferry ferry-cost-stats` reads `ferry-audit.jsonl` and writes `cost-baseline.json` with per-phase median and p90 cost in USD. Flags: `--audit-log`, `--repo`, `--out`. Commit the baseline to your repo root so the Refiner can read it at runtime. See [`docs/COST.md`](docs/COST.md) for full usage.

- **Refiner cost estimation** — when `cost-baseline.json` is present, the Refiner now computes a `$lo–$hi` cost range after producing its plan, posts it as a Jira comment (`[ferry:refiner-estimate:<id>]`), and applies a `ferry:cost-estimate:<lo>-<hi>` label. Set `COST_TICKET_MAX_USD` to refuse tickets whose estimated high exceeds the cap (posts a `[ferry:refiner-cap:<id>]` comment and exits without creating subtasks). See [`docs/COST.md`](docs/COST.md) for configuration details.

- **`ferry-cost-report` CLI** — `npx -p @big-emotion/ferry ferry-cost-report` reads `ferry-audit.jsonl` and renders a spend breakdown with per-phase, per-model, per-ticket (top 20), and daily tables plus ASCII sparklines for daily spend and tokens/run trends. Supports `--from`, `--to`, `--ticket`, `--phase`, `--format` (`md`/`json`/`csv`), `--out`, and `--audit-log` flags. An anomalies section flags runs above p95 cost. See [`docs/COST.md`](docs/COST.md) for full usage.

- **`ferry-doctor` audit-log check** — a new check (#14) warns when `ferry-audit.jsonl` is missing, empty, or has fewer than 5 entries, so consumers know the file is ready before running `ferry-cost-report`.

- **Configurable working branch prefix per issue type** (`git.working_branch_prefix` mapping) — `working_branch_prefix` now accepts either a plain string (existing behaviour, default `"ferry/"`) or a mapping object whose keys are Jira issue type names and whose `default` key covers unmatched types. At runtime the prefix is resolved by checking for a `ferry:type:<name>` label on the ticket first, then the ticket's Jira issue type, then `mapping.default`. This enables [Conventional Branch](https://conventional-branch.github.io/) naming out of the box — see `docs/CONFIGURATION.md` for a copy-pasteable recipe. Existing consumers are unaffected; the default remains `"ferry/"`.

- **Context7 enabled as a default MCP server for all agents** (#261) — agents now have the Context7 documentation MCP server wired in by default, so they can fetch current library/framework docs at runtime instead of relying on stale training data. Consumers can disable it via the MCP configuration.

- **MCP registry table** (#259) — `docs/MCP.md` documents the MCP servers Ferry agents can use, their transport, and their default-enabled status.

### Changed

- **Runner factory + unified `ferry-agent` CLI** (#211, prerequisite for #210) — the runner layer is now resolved through `createRunnerFromEnv()` (`src/lib/dispatch/runner/factory.ts`), switching on a new `FERRY_FORGE` env var (default `github`; `gitlab` throws a clear "not yet implemented" error pointing at #210). The four agent composite actions (`ferry-run-{refiner,developer,reviewer,iterator}`) now invoke a single `ferry-agent run --role <role>` CLI; the per-role `.ferry/{refiner,dev,review,iterate}-action.js` bundles are replaced by a unified `.ferry/agent.js`. **No behaviour change for consumers** — the composite action interface is unchanged.

- **Anthropic HTTP MCP beta status qualified in constraints** (#260) — `docs/CONFIGURATION.md` and the agent constraints now explicitly note that Anthropic HTTP MCP support is a beta capability, so consumers don't assume GA-level stability.

### Fixed

- **Reviewer agent was ignoring `git.working_branch_prefix` config** — `review-action.ts` hardcoded the PR branch lookup as `` `ferry/${ticketKey}` `` instead of reading the resolved prefix from `ferry.config`. Consumers who overrode `working_branch_prefix` found the Reviewer unable to locate the PR. The Reviewer now resolves the prefix from the reloaded base-branch config, consistent with the Developer and Iterator agents.

- **Developer uses the verbatim Jira summary in the PR title** (#256) — the Developer previously massaged the Jira summary when building the PR title, which could drift from the ticket. It now uses the ticket summary verbatim, keeping the PR title traceable to the source ticket.

- **`cost_eur` and token outputs wired through composite actions** (#257) — the `cost_eur` and token-count step outputs were computed by the agent but not propagated through the `ferry-emit-audit` composite action, so they never reached `ferry-audit.jsonl`. They are now plumbed end-to-end, so cost reporting reflects real spend.

- **Jira issue-type locale normalised at the tracker boundary** (#258) — Jira returns localised issue-type names depending on the workspace locale, which broke type-based routing and branch-prefix resolution on non-English Jira instances. The tracker boundary now normalises the issue type to a locale-invariant form so routing is consistent regardless of the Jira UI language.

### Dependencies

- Bumped `@anthropic-ai/sdk` (0.93.0 → 0.95.2), `@google/genai` (1.x → 2.0.1), `openai` (6.36.0 → 6.37.0), `lint-staged` (16.4.0 → 17.0.4), and the typescript-toolchain group (4 updates).

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

[Unreleased]: https://github.com/big-emotion/ferry/compare/v0.17.0...HEAD
[0.17.0]: https://github.com/big-emotion/ferry/releases/tag/v0.17.0
[0.16.0]: https://github.com/big-emotion/ferry/releases/tag/v0.16.0
[0.15.1]: https://github.com/big-emotion/ferry/releases/tag/v0.15.1
[0.15.0]: https://github.com/big-emotion/ferry/releases/tag/v0.15.0
[0.14.0]: https://github.com/big-emotion/ferry/releases/tag/v0.14.0
[0.13.2]: https://github.com/big-emotion/ferry/releases/tag/v0.13.2
[0.13.1]: https://github.com/big-emotion/ferry/releases/tag/v0.13.1
[0.13.0]: https://github.com/big-emotion/ferry/releases/tag/v0.13.0
[0.12.0]: https://github.com/big-emotion/ferry/releases/tag/v0.12.0
[0.11.0]: https://github.com/big-emotion/ferry/releases/tag/v0.11.0
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
