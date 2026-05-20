# Ferry Migration Notes

This file documents consumer-visible changes between Ferry releases.
`ferry-update` reads the relevant section(s) and prints them as **Manual follow-ups required** after upgrading.

## How to add entries

Add a `## <from> → <to>` section before each release. Use either:

- An exact version pair: `## v0.3.0 → v0.3.1`
- A wildcard range: `## v0.3.x → v0.4.0` (matches any 0.3.\* source)

Optionally scope the section to a single forge by adding a `forge:` line directly
under the heading. Allowed values are `github`, `gitlab`, or `both` (default).
Entries without an explicit `forge:` line apply to both forges (backwards
compatible). `ferry-update` filters the notes it prints based on the active
`--forge` flag, so consumers only see notes that apply to them.

```markdown
## v0.10.x → v0.11.0

forge: gitlab

- **(action)** GitLab-only follow-up …
```

Optionally declare secrets the consumer must have set for the transition by
adding a `requires-secrets:` line (parallel to `forge:`, comma- and/or
whitespace-separated). This is a **general mechanism**: any release that
introduces a newly-required secret uses it — it is not tied to one feature.

```markdown
## v0.X.x → v0.Y.0

requires-secrets: SOME_NEW_TOKEN
```

`ferry-update` stays **credential-silent for code-only ranges** (no
`requires-secrets:` → no prompt, credentials untouched). When the crossed
range declares one or more required secrets, it diffs them against
`gh secret list` and, **only for the missing ones**, prompts in an
interactive run (or, in a non-interactive run, stays on the bundled script
with no breakage and prints a mandatory follow-up to re-run interactively).
An explicit `execution_path: script` in `ferry.config.json` is always
respected. See ADR-0006 §7 and `docs/decisions/0002` §G.

Each bullet should be one of:

- `(action)` — something the consumer must do manually (new secret, Jira rule change, etc.)
- `(info)` — a behavior change worth knowing, but no action needed

If there are no consumer-visible changes, omit the section (or note `(none — internal changes only)`).

---

## v0.12.x → v0.13.0

requires-secrets: CLAUDE_CODE_OAUTH_TOKEN

- **(action)** **New `ferry-route` job** introduced ahead of every agent run in the four consumer workflows (`ferry-refine.yml`, `ferry-dev.yml`, `ferry-review.yml`, `ferry-iterate.yml`). It calls `big-emotion/ferry/.github/actions/ferry-route` and exposes a `path` output (`script` | `claude-code`) consumed by an `if:` on the agent jobs. Consumers using the bundled `examples/consumer-setup/workflows/` stubs pick this up automatically via `ferry-update` once `src/cli/init/templates.ts` is mirrored (tracked in the follow-up PR for the templates). Until then, copy the four workflow stubs from `examples/consumer-setup/workflows/` by hand if you want the routing decision wired. The routing-only PR is safe to ignore — without the four workflows updated, every run stays on the script path (the existing behaviour).
- **(info)** A `run-agent-claude-code` placeholder job is added alongside `run-agent` in each workflow. It is gated by `if: needs.route.outputs.path == 'claude-code'` and **fails loudly** with a clear error if reached. The actual `anthropics/claude-code-action@v1` invocation lands in a follow-up PR. If you want to opt into the claude-code path before that PR ships, leave `execution_path` unset in `ferry.config.yaml` and remove any `ferry:claude-code` labels — Ferry stays on the script path by default for mixed-provider configs.
- **(action)** **`CLAUDE_CODE_OAUTH_TOKEN` secret required for the claude-code execution path.** `ferry-update` checks whether the secret is already set (`gh secret list`). In an interactive run (TTY, without `--yes`), you are prompted to enter your Claude Code OAuth token — Ferry sets the secret on the repo and writes `execution_path: claude-code` to `ferry.config.json` automatically. In a non-interactive or `--dry-run` run, Ferry stays on the bundled script path (no breakage) and prints a mandatory follow-up asking you to re-run `ferry-update` interactively when ready to provision the secret. To permanently opt out of the claude-code path, set `execution_path: script` in `ferry.config.json` — the credential gate skips silently in that case.

---

## v0.10.x → v0.11.0

