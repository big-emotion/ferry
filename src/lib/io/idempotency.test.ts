import { describe, it, expect } from 'vitest';
import { appendMarker, checkIdempotencyMarker } from './idempotency.js';

describe('io/idempotency', () => {
  describe('checkIdempotencyMarker', () => {
    it('returns skipped:true when any item contains the marker', () => {
      expect(checkIdempotencyMarker('[ferry:dev:01H]', ['hello', 'x [ferry:dev:01H] y'])).toEqual({
        skipped: true,
      });
    });

    it('returns skipped:false when marker not present', () => {
      expect(checkIdempotencyMarker('[ferry:dev:01H]', ['hello', 'world'])).toEqual({
        skipped: false,
      });
    });
  });

  describe('appendMarker', () => {
    it('appends marker with a blank line separator when not already present', () => {
      expect(appendMarker('payload', '[ferry:dev:01H]')).toBe('payload\n\n[ferry:dev:01H]');
    });

    it('is a no-op when marker already present', () => {
      expect(appendMarker('payload\n\n[ferry:dev:01H]', '[ferry:dev:01H]')).toBe(
        'payload\n\n[ferry:dev:01H]',
      );
    });
  });
});
