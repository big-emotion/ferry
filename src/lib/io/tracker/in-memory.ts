import type { IssueTracker, TrackerIssue, TrackerSubtask } from './types.js';

export class InMemoryTracker implements IssueTracker {
  readonly issues = new Map<string, TrackerIssue>();
  readonly postedComments: Array<{ key: string; body: string }> = [];
  readonly postedTransitions: Array<{ key: string; transitionId: string }> = [];
  readonly createdSubtasks: Array<{ parentKey: string; title: string; description: string }> = [];
  private readonly subtaskMap = new Map<string, string[]>();
  private readonly subtaskDetailMap = new Map<string, TrackerSubtask[]>();

  seed(issue: TrackerIssue): void {
    this.issues.set(issue.key, { ...issue, comments: [...issue.comments] });
  }

  seedSubtasks(parentKey: string, summaries: string[]): void {
    this.subtaskMap.set(parentKey, [...summaries]);
  }

  seedSubtaskDetails(parentKey: string, subtasks: TrackerSubtask[]): void {
    this.subtaskDetailMap.set(
      parentKey,
      subtasks.map((s) => ({ ...s })),
    );
  }

  async getIssue(key: string): Promise<TrackerIssue> {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`InMemoryTracker: issue ${key} not found`);
    return { ...issue, comments: [...issue.comments] };
  }

  async postComment(key: string, body: string): Promise<void> {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`InMemoryTracker: issue ${key} not found`);
    this.postedComments.push({ key, body });
    issue.comments.push(body);
  }

  async postTransition(key: string, transitionId: string): Promise<void> {
    this.postedTransitions.push({ key, transitionId });
  }

  async getSubtasks(key: string): Promise<string[]> {
    return this.subtaskMap.get(key) ?? [];
  }

  async getSubtaskDetails(key: string): Promise<TrackerSubtask[]> {
    return (this.subtaskDetailMap.get(key) ?? []).map((s) => ({ ...s }));
  }

  async createSubtask(
    parentKey: string,
    title: string,
    description: string,
  ): Promise<{ id: string }> {
    const id = `subtask-${this.createdSubtasks.length + 1}`;
    this.createdSubtasks.push({ parentKey, title, description });
    const existing = this.subtaskDetailMap.get(parentKey) ?? [];
    existing.push({ key: id, title, description, status: 'To Do' });
    this.subtaskDetailMap.set(parentKey, existing);
    return { id };
  }
}
