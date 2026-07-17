import { JiraRestClient } from '../../jira-rest.js';
import { adfToText, textToAdf } from '../../jira-adf.js';
import type { IssueTracker, TrackerIssue, TrackerSubtask, TrackerTransition } from '../types.js';

const ISSUE_TYPE_LOCALE_MAP: Record<string, string> = {
  // French
  tâche: 'Task',
  bogue: 'Bug',
  histoire: 'Story',
  épique: 'Epic',
  'sous-tâche': 'Sub-task',
};

function normalizeIssueType(raw: string): string {
  return ISSUE_TYPE_LOCALE_MAP[raw.toLowerCase()] ?? raw;
}

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
      issueType: normalizeIssueType(issue.fields.issuetype.name),
      issueTypeRaw: issue.fields.issuetype.name,
    };
  }

  async postComment(key: string, body: string): Promise<void> {
    await this.client.postComment(key, textToAdf(body));
  }

  async getTransitions(key: string): Promise<TrackerTransition[]> {
    const { transitions } = await this.client.getTransitions(key);
    // Key off the target status (`to.name`), not the transition label — see
    // matchTransitionId. `to` is optional in the parsed shape; an entry without
    // it can never match a configured status, so an empty toStatus is correct.
    return transitions.map((t) => ({ id: t.id, toStatus: t.to?.name ?? '' }));
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
