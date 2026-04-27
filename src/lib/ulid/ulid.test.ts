import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateULID } from './index.js';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('generateULID', () => {
  it('returns a 26-character Crockford base32 string', () => {
    const id = generateULID();
    expect(id).toMatch(ULID_PATTERN);
  });

  it('returns different values on successive unseeded calls', () => {
    const a = generateULID();
    const b = generateULID();
    expect(a).not.toBe(b);
  });

  it('returns deterministic output for same prng and pinned timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00.000Z'));
    const prng = () => 0.5;
    const a = generateULID(prng);
    const b = generateULID(prng);
    expect(a).toMatch(ULID_PATTERN);
    expect(b).toMatch(ULID_PATTERN);
    // Each seeded call creates a fresh factory — same timestamp + same prng → same ULID
    expect(a).toBe(b);
    vi.useRealTimers();
  });

  it('generates ULIDs with a fixed prng that are lexicographically sortable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00.000Z'));
    const prng = () => 0.42;
    const ids = Array.from({ length: 5 }, () => {
      vi.advanceTimersByTime(1);
      return generateULID(prng);
    });
    vi.useRealTimers();
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
