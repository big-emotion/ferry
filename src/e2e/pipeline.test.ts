/**
 * E2E pipeline acceptance test: refine → dev → review → iterate
 *
 * All IO is mocked (Octokit, Jira tracker, LLM). Verifies:
 *   - 4 audit lines accumulate on the same audit issue
 *   - Exactly one FR18 transition (Dev → In Review)
 *   - Exactly one FR24 outcome (transition OR ferry:approved label, not both)
 *   - Exactly one FR28 transition (Iterator → In Review)
 *   - Replaying the same event_id is a no-op (idempotent)
 *   - octokit.rest.pulls.merge is never called
 *
 * The dev/review/iterate action files execute on import (they call runAgent()
 * unconditionally at module level). This test exercises the same IO contracts
 * through shared abstractions: InMemoryTracker, GitHubActionsRunner backed by a
 * mock Octokit, and emitAudit. The refiner phase uses its real injectable run().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Octokit } from '@octokit/rest';

import { run as runRefinerAction } from '../agents/refiner/refiner-action.js';
import { emitAudit } from '../lib/audit/index.js';
import { InMemoryTracker } from '../lib/io/tracker/in-memory.js';
import { GitHubActionsRunner } from '../lib/dispatch/runner/github-actions/index.js';
import type { CIRunner } from '../lib/dispatch/runner/types.js';
import { checkIdempotencyMarker } from '../lib/io/idempotency.js';
import { byEventId, byPrHeadSha, byReviewCommentId } from '../lib/agent-runtime/idempotency.js';
import type { EventEnvelopeV1 } from '../lib/envelope/types.js';
import type { LlmCall } from '../agents/refiner/refine.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const OWNER = 'test-org';
const REPO = 'test-repo';
const TICKET_KEY = 'ACME-1';
const EVENT_ID = 'evt-e2e-001';
const AUDIT_ISSUE = 42;
const PR_NUMBER = 7;
const HEAD_SHA = 'abc1234deadbeef';
const REVIEW_COMMENT_ID = 99;
const REVIEW_TRANSITION_ID = 'trans-to-review';
const ITER_TRANSITION_ID = 'trans-to-iterate';

const ENVELOPE: EventEnvelopeV1 = {
  version: 'v1',
  event_id: EVENT_ID,
  ticket_key: TICKET_KEY,
  phase: 'refine',
  source: 'jira-column',
  ts: '2026-01-01T00:00:00.000Z',
};

const MOCK_PLAN = {
  actions: [
    {
      type: 'create' as const,
      title: 'Implement feature A',
      description: 'Add feature A to src/feature.ts',
    },
    {
      type: 'create' as const,
      title: 'Add tests for A',
      description: 'Test coverage in src/feature.test.ts',
    },
  ],
  touch_paths: ['src/feature.ts', 'src/feature.test.ts'],
  output_locale: 'en' as const,
  audit_summary: '2 subtasks planned',
};

// ─── Mock IO builder ──────────────────────────────────────────────────────────

interface MockIO {
  octokit: Octokit;
  tracker: InMemoryTracker;
  runner: CIRunner;
  auditComments: Array<{ id: number; body: string }>;
  /** Spy for octokit.issues.addLabels / octokit.rest.issues.addLabels */
  addLabelsSpy: ReturnType<typeof vi.fn>;
  /** Spy for octokit.pulls.merge / octokit.rest.pulls.merge — must never fire */
  mergeSpy: ReturnType<typeof vi.fn>;
  /** Spy for octokit.graphql (markPullRequestReadyForReview) */
  graphqlSpy: ReturnType<typeof vi.fn>;
  callLlm: LlmCall;
}

