# Ferry Migration Notes

This file documents consumer-visible changes between Ferry releases.
`ferry-update` reads the relevant section(s) and prints them as **Manual follow-ups required** after upgrading.

## How to add entries

Add a `## <from> → <to>` section before each release. Use either:

- An exact version pair: `## v0.3.0 → v0.3.1`
- A wildcard range: `## v0.3.x → v0.4.0` (matches any 0.3.\* source)

Each bullet should be one of:

- `(action)` — something the consumer must do manually (new secret, Jira rule change, etc.)
- `(info)` — a behavior change worth knowing, but no action needed

If there are no consumer-visible changes, omit the section (or note `(none — internal changes only)`).

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
