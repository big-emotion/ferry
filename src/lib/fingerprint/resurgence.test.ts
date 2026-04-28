import { describe, expect, it } from 'vitest';
import { detectResurgence } from './resurgence.js';
import { FerryError } from '../error.js';

describe('resurgence detection', () => {
  it('proceeds when no resurgent fingerprints', () => {
    expect(
      detectResurgence({
        iteration: 1,
        previous: ['a', 'b'],
        current: ['c'],
      }),
    ).toEqual({ resurgent: [] });
  });

  it('throws FerryError(oscillation) when resurgent at iteration >= 1', () => {
    expect(() =>
      detectResurgence({
        iteration: 1,
        previous: ['a', 'b'],
        current: ['a', 'c'],
      }),
    ).toThrow(FerryError);
  });

  it('does not throw at iteration 0 even if duplicates present', () => {
    expect(() =>
      detectResurgence({
        iteration: 0,
        previous: ['a'],
        current: ['a'],
      }),
    ).not.toThrow();
  });

  it('returns the resurgent set on early iterations', () => {
    const out = detectResurgence({
      iteration: 0,
      previous: ['a', 'b'],
      current: ['b', 'c'],
    });
    expect(out.resurgent).toEqual(['b']);
  });
});
