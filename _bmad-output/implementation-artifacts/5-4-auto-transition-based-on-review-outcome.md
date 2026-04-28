# 5-4 Auto-Transition Based on Review Outcome

Status: review

## Story

After the reviewer renders a verdict, the ticket auto-transitions to the
correct next state based on the decision (FR24, FR40).

## Implementation

`src/agents/reviewer/transition.ts` exports `decideReviewerTransition` which
maps decision to:

- `merge-ready` → Jira `Ready to Merge`, add `ferry:ready`, remove
  `ferry:reviewing`, phase `ready`.
- `changes-requested` → Jira `Changes Requested`, remove `ferry:reviewing`,
  phase `iterating`.
- `needs-human` → no column move, add `needs-human`, phase `escalated`.

`self_dispatch` is always `false`: Jira Automation fires the next
`repository_dispatch` (FR40), Ferry never self-triggers.

## Tests

`src/agents/reviewer/transition.test.ts` covers the three branches.
