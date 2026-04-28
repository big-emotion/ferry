/**
 * Resurgent-finding detection.
 *
 * Compares the current fingerprint set against the last iteration's set.
 * Throws `FerryError("oscillation")` when intersection is non-empty AND
 * `iteration >= 1` so we escalate immediately instead of looping (FR27).
 */

import { FerryError } from '../error.js';

export interface ResurgenceInput {
  iteration: number;
  previous: string[];
  current: string[];
}

export interface ResurgenceOutcome {
  resurgent: string[];
}

export function detectResurgence(input: ResurgenceInput): ResurgenceOutcome {
  const prev = new Set(input.previous);
  const resurgent = input.current.filter((fp) => prev.has(fp));
  if (input.iteration >= 1 && resurgent.length > 0) {
    throw new FerryError('oscillation', {
      reason: 'resurgent-findings',
      resurgent,
      iteration: input.iteration,
    });
  }
  return { resurgent };
}