function buildMockIO(): MockIO {
  const auditComments: Array<{ id: number; body: string }> = [];

  const createCommentSpy = vi
    .fn()
    .mockImplementation(async (opts: { issue_number: number; body: string }) => {
      if (opts.issue_number === AUDIT_ISSUE) {
        auditComments.push({ id: auditComments.length + 1, body: opts.body });
      }
      return { data: { id: auditComments.length + 2000 } };
    });

  const listCommentsSpy = vi.fn().mockImplementation(async (opts: { issue_number: number }) => {
    if (opts.issue_number === AUDIT_ISSUE) {
      return { data: auditComments };
    }
    // PR comments: the reviewer's comment that the iterator needs to find
    return {
      data: [
        {
          id: REVIEW_COMMENT_ID,
          body: `[ferry:reviewer:${HEAD_SHA.slice(0, 7)}]\n\n**Verdict**: Changes requested\n\nPlease fix the reported issues.`,
        },
      ],
    };
  });

  const addLabelsSpy = vi.fn().mockResolvedValue({ data: [] });
  const removeLabelSpy = vi.fn().mockResolvedValue({ data: [] });

  const issuesMock = {
    createComment: createCommentSpy,
    listComments: listCommentsSpy,
    addLabels: addLabelsSpy,
    removeLabel: removeLabelSpy,
    get: vi.fn().mockResolvedValue({
      data: { number: AUDIT_ISSUE, title: 'Ferry Audit Log (#1)', comments: 0, labels: [] },
    }),
  };

  const mergeSpy = vi.fn(); // must remain uncalled for the entire pipeline run
  const graphqlSpy = vi.fn().mockResolvedValue({});

  const pullsMock = {
    create: vi.fn().mockResolvedValue({
      data: {
        html_url: `https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}`,
        number: PR_NUMBER,
      },
    }),
    list: vi.fn().mockResolvedValue({
      data: [
        {
          number: PR_NUMBER,
          title: `feat: ${TICKET_KEY}`,
          base: { ref: 'main' },
          head: { ref: `ferry/${TICKET_KEY}`, sha: HEAD_SHA },
        },
      ],
    }),
    get: vi.fn().mockResolvedValue({
      data: {
        number: PR_NUMBER,
        title: `feat: ${TICKET_KEY}`,
        base: { ref: 'main' },
        head: { ref: `ferry/${TICKET_KEY}`, sha: HEAD_SHA },
        mergeable: true,
        node_id: 'PR_kwMockNodeId',
      },
    }),
    listFiles: vi.fn().mockResolvedValue({ data: [] }),
    listCommits: vi.fn().mockResolvedValue({ data: [] }),
    merge: mergeSpy,
  };

  const checksMock = {
    listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [] } }),
  };

  const reposMock = {
    createDispatchEvent: vi.fn().mockResolvedValue({}),
    getContent: vi.fn().mockRejectedValue(new Error('not found')),
  };

  // Both namespaces point to the same objects:
  // octokit.issues === octokit.rest.issues, octokit.pulls === octokit.rest.pulls
  const octokit = {
    issues: issuesMock,
    pulls: pullsMock,
    checks: checksMock,
    repos: reposMock,
    paginate: vi.fn().mockResolvedValue([]),
    graphql: graphqlSpy,
    rest: { issues: issuesMock, pulls: pullsMock, checks: checksMock, repos: reposMock },
  } as unknown as Octokit;

  const tracker = new InMemoryTracker();
  tracker.seed({
    key: TICKET_KEY,
    summary: 'Implement login feature',
    description: 'Add a login button to the home page.',
    comments: [],
    labels: [],
    issueType: 'Story',
    issueTypeRaw: 'Story',
  });

  const runner = new GitHubActionsRunner(octokit, OWNER, REPO);

  const callLlm = vi.fn<LlmCall>().mockResolvedValue({
    text: JSON.stringify(MOCK_PLAN),
    usage: { inputTokens: 100, outputTokens: 50, costEur: 0.01 },
  });

  return { octokit, tracker, runner, auditComments, addLabelsSpy, mergeSpy, graphqlSpy, callLlm };
}

// ─── Phase runners ────────────────────────────────────────────────────────────
// Each function reproduces the IO contract of the matching agent action
// (idempotency check → IO writes → audit emit), without running LLM loops or
// git operations that are inappropriate in unit/integration tests.

async function runRefinePhase(io: MockIO): Promise<void> {
  await runRefinerAction(ENVELOPE, { tracker: io.tracker, callLlm: io.callLlm });
  await emitAudit(
    {
      ticket: TICKET_KEY,
      phase: 'refine',
      runId: `${EVENT_ID}-refine`,
      model: 'test-model',
      outcome: 'success',
      usage: { inputTokens: 100, outputTokens: 50, costEur: 0.01 },
      start: Date.now() - 200,
    },
    { octokit: io.octokit, owner: OWNER, repo: REPO, auditIssue: AUDIT_ISSUE },
  );
}

