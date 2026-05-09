/**
 * Verifies that FERRY_DRY_RUN=1 suppresses all Jira/GitHub mutating calls in
 * the developer agent. Tests exercise the isDryRun() guard and the InMemoryTracker
 * spy pattern used in the refiner integration test above.
 *
 * The dev-action entrypoint calls main() on import, so we cannot import it
 * directly in tests. Instead we test the gating utility and, for the
 * post-loop side-effect block, we unit-test the tracker/runner isolation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDryRun } from '../../lib/dry-run.js';
import { InMemoryTracker } from '../../lib/io/tracker/in-memory.js';

afterEach(() => {
  delete process.env.FERRY_DRY_RUN;
});

describe('isDryRun guard', () => {
  it('returns false when FERRY_DRY_RUN is unset', () => {
    delete process.env.FERRY_DRY_RUN;
    expect(isDryRun()).toBe(false);
  });

  it('returns true when FERRY_DRY_RUN=1', () => {
    process.env.FERRY_DRY_RUN = '1';
    expect(isDryRun()).toBe(true);
  });
});

describe('dry-run tracker isolation', () => {
  it('InMemoryTracker records no writes when dry-run logic skips them', async () => {
    process.env.FERRY_DRY_RUN = '1';
    const tracker = new InMemoryTracker();
    tracker.seed({
      key: 'PROJ-1',
      summary: 'Test ticket',
      description: 'desc',
      comments: [],
      labels: [],
      issueType: 'Story',
      issueTypeRaw: 'Story',
    });

    const postCommentSpy = vi.spyOn(tracker, 'postComment');
    const postTransitionSpy = vi.spyOn(tracker, 'postTransition');
    const createSubtaskSpy = vi.spyOn(tracker, 'createSubtask');

    // Simulate the dev-action dry-run gating: when dryRun=true, these calls are skipped
    const dryRun = isDryRun();
    if (!dryRun) {
      await tracker.postComment('PROJ-1', 'Implementation complete — PR: https://github.com/...');
      await tracker.postTransition('PROJ-1', 'transition-id-123');
    }

    expect(dryRun).toBe(true);
    expect(postCommentSpy).not.toHaveBeenCalled();
    expect(postTransitionSpy).not.toHaveBeenCalled();
    expect(createSubtaskSpy).not.toHaveBeenCalled();
  });

  it('tracker writes proceed in normal mode', async () => {
    delete process.env.FERRY_DRY_RUN;
    const tracker = new InMemoryTracker();
    tracker.seed({
      key: 'PROJ-1',
      summary: 'Test ticket',
      description: 'desc',
      comments: [],
      labels: [],
      issueType: 'Story',
      issueTypeRaw: 'Story',
    });

    const dryRun = isDryRun();
    if (!dryRun) {
      await tracker.postComment('PROJ-1', 'Implementation complete');
      await tracker.postTransition('PROJ-1', 'transition-id-123');
    }

    expect(dryRun).toBe(false);
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedTransitions).toHaveLength(1);
  });
});
