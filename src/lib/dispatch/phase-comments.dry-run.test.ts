import { describe, it, expect } from 'vitest';
import { formatPhaseStatusComment, phaseStatusMarker } from './phase-comments.js';
import { checkIdempotencyMarker } from '../io/idempotency.js';

/**
 * Story 2-4 AC4 dry-run E2E. The "store" is an in-memory string array
 * that mimics a Jira ticket's comment thread. Two runs with the same
 * (phase, runId) MUST produce a single comment in the store.
 */
describe('phase-comments dry-run idempotency (Story 2-4)', () => {
  it('a re-run with the same run_id leaves the count unchanged', () => {
    const store: string[] = [];

    const run = (runId: string) => {
      const marker = phaseStatusMarker('refine', runId);
      const { skipped } = checkIdempotencyMarker(marker, store);
      if (skipped) return;
      store.push(
        formatPhaseStatusComment({
          phase: 'refine',
          runId,
          outcome: 'ok',
          costEur: 0.01,
          runUrl: 'https://example.com/run/1',
        }),
      );
    };

    run('01HXYZ');
    run('01HXYZ');
    run('01HXYZ');

    expect(store).toHaveLength(1);
    expect(store[0]).toContain('[ferry:refiner:01HXYZ]');
  });

  it('different run_ids produce separate comments', () => {
    const store: string[] = [];
    for (const id of ['r1', 'r2', 'r3']) {
      const marker = phaseStatusMarker('dev', id);
      const { skipped } = checkIdempotencyMarker(marker, store);
      if (!skipped) {
        store.push(
          formatPhaseStatusComment({
            phase: 'dev',
            runId: id,
            outcome: 'ok',
            costEur: 0.01,
            runUrl: 'https://example.com/run/1',
          }),
        );
      }
    }
    expect(store).toHaveLength(3);
  });
});
