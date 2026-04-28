# 6-3 3-Iteration Cap with needs-human Escalation

Status: review

## Implementation

`src/agents/iterator/cap.ts` exports `checkIterationCap` which throws
`FerryError("oscillation", { reason: "3-iteration-cap" })` at iteration === 3
when findings remain, otherwise returns `{ proceed: true }` (FR29). Iterations
0..2 always proceed.

## Tests

`src/agents/iterator/cap.test.ts` asserts cap fires only at exactly 3 with
findings present.
