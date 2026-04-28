/**
 * CI validator for the mandated TL;DR block (FR56). Skips human-authored PRs.
 */

import { TLDR_FIELD_ORDER, TLDR_MAX_LEN, TLDR_SLOT } from './tldr.js';

export type ValidateResult = { ok: true; skipped?: boolean } | { ok: false; message: string };

export function validateTldrBlock(
  body: string,
  author_login: string,
  ferry_bot_login: string,
): ValidateResult {
  if (author_login !== ferry_bot_login) {
    return { ok: true, skipped: true };
  }
  const match = TLDR_SLOT.exec(body);
  if (!match) {
    return {
      ok: false,
      message: 'TL;DR block missing. Developer must include the ferry:tldr section.',
    };
  }
  const block = match[0];
  if (block.length > TLDR_MAX_LEN) {
    return {
      ok: false,
      message: `TL;DR block too long. Maximum is ${TLDR_MAX_LEN} characters.`,
    };
  }
  const labelRe = /\|\s*(Ships|Touches|Risk|Tests|Rollback|Reviewer verdict)\s*\|/g;
  const seen: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(block)) !== null) seen.push(m[1]);
  // Distinguish missing fields from misordered fields so authors get an actionable message.
  const missing = TLDR_FIELD_ORDER.filter((f) => !seen.includes(f));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `TL;DR block missing required field(s): ${missing.join(', ')}.`,
    };
  }
  for (let i = 0; i < TLDR_FIELD_ORDER.length; i++) {
    if (seen[i] !== TLDR_FIELD_ORDER[i]) {
      return {
        ok: false,
        message:
          'TL;DR fields out of order. Expected: Ships, Touches, Risk, Tests, Rollback, Reviewer verdict.',
      };
    }
  }
  return { ok: true };
}
