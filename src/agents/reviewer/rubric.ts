/**
 * Reviewer rubric overlay — appended to the base reviewer system prompt when
 * `ferry:strict-review` or `ferry:lenient-review` is on the ticket.
 *
 * Kept short and append-only (not a base-prompt swap) so the rubric overlay
 * composes with the existing `prompts/review.md` and any optional
 * `prompts/review-comment.md` overlay. The directive is the LAST section of the
 * system prompt — it overrides earlier instructions about review strictness.
 */

import type { TicketOverrides } from '../../lib/agent-runtime/index.js';

const STRICT_DIRECTIVE = [
  '## Rubric override — strict',
  '',
  'For this review, apply a STRICTER bar than usual:',
  '',
  '- Block on any missing test coverage for new/changed behaviour.',
  '- Block on missing edge-case handling, error paths, or input validation.',
  '- Block on weak naming, dead code, or unreachable branches.',
  '- Block on incomplete documentation when public APIs change.',
  '- Approve only when every acceptance criterion is fully satisfied with concrete evidence.',
].join('\n');

const LENIENT_DIRECTIVE = [
  '## Rubric override — lenient',
  '',
  'For this review, apply a MORE PERMISSIVE bar than usual:',
  '',
  '- Approve when the acceptance criteria are met, even if minor polish is missing.',
  '- Treat naming nits, non-blocking style issues, and stylistic preferences as comments — not blockers.',
  '- Block only on: failing tests, unimplemented ACs, merge conflicts, committed build artefacts, or security regressions.',
  '- Prefer "approve with comments" over "request changes" when issues are non-blocking.',
].join('\n');

/**
 * Appends a rubric-override directive to the reviewer system prompt.
 *
 * - `rubric === 'strict'`  → appends the strict directive.
 * - `rubric === 'lenient'` → appends the lenient directive.
 * - `rubric === undefined` → returns `basePrompt` unchanged.
 *
 * The directive is appended (not substituted) so it composes with the base
 * prompt and any optional overlay. It is placed last, so it wins when it
 * disagrees with earlier sections.
 */
export function applyRubricToPrompt(
  basePrompt: string,
  rubric: TicketOverrides['reviewRubric'],
): string {
  if (rubric === undefined) return basePrompt;
  const directive = rubric === 'strict' ? STRICT_DIRECTIVE : LENIENT_DIRECTIVE;
  return `${basePrompt}\n\n---\n\n${directive}`;
}
