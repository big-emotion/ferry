# 8-2 HTTP 429/402 Auto-Pause on Provider Rate Limits

Status: review

## Implementation

`src/lib/io/spend-cap.ts` exports `classifyHttpStatus` (429/402 →
spend-cap, 5xx → transient, 2xx → ok) and `buildSpendCapPause` which
returns the pause directive with both labels (`ferry:paused`,
`ferry:spend-cap`), a Jira comment carrying the role:run_id marker, and the
`spend-cap` audit outcome (FR46, NFR-R4). Pauses are ticket-scoped, never
global.

## Tests

`src/lib/io/spend-cap.test.ts` covers all classifier branches and the
pause directive payload.
