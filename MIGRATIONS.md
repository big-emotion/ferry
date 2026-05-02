# Ferry Migration Notes

This file documents consumer-visible changes between Ferry releases.
`ferry-update` reads the relevant section(s) and prints them as **Manual follow-ups required** after upgrading.

## How to add entries

Add a `## <from> → <to>` section before each release. Use either:
- An exact version pair: `## v0.3.0 → v0.3.1`
- A wildcard range: `## v0.3.x → v0.4.0` (matches any 0.3.* source)

Each bullet should be one of:
- `(action)` — something the consumer must do manually (new secret, Jira rule change, etc.)
- `(info)` — a behavior change worth knowing, but no action needed

If there are no consumer-visible changes, omit the section (or note `(none — internal changes only)`).

---

## v0.3.0 → v0.3.1

(none — internal changes only: workflow stub version pins, ferry-init Jira import beta, column-name consistency fix, wizard ARI/project-ID auto-detection)

---

## v0.3.x → v0.4.0

- **(info)** `ferry-init` now prompts for Jira column status names instead of requiring exact defaults. If you previously customised your board to match Ferry's exact defaults, no action needed — the defaults are unchanged (Refinement / In Development / In Review / Changes Requested / Ready to Merge).
- **(info)** `ferry-update` is now available to upgrade your workflow pins without re-entering credentials. Run `npx -p @big-emotion/ferry@0.4.0 ferry-update` after upgrading.
- **(info)** `ferry-uninstall` is now available to cleanly remove Ferry from a repo.
- **(info)** `docs/CONSUMER-SETUP.md` has been deleted. The install guide now lives in the README quick-install block.
