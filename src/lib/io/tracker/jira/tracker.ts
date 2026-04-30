import { JiraRestClient } from '../../jira-rest.js';
import { adfToText, textToAdf } from '../../jira-adf.js';
import type { IssueTracker, TrackerIssue } from '../types.js';

export class JiraTracker implements IssueTracker {
  constructor(private readonly client: JiraRestClient) {}

  async getIssue(key: string): Promise<TrackerIssue> {
    const issue = await this.client.getIssue(key);
    return {
      key: issue.key,
      summary: issue.fields.summary,
      description: adfToText(issue.fields.description),
      comments: issue.fields.comment.comments.map((c) => adfToText(c.body)),
      labels: issue.fields.labels,
      issueType: issue.fields.issuetype.name,
    };
  }

  async postComment(key: string, body: string): Promise<void> {
    await this.client.postComment(key, textToAdf(body));
  }

  async postTransition(key: string, transitionId: string): Promise<void> {
    await this.client.postTransition(key, transitionId);
  }

  async getSubtasks(key: string): Promise<string[]> {
    return this.client.getSubtasks(key);
  }

  async createSubtask(
    parentKey: string,
    title: string,
    description: string,
  ): Promise<{ id: string }> {
    const result = await this.client.createSubtask(parentKey, title, textToAdf(description));
    return { id: result.key };
  }
}
