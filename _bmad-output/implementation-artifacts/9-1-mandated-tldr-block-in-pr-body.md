# 9-1 Mandated TL;DR Block in PR Body

Status: review

## Implementation

`src/lib/io/tldr.ts` exports `buildTldrBlock`, `upsertTldrInBody`, and
`updateReviewerVerdictField`. The block is a 6-field markdown table —
Ships, Touches, Risk, Tests, Rollback, Reviewer verdict — wrapped in
`<!-- ferry:tldr -->` markers and capped at 500 characters total (FR55).
Idempotent on re-write so the Iterator can refresh without duplicating;
the Reviewer verdict cell is updated in place with a 40-char truncation.

## Tests

`src/lib/io/tldr.test.ts` covers field order, length cap, idempotent
upsert, and verdict-field update including the truncation rule.
