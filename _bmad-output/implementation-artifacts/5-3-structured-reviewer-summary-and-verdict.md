# 5-3 Structured Reviewer Summary and Verdict

Status: review

## Story

A structured 3-field verdict (decision, top-risk, reading-time-estimate)
written into a delimited bot-owned slot in the PR body so operators can
triage in under 2 minutes (FR58, NFR-UX3).

## Implementation

`src/agents/reviewer/verdict.ts`:

- `buildVerdict({ findings, diffLines })` returns merge-ready when there are
  no findings; otherwise changes-requested with the first finding (preferring
  ci-failure) as top-risk.
- `truncateVerdict(v)` throws `ReviewerVerdictError` if the verdict exceeds
  the 120-word cap.
- `writeVerdictToBody(body, v)` writes or replaces the
  `<!-- ferry:reviewer-verdict --> ... <!-- /ferry:reviewer-verdict -->`
  slot idempotently.

## Tests

`src/agents/reviewer/verdict.test.ts` covers all branches plus idempotent
re-write of the verdict slot.
