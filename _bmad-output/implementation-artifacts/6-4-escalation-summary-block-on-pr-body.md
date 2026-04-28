# 6-4 Escalation Summary Block on PR Body

Status: review

## Implementation

`src/lib/io/escalation.ts` builds the structured escalation block with five
required sections (`What I tried` 2-5 bullets ≤120 chars, `What blocked me` ≥1
fingerprinted finding, `My best hypothesis` ≤400 chars, `Suggested next
action`, optional `Context`) wrapped in `<!-- ferry:escalation -->` markers.
`writeEscalationToBody` is idempotent on re-run; `clearEscalationFromBody`
removes the slot once the human resolves the escalation (FR59).

## Tests

`src/lib/io/escalation.test.ts` covers schema invariants, idempotent rewrite,
and clear-after-resolution.
