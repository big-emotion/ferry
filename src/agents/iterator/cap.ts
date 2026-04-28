/**
 * Iteration cap (3 rounds). Throws `FerryError("oscillation")` at iteration
 * `>= 3` when findings remain (FR29). The `>= 3` boundary (rather than
 * `=== 3`) is intentionally defensive: any state-store drift that produces
 * an unexpectedly high iteration counter must still trip the cap rather
 * than silently bypass it. Lower iterations (or zero remaining findings)
 * proceed normally.
 */

import { FerryError } from '../../lib/error.js';

export interface CapInput {
  iteration: number;
  hasFindings: boolean;
}

export function checkIterationCap(input: CapInput): { proceed: true } {
  if (input.iteration >= 3 && input.hasFindings) {
    throw new FerryError('oscillation', {
      reason: '3-iteration-cap',
      iteration: input.iteration,
    });
  }
  return { proceed: true };
}