async function runDevPhase(io: MockIO): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = ENVELOPE;
  const marker = byEventId('dev', eventId);
  const issue = await io.tracker.getIssue(ticketKey);
  if (checkIdempotencyMarker(marker, issue.comments).skipped) return;

  const prUrl = await io.runner.createPR(
    OWNER,
    REPO,
    `ferry/${ticketKey}`,
    'main',
    `feat: ${ticketKey}`,
    'Implements the ticket.',
  );
  await io.tracker.postTransition(ticketKey, REVIEW_TRANSITION_ID); // FR18
  await io.tracker.postComment(
    ticketKey,
    `${marker} Implementation complete — PR: ${prUrl}. Moved to Review.`,
  );
  await emitAudit(
    {
      ticket: TICKET_KEY,
      phase: 'dev',
      runId: `${EVENT_ID}-dev`,
      model: 'test-model',
      outcome: 'success',
      usage: { inputTokens: 0, outputTokens: 0, costEur: 0 },
      start: Date.now() - 100,
    },
    { octokit: io.octokit, owner: OWNER, repo: REPO, auditIssue: AUDIT_ISSUE },
  );
}

async function runReviewPhase(
  io: MockIO,
  verdict: 'approved' | 'changes-requested',
): Promise<void> {
  const { ticket_key: ticketKey } = ENVELOPE;
  const marker = byPrHeadSha('reviewer', HEAD_SHA);
  const issue = await io.tracker.getIssue(ticketKey);
  if (checkIdempotencyMarker(marker, issue.comments).skipped) return;

  const prRef = { owner: OWNER, repo: REPO, prNumber: PR_NUMBER };
  const reviewBody =
    verdict === 'approved'
      ? `${marker}\n\n**Verdict**: Approved\n\nLGTM — ship it.`
      : `${marker}\n\n**Verdict**: Changes requested\n\nPlease fix the reported issues.`;

  await io.runner.commentOnPR(prRef, reviewBody);

  if (verdict === 'approved') {
    await io.tracker.postComment(
      ticketKey,
      `${marker} Approved. PR#${PR_NUMBER} is ready to merge.`,
    );
    await io.runner.addLabelsToPR(prRef, ['ferry:approved']); // FR24 approved path
    await io.runner.removeLabelFromPR(prRef, 'ferry:reviewing');
    await io.runner.markPRReadyForReview(OWNER, REPO, PR_NUMBER);
  } else {
    await io.tracker.postComment(
      ticketKey,
      `${marker} Changes requested. Moved to Dev Iteration. See PR#${PR_NUMBER}.`,
    );
    await io.tracker.postTransition(ticketKey, ITER_TRANSITION_ID); // FR24 changes-requested path
  }

  await emitAudit(
    {
      ticket: TICKET_KEY,
      phase: 'review',
      runId: `${EVENT_ID}-review`,
      model: 'test-model',
      outcome: 'success',
      usage: { inputTokens: 0, outputTokens: 0, costEur: 0 },
      start: Date.now() - 100,
    },
    { octokit: io.octokit, owner: OWNER, repo: REPO, auditIssue: AUDIT_ISSUE },
  );
}

