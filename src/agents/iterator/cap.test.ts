import { describe, expect, it } from 'vitest';
import { checkIterationCap } from './cap.js';
import { FerryError } from '../../lib/errors/index.js';

describe('iteration cap', () => {
  describe('default cap (3)', () => {
    it('proceeds at iteration 0, 1, 2', () => {
      for (const i of [0, 1, 2]) {
        expect(checkIterationCap({ iteration: i, hasFindings: true })).toEqual({ proceed: true });
      }
    });

    it('throws oscillation at iteration === 3 with findings', () => {
      expect(() => checkIterationCap({ iteration: 3, hasFindings: true })).toThrow(FerryError);
    });

    it('does not throw at iteration 3 with no remaining findings', () => {
      expect(checkIterationCap({ iteration: 3, hasFindings: false })).toEqual({ proceed: true });
    });
  });

  describe('configurable cap', () => {
    it('proceeds below a custom cap', () => {
      expect(checkIterationCap({ iteration: 4, hasFindings: true }, 5)).toEqual({ proceed: true });
    });

    it('throws at a custom cap boundary', () => {
      expect(() => checkIterationCap({ iteration: 5, hasFindings: true }, 5)).toThrow(FerryError);
    });

    it('cap=1 throws on first iteration with findings', () => {
      expect(() => checkIterationCap({ iteration: 1, hasFindings: true }, 1)).toThrow(FerryError);
    });

    it('includes cap and iteration in error context', () => {
      let thrown: FerryError | null = null;
      try {
        checkIterationCap({ iteration: 2, hasFindings: true }, 2);
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown?.context?.cap).toBe(2);
      expect(thrown?.context?.iteration).toBe(2);
    });
  });
});
