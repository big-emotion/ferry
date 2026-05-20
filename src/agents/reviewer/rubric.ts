/**
 * Reviewer rubric overlay — appended to the base reviewer system prompt when
 * `ferry:strict-review` or `ferry:lenient-review` is on the ticket.
 *
 * The implementation lives in `src/lib/agent-runtime/reviewer-helpers.ts`
 * (the lib layer cannot depend on agents/**, so the canonical location of
 * the helper moved there in #330). This file is kept as a re-export so the
 * reviewer agent's existing import paths stay valid.
 */

export { applyRubricToPrompt } from '../../lib/agent-runtime/reviewer-helpers.js';
