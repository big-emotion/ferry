import { createJiraRestClientFromEnv } from '../jira-rest.js';
import { JiraTracker } from './jira/tracker.js';
import type { IssueTracker } from './types.js';

export function createTrackerFromEnv(): IssueTracker {
  return new JiraTracker(createJiraRestClientFromEnv());
}
