# 8-1 Daily Provider Spend Check and 50% Soft Alert

Status: review

## Implementation

`src/cost-governance/daily-check.ts` exports `evaluateDailyCheck` and
`formatSpendAlert` — pure helpers that compute per-provider spend ratio
against `FERRY_MAX_SPEND_EUR` and emit a structured alert payload when any
provider crosses the 50% threshold (FR45, NFR-C4). Alert text includes
provider, percent, cap, monthly and daily costs in `€X.XX` format with
clamped negatives.

## Tests

`src/cost-governance/daily-check.test.ts` covers all-under-threshold,
single-provider alert, formatted text content, and negative clamp.
