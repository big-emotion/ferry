# 7-4 Human-Only Merge and Column-Transition Invariants

Status: review

## Implementation

`src/lib/policy/no-auto-merge.ts` exports `scanForMergeCalls` — walks
`src/**/*.ts` looking for any `octokit.pulls.merge` call (FR39). Used both
by the unit test and as a companion lint check. The README already states
the invariant explicitly with the three allowed auto-transitions
(FR18/FR24/FR28).

## Tests

`src/lib/policy/no-auto-merge.test.ts` asserts: zero offenders under `src/`,
correct positive detection on synthetic snippets, no false positives on
harmless prose, and the README invariant phrasing is intact.
