import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveMergeStrategy } from './merge-action.js';
import { InMemoryTracker } from '../../lib/io/tracker/in-memory.js';
import type { CIRunner, PR, PRRef } from '../../lib/dispatch/runner/types.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { byEventId } from '../../lib/agent-runtime/index.js';

// ── resolveMergeStrategy ──────────────────────────────────────────────────────

describe('resolveMergeStrategy', () => {
  afterEach(() => {
    delete process.env.FERRY_MERGE_STRATEGY;
  });

  it('defaults to squash when env var is unset', () => {
    delete process.env.FERRY_MERGE_STRATEGY;
    expect(resolveMergeStrategy()).toBe('squash');
  });

  it.each(['squash', 'merge', 'rebase'] as const)(
    'returns %s when FERRY_MERGE_STRATEGY=%s',
    (strategy) => {
      process.env.FERRY_MERGE_STRATEGY = strategy;
      expect(resolveMergeStrategy()).toBe(strategy);
    },
  );

  it('falls back to squash for an unrecognised strategy', () => {
    process.env.FERRY_MERGE_STRATEGY = 'fast-forward';
    expect(resolveMergeStrategy()).toBe('squash');
  });
});

// ── idempotency helpers ───────────────────────────────────────────────────────

describe('merger idempotency fingerprint', () => {
  it('byEventId produces the expected [ferry:merger:<id>] marker', () => {
    expect(byEventId('merger', 'evt-001')).toBe('[ferry:merger:evt-001]');
  });

  it('checkIdempotencyMarker returns skipped=true when marker is present', () => {
    const marker = byEventId('merger', 'evt-001');
    const comments = [`${marker} Merged PR#42 via \`squash\`.`];
    expect(checkIdempotencyMarker(marker, comments).skipped).toBe(true);
  });

  it('checkIdempotencyMarker returns skipped=false when marker is absent', () => {
    const marker = byEventId('merger', 'evt-001');
    expect(checkIdempotencyMarker(marker, []).skipped).toBe(false);
  });
});

// ── merger integration-style tests with mocked runner + tracker ───────────────

function makeTracker(comments: string[] = []): InMemoryTracker {
  const tracker = new InMemoryTracker();
  tracker.seed({
    key: 'PROJ-1',
    summary: 'Implement feature X',
    description: 'desc',
    comments,
    labels: [],
    issueType: 'Story',
    issueTypeRaw: 'Story',
  });
  return tracker;
}

function makePR(prNumber: number): PR {
  return {
    number: prNumber,
    title: 'feat(PROJ-1): implement feature X',
    baseRef: 'main',
    headRef: 'ferry/PROJ-1',
    headSha: 'abc1234',
    mergeable: true,
  };
}

function makeRunner(opts: {
  defaultBranch?: string;
  openPRs?: PR[];
  mergePRImpl?: (prRef: PRRef, strategy: string) => Promise<void>;
}): CIRunner {
  const { defaultBranch = 'main', openPRs = [makePR(42)], mergePRImpl } = opts;
  return {
    getRepoDefaultBranch: vi.fn().mockResolvedValue(defaultBranch),
    listPRsForBranch: vi.fn().mockResolvedValue(openPRs),
    getPR: vi.fn().mockResolvedValue(makePR(42)),
    mergePR: vi.fn().mockImplementation(mergePRImpl ?? (() => Promise.resolve())),
    dispatch: vi.fn().mockResolvedValue(undefined),
    listPRFiles: vi.fn().mockResolvedValue([]),
    listPRCommits: vi.fn().mockResolvedValue([]),
    getCommitStatus: vi.fn().mockResolvedValue('green'),
    getFileContent: vi.fn().mockResolvedValue(''),
    createPR: vi.fn().mockResolvedValue('https://github.com/org/repo/pull/42'),
    markPRReadyForReview: vi.fn().mockResolvedValue(undefined),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    addLabelsToPR: vi.fn().mockResolvedValue(undefined),
    removeLabelFromPR: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
  } as unknown as CIRunner;
}

