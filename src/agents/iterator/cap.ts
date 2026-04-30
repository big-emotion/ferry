/**
 * Oscillation cap. Throws `FerryError("oscillation")` when `iteration` meets
 * or exceeds `cap` and findings remain (FR29). Configurable via ferry.config
 * (limits.max_iterations); defaults to 3.
 */

import { FerryError } from '../../lib/errors/index.js';

export interface CapInput {
  iteration: number;
  hasFindings: boolean;
}

export function checkIterationCap(input: CapInput, cap = 3): { proceed: true } {
  if (input.iteration >= cap && input.hasFindings) {
    throw new FerryError('oscillation', {
      reason: 'iteration-cap-exceeded',
      cap,
      iteration: input.iteration,
    });
  }
  return { proceed: true };
}
