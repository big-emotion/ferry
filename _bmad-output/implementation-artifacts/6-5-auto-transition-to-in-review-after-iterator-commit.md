# 6-5 Auto-Transition to In Review After Iterator Commit

Status: review

## Implementation

`src/agents/iterator/transition.ts` exports `decideIteratorTransition` which
returns the In-Review Jira status, `ferry:reviewing` label, phase `reviewing`,
and an incremented `state.iteration`. `self_dispatch` is always `false` —
Jira Automation fires the next `repository_dispatch` (FR28).

## Tests

`src/agents/iterator/transition.test.ts` asserts the mapping and increment.
