import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from './refiner-action.js';
import { InMemoryTracker } from '../../lib/io/tracker/in-memory.js';
import type { LlmCall } from './refine.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';

const envelope: EventEnvelopeV1 = {
  version: 'v1',
  event_id: 'evt-dry-001',
  ticket_key: 'PROJ-42',
  phase: 'refine',
  source: 'jira-column',
  ts: '2026-01-01T00:00:00Z',
};

const validPlan = {
  subtasks: [
    { title: 'Implement feature A', description: 'Do A' },
    { title: 'Implement feature B', description: 'Do B' },
  ],
  touch_paths: ['src/foo.ts'],
  output_locale: 'en' as const,
  audit_summary: 'Two tasks planned',
};

function makeMockLlm() {
  return vi.fn<LlmCall>().mockResolvedValue({
    text: JSON.stringify(validPlan),
    usage: { inputTokens: 100, outputTokens: 50, costEur: 0.01 },
  });
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

  it('calls the LLM but posts no Jira comment', async () => {
    const tracker = makeTracker();
    const mockLlm = makeMockLlm();
    await run(envelope, { tracker, callLlm: mockLlm });

    expect(mockLlm).toHaveBeenCalledOnce();
    expect(tracker.postedComments).toHaveLength(0);
  });

  it('creates no subtasks in Jira', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, callLlm: makeMockLlm() });

    expect(tracker.createdSubtasks).toHaveLength(0);
  });

  it('posts no transitions', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, callLlm: makeMockLlm() });

    expect(tracker.postedTransitions).toHaveLength(0);
  });
});

describe('refiner-action normal mode (no FERRY_DRY_RUN)', () => {
  beforeEach(() => {
    delete process.env.FERRY_DRY_RUN;
  });

  it('creates subtasks and posts a comment', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, callLlm: makeMockLlm() });

    expect(tracker.createdSubtasks).toHaveLength(2);
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain('[ferry:refiner:evt-dry-001]');
    expect(tracker.postedComments[0].body).toContain('2 sub-task(s)');
  });

  it('is idempotent: re-run with existing subtasks skips creation', async () => {
    const tracker = makeTracker();
    await run(envelope, { tracker, callLlm: makeMockLlm() });
    expect(tracker.createdSubtasks).toHaveLength(2);

    // Seed the in-memory tracker with created subtask descriptions to simulate
    // them already existing in Jira on a re-run.
    const existingDescs = tracker.createdSubtasks.map((s) => s.description);
    tracker.seedSubtasks('PROJ-42', existingDescs);

    await run(envelope, { tracker, callLlm: makeMockLlm() });

    // No new subtasks (idempotent)
    expect(tracker.createdSubtasks).toHaveLength(2);
  });
});
