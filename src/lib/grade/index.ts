/**
 * Reviewer-grade rubric and verdict computation.
 *
 * The Ferry reviewer rubric scores a code review along four dimensions, each 0–2:
 *
 * - **substantive**: did the review address the actual change in the PR?
 * - **specific**: did findings cite concrete files, lines, or behaviors?
 * - **correct**: were findings technically right (no false positives, no fabricated bugs)?
 * - **actionable**: was a clear next step or fix proposed for each finding?
 *
 * The total score (0–8) maps to one of three verdicts:
 *
 * - `actionable`: total ≥ 5
 * - `weak`: total 3–4
 * - `rubber_stamp`: total ≤ 2
 *
 * Override: if `correct === 0`, the verdict is **capped at `weak`** — even if the
 * totals would otherwise yield `actionable`. A review with no correct findings is
 * never actionable, regardless of how substantive, specific, or actionable it
 * appears. The override does not promote `rubber_stamp` upward.
 */

export interface RubricScores {
  substantive: number;
  specific: number;
  correct: number;
  actionable: number;
}

export type ReviewerVerdict = 'actionable' | 'weak' | 'rubber_stamp';

const ALLOWED_SCORES = new Set([0, 1, 2]);

function assertScore(name: keyof RubricScores, value: number): void {
  if (!Number.isInteger(value) || !ALLOWED_SCORES.has(value)) {
    throw new Error(`Rubric score "${name}" must be an integer in {0, 1, 2}, got ${value}`);
  }
}

export function computeReviewerVerdict(scores: RubricScores): ReviewerVerdict {
  assertScore('substantive', scores.substantive);
  assertScore('specific', scores.specific);
  assertScore('correct', scores.correct);
  assertScore('actionable', scores.actionable);

  const total = scores.substantive + scores.specific + scores.correct + scores.actionable;

  let verdict: ReviewerVerdict;
  if (total >= 5) {
    verdict = 'actionable';
  } else if (total >= 3) {
    verdict = 'weak';
  } else {
    verdict = 'rubber_stamp';
  }

  // Cap actionable at weak when correctness is zero — never promote rubber_stamp.
  if (scores.correct === 0 && verdict === 'actionable') {
    verdict = 'weak';
  }

  return verdict;
}
