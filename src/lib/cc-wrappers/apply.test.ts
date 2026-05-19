import { describe, it, expect, beforeEach } from 'vitest';
import { applyContract, checkContractIdempotency } from './apply.js';
import { InMemoryTracker } from '../io/tracker/in-memory.js';
import { FerryError } from '../errors/index.js';
import type { ContractDecision } from './contract.js';
import type { TrackerIssue } from '../io/tracker/types.js';

const ISSUE: TrackerIssue = {
  key: 'PROJ-1',
  summary: 's',
  description: 'd',
  comments: [],
  labels: [],
  issueType: 'Story',
  issueTypeRaw: 'Story',
};

const ENV = (k: string): string =>
  ({
    FERRY_REVIEW_TRANSITION_ID: 'TR-REVIEW',
    FERRY_ITER_TRANSITION_ID: 'TR-ITER',
    FERRY_APPROVE_TRANSITION_ID: 'TR-APPROVE',
  })[k] ?? '';

describe('checkContractIdempotency', () => {
  it('skips when the marker is already present in a prior comment', () => {
    expect(
      checkContractIdempotency('[ferry:dev:abc1234]', ['noise', 'x [ferry:dev:abc1234] y']).skipped,
    ).toBe(true);
  });
  it('does not skip when the marker is absent', () => {
    expect(checkContractIdempotency('[ferry:dev:abc1234]', ['unrelated']).skipped).toBe(false);
  });
});

describe('applyContract', () => {
  let tracker: InMemoryTracker;
  beforeEach(() => {
    tracker = new InMemoryTracker();
    tracker.seed(ISSUE);
  });

  const run = (
    decision: ContractDecision,
    over: Partial<Parameters<typeof applyContract>[0]> = {},
  ) =>
    applyContract({
      tracker,
      ticketKey: 'PROJ-1',
      marker: '[ferry:dev:abc1234]',
      existingComments: [],
      decision,
      getEnv: ENV,
      ...over,
    });

  it('developer FR18: transition is posted BEFORE the audit comment', async () => {
    const decision: ContractDecision = {
      comment: '[ferry:dev:abc1234] Implementation complete — PR: x. Moved to Review.',
      labels: [],
      transitions: [{ transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' }],
      exitCode: 0,
    };
    const res = await run(decision);
    expect(res).toEqual({ skipped: false, emitted: true, exitCode: 0 });
    expect(tracker.postedTransitions).toEqual([{ key: 'PROJ-1', transitionId: 'TR-REVIEW' }]);
    expect(tracker.postedComments).toEqual([{ key: 'PROJ-1', body: decision.comment }]);
  });

  it('reviewer FR24: transition is posted AFTER the audit comment', async () => {
    const decision: ContractDecision = {
      comment: '[ferry:reviewer:abc1234] Approved. PR#7 is ready to merge.',
      labels: [],
      transitions: [{ transitionIdEnv: 'FERRY_APPROVE_TRANSITION_ID', when: 'after-comment' }],
      exitCode: 0,
    };
    await run(decision, { marker: '[ferry:reviewer:abc1234]' });
    // Comment must land before the transition (parity with review-action.ts).
    expect(tracker.postedComments).toEqual([{ key: 'PROJ-1', body: decision.comment }]);
    expect(tracker.postedTransitions).toEqual([{ key: 'PROJ-1', transitionId: 'TR-APPROVE' }]);
  });

  it('blocked: adds ferry:blocked label, posts comment, no transition, exit 1', async () => {
    const decision: ContractDecision = {
      comment: '[ferry:dev:abc1234] 🚨 BLOCKED — x. Manual intervention required.',
      labels: ['ferry:blocked'],
      transitions: [],
      exitCode: 1,
    };
    const res = await run(decision);
    expect(res.exitCode).toBe(1);
    expect(tracker.addedLabels).toEqual([{ key: 'PROJ-1', label: 'ferry:blocked' }]);
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedTransitions).toEqual([]);
  });

  it('idempotency: skips all writes when the marker already exists', async () => {
    const decision: ContractDecision = {
      comment: '[ferry:dev:abc1234] Implementation complete — PR: x.',
      labels: ['ferry:blocked'],
      transitions: [{ transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' }],
      exitCode: 0,
    };
    const res = await run(decision, {
      existingComments: ['earlier [ferry:dev:abc1234] run'],
    });
    expect(res).toEqual({ skipped: true, emitted: false, exitCode: 0 });
    expect(tracker.postedComments).toEqual([]);
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.addedLabels).toEqual([]);
  });

  it('dry-run: suppresses ALL external writes (decisions/0002 §D)', async () => {
    const decision: ContractDecision = {
      comment: '[ferry:dev:abc1234] Implementation complete — PR: x. Moved to Review.',
      labels: ['ferry:blocked'],
      transitions: [{ transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' }],
      exitCode: 0,
    };
    const res = await run(decision, { dryRun: true });
    expect(res).toEqual({ skipped: false, emitted: false, exitCode: 0 });
    expect(tracker.postedComments).toEqual([]);
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.addedLabels).toEqual([]);
  });

  it('the emitted audit comment carries the marker (post-step idempotency)', async () => {
    const decision: ContractDecision = {
      comment: '[ferry:dev:abc1234] Implementation complete — PR: x.',
      labels: [],
      transitions: [],
      exitCode: 0,
    };
    await run(decision);
    // A subsequent run with the now-existing comment must skip.
    const second = await run(decision, {
      existingComments: [tracker.postedComments[0].body],
    });
    expect(second.skipped).toBe(true);
  });

  it('fail-closed: a planned transition with a missing secret throws (requireEnv parity)', async () => {
    const decision: ContractDecision = {
      comment: '[ferry:dev:abc1234] Implementation complete — PR: x.',
      labels: [],
      transitions: [{ transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' }],
      exitCode: 0,
    };
    await expect(
      applyContract({
        tracker,
        ticketKey: 'PROJ-1',
        marker: '[ferry:dev:abc1234]',
        existingComments: [],
        decision,
        getEnv: (k) => {
          throw new FerryError('state-invariant', { reason: 'missing-env', key: k });
        },
      }),
    ).rejects.toThrow(FerryError);
  });
});