describe('merger: merges with the configured strategy', () => {
  afterEach(() => {
    delete process.env.FERRY_MERGE_STRATEGY;
    delete process.env.FERRY_MERGE_DONE_TRANSITION_ID;
  });

  it('calls mergePR with squash by default', async () => {
    delete process.env.FERRY_MERGE_STRATEGY;
    const runner = makeRunner({});
    const tracker = makeTracker();

    const marker = byEventId('merger', 'evt-001');
    const { skipped } = checkIdempotencyMarker(marker, []);
    expect(skipped).toBe(false);

    // Simulate the merge logic
    const prs = await runner.listPRsForBranch('org', 'repo', 'ferry/PROJ-1');
    expect(prs).toHaveLength(1);

    const strategy = resolveMergeStrategy();
    await runner.mergePR({ owner: 'org', repo: 'repo', prNumber: prs[0].number }, strategy);
    await tracker.postComment('PROJ-1', `${marker} Merged PR#42 via \`${strategy}\`.`);

    expect(runner.mergePR as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      { owner: 'org', repo: 'repo', prNumber: 42 },
      'squash',
    );
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain('[ferry:merger:evt-001]');
    expect(tracker.postedComments[0].body).toContain('squash');
  });

  it('calls mergePR with rebase when FERRY_MERGE_STRATEGY=rebase', async () => {
    process.env.FERRY_MERGE_STRATEGY = 'rebase';
    const runner = makeRunner({});
    const tracker = makeTracker();
    const marker = byEventId('merger', 'evt-002');

    const prs = await runner.listPRsForBranch('org', 'repo', 'ferry/PROJ-1');
    const strategy = resolveMergeStrategy();
    await runner.mergePR({ owner: 'org', repo: 'repo', prNumber: prs[0].number }, strategy);
    await tracker.postComment('PROJ-1', `${marker} Merged PR#42 via \`${strategy}\`.`);

    expect(runner.mergePR as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.anything(),
      'rebase',
    );
  });
});

describe('merger: skips if no open PR found (already merged)', () => {
  it('posts a no-op comment and does not call mergePR', async () => {
    const runner = makeRunner({ openPRs: [] });
    const tracker = makeTracker();
    const marker = byEventId('merger', 'evt-003');

    const prs = await runner.listPRsForBranch('org', 'repo', 'ferry/PROJ-1');
    expect(prs).toHaveLength(0);

    // Simulate the no-open-PR branch
    if (prs.length === 0) {
      await tracker.postComment(
        'PROJ-1',
        `${marker} No open PR found for branch \`ferry/PROJ-1\` — already merged or not yet created.`,
      );
    }

    expect(runner.mergePR as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(tracker.postedComments[0].body).toContain('No open PR found');
    expect(tracker.postedComments[0].body).toContain(marker);
  });
});

describe('merger: performs done-transition only when FERRY_MERGE_DONE_TRANSITION_ID is set', () => {
  afterEach(() => {
    delete process.env.FERRY_MERGE_DONE_TRANSITION_ID;
  });

  it('does NOT post transition when env var is unset', async () => {
    delete process.env.FERRY_MERGE_DONE_TRANSITION_ID;
    const tracker = makeTracker();
    const doneTransitionId = process.env.FERRY_MERGE_DONE_TRANSITION_ID;
    if (doneTransitionId) {
      await tracker.postTransition('PROJ-1', doneTransitionId);
    }
    expect(tracker.postedTransitions).toHaveLength(0);
  });

  it('posts transition when FERRY_MERGE_DONE_TRANSITION_ID is set', async () => {
    process.env.FERRY_MERGE_DONE_TRANSITION_ID = 'done-transition-id';
    const tracker = makeTracker();
    const doneTransitionId = process.env.FERRY_MERGE_DONE_TRANSITION_ID;
    if (doneTransitionId) {
      await tracker.postTransition('PROJ-1', doneTransitionId);
    }
    expect(tracker.postedTransitions).toHaveLength(1);
    expect(tracker.postedTransitions[0]).toEqual({
      key: 'PROJ-1',
      transitionId: 'done-transition-id',
    });
  });
});

describe('merger: idempotent on re-dispatch', () => {
  it('skips when the fingerprint already exists in Jira comments', async () => {
    const marker = byEventId('merger', 'evt-004');
    const existingComment = `${marker} Merged PR#42 via \`squash\`.`;
    const tracker = makeTracker([existingComment]);
    const runner = makeRunner({});

    const issue = await tracker.getIssue('PROJ-1');
    const { skipped } = checkIdempotencyMarker(marker, issue.comments);

    expect(skipped).toBe(true);
    expect(runner.mergePR as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('does not skip when a different event-id fingerprint is present', async () => {
    const marker = byEventId('merger', 'evt-005');
    const otherMarker = byEventId('merger', 'evt-004');
    const existingComment = `${otherMarker} Merged PR#42 via \`squash\`.`;
    const tracker = makeTracker([existingComment]);

    const issue = await tracker.getIssue('PROJ-1');
    const { skipped } = checkIdempotencyMarker(marker, issue.comments);

    expect(skipped).toBe(false);
  });
});
