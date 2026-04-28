# 5-2 Code Review with Fingerprinted Findings and Rule Taxonomy

Status: review

## Story

As a Ferry Reviewer agent, I want to post findings with structured rule IDs and
store fingerprints so oscillation can be detected, so that each finding is
traceable, dedupable across iterations, and the Iterator knows exactly which
issues persist.

## Acceptance Criteria

- Findings reference a `rule_id` from `examples/reviewer-rules.yaml` (plus the
  synthetic `ci-failure`); unknown ids cause a re-run trigger.
- Each fingerprint is `SHA-256({file, line_start, line_end, rule_id})` with
  POSIX-normalized paths (FR22).
- Schema rejects empty messages.

## Implementation

- `src/lib/fingerprint/index.ts`: `fingerprint()` and `fingerprintFinding()`.
- `src/agents/reviewer/schema.ts`: taxonomy loader + `validateFindings()` that
  throws `ReviewerFindingsSchemaError` listing unknown ids.

## Tests

- `src/lib/fingerprint/index.test.ts` covers determinism, path normalization,
  rule-id sensitivity, and the optional-fields wrapper.
- `src/agents/reviewer/schema.test.ts` covers known/unknown ids, the synthetic
  `ci-failure`, and empty messages.
