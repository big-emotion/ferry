import { describe, expect, it } from 'vitest';
import { checkIterationCap } from './cap.js';
import { FerryError } from '../../lib/errors/index.js';

describe('iteration cap', () => {
  it('proceeds at iteration 0,1,2', () => {
    for (const i of [0, 1, 2]) {
      expect(checkIterationCap({ iteration: i, hasFindings: true })).toEqual({
        proceed: true,
      });
    }
  });

  it('throws oscillation at iteration === 3 with findings', () => {
    expect(() => checkIterationCap({ iteration: 3, hasFindings: true })).toThrow(FerryError);
  });

  it('does not throw at iteration 3 if there are no remaining findings', () => {
    expect(checkIterationCap({ iteration: 3, hasFindings: false })).toEqual({
      proceed: true,
    });
  });
});
