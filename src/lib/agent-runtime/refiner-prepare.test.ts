import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prepareRefiner } from './refiner-prepare.js';
import { InMemoryTracker } from '../io/tracker/in-memory.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';

const envelope: EventEnvelopeV1 = {
  version: 'v1',
  event_id: 'evt-prep-001',
  ticket_key: 'PROJ-100',
  phase: 'refine',
  source: 'jira-column',
  ts: '2026-01-01T00:00:00Z',
};

function makeTracker(): InMemoryTracker {
  const tracker = new InMemoryTracker();
  tracker.seed({
    key: 'PROJ-100',
    summary: 'Refine setup',
    description: 'Body text',
    comments: [
      'random comment',
      '[ferry:refiner:evt-old-1] Refined. Created 2…',
      'another comment',
      '[ferry:refiner:evt-old-2] Refined. Kept 1…',
    ],
    labels: [],
    issueType: 'Story',
    issueTypeRaw: 'Story',
  });
  tracker.seedSubtaskDetails('PROJ-100', [
    { key: 'PROJ-101', title: 'Existing one', description: 'desc', status: 'To Do' },
  ]);
  return tracker;
}

describe('prepareRefiner', () => {
  beforeEach(() => {
    process.env.GITHUB_REPO = 'big-emotion/ferry';
    process.env.GITHUB_RUN_ID = '12345';
  });

  afterEach(() => {
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_RUN_ID;
    vi.restoreAllMocks();
  });

  it('returns the issue, existing subtasks, prior refiner runs, runLink and idempotency marker', async () => {
    const tracker = makeTracker();
    const ctx = await prepareRefiner({ envelope, tracker });

    expect(ctx.issue.key).toBe('PROJ-100');
    expect(ctx.existingSubtasks).toHaveLength(1);
    expect(ctx.existingSubtasks[0].key).toBe('PROJ-101');
    expect(ctx.priorRefinerRuns).toEqual([
      '[ferry:refiner:evt-old-1] Refined. Created 2…',
      '[ferry:refiner:evt-old-2] Refined. Kept 1…',
    ]);
    expect(ctx.runLink).toBe('https://github.com/big-emotion/ferry/actions/runs/12345');
    expect(ctx.idempotencyMarker).toBe('[ferry:refiner:evt-prep-001]');
  });

  it('falls back to "unknown" repo and "0" run id when env vars are missing', async () => {
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_RUN_ID;
    const tracker = makeTracker();
    const ctx = await prepareRefiner({ envelope, tracker });

    expect(ctx.runLink).toBe('https://github.com/unknown/actions/runs/0');
  });

  it('returns an empty priorRefinerRuns list when the issue has no refiner markers', async () => {
    const tracker = new InMemoryTracker();
    tracker.seed({
      key: 'PROJ-100',
      summary: 'Fresh ticket',
      description: 'No prior runs',
      comments: ['just a user comment'],
      labels: [],
      issueType: 'Story',
      issueTypeRaw: 'Story',
    });
    const ctx = await prepareRefiner({ envelope, tracker });

    expect(ctx.priorRefinerRuns).toEqual([]);
    expect(ctx.existingSubtasks).toEqual([]);
  });

  it('only invokes the tracker once for issue + once for subtask details', async () => {
    const tracker = makeTracker();
    const getIssueSpy = vi.spyOn(tracker, 'getIssue');
    const getSubtaskDetailsSpy = vi.spyOn(tracker, 'getSubtaskDetails');

    await prepareRefiner({ envelope, tracker });

    expect(getIssueSpy).toHaveBeenCalledTimes(1);
    expect(getIssueSpy).toHaveBeenCalledWith('PROJ-100');
    expect(getSubtaskDetailsSpy).toHaveBeenCalledTimes(1);
    expect(getSubtaskDetailsSpy).toHaveBeenCalledWith('PROJ-100');
  });
});
