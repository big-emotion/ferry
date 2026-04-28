/**
 * Halt-label preflight check.
 *
 * Pure function that inspects the ticket label set for `ferry:paused` (FR37)
 * and `needs-human` (FR38) and returns whether the run must short-circuit
 * with no LLM call, no state write, and no sub-task creation.
 *
 * `ferry:paused` takes precedence so the most-restrictive label wins.
 */

/** Outcome strings emitted by the audit line (not Jira labels). */
export type HaltOutcome = 'paused' | 'needs_human_halt';

export interface HaltCheckInput {
  labels: string[];
}

export type HaltCheckResult =
  | { halt: true; outcome: HaltOutcome }
  | { halt: false; outcome?: undefined };

export function checkHaltLabels(input: HaltCheckInput): HaltCheckResult {
  const set = new Set(input.labels);
  if (set.has('ferry:paused')) return { halt: true, outcome: 'paused' };
  if (set.has('needs-human')) {
    return { halt: true, outcome: 'needs_human_halt' };
  }
  return { halt: false };
}
