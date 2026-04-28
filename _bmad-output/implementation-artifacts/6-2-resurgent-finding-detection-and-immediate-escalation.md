# 6-2 Resurgent-Finding Detection and Immediate Escalation

Status: review

## Implementation

`src/lib/fingerprint/resurgence.ts` exports `detectResurgence` which compares
the current fingerprint set against the previous iteration's set. Throws
`FerryError("oscillation", { reason: "resurgent-findings" })` immediately when
intersection is non-empty AND `iteration >= 1` (FR27); otherwise returns the
resurgent set without throwing.

## Tests

`src/lib/fingerprint/resurgence.test.ts` covers the four branches.
