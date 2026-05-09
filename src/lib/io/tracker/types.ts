export interface TrackerIssue {
  key: string;
  summary: string;
  description: string;
  comments: string[];
  labels: string[];
  /** Canonical (normalized) English issue type name. */
  issueType: string;
  /** Verbatim issue type name as returned by the tracker (may be a non-English locale). */
  issueTypeRaw: string;
}

export interface TrackerSubtask {
  key: string;
  title: string;
  description: string;
  status: string;
}

export interface IssueTracker {
  getIssue(key: string): Promise<TrackerIssue>;
  postComment(key: string, body: string): Promise<void>;
  postTransition(key: string, transitionId: string): Promise<void>;
  addLabel(key: string, label: string): Promise<void>;
  getSubtasks(key: string): Promise<string[]>;
  getSubtaskDetails(key: string): Promise<TrackerSubtask[]>;
  createSubtask(parentKey: string, title: string, description: string): Promise<{ id: string }>;
}
