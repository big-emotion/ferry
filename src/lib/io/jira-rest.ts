import { classifyHttpStatus } from './spend-cap.js';
import { FerryError } from '../errors/index.js';
import type { AdfDoc } from './jira-adf.js';

export interface JiraIssueFields {
  summary: string;
  description: AdfDoc | null;
  comment: {
    comments: Array<{ id: string; body: AdfDoc }>;
  };
  labels: string[];
  issuetype: { name: string };
}

export interface JiraIssueResponse {
  id: string;
  key: string;
  fields: JiraIssueFields;
}

export interface JiraTransition {
  id: string;
  name: string;
}

export interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

export interface JiraCommentResponse {
  id: string;
  body: AdfDoc;
}

export interface JiraCreatedIssue {
  id: string;
  key: string;
  self: string;
}

interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

export class JiraRestClient {
  private readonly authHeader: string;
  private readonly subtaskTypeCache = new Map<string, string>();

  constructor(
    private readonly baseUrl: string,
    email: string,
    apiToken: string,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  }

  private get baseHeaders(): Record<string, string> {
    return { Authorization: this.authHeader, Accept: 'application/json' };
  }

  private throwForStatus(status: number): void {
    const cls = classifyHttpStatus(status);
    if (cls === 'spend-cap') throw new FerryError('spend-cap', { status });
    if (cls === 'transient') throw new FerryError('transient', { status });
  }

  async getIssue(key: string): Promise<JiraIssueResponse> {
    const response = await fetch(
      `${this.baseUrl}/rest/api/3/issue/${key}?fields=summary,description,comment,labels,issuetype`,
      { method: 'GET', headers: this.baseHeaders },
    );
    this.throwForStatus(response.status);
    return response.json() as Promise<JiraIssueResponse>;
  }

  async postComment(key: string, adfBody: AdfDoc): Promise<JiraCommentResponse> {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: adfBody }),
    });
    this.throwForStatus(response.status);
    return response.json() as Promise<JiraCommentResponse>;
  }

  async putComment(key: string, commentId: string, adfBody: AdfDoc): Promise<JiraCommentResponse> {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/comment/${commentId}`, {
      method: 'PUT',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: adfBody }),
    });
    this.throwForStatus(response.status);
    return response.json() as Promise<JiraCommentResponse>;
  }

  private async resolveSubtaskTypeName(projectKey: string): Promise<string> {
    const cached = this.subtaskTypeCache.get(projectKey);
    if (cached !== undefined) return cached;

    const response = await fetch(
      `${this.baseUrl}/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
      { method: 'GET', headers: this.baseHeaders },
    );
    this.throwForStatus(response.status);
    const data = (await response.json()) as { issueTypes: JiraIssueType[] };
    const subtaskType = data.issueTypes.find((t) => t.subtask);
    if (!subtaskType) {
      throw new FerryError('state-invariant', { reason: 'no-subtask-issuetype', projectKey });
    }
    this.subtaskTypeCache.set(projectKey, subtaskType.name);
    return subtaskType.name;
  }

  async createSubtask(
    parentKey: string,
    summary: string,
    adfDescription: AdfDoc,
  ): Promise<JiraCreatedIssue> {
    const projectKey = parentKey.split('-')[0];
    const issuetypeName = await this.resolveSubtaskTypeName(projectKey);

    const response = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          parent: { key: parentKey },
          summary,
          issuetype: { name: issuetypeName },
          description: adfDescription,
        },
      }),
    });
    this.throwForStatus(response.status);
    return response.json() as Promise<JiraCreatedIssue>;
  }

  async addLabel(key: string, label: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ update: { labels: [{ add: label }] } }),
    });
    this.throwForStatus(response.status);
  }

  async getTransitions(key: string): Promise<JiraTransitionsResponse> {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/transitions`, {
      method: 'GET',
      headers: this.baseHeaders,
    });
    this.throwForStatus(response.status);
    return response.json() as Promise<JiraTransitionsResponse>;
  }

  async postTransition(key: string, transitionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/transitions`, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
    this.throwForStatus(response.status);
  }

  async getSubtasks(parentKey: string): Promise<string[]> {
    const jql = encodeURIComponent(`parent=${parentKey} ORDER BY created ASC`);
    const response = await fetch(
      `${this.baseUrl}/rest/api/3/search?jql=${jql}&fields=summary&maxResults=50`,
      { method: 'GET', headers: this.baseHeaders },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      issues?: Array<{ key: string; fields: { summary: string } }>;
    };
    return (data.issues ?? []).map((i) => `- [${i.key}] ${i.fields.summary}`);
  }
}

export function createJiraRestClientFromEnv(): JiraRestClient {
  const baseUrl = process.env.FERRY_JIRA_BASE_URL;
  const email = process.env.FERRY_JIRA_EMAIL;
  const apiToken = process.env.FERRY_JIRA_API_TOKEN;

  if (!baseUrl)
    throw new FerryError('state-invariant', { reason: 'missing-env', key: 'FERRY_JIRA_BASE_URL' });
  if (!email)
    throw new FerryError('state-invariant', { reason: 'missing-env', key: 'FERRY_JIRA_EMAIL' });
  if (!apiToken)
    throw new FerryError('state-invariant', {
      reason: 'missing-env',
      key: 'FERRY_JIRA_API_TOKEN',
    });

  return new JiraRestClient(baseUrl, email, apiToken);
}
