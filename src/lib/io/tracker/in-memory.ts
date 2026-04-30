import type { IssueTracker, TrackerIssue } from './types.js';

export class InMemoryTracker implements IssueTracker {
  readonly issues = new Map<string, TrackerIssue>();
  readonly postedComments: Array<{ key: string; body: string }> = [];
  readonly postedTransitions: Array<{ key: string; transitionId: string }> = [];

  seed(issue: TrackerIssue): void {
    this.issues.set(issue.key, { ...issue, comments: [...issue.comments] });
  }

  async getIssue(key: string): Promise<TrackerIssue> {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`InMemoryTracker: issue ${key} not found`);
    return { ...issue, comments: [...issue.comments] };
  }

  async postComment(key: string, body: string): Promise<void> {
    this.postedComments.push({ key, body });
    const issue = this.issues.get(key);
    if (issue) issue.comments.push(body);
  }

  async postTransition(key: string, transitionId: string): Promise<void> {
    this.postedTransitions.push({ key, transitionId });
  }
}