async function runIteratePhase(io: MockIO): Promise<void> {
  const { ticket_key: ticketKey } = ENVELOPE;
  const marker = byReviewCommentId('iterator', REVIEW_COMMENT_ID);
  const issue = await io.tracker.getIssue(ticketKey);
  if (checkIdempotencyMarker(marker, issue.comments).skipped) return;

  await io.tracker.postTransition(ticketKey, REVIEW_TRANSITION_ID); // FR28
  await io.tracker.postComment(
    ticketKey,
    `${marker} Iteration 1 complete. Pushed fixes to PR#${PR_NUMBER}. Moved back to Review.`,
  );
  await emitAudit(
    {
      ticket: TICKET_KEY,
      phase: 'iterate',
      runId: `${EVENT_ID}-iterate`,
      model: 'test-model',
      outcome: 'success',
      usage: { inputTokens: 0, outputTokens: 0, costEur: 0 },
      start: Date.now() - 100,
    },
    { octokit: io.octokit, owner: OWNER, repo: REPO, auditIssue: AUDIT_ISSUE },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('E2E pipeline: refine → dev → review → iterate', () => {
  beforeEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  afterEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  describe('full 4-phase pipeline (reviewer requests changes)', () => {
    let io: MockIO;

    beforeEach(async () => {
      io = buildMockIO();
      await runRefinePhase(io);
      await runDevPhase(io);
      await runReviewPhase(io, 'changes-requested');
      await runIteratePhase(io);
    });

    it('accumulates exactly 4 audit lines on the same audit issue', () => {
      expect(io.auditComments).toHaveLength(4);
      const phases = io.auditComments.map((c) => {
        const json = JSON.parse(c.body.split('\n')[1]) as { phase: string };
        return json.phase;
      });
      expect(phases).toEqual(['refine', 'dev', 'review', 'iterate']);
    });

    it('emits exactly one FR18 transition (Dev → In Review)', () => {
      // FR18 is the first posted transition (from the dev phase)
      expect(io.tracker.postedTransitions[0]).toMatchObject({
        key: TICKET_KEY,
        transitionId: REVIEW_TRANSITION_ID,
      });
      // Only one REVIEW_TRANSITION_ID before the iterate phase
      const beforeIterate = io.tracker.postedTransitions.slice(0, 1);
      expect(beforeIterate.filter((t) => t.transitionId === REVIEW_TRANSITION_ID)).toHaveLength(1);
    });

    it('emits exactly one FR24 outcome: iter transition, no ferry:approved label', () => {
      // Exactly one changes-requested outcome
      const fr24 = io.tracker.postedTransitions.filter(
        (t) => t.transitionId === ITER_TRANSITION_ID,
      );
      expect(fr24).toHaveLength(1);

      // Not both: no ferry:approved label in the changes-requested path
      expect(io.addLabelsSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ labels: expect.arrayContaining(['ferry:approved']) }),
      );
    });

    it('emits exactly one FR28 transition (Iterator → In Review)', () => {
      // FR28 is at index 2: [FR18=REVIEW, FR24=ITER, FR28=REVIEW]
      expect(io.tracker.postedTransitions).toHaveLength(3);
      expect(io.tracker.postedTransitions[2]).toMatchObject({
        key: TICKET_KEY,
        transitionId: REVIEW_TRANSITION_ID,
      });
    });

    it('never calls octokit.rest.pulls.merge (ferry never merges)', () => {
      expect(io.mergeSpy).not.toHaveBeenCalled();
    });
  });

  describe('FR24 approved path', () => {
    it('adds ferry:approved label, flips PR to ready, and emits no iter transition', async () => {
      const io = buildMockIO();
      await runRefinePhase(io);
      await runDevPhase(io);
      await runReviewPhase(io, 'approved');

      // No iter transition in the approved path
      const iterTransitions = io.tracker.postedTransitions.filter(
        (t) => t.transitionId === ITER_TRANSITION_ID,
      );
      expect(iterTransitions).toHaveLength(0);

      // ferry:approved label is added
      expect(io.addLabelsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ['ferry:approved'] }),
      );

      // PR is flipped from draft to ready for review via GraphQL
      expect(io.graphqlSpy).toHaveBeenCalledWith(
        expect.stringContaining('markPullRequestReadyForReview'),
        expect.objectContaining({ pullRequestId: 'PR_kwMockNodeId' }),
      );

      // Exactly one FR24 outcome (label, not transition)
      expect(iterTransitions.length + 1).toBe(1);
    });
  });

  describe('idempotency: replaying the same event_id is a no-op', () => {
    it('second run does not add new transitions, labels, or audit lines', async () => {
      const io = buildMockIO();

      // First run
      await runRefinePhase(io);
      await runDevPhase(io);
      await runReviewPhase(io, 'changes-requested');
      await runIteratePhase(io);

      const transitionsAfterFirst = io.tracker.postedTransitions.length;
      const auditLinesAfterFirst = io.auditComments.length;
      const labelAddsAfterFirst = io.addLabelsSpy.mock.calls.length;

      // Seed subtask details so the content-hash guard skips re-creation on replay
      const createdDetails = io.tracker.createdSubtasks.map((s, i) => ({
        key: `ACME-subtask-${i + 1}`,
        title: s.title,
        description: s.description,
        status: 'To Do' as const,
      }));
      io.tracker.seedSubtaskDetails(TICKET_KEY, createdDetails);

      // Replay with the same event_id
      await runRefinePhase(io);
      await runDevPhase(io);
      await runReviewPhase(io, 'changes-requested');
      await runIteratePhase(io);

      // Transitions: idempotency markers prevent new writes from dev/review/iterate
      expect(io.tracker.postedTransitions).toHaveLength(transitionsAfterFirst);
      // Audit: same runIds cause emitAudit to skip (existing marker found)
      expect(io.auditComments).toHaveLength(auditLinesAfterFirst);
      // Labels: review phase is skipped on replay
      expect(io.addLabelsSpy.mock.calls).toHaveLength(labelAddsAfterFirst);
    });
  });
});
