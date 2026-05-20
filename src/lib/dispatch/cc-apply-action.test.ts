/**
 * Fixture-driven tests for the ferry-cc-apply post-step.
 *
 * Each role test verifies that given a valid cc-output.json artifact,
 * the correct [ferry:<role>:<marker>] audit comment is posted to Jira AND
 * the correct FR-conformant transition fires (FR18 developer, FR24 reviewer,
 * FR28 iterator, none for refiner).
 *
 * Idempotency and fail-closed behaviour are also exercised.
 */
import { describe, it, expect } from 'vitest';
import { applyCcArtifact } from './cc-apply-action.js';
import { InMemoryTracker } from '../io/tracker/in-memory.js';
import { FerryError } from '../errors/index.js';
import type { TrackerIssue } from '../io/tracker/types.js';

const MARKER_DEV = '[ferry:dev:abc1234]';
const MARKER_REVIEWER = '[ferry:reviewer:abc1234]';
const MARKER_ITERATOR = '[ferry:iterator:abc1234]';
const MARKER_REFINER = '[ferry:refiner:EVT-1]';
const TICKET = 'PROJ-1';

const ISSUE: TrackerIssue = {
  key: TICKET,
  summary: 's',
  description: 'd',
  comments: [],
  labels: [],
  issueType: 'Story',
  issueTypeRaw: 'Story',
};

const TRANS_ENV: Record<string, string> = {
  FERRY_REVIEW_TRANSITION_ID: 'TR-REVIEW',
  FERRY_ITER_TRANSITION_ID: 'TR-ITER',
  FERRY_APPROVE_TRANSITION_ID: 'TR-APPROVE',
};
const getEnv = (k: string): string => TRANS_ENV[k] ?? '';

function makeTracker(): InMemoryTracker {
  const t = new InMemoryTracker();
  t.seed(ISSUE);
  return t;
}

// ── developer (FR18) ──────────────────────────────────────────────────────

