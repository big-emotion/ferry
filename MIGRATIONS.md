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

## v0.3.x → v0.3.0

(none — initial release)
