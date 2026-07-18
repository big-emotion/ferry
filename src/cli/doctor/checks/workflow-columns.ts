import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { httpsGet } from '../../http.js';
import type { CheckResult } from '../types.js';

const _require = createRequire(import.meta.url);

function jiraAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

interface JiraStatus {
  id: string;
  name: string;
}

interface JiraIssueTypeWithStatuses {
  statuses: JiraStatus[];
}

function parseYaml(content: string): unknown {
  const mod = _require('yaml') as { parse: (s: string) => unknown };
  return mod.parse(content);
}

function readRawConfig(repoRoot: string): Record<string, unknown> | null {
  const jsonPath = join(repoRoot, 'ferry.config.json');
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  for (const ext of ['ferry.config.yaml', 'ferry.config.yml']) {
    const yamlPath = join(repoRoot, ext);
    if (!existsSync(yamlPath)) continue;
    try {
      return parseYaml(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function collectWorkflowColumns(raw: Record<string, unknown>): string[] | null {
  const workflow = raw.workflow as Record<string, unknown> | undefined;
  if (!workflow) return null;
  const agents = workflow.agents as Record<string, unknown> | undefined;
  if (!agents) return null;

  const columns: string[] = [];
  const push = (val: unknown): void => {
    if (typeof val === 'string' && val.trim()) columns.push(val.trim());
  };

  for (const agentKey of ['refiner', 'developer', 'reviewer', 'iterator', 'merger']) {
    const agent = agents[agentKey] as Record<string, unknown> | undefined;
    if (!agent) continue;
    push(agent.trigger_column);
    push(agent.auto_transition);
    push(agent.auto_transition_approve);
    push(agent.auto_transition_changes);
    push(agent.auto_transition_done);
  }

  return columns.length > 0 ? [...new Set(columns)] : null;
}

export async function checkWorkflowColumns(opts: {
  repoRoot: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
}): Promise<CheckResult> {
  const { repoRoot, jiraBaseUrl, jiraEmail, jiraApiToken, jiraProjectKey } = opts;

  const raw = readRawConfig(repoRoot);
  if (!raw) {
    return {
      label: 'Workflow columns',
      status: 'skip',
      detail: 'No ferry.config.* found or config could not be parsed — skipping column validation',
    };
  }

  const columns = collectWorkflowColumns(raw);
  if (columns === null) {
    return {
      label: 'Workflow columns',
      status: 'skip',
      detail: 'No workflow.agents section in config — using defaults',
    };
  }

  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken || !jiraProjectKey) {
    return {
      label: 'Workflow columns',
      status: 'skip',
      detail: 'Jira credentials not provided — skipping column validation',
      remedy: 'Provide --jira-url, --jira-email, --jira-token, --jira-project to validate columns',
    };
  }

  let hostname: string;
  let basePath: string;
  try {
    const url = new URL(jiraBaseUrl);
    hostname = url.hostname;
    basePath = url.pathname.replace(/\/$/, '');
  } catch {
    return {
      label: 'Workflow columns',
      status: 'skip',
      detail: 'Invalid Jira URL — skipping column validation',
    };
  }

  const headers = {
    Authorization: jiraAuthHeader(jiraEmail, jiraApiToken),
    Accept: 'application/json',
    'User-Agent': 'ferry-doctor/1',
  };

  let projectStatuses: string[];
  try {
    const res = await httpsGet({
      hostname,
      path: `${basePath}/rest/api/3/project/${encodeURIComponent(jiraProjectKey)}/statuses`,
      headers,
    });

    if (res.statusCode === 404) {
      return {
        label: 'Workflow columns',
        status: 'yellow',
        detail: `Project "${jiraProjectKey}" not found — cannot validate columns`,
        remedy: 'Verify FERRY_JIRA_PROJECT_KEY is correct',
      };
    }
    if (res.statusCode !== 200) {
      return {
        label: 'Workflow columns',
        status: 'yellow',
        detail: `Jira returned status ${res.statusCode} fetching project statuses`,
        remedy: 'Check Jira credentials and project key',
      };
    }

    const data = JSON.parse(res.body) as JiraIssueTypeWithStatuses[];
    const statusSet = new Set<string>();
    for (const issueType of data) {
      for (const s of issueType.statuses) {
        statusSet.add(s.name);
      }
    }
    projectStatuses = [...statusSet];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      label: 'Workflow columns',
      status: 'yellow',
      detail: `Could not fetch Jira project statuses: ${msg}`,
      remedy: 'Check network connectivity and Jira credentials',
    };
  }

  const missing = columns.filter((c) => !projectStatuses.includes(c));

  if (missing.length > 0) {
    return {
      label: 'Workflow columns',
      status: 'red',
      detail: `Column(s) not found in Jira project "${jiraProjectKey}": ${missing.join(', ')}`,
      remedy: `Update workflow.agents column names in ferry.config.yaml to match your Jira board. Available: ${projectStatuses.join(', ')}`,
    };
  }

  return {
    label: 'Workflow columns',
    status: 'green',
    detail: `All ${columns.length} configured column(s) exist in Jira project "${jiraProjectKey}"`,
  };
}
