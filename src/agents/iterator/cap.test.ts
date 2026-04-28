import { describe, expect, it } from 'vitest';
import { checkIterationCap } from './cap.js';
import { FerryError } from '../../lib/error.js';

describe('iteration cap', () => {
  it('proceeds at iteration 0,1,2', () => {
    for (const i of [0, 1, 2]) {
      expect(checkIterationCap({ iteration: i, hasFindings: true })).toEqual({
        proceed: true,
      });
    }
  });

  it('throws oscillation at iteration === 3 with findings', () => {
    let caught: unknown;
    try {
      checkIterationCap({ iteration: 3, hasFindings: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('oscillation');
    expect((caught as FerryError).context).toMatchObject({
      reason: '3-iteration-cap',
      iteration: 3,
    });
  });

  it('also throws at iteration > 3 with findings (defensive >= 3 cap)', () => {
    let caught: unknown;
    try {
      checkIterationCap({ iteration: 4, hasFindings: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('oscillation');
    expect((caught as FerryError).context).toMatchObject({
      reason: '3-iteration-cap',
      iteration: 4,
    });
  });

  it('does not throw at iteration 3 if there are no remaining findings', () => {
    expect(checkIterationCap({ iteration: 3, hasFindings: false })).toEqual({
      proceed: true,
    });
  });
});
