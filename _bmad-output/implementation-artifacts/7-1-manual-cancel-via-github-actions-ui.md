# 7-1 Manual Cancel via GitHub Actions UI

Status: review

## Implementation

`src/lib/preflight/cancel-recovery.ts` exports `detectStaleAfterCancel` —
when the stored `pr_sha` does not match the current HEAD or schema validation
fails, the next run is flagged stale, the ticket gets `status:stale`, and
writes are short-circuited (FR34). Fresh tickets (no stored pr_sha) and
clean states proceed normally.

## Tests

`src/lib/preflight/cancel-recovery.test.ts` covers SHA mismatch, schema
failure, clean state, and the no-stored-sha case.
