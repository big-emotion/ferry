/**
 * Reviewer helper utilities shared between the reviewer agent's in-loop code
 * (`src/agents/reviewer/review-loop.ts`, `src/agents/reviewer/rubric.ts`) and
 * the pre-loop setup (`src/lib/agent-runtime/reviewer-prepare.ts`).
 *
 * Moved into `src/lib/agent-runtime/**` to preserve the project's layering
 * invariant: `src/lib/**` is the shared lower layer and `src/agents/**` is
 * its consumer — the lib layer must never reach into agent modules.
 *
 * The original locations re-export from here so existing call sites under
 * `src/agents/reviewer/**` keep importing them with no diff churn.
 */
import type { PRFile } from '../dispatch/runner/types.js';
import type { TicketOverrides } from '../labels/capabilities.js';

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

export function detectMergeConflicts(files: PRFile[]): string[] {
  const conflicted: string[] = [];
  for (const f of files) {
    if (f.patch && /^[+].*<{7}|^[+].*={7}|^[+].*>{7}/m.test(f.patch)) {
      conflicted.push(f.filename);
    }
  }
  return conflicted;
}

export function buildFileList(files: PRFile[]): string {
  return files
    .map((f) => `${f.status.padEnd(8)} +${f.additions} -${f.deletions}  ${f.filename}`)
    .join('\n');
}
