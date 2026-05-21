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
import { applyCcArtifact, applyRefinerCcArtifact } from './cc-apply-action.js';
import { InMemoryTracker } from '../io/tracker/in-memory.js';
import { FerryError } from '../errors/index.js';
import { subtaskContentHash } from '../../agents/refiner/batch.js';
import type { TrackerIssue, TrackerSubtask } from '../io/tracker/types.js';

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

// ── refiner (plan artifact → applyActions → audit comment) ────────────────

describe('refiner role (applyRefinerCcArtifact)', () => {
  const RUN_LINK = 'https://github.com/o/r/actions/runs/99';

  // A RefinerOutput plan: `create` actions become Jira sub-tasks, `keep` is
  // counted only, `noop` short-circuits. cc-apply runs the same `applyActions`
  // reconcile the script path uses.
  const refinedPlan = {
    actions: [
      { type: 'create', title: 'Add validation', description: 'Validate POST /users.' },
      { type: 'create', title: 'Add tests', description: 'Cover the validation path.' },
      { type: 'keep', existing_key: 'PROJ-2', reason: 'still valid' },
    ],
    touch_paths: ['src/users.ts'],
    output_locale: 'en',
    audit_summary: 'Refine the users endpoint.',
  };

  it('refined: creates sub-tasks via applyActions and posts the audit comment', async () => {
    const tracker = makeTracker();
    const result = await applyRefinerCcArtifact({
      rawArtifact: refinedPlan,
      marker: MARKER_REFINER,
      existingComments: [],
      eventId: 'EVT-1',
      ticketKey: TICKET,
      runLink: RUN_LINK,
      tracker,
    });
    expect(result).toEqual({ skipped: false, emitted: true, exitCode: 0 });
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.createdSubtasks).toHaveLength(2);
    expect(tracker.createdSubtasks.map((s) => s.title)).toEqual(['Add validation', 'Add tests']);
    // Audit comment is byte-identical to the script path (refiner-action.ts:164-167).
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toBe(
      `${MARKER_REFINER} Refined. Created 2, kept 1, staled 0 sub-task(s). See run: ${RUN_LINK}`,
    );
  });

  it('noop: posts the audit comment with the fetched existing-subtask count', async () => {
    const noopPlan = {
      actions: [{ type: 'noop', reason: 'all sub-tasks still valid' }],
      touch_paths: [],
      output_locale: 'en',
      audit_summary: 'No change.',
    };
    const tracker = makeTracker();
    const existing: TrackerSubtask[] = [
      { key: 'PROJ-2', title: 'a', description: 'a', status: 'To Do' },
      { key: 'PROJ-3', title: 'b', description: 'b', status: 'To Do' },
      { key: 'PROJ-4', title: 'c', description: 'c', status: 'To Do' },
    ];
    tracker.seedSubtaskDetails(TICKET, existing);
    await applyRefinerCcArtifact({
      rawArtifact: noopPlan,
      marker: MARKER_REFINER,
      existingComments: [],
      eventId: 'EVT-1',
      ticketKey: TICKET,
      runLink: RUN_LINK,
      tracker,
    });
    expect(tracker.createdSubtasks).toEqual([]);
    // Byte-identical to the script path noop comment (refiner-action.ts:140-143).
    expect(tracker.postedComments[0].body).toBe(
      `${MARKER_REFINER} No changes needed — existing 3 sub-task(s) still valid. all sub-tasks still valid`,
    );
  });

  it('idempotency: skips all writes when the marker already exists', async () => {
    const tracker = makeTracker();
    const result = await applyRefinerCcArtifact({
      rawArtifact: refinedPlan,
      marker: MARKER_REFINER,
      existingComments: [`earlier ${MARKER_REFINER} run`],
      eventId: 'EVT-1',
      ticketKey: TICKET,
      runLink: RUN_LINK,
      tracker,
    });
    expect(result).toEqual({ skipped: true, emitted: false, exitCode: 0 });
    expect(tracker.createdSubtasks).toEqual([]);
    expect(tracker.postedComments).toEqual([]);
  });

  it('dry-run: suppresses sub-task creation and the audit comment', async () => {
    const tracker = makeTracker();
    const result = await applyRefinerCcArtifact({
      rawArtifact: refinedPlan,
      marker: MARKER_REFINER,
      existingComments: [],
      eventId: 'EVT-1',
      ticketKey: TICKET,
      runLink: RUN_LINK,
      tracker,
      dryRun: true,
    });
    expect(result).toEqual({ skipped: false, emitted: false, exitCode: 0 });
    expect(tracker.createdSubtasks).toEqual([]);
    expect(tracker.postedComments).toEqual([]);
  });

  it('content-hash re-run: a sub-task already present is not re-created', async () => {
    const tracker = makeTracker();
    // Seed an existing sub-task carrying the content-hash marker of the first
    // `create` action — filterExistingSubtasks must skip it.
    const dupHash = subtaskContentHash('Add validation', 'Validate POST /users.');
    tracker.seedSubtaskDetails(TICKET, [
      {
        key: 'PROJ-9',
        title: 'Add validation',
        description: `Validate POST /users.\n\n[ferry:refiner-subtask:${dupHash}]`,
        status: 'To Do',
      },
    ]);
    await applyRefinerCcArtifact({
      rawArtifact: refinedPlan,
      marker: MARKER_REFINER,
      existingComments: [],
      eventId: 'EVT-1',
      ticketKey: TICKET,
      runLink: RUN_LINK,
      tracker,
    });
    expect(tracker.createdSubtasks.map((s) => s.title)).toEqual(['Add tests']);
    expect(tracker.postedComments[0].body).toContain('Created 1, kept 1, staled 0');
  });

  it('fail-closed: throws FerryError(agent-output-invalid) for a malformed plan', async () => {
    const tracker = makeTracker();
    try {
      await applyRefinerCcArtifact({
        rawArtifact: { touch_paths: [], output_locale: 'en', audit_summary: 'x' }, // no actions
        marker: MARKER_REFINER,
        existingComments: [],
        eventId: 'EVT-1',
        ticketKey: TICKET,
        runLink: RUN_LINK,
        tracker,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FerryError);
      expect((err as FerryError).code).toBe('state-invariant');
      expect((err as FerryError).context?.reason).toBe('agent-output-invalid');
    }
    expect(tracker.createdSubtasks).toEqual([]);
    expect(tracker.postedComments).toEqual([]);
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

  it('throws state-invariant when env role mismatches artifact role (no raw values leaked)', async () => {
    // Valid reviewer artifact, but env role says 'developer' — must fail closed.
    const tracker = makeTracker();
    try {
      await applyCcArtifact({
        rawArtifact: {
          version: 'v1',
          role: 'reviewer',
          verdict: 'approved',
          review_comment: 'LGTM',
          summary: 'Ready.',
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
      const ferr = err as FerryError;
      expect(ferr.code).toBe('state-invariant');
      expect(ferr.context?.reason).toBe('role-mismatch');
      // NFR-S1: no raw artifact field values leaked.
      expect(ferr.message).not.toContain('reviewer');
      expect(ferr.message).not.toContain('developer');
      expect(ferr.message).not.toContain('LGTM');
    }
    expect(tracker.postedComments).toEqual([]);
    expect(tracker.postedTransitions).toEqual([]);
    expect(tracker.addedLabels).toEqual([]);
  });
});
