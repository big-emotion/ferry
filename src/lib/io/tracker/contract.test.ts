import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTracker } from './in-memory.js';
import type { TrackerIssue } from './types.js';

const SAMPLE_ISSUE: TrackerIssue = {
  key: 'PROJ-1',
  summary: 'Test issue',
  description: 'Some description',
  comments: ['First comment', 'Second comment'],
  labels: ['bug'],
  issueType: 'Story',
};

describe('IssueTracker contract — InMemoryTracker', () => {
  let tracker: InMemoryTracker;

  beforeEach(() => {
    tracker = new InMemoryTracker();
    tracker.seed(SAMPLE_ISSUE);
  });

  it('getIssue returns the seeded issue with correct fields', async () => {
    const issue = await tracker.getIssue('PROJ-1');
    expect(issue.key).toBe('PROJ-1');
    expect(issue.summary).toBe('Test issue');
    expect(issue.description).toBe('Some description');
    expect(issue.comments).toEqual(['First comment', 'Second comment']);
    expect(issue.labels).toEqual(['bug']);
    expect(issue.issueType).toBe('Story');
  });

  it('getIssue throws when the issue does not exist', async () => {
    await expect(tracker.getIssue('UNKNOWN-1')).rejects.toThrow('UNKNOWN-1');
  });

  it('getIssue returns an independent copy of comments (mutation safety)', async () => {
    const issue = await tracker.getIssue('PROJ-1');
    issue.comments.push('mutated externally');
    const issue2 = await tracker.getIssue('PROJ-1');
    expect(issue2.comments).toHaveLength(2);
  });

  it('postComment appends to the tracked list', async () => {
    await tracker.postComment('PROJ-1', 'New comment');
    expect(tracker.postedComments).toEqual([{ key: 'PROJ-1', body: 'New comment' }]);
  });

  it('postComment makes the body visible in subsequent getIssue calls', async () => {
    await tracker.postComment('PROJ-1', 'Appended');
    const issue = await tracker.getIssue('PROJ-1');
    expect(issue.comments).toContain('Appended');
  });

  it('postComment throws when the issue does not exist', async () => {
    await expect(tracker.postComment('UNKNOWN-1', 'body')).rejects.toThrow('UNKNOWN-1');
  });

  it('postTransition records the transition', async () => {
    await tracker.postTransition('PROJ-1', '31');
    expect(tracker.postedTransitions).toEqual([{ key: 'PROJ-1', transitionId: '31' }]);
  });

  it('multiple transitions are all recorded', async () => {
    await tracker.postTransition('PROJ-1', '11');
    await tracker.postTransition('PROJ-1', '31');
    expect(tracker.postedTransitions).toHaveLength(2);
    expect(tracker.postedTransitions[1].transitionId).toBe('31');
  });

  it('getSubtasks returns empty array when none are seeded', async () => {
    const subtasks = await tracker.getSubtasks('PROJ-1');
    expect(subtasks).toEqual([]);
  });

  it('getSubtasks returns seeded subtask summaries', async () => {
    tracker.seedSubtasks('PROJ-1', ['- [PROJ-2] First subtask', '- [PROJ-3] Second subtask']);
    const subtasks = await tracker.getSubtasks('PROJ-1');
    expect(subtasks).toEqual(['- [PROJ-2] First subtask', '- [PROJ-3] Second subtask']);
  });

  it('getSubtaskDetails returns empty array when none are seeded', async () => {
    const details = await tracker.getSubtaskDetails('PROJ-1');
    expect(details).toEqual([]);
  });

  it('getSubtaskDetails returns seeded subtask details', async () => {
    tracker.seedSubtaskDetails('PROJ-1', [
      { key: 'PROJ-2', title: 'First subtask', description: 'do first', status: 'To Do' },
      { key: 'PROJ-3', title: 'Second subtask', description: 'do second', status: 'In Progress' },
    ]);
    const details = await tracker.getSubtaskDetails('PROJ-1');
    expect(details).toHaveLength(2);
    expect(details[0].key).toBe('PROJ-2');
    expect(details[1].status).toBe('In Progress');
  });

  it('createSubtask records the new subtask in getSubtaskDetails', async () => {
    await tracker.createSubtask('PROJ-1', 'New task', 'do new');
    const details = await tracker.getSubtaskDetails('PROJ-1');
    expect(details).toHaveLength(1);
    expect(details[0].title).toBe('New task');
    expect(details[0].status).toBe('To Do');
  });
});
