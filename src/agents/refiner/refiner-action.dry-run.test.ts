import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from './refiner-action.js';
import { InMemoryTracker } from '../../lib/io/tracker/in-memory.js';
import type { AgentLoop, AgentLoopResult } from '../../lib/llm/agent-loop/index.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';
import type { TrackerSubtask } from '../../lib/io/tracker/types.js';

const envelope: EventEnvelopeV1 = {
  version: 'v1',
  event_id: 'evt-dry-001',
  ticket_key: 'PROJ-42',
  phase: 'refine',
  source: 'jira-column',
  ts: '2026-01-01T00:00:00Z',
};

const createPlan = {
  actions: [
    { type: 'create' as const, title: 'Implement feature A', description: 'Do A' },
    { type: 'create' as const, title: 'Implement feature B', description: 'Do B' },
  ],
  touch_paths: ['src/foo.ts'],
  output_locale: 'en' as const,
  audit_summary: 'Two tasks planned',
};

const noopPlan = {
  actions: [{ type: 'noop' as const, reason: 'already done' }],
  touch_paths: [],
  output_locale: 'en' as const,
  audit_summary: 'nothing to do',
};

function makeMockLoop(plan: unknown = createPlan): AgentLoop {
  const result: AgentLoopResult = {
    done: plan as AgentLoopResult['done'],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    iterations: 1,
    toolCounts: {},
    toolCallRecords: [],
  };
  return { run: vi.fn().mockResolvedValue(result) };
}

function makeTracker(): InMemoryTracker {
  const tracker = new InMemoryTracker();
  tracker.seed({
    key: 'PROJ-42',
    summary: 'Implement login',
    description: 'Add login button',
    comments: [],
    labels: [],
    issueType: 'Story',
    issueTypeRaw: 'Story',
  });
  return tracker;
}

describe('refiner-action dry-run (FERRY_DRY_RUN=1)', () => {
  beforeEach(() => {
    process.env.FERRY_DRY_RUN = '1';
  });

  afterEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  it('calls the loop but posts no Jira comment', async () => {
    const tracker = makeTracker();
    const mockLoop = makeMockLoop();
    await run(envelope, { tracker, loop: mockLoop });

    expect(mockLoop.run).toHaveBeenCalledOnce();
    expect(tracker.postedComments).toHaveLength(0);
  });

  it('creates no subtasks in Jira', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, loop: makeMockLoop() });

    expect(tracker.createdSubtasks).toHaveLength(0);
  });

  it('posts no transitions', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, loop: makeMockLoop() });

    expect(tracker.postedTransitions).toHaveLength(0);
  });
});

describe('refiner-action normal mode — first run (no FERRY_DRY_RUN)', () => {
  beforeEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  it('creates subtasks and posts a refinement comment', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, loop: makeMockLoop() });

    expect(tracker.createdSubtasks).toHaveLength(2);
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain('[ferry:refiner:evt-dry-001]');
    expect(tracker.postedComments[0].body).toContain('Created 2');
  });
});

describe('refiner-action dry-run (label-driven via deps.dryRun)', () => {
  beforeEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  it('calls the loop but posts no Jira comment when deps.dryRun=true', async () => {
    const tracker = makeTracker();
    const mockLoop = makeMockLoop();
    await run(envelope, { tracker, loop: mockLoop, dryRun: true });

    expect(mockLoop.run).toHaveBeenCalledOnce();
    expect(tracker.postedComments).toHaveLength(0);
  });

  it('creates no subtasks when deps.dryRun=true (Refiner sub-task write suppressed)', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, loop: makeMockLoop(), dryRun: true });

    expect(tracker.createdSubtasks).toHaveLength(0);
  });

  it('posts no transitions when deps.dryRun=true', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, loop: makeMockLoop(), dryRun: true });

    expect(tracker.postedTransitions).toHaveLength(0);
  });

  it('adds no labels when deps.dryRun=true (cost-estimate label suppressed)', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, loop: makeMockLoop(), dryRun: true });

    expect(tracker.addedLabels).toHaveLength(0);
  });
});

describe('refiner-action re-trigger scenario', () => {
  beforeEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  it('noop: posts no-changes comment and creates zero subtasks', async () => {
    const tracker = makeTracker();
    // Seed existing subtasks so prior runs look present in comments
    tracker.seed({
      key: 'PROJ-42',
      summary: 'Implement login',
      description: 'Add login button',
      comments: ['[ferry:refiner:old-evt] Refined. Created 2...'],
      labels: [],
      issueType: 'Story',
      issueTypeRaw: 'Story',
    });

    await run(envelope, { tracker, loop: makeMockLoop(noopPlan) });

    expect(tracker.createdSubtasks).toHaveLength(0);
    expect(tracker.postedComments[0].body).toContain('No changes needed');
    expect(tracker.postedComments[0].body).toContain('[ferry:refiner:evt-dry-001]');
  });

  it('partial create: only creates missing subtasks, skips existing ones with matching content hash', async () => {
    const tracker = makeTracker();

    // First run: creates 2 subtasks
    await run(envelope, { tracker, loop: makeMockLoop() });
    expect(tracker.createdSubtasks).toHaveLength(2);

    // Simulate Jira now has those subtasks seeded (with content-hash markers in descriptions)
    const existingDetails: TrackerSubtask[] = tracker.createdSubtasks.map((s, i) => ({
      key: `PROJ-${100 + i}`,
      title: s.title,
      description: s.description,
      status: 'To Do',
    }));
    tracker.seedSubtaskDetails('PROJ-42', existingDetails);

    // Re-trigger with same plan → loop returns create actions again but idempotency guard fires
    const envelope2 = { ...envelope, event_id: 'evt-dry-002' };
    await run(envelope2, { tracker, loop: makeMockLoop() });

    // No new subtasks should be created (content-hash guard)
    expect(tracker.createdSubtasks).toHaveLength(2);
  });

  it('locked-status guard: In Progress subtask marked stale triggers parent warning, not subtask comment', async () => {
    const tracker = makeTracker();
    const lockedSubtask: TrackerSubtask = {
      key: 'PROJ-99',
      title: 'Old task',
      description: 'old desc',
      status: 'In Progress',
    };
    tracker.seedSubtaskDetails('PROJ-42', [lockedSubtask]);

    const stalePlan = {
      actions: [{ type: 'mark_stale' as const, existing_key: 'PROJ-99', reason: 'superseded' }],
      touch_paths: [],
      output_locale: 'en' as const,
      audit_summary: 'mark stale',
    };

    await run(envelope, { tracker, loop: makeMockLoop(stalePlan) });

    // Comment should be on parent ticket (PROJ-42), not the locked subtask (PROJ-99)
    const staleComment = tracker.postedComments.find((c) => c.body.includes('ferry:refiner-stale'));
    expect(staleComment).toBeDefined();
    expect(staleComment!.key).toBe('PROJ-42');
    expect(staleComment!.body).toContain('In Progress');
    expect(staleComment!.body).toContain('PROJ-99');
  });
});
