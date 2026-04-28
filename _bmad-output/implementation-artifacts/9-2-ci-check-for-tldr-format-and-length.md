# 9-2 CI Check for TL;DR Format and Length

Status: review

## Implementation

`src/lib/io/tldr-validate.ts` exports `validateTldrBlock(body, author_login,
ferry_bot_login)` — passes when a well-formed block is present and the
author is the ferry bot, fails with explicit messages when the block is
missing, out of order, or > 500 chars (FR56). Human-authored PRs are
skipped (`{ ok: true, skipped: true }`).

## Tests

`src/lib/io/tldr-validate.test.ts` covers all four failure modes plus the
human-author skip path.
