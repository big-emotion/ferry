import { describe, it, expect } from 'vitest';
import { applyActions } from './reconcile.js';
import { InMemoryTracker } from '../../lib/io/tracker/in-memory.js';
import type { RefinerAction } from './schema.js';
import type { TrackerSubtask } from '../../lib/io/tracker/types.js';
import { prepareBatch } from './batch.js';

function makeTracker(parentKey: string, subtasks: TrackerSubtask[] = []) {
  const tracker = new InMemoryTracker();
  tracker.seed({
    key: parentKey,
    summary: 'Test ticket',
    description: 'desc',
    comments: [],
    labels: [],
    issueType: 'Story',
    issueTypeRaw: 'Story',
  });
  for (const s of subtasks) {
    tracker.seed({
      key: s.key,
      summary: s.title,
      description: s.description,
      comments: [],
      labels: [],
      issueType: 'Sub-task',
      issueTypeRaw: 'Sub-task',
    });
  }
  tracker.seedSubtaskDetails(parentKey, subtasks);
  return tracker;
}

describe('applyActions — noop', () => {
  it('returns noop=true and posts no subtasks', async () => {
    const tracker = makeTracker('PROJ-1');
    const actions: RefinerAction[] = [{ type: 'noop', reason: 'nothing changed' }];

    const result = await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-1',
      existingSubtasks: [],
      tracker,
    });

    expect(result.noop).toBe(true);
    expect(result.noopReason).toBe('nothing changed');
    expect(result.createdCount).toBe(0);
    expect(tracker.createdSubtasks).toHaveLength(0);
  });
});

describe('applyActions — create', () => {
  it('creates new subtasks and returns correct count', async () => {
    const tracker = makeTracker('PROJ-1');
    const actions: RefinerAction[] = [
      { type: 'create', title: 'Task A', description: 'Do A' },
      { type: 'create', title: 'Task B', description: 'Do B' },
    ];

    const result = await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-1',
      existingSubtasks: [],
      tracker,
    });

    expect(result.noop).toBe(false);
    expect(result.createdCount).toBe(2);
    expect(tracker.createdSubtasks).toHaveLength(2);
  });

  it('skips create actions whose content-hash already exists in Jira (idempotency guard)', async () => {
    // Prepare descriptions with content-hash markers as they would appear in Jira
    const batch = prepareBatch([{ title: 'Task A', description: 'Do A' }]);
    const existingSubtask: TrackerSubtask = {
      key: 'PROJ-10',
      title: 'Task A',
      description: batch.subtasks[0].description,
      status: 'To Do',
    };

    const tracker = makeTracker('PROJ-1', [existingSubtask]);
    const actions: RefinerAction[] = [
      { type: 'create', title: 'Task A', description: 'Do A' },
      { type: 'create', title: 'Task B', description: 'Do B' },
    ];

    const result = await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-2',
      existingSubtasks: [existingSubtask],
      tracker,
    });

    // Only Task B should be created; Task A already exists by content hash
    expect(result.createdCount).toBe(1);
    expect(tracker.createdSubtasks[0].title).toBe('Task B');
  });
});

describe('applyActions — keep', () => {
  it('counts kept actions without writing anything', async () => {
    const existing: TrackerSubtask = {
      key: 'PROJ-10',
      title: 'Old',
      description: 'old',
      status: 'To Do',
    };
    const tracker = makeTracker('PROJ-1', [existing]);
    const actions: RefinerAction[] = [
      { type: 'keep', existing_key: 'PROJ-10', reason: 'still valid' },
    ];

    const result = await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-1',
      existingSubtasks: [existing],
      tracker,
    });

    expect(result.keptCount).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(tracker.createdSubtasks).toHaveLength(0);
    expect(tracker.postedComments).toHaveLength(0);
  });
});

describe('applyActions — mark_stale', () => {
  it('posts a stale comment on the subtask when it is not locked', async () => {
    const existing: TrackerSubtask = {
      key: 'PROJ-10',
      title: 'Old',
      description: 'old',
      status: 'To Do',
    };
    const tracker = makeTracker('PROJ-1', [existing]);
    const actions: RefinerAction[] = [
      { type: 'mark_stale', existing_key: 'PROJ-10', reason: 'superseded by rewrite' },
    ];

    const result = await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-1',
      existingSubtasks: [existing],
      tracker,
    });

    expect(result.staledCount).toBe(1);
    const staleComment = tracker.postedComments.find((c) => c.key === 'PROJ-10');
    expect(staleComment).toBeDefined();
    expect(staleComment!.body).toContain('[ferry:refiner-stale:evt-1]');
    expect(staleComment!.body).toContain('superseded by rewrite');
  });

  it('locked guard: In Progress subtask → warning on parent, not on subtask', async () => {
    const existing: TrackerSubtask = {
      key: 'PROJ-20',
      title: 'Active',
      description: 'active',
      status: 'In Progress',
    };
    const tracker = makeTracker('PROJ-1', [existing]);
    const actions: RefinerAction[] = [
      { type: 'mark_stale', existing_key: 'PROJ-20', reason: 'superseded' },
    ];

    await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-1',
      existingSubtasks: [existing],
      tracker,
    });

    // Warning must go to parent (PROJ-1), not the locked subtask
    expect(tracker.postedComments.find((c) => c.key === 'PROJ-20')).toBeUndefined();
    const parentWarning = tracker.postedComments.find((c) => c.key === 'PROJ-1');
    expect(parentWarning).toBeDefined();
    expect(parentWarning!.body).toContain('In Progress');
    expect(parentWarning!.body).toContain('PROJ-20');
  });

  it('locked guard: Done subtask → warning on parent', async () => {
    const existing: TrackerSubtask = {
      key: 'PROJ-30',
      title: 'Finished',
      description: 'done',
      status: 'Done',
    };
    const tracker = makeTracker('PROJ-1', [existing]);
    const actions: RefinerAction[] = [
      { type: 'mark_stale', existing_key: 'PROJ-30', reason: 'obsolete' },
    ];

    await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-1',
      existingSubtasks: [existing],
      tracker,
    });

    expect(tracker.postedComments.find((c) => c.key === 'PROJ-30')).toBeUndefined();
    const parentWarning = tracker.postedComments.find((c) => c.key === 'PROJ-1');
    expect(parentWarning!.body).toContain('Done');
  });
});

describe('applyActions — mixed', () => {
  it('handles create + keep + mark_stale together', async () => {
    const keepSubtask: TrackerSubtask = {
      key: 'PROJ-10',
      title: 'Keep me',
      description: 'keep',
      status: 'To Do',
    };
    const staleSubtask: TrackerSubtask = {
      key: 'PROJ-11',
      title: 'Old task',
      description: 'old',
      status: 'To Do',
    };
    const tracker = makeTracker('PROJ-1', [keepSubtask, staleSubtask]);

    const actions: RefinerAction[] = [
      { type: 'keep', existing_key: 'PROJ-10', reason: 'still valid' },
      { type: 'mark_stale', existing_key: 'PROJ-11', reason: 'replaced' },
      { type: 'create', title: 'New task', description: 'new work' },
    ];

    const result = await applyActions(actions, {
      ticketKey: 'PROJ-1',
      eventId: 'evt-1',
      existingSubtasks: [keepSubtask, staleSubtask],
      tracker,
    });

    expect(result.noop).toBe(false);
    expect(result.keptCount).toBe(1);
    expect(result.staledCount).toBe(1);
    expect(result.createdCount).toBe(1);
  });
});
