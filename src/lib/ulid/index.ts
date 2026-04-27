import { monotonicFactory } from 'ulid';

// Module-level factory for production calls — preserves monotonic counter across calls.
const _generate = monotonicFactory();

export function generateULID(prng?: () => number): string {
  // Seeded path (tests): new factory per call is intentional — each call is independent.
  if (prng !== undefined) {
    return monotonicFactory(prng)();
  }
  return _generate();
}
