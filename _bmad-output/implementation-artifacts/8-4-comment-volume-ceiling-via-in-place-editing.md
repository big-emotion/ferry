# 8-4 Comment-Volume Ceiling via In-Place Editing

Status: review

## Implementation

`src/lib/io/jira-upsert.ts` exports `upsertJiraComment` — given the existing
comment list and the role + run_id, returns either an `update` directive
(target comment id + new body with refreshed marker) or `create` when no
marker for that role exists (FR60, NFR-UX4). Different roles produce
separate comments; matching is by `[ferry:<role>:` prefix only so run_id
changes do not split comments.

## Tests

`src/lib/io/jira-upsert.test.ts` covers update-in-place, fresh create,
role separation, and run_id-agnostic matching.