describe('developer role', () => {
  const artifact = {
    version: 'v1',
    role: 'developer',
    outcome: 'implemented',
    summary: 'Done.',
    pr_url: 'https://github.com/o/r/pull/7',
  };

  it('FR18: posts audit comment and fires transition before it', async () => {
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: artifact,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [],
      gates: { shouldAutoTransition: true, noAutoTransition: false },
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(result).toEqual({ skipped: false, emitted: true, exitCode: 0 });
    // FR18 transition fires BEFORE the audit comment
    expect(tracker.postedTransitions).toEqual([{ key: TICKET, transitionId: 'TR-REVIEW' }]);
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain(MARKER_DEV);
    expect(tracker.postedComments[0].body).toContain('Implementation complete');
    expect(tracker.postedComments[0].body).toContain('Moved to Review');
  });

  it('no transition when shouldAutoTransition=false', async () => {
    const tracker = makeTracker();
    await applyCcArtifact({
      rawArtifact: artifact,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [],
      gates: { shouldAutoTransition: false, noAutoTransition: false },
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.postedComments).toHaveLength(1);
  });

  it('no-auto-transition label note in comment', async () => {
    const tracker = makeTracker();
    await applyCcArtifact({
      rawArtifact: artifact,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [],
      gates: { shouldAutoTransition: false, noAutoTransition: true },
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(tracker.postedComments[0].body).toContain('FR18 auto-transition skipped');
  });

  it('blocked: adds label, posts comment, no transition, exit 1', async () => {
    const blocked = {
      version: 'v1',
      role: 'developer',
      outcome: 'blocked',
      summary: 'Cannot proceed.',
      reason: 'missing API key',
    };
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: blocked,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [],
      gates: { shouldAutoTransition: true },
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(result.exitCode).toBe(1);
    expect(tracker.addedLabels).toEqual([{ key: TICKET, label: 'ferry:blocked' }]);
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.postedComments[0].body).toContain('BLOCKED');
    expect(tracker.postedComments[0].body).toContain('missing API key');
  });

  it('already_satisfied outcome', async () => {
    const satisfied = {
      version: 'v1',
      role: 'developer',
      outcome: 'already_satisfied',
      summary: 'Nothing to do.',
      pr_url: 'https://github.com/o/r/pull/7',
    };
    const tracker = makeTracker();
    await applyCcArtifact({
      rawArtifact: satisfied,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [],
      gates: {},
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(tracker.postedComments[0].body).toContain('Spec already satisfied');
  });
});

// ── reviewer (FR24) ───────────────────────────────────────────────────────

describe('reviewer role', () => {
  it('FR24 approve: transition fires AFTER audit comment', async () => {
    const artifact = {
      version: 'v1',
      role: 'reviewer',
      verdict: 'approved',
      review_comment: '**Verdict**: Approved',
      summary: 'Ready.',
    };
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: artifact,
      role: 'reviewer',
      marker: MARKER_REVIEWER,
      existingComments: [],
      gates: { shouldTransitionApprove: true, shouldTransitionChanges: false },
      prNumber: 7,
      priorIterations: 0,
      cap: 3,
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(result).toEqual({ skipped: false, emitted: true, exitCode: 0 });
    // Audit comment BEFORE transition (FR24)
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain(MARKER_REVIEWER);
    expect(tracker.postedComments[0].body).toContain('Approved');
    expect(tracker.postedTransitions).toEqual([{ key: TICKET, transitionId: 'TR-APPROVE' }]);
  });

  it('FR24 changes: transition fires AFTER audit comment', async () => {
    const artifact = {
      version: 'v1',
      role: 'reviewer',
      verdict: 'changes_requested',
      review_comment: 'Fix the tests.',
      summary: 'Needs work.',
    };
    const tracker = makeTracker();
    await applyCcArtifact({
      rawArtifact: artifact,
      role: 'reviewer',
      marker: MARKER_REVIEWER,
      existingComments: [],
      gates: { shouldTransitionApprove: false, shouldTransitionChanges: true },
      prNumber: 7,
      priorIterations: 0,
      cap: 3,
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(tracker.postedComments[0].body).toContain('Changes requested (iteration 1/3)');
    expect(tracker.postedComments[0].body).toContain('Moved to Dev Iteration');
    expect(tracker.postedTransitions).toEqual([{ key: TICKET, transitionId: 'TR-ITER' }]);
  });

  it('cap reached: no transition, appropriate message', async () => {
    const artifact = {
      version: 'v1',
      role: 'reviewer',
      verdict: 'changes_requested',
      review_comment: 'Still needs work.',
      summary: 'Needs work.',
    };
    const tracker = makeTracker();
    await applyCcArtifact({
      rawArtifact: artifact,
      role: 'reviewer',
      marker: MARKER_REVIEWER,
      existingComments: [],
      gates: { shouldTransitionChanges: true },
      prNumber: 7,
      priorIterations: 3,
      cap: 3,
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(tracker.postedComments[0].body).toContain('Iteration cap (3) reached');
    expect(tracker.postedTransitions).toEqual([]);
  });
});

// ── iterator (FR28) ───────────────────────────────────────────────────────

describe('iterator role', () => {
  it('FR28: transition fires BEFORE audit comment (same env var as FR18)', async () => {
    const artifact = {
      version: 'v1',
      role: 'iterator',
      outcome: 'implemented',
      summary: 'Fixed.',
      pr_number: 7,
    };
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: artifact,
      role: 'iterator',
      marker: MARKER_ITERATOR,
      existingComments: [],
      gates: { shouldAutoTransition: true, noAutoTransition: false },
      prNumber: 7,
      priorIterations: 0,
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(result).toEqual({ skipped: false, emitted: true, exitCode: 0 });
    // FR28 transition fires BEFORE the audit comment
    expect(tracker.postedTransitions).toEqual([{ key: TICKET, transitionId: 'TR-REVIEW' }]);
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain(MARKER_ITERATOR);
    expect(tracker.postedComments[0].body).toContain('Iteration 1 complete');
    expect(tracker.postedComments[0].body).toContain('Moved back to Review');
  });

  it('blocked: adds label, no transition, exit 1', async () => {
    const blocked = {
      version: 'v1',
      role: 'iterator',
      outcome: 'blocked',
      summary: 'Stuck.',
      reason: 'conflict',
    };
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: blocked,
      role: 'iterator',
      marker: MARKER_ITERATOR,
      existingComments: [],
      gates: { shouldAutoTransition: true },
      prNumber: 7,
      priorIterations: 0,
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(result.exitCode).toBe(1);
    expect(tracker.addedLabels).toEqual([{ key: TICKET, label: 'ferry:blocked' }]);
    expect(tracker.postedTransitions).toEqual([]);
  });
});

// ── refiner (no transition) ───────────────────────────────────────────────

describe('refiner role', () => {
  it('refined: posts audit comment with created/kept/staled, no transition', async () => {
    const artifact = {
      version: 'v1',
      role: 'refiner',
      result: 'refined',
      summary: 'Sub-tasks updated.',
      created: 2,
      kept: 1,
      staled: 0,
    };
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: artifact,
      role: 'refiner',
      marker: MARKER_REFINER,
      existingComments: [],
      gates: {},
      runLink: 'https://github.com/o/r/actions/runs/99',
      subtaskCount: 3,
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(result).toEqual({ skipped: false, emitted: true, exitCode: 0 });
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain(MARKER_REFINER);
    expect(tracker.postedComments[0].body).toContain('Created 2, kept 1, staled 0');
    expect(tracker.postedComments[0].body).toContain('actions/runs/99');
  });

  it('noop: posts audit comment with subtaskCount', async () => {
    const artifact = {
      version: 'v1',
      role: 'refiner',
      result: 'noop',
      summary: 'Nothing changed.',
      noop_reason: 'all sub-tasks still valid',
    };
    const tracker = makeTracker();
    await applyCcArtifact({
      rawArtifact: artifact,
      role: 'refiner',
      marker: MARKER_REFINER,
      existingComments: [],
      gates: {},
      runLink: 'https://github.com/o/r/actions/runs/99',
      subtaskCount: 5,
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.postedComments[0].body).toContain('5 sub-task(s) still valid');
  });
});

// ── idempotency ───────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('skips all writes when the marker already exists in prior comments', async () => {
    const artifact = {
      version: 'v1',
      role: 'developer',
      outcome: 'implemented',
      summary: 'Done.',
      pr_url: 'https://github.com/o/r/pull/7',
    };
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: artifact,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [`earlier ${MARKER_DEV} run`],
      gates: { shouldAutoTransition: true },
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(result).toEqual({ skipped: true, emitted: false, exitCode: 0 });
    expect(tracker.postedComments).toEqual([]);
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.addedLabels).toEqual([]);
  });

  it('second run with emitted comment is a no-op (marker found in re-run)', async () => {
    const artifact = {
      version: 'v1',
      role: 'developer',
      outcome: 'implemented',
      summary: 'Done.',
      pr_url: 'https://github.com/o/r/pull/7',
    };
    const tracker = makeTracker();
    await applyCcArtifact({
      rawArtifact: artifact,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [],
      gates: {},
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    const emittedComment = tracker.postedComments[0].body;
    const second = await applyCcArtifact({
      rawArtifact: artifact,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [emittedComment],
      gates: {},
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      getEnv,
    });
    expect(second.skipped).toBe(true);
  });
});

// ── dry-run ───────────────────────────────────────────────────────────────

describe('dry-run', () => {
  it('suppresses all external writes (decisions/0002 §D)', async () => {
    const artifact = {
      version: 'v1',
      role: 'developer',
      outcome: 'implemented',
      summary: 'Done.',
      pr_url: 'https://github.com/o/r/pull/7',
    };
    const tracker = makeTracker();
    const result = await applyCcArtifact({
      rawArtifact: artifact,
      role: 'developer',
      marker: MARKER_DEV,
      existingComments: [],
      gates: { shouldAutoTransition: true },
      prUrl: 'https://github.com/o/r/pull/7',
      tracker,
      ticketKey: TICKET,
      dryRun: true,
      getEnv,
    });
    expect(result).toEqual({ skipped: false, emitted: false, exitCode: 0 });
    expect(tracker.postedComments).toEqual([]);
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.addedLabels).toEqual([]);
  });
});

// ── fail-closed (NFR-S1) ──────────────────────────────────────────────────

describe('fail-closed validation', () => {
  it('throws FerryError state-invariant for a malformed artifact', async () => {
    const tracker = makeTracker();
    await expect(
      applyCcArtifact({
        rawArtifact: { version: 'v1', role: 'developer' }, // missing required fields
        role: 'developer',
        marker: MARKER_DEV,
        existingComments: [],
        gates: {},
        tracker,
        ticketKey: TICKET,
        getEnv,
      }),
    ).rejects.toBeInstanceOf(FerryError);
  });

  it('does not leak raw field values in the error (NFR-S1)', async () => {
    const tracker = makeTracker();
    try {
      await applyCcArtifact({
        rawArtifact: {
          version: 'v1',
          role: 'developer',
          outcome: 'SECRET-OUTCOME',
          summary: 'SECRET-SUMMARY',
        },
        role: 'developer',
        marker: MARKER_DEV,
        existingComments: [],
        gates: {},
        tracker,
        ticketKey: TICKET,
        getEnv,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FerryError);
      const msg = (err as FerryError).message;
      expect(msg).not.toContain('SECRET-OUTCOME');
      expect(msg).not.toContain('SECRET-SUMMARY');
    }
  });

  it('throws for a non-JSON string input', async () => {
    const tracker = makeTracker();
    await expect(
      applyCcArtifact({
        rawArtifact: '{ not valid json',
        role: 'developer',
        marker: MARKER_DEV,
        existingComments: [],
        gates: {},
        tracker,
        ticketKey: TICKET,
        getEnv,
      }),
    ).rejects.toBeInstanceOf(FerryError);
  });

  it('throws for an unknown role in the artifact', async () => {
    const tracker = makeTracker();
    await expect(
      applyCcArtifact({
        rawArtifact: { version: 'v1', role: 'planner', summary: 'x' },
        role: 'developer',
        marker: MARKER_DEV,
        existingComments: [],
        gates: {},
        tracker,
        ticketKey: TICKET,
        getEnv,
      }),
    ).rejects.toBeInstanceOf(FerryError);
  });
});
