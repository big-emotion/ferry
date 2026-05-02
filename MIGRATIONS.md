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

## v0.3.x → v0.4.0

- **(action)** The Anthropic API key secret has been renamed from `FERRY_ANTHROPIC_API_KEY` to `ANTHROPIC_API_KEY` to match what the reusable agent workflows actually read. After upgrading: re-run `gh secret set ANTHROPIC_API_KEY --body "<sk-ant-...>"` and then `gh secret delete FERRY_ANTHROPIC_API_KEY`. Without this step the agents will fail to authenticate with Anthropic.
- **(action)** If you ran a previous `ferry-init` and have `.github/workflows/ferry-reconciler.yml` or `ferry-audit-daily.yml`, delete them — they referenced reusable workflows that never existed. Replace them with the working stubs from the README's "Operations setup" step (`ferry-reconcile.yml` and `ferry-cost-daily.yml`, pulled from `examples/consumer-setup/workflows/`).
- **(info)** `ferry-init` now prompts for Jira column status names instead of requiring exact defaults. The defaults are unchanged (Refinement / In Development / In Review / Changes Requested / Ready to Merge).
- **(info)** `ferry-update` is now available to upgrade your workflow pins without re-entering credentials. Run `npx -p @big-emotion/ferry@0.4.0 ferry-update` after upgrading.
- **(info)** `ferry-uninstall` is now available to cleanly remove Ferry from a repo.
- **(info)** `docs/CONSUMER-SETUP.md` has been deleted. The install guide now lives in the README quick-install block.
- **(info)** `ferry-doctor` now also requires `FERRY_REVIEW_TRANSITION_ID` and `FERRY_ITER_TRANSITION_ID` to report green — these were always needed by the agents (FR18 / FR24 / FR28) but the doctor previously did not check for them.
