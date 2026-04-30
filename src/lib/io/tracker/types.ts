export interface TrackerIssue {
  key: string;
  summary: string;
  description: string;
  comments: string[];
  labels: string[];
  issueType: string;
}

export interface IssueTracker {
  getIssue(key: string): Promise<TrackerIssue>;
  postComment(key: string, body: string): Promise<void>;
  postTransition(key: string, transitionId: string): Promise<void>;
}
