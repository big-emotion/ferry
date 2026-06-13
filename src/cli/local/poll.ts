import { Buffer } from 'node:buffer';
import { loadFerryConfig } from '../../lib/config.js';
import { processLocalTransition } from './process.js';

export interface PollIssue {
  id: string;
  key: string;
  fields: {
    status: { name: string };
    updated?: string;
  };
}

export interface PollOptions {
  repoRoot: string;
  dryRun?: boolean;
  once?: boolean;
}

function getJiraAuthHeader(): string {
  const baseUrl = process.env.FERRY_JIRA_BASE_URL;
  const email = process.env.FERRY_JIRA_EMAIL;
  const apiToken = process.env.FERRY_JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      'FERRY_JIRA_BASE_URL, FERRY_JIRA_EMAIL, and FERRY_JIRA_API_TOKEN are required for ferry-local poll',
    );
  }
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

export function buildPollJql(statuses: readonly string[]): string {
  return `status in (${statuses.map((status) => `"${status}"`).join(',')}) ORDER BY updated DESC`;
}

export async function fetchPollIssues(repoRoot: string): Promise<PollIssue[]> {
  const config = loadFerryConfig(repoRoot);
  const baseUrl = process.env.FERRY_JIRA_BASE_URL;
  if (!baseUrl) throw new Error('FERRY_JIRA_BASE_URL is required for ferry-local poll');

  const statuses = [
    config.workflow.agents.refiner.trigger_column,
    config.workflow.agents.developer.trigger_column,
    config.workflow.agents.reviewer.trigger_column,
    config.workflow.agents.iterator.trigger_column,
    'Ready to Merge',
  ];
  const jql = buildPollJql(statuses);
  const response = await fetch(
    `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=status,updated&maxResults=100`,
    {
      headers: {
        Authorization: getJiraAuthHeader(),
        Accept: 'application/json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`[ferry-local] Jira poll failed with status ${response.status}`);
  }
  const data = (await response.json()) as { issues?: PollIssue[] };
  return data.issues ?? [];
}

export async function runPollOnce(options: PollOptions): Promise<void> {
  const issues = await fetchPollIssues(options.repoRoot);
  for (const issue of issues) {
    await processLocalTransition({
      repoRoot: options.repoRoot,
      ticketKey: issue.key,
      status: issue.fields.status.name,
      ts: issue.fields.updated,
      eventId: issue.fields.updated
        ? `${Date.parse(issue.fields.updated)}-${issue.key}`
        : undefined,
      dryRun: options.dryRun,
    });
  }
}

export async function runPollLoop(options: PollOptions): Promise<void> {
  const intervalMs = parseInt(process.env.FERRY_LOCAL_POLL_INTERVAL_MS ?? '', 10) || 30_000;
  do {
    await runPollOnce(options);
    if (options.once) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
}
