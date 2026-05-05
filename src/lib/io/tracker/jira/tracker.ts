import { JiraRestClient } from '../../jira-rest.js';
import { adfToText, textToAdf } from '../../jira-adf.js';
import type { IssueTracker, TrackerIssue, TrackerSubtask } from '../types.js';

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

  async addLabel(key: string, label: string): Promise<void> {
    await this.client.addLabel(key, label);
  }

  async getSubtasks(key: string): Promise<string[]> {
    return this.client.getSubtasks(key);
  }

  async getSubtaskDetails(key: string): Promise<TrackerSubtask[]> {
    const raw = await this.client.getSubtaskDetails(key);
    return raw.map((r) => ({
      key: r.key,
      title: r.title,
      description: adfToText(r.descriptionAdf),
      status: r.status,
    }));
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
