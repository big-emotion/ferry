# 7-3 Pause and Needs-Human Label Handling

Status: review

## Implementation

`src/lib/preflight/halt-labels.ts` exports `checkHaltLabels` — returns
`halt: true, outcome: 'paused'` when `ferry:paused` is present (FR37) and
`outcome: 'needs_human_halt'` when `needs-human` is present (FR38). Pause
takes precedence (most-restrictive wins). Returns `halt: false` otherwise so
re-triggers proceed once the label is removed.

## Tests

`src/lib/preflight/halt-labels.test.ts` covers all branches plus the
precedence rule.