- **(info)** **GitLab support added behind an `FERRY_FORGE=gitlab` flag — experimental.** GitHub users are not affected; the default forge remains GitHub Actions. The GitLab adapter is shipped under [#210](https://github.com/big-emotion/ferry/issues/210) with templates in `examples/consumer-setup-gitlab/`. The experimental flag is expected to drop once a real consumer has run a full Refiner→Developer→Reviewer→Iterator cycle in production for two weeks. Until then, the bundled artifact may break across minor releases. See the promotion checklist on #210.
- **(info)** Per-ticket label overrides are now available (`ferry:model:*`, `ferry:provider:*`, `ferry:max-iterations:*`, `ferry:no-auto-transition`, `ferry:as/<type>`, `ferry:dry-run`, etc.) — opt-in, no action required. See `docs/CONFIGURATION.md`.
- **(info)** New cost CLIs: `ferry-cost-advice` (ranked savings) and `ferry-cost-reconcile` (audit-vs-Anthropic-CSV diff), alongside the existing `ferry-cost-report` / `ferry-cost-stats`. See `docs/COST.md`.
- **(info)** The four agent composite actions now invoke a single `ferry-agent` CLI internally (the per-role `.ferry/*-action.js` bundles are replaced by `.ferry/agent.js`). The composite-action interface is unchanged — `ferry-update` re-pins workflows to `@v0.11.0` automatically; no consumer action required.

---

## v0.10.2 → v0.10.3

- **(action)** Update `ferry-refine.yml` to pass `github_token: ${{ github.token }}` and `github_repo: ${{ github.repository }}` to the `ferry-run-refiner` step. Without these inputs, the Refiner agent crashes immediately on startup with `[ferry:state-invariant] missing-env GITHUB_TOKEN` (the underlying `createGitHubContext()` requires both env vars). Run `npx -p @big-emotion/ferry@v0.10.3 ferry-update` to apply the updated stub automatically, or edit the file by hand — the new lines belong alongside the existing `jira_*`, `*_api_key`, and `ferry_refiner_*` inputs.

---

## v0.7.x → v0.8.0

- **(info)** Composite action inputs expanded: all four agent actions (`ferry-run-developer`, `ferry-run-iterator`, `ferry-run-reviewer`, `ferry-run-refiner`) now accept inputs for the B2 selective variable set (`FERRY_DEV_MAX_INPUT_TOKENS`, `FERRY_MAX_COST_EUR_PER_RUN`, `FERRY_LLM_RETRY_MAX_ATTEMPTS`, etc.). Existing consumers continue to work without changes — new inputs are all optional with safe empty-string defaults.
- **(info)** Drive-by fix: the `ferry-run-developer` and `ferry-run-refiner` composite actions previously forwarded `ferry_model` → `FERRY_MODEL`, which is only read by the audit step and was silently ignored by the agent runtime. The inputs are now renamed to `ferry_dev_model` → `FERRY_DEV_MODEL` and `ferry_refiner_model` → `FERRY_REFINER_MODEL` respectively. If you passed `ferry_model` in a custom workflow, rename it to `ferry_dev_model` (developer) or `ferry_refiner_model` (refiner). Consumers using the bundled `examples/consumer-setup/workflows/` stubs get this automatically via `ferry-update`.
- **(action)** Run `npx -p @big-emotion/ferry@v0.8.0 ferry-update` to pick up the updated consumer workflow stubs, which wire the new `vars.*` variables (`FERRY_DEV_MAX_INPUT_TOKENS`, `FERRY_DEV_MODEL`, provider overrides, cost/retry controls). Without this step, new repo variables are silently ignored.

---

## v0.6.x → v0.7.0

- **(action)** Run `npx -p @big-emotion/ferry@v0.7.0 ferry-update` to migrate consumer workflows from reusable-workflow form to expanded form. Required for any consumer in a GitHub org other than `big-emotion` (cross-org `secrets: inherit` is unsupported by GitHub).
- **(info)** Workflow file count and names are unchanged (`ferry-refine.yml`, `ferry-dev.yml`, `ferry-review.yml`, `ferry-iterate.yml`). Each grows from ~25 lines to ~90 lines as the 3 jobs (`gate-envelope`, `run-agent`, `emit-audit`) move from the reusable workflow into the consumer file.
- **(info)** `ferry.config.yaml` config files now load correctly. If you converted to `ferry.config.json` as a workaround, both formats are supported; `ferry.config.json` takes precedence when both exist in the repo root.

---

## v0.5.3 → v0.6.0

- **(info)** Refiner and Reviewer reusable workflows now install `gitleaks` v8.21.2 on the runner before invoking the agent. Fixes `Error: spawn gitleaks ENOENT` crashes that affected every Refiner run and any Reviewer run that posted a Jira comment under `@v0.5.3` (and earlier). No consumer action required — `ferry-update` re-pins workflows to `@v0.6.0` automatically.
- **(info)** Reviewer Review↔Iterate auto-loop now respects `limits.max_iterations` (default 3) instead of stopping after a single iterator cycle. Reviewer Jira comments now include an "iteration N/M" hint. No consumer action required.
- **(info)** `ferry-doctor` adds a new D7 check that verifies `FERRY_AUDIT_ISSUE` repo variable is set, numeric, and points to an open issue. If you skipped README Step 1 you'll now see an actionable error instead of a runtime crash on the first Jira column move.

---

## v0.5.2 → v0.5.3

- **(info)** Refiner state-invariant errors now include a sample of the raw LLM text. No consumer action required — `ferry-update` re-pins workflows to `@v0.5.3` automatically.

---

## v0.5.1 → v0.5.2

- **(action)** v0.5.1 ships a broken refiner action (crashes with `Dynamic require of "child_process" is not supported` on every run because the bundled `@google/genai` SDK pulls `google-auth-library`'s CJS dynamic requires). Upgrade your pinned tag from `@v0.5.1` to `@v0.5.2` in every Ferry workflow stub (`.github/workflows/ferry-*.yml`) and in the `FERRY_REF` env value of `ferry-reconcile.yml` / `ferry-cost-daily.yml`. `ferry-update` does this automatically. No other consumer-visible changes.

---

## v0.5.0 → v0.5.1

- **(action)** Jira Automation custom body JSON format corrected: `{{now.format(...)}}` smart value was invalid and caused empty timestamp fields. Now uses `{{now.jiraDate}}` (valid Jira syntax). The `actor` field (which failed to resolve in column triggers) has been removed. Added `version` and `event_id` fields. If you manually created rules before v0.5.1, you must update the JSON in each rule's "Web request" action. `ferry-update` automatically regenerates `ferry-jira-automation-setup.md` with the corrected format — review and apply the new JSON to each rule before testing.

---

## v0.3.x → v0.4.0

- **(action)** The Anthropic API key secret has been renamed from `FERRY_ANTHROPIC_API_KEY` to `ANTHROPIC_API_KEY` to match what the reusable agent workflows actually read. After upgrading: re-run `gh secret set ANTHROPIC_API_KEY --body "<sk-ant-...>"` and then `gh secret delete FERRY_ANTHROPIC_API_KEY`. Without this step the agents will fail to authenticate with Anthropic.
- **(action)** If you ran a previous `ferry-init` and have `.github/workflows/ferry-reconciler.yml` or `ferry-audit-daily.yml`, delete them — they referenced reusable workflows that never existed. Replace them with the working stubs from the README's "Operations setup" step (`ferry-reconcile.yml` and `ferry-cost-daily.yml`, pulled from `examples/consumer-setup/workflows/`).
- **(info)** `ferry-init` now prompts for Jira column status names instead of requiring exact defaults. The defaults are unchanged (Refinement / In Development / In Review / Changes Requested / Ready to Merge).
- **(info)** `ferry-update` is now available to upgrade your workflow pins without re-entering credentials. Run `npx -p @big-emotion/ferry@0.4.0 ferry-update` after upgrading.
- **(info)** `ferry-uninstall` is now available to cleanly remove Ferry from a repo.
- **(info)** `docs/CONSUMER-SETUP.md` has been deleted. The install guide now lives in the README quick-install block.
- **(info)** `ferry-doctor` now also requires `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID` to report green — these were always needed by the agents (FR18 / FR24 / FR28) but the doctor previously did not check for them.
