# 6-1 Iterator Reads Review History and Applies Findings

Status: review

## Implementation

- `src/agents/iterator/prompt.ts`: `buildIteratorPrompt` injects iteration
  history (with fingerprints and pr_sha), the latest findings, the allowed
  `touch_paths` and the branch HEAD; `formatCommitMessage` produces the
  `[CHAN-XX] fix: <summary>` body with the iterator run-id marker.

## Tests

`src/agents/iterator/prompt.test.ts` covers 0/1/2 prior-iteration cases plus
the commit-message formatter.
