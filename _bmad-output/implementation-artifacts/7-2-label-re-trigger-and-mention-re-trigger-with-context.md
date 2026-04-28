# 7-2 Label Re-Trigger and @Mention Re-Trigger With Context

Status: review

## Implementation

`src/lib/dispatch/retrigger.ts` exports `buildRetriggerEnvelope` which mints
the dispatch envelope from a `jira-label` or `jira-mention` source. @mention
instructions are wrapped in `delimitUntrusted()` (NFR-S1) before being
appended to the agent prompt; the caller is responsible for providing a
fresh ULID `event_id` so re-triggers are not blocked by the dedupe ledger
(FR35, FR36).

## Tests

`src/lib/dispatch/retrigger.test.ts` covers label-only, @mention with
instructions wrapped untrusted, and event_id pass-through.
