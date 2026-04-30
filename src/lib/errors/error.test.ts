import { describe, it, expect } from 'vitest';
import { FerryError, type FerryErrorCode } from './index.js';

describe('FerryError', () => {
  it('is an instance of Error', () => {
    const e = new FerryError('state-invariant');
    expect(e).toBeInstanceOf(Error);
  });

  it('exposes code property', () => {
    const e = new FerryError('spend-cap');
    expect(e.code).toBe('spend-cap');
  });

  it('name is FerryError', () => {
    const e = new FerryError('transient');
    expect(e.name).toBe('FerryError');
  });

  it('message includes error code', () => {
    const e = new FerryError('oscillation');
    expect(e.message).toContain('oscillation');
  });

  it('includes context in message when provided', () => {
    const e = new FerryError('state-invariant', { field: 'phase' });
    expect(e.message).toContain('phase');
  });

  it('accepts all 5 error codes', () => {
    const codes: FerryErrorCode[] = [
      'state-invariant',
      'spend-cap',
      'transient',
      'oscillation',
      'unknown',
    ];
    for (const code of codes) {
      expect(() => new FerryError(code)).not.toThrow();
    }
  });
});
