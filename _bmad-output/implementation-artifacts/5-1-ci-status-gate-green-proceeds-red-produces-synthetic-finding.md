# 5-1 CI-Status Gate — Green Proceeds, Red Produces Synthetic Finding

Status: review

## Story

As a Ferry Reviewer agent, I want to check CI status before spending any model
tokens and treat red CI as a finding in itself, so that LLM review costs are
only incurred on code that already passes automated checks.

## Acceptance Criteria

- Pending CI: exit with `outcome: "pending-ci"`, no LLM call, no findings posted.
- Red CI: emit a synthetic finding with `rule_id: "ci-failure"`, transition to
  `Changes Requested`, audit `input_tokens=0, output_tokens=0, cost_eur=0`.
- Green CI: proceed to real review path.
- Both branches always emit an audit decision via the gate output.

## Implementation

`src/agents/reviewer/ci-gate.ts` exports a pure `gateCi(status)` function that
maps a CI status (`pending`/`green`/`red`) plus optional failure summary into a
structured `CiGateOutcome`. The audit-friendly outcome string and synthetic
finding are deterministic.

## Tests

`src/agents/reviewer/ci-gate.test.ts` covers all three branches and asserts the
synthetic finding shape for red CI.
