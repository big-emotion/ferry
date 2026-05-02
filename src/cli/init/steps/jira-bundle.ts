import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { printSuccess, print } from '../prompt.js';
import type { StepResult } from '../types.js';

interface JiraWebRequestAction {
  type: 'SEND_WEB_REQUEST';
  value: {
    url: string;
    method: 'POST';
    body: string;
    headers: Array<{ name: string; value: string }>;
    delayUnit: 'SECONDS';
    delay: '0';
    waitForResponse: false;
  };
}

interface JiraTransitionTrigger {
  type: 'ISSUE_TRANSITIONED';
  value: {
    fromStatusCategory?: string;
    toStatus: { name: string };
    eventFilters: string[];
  };
}

interface JiraRule {
  name: string;
  state: 'DISABLED';
  ruleScope: { resources: string[] };
  trigger: JiraTransitionTrigger;
  actions: JiraWebRequestAction[];
}

interface JiraAutomationBundle {
  cloud: true;
  version: 1;
  type: 'AUTOMATION';
  rules: JiraRule[];
}

const PHASES = [
  { eventType: 'ferry-refine', statusName: 'Refinement', label: 'Refine' },
  { eventType: 'ferry-dev', statusName: 'In Development', label: 'Dev' },
  { eventType: 'ferry-review', statusName: 'In Review', label: 'Review' },
  { eventType: 'ferry-iterate', statusName: 'Iteration', label: 'Iterate' },
] as const;

export function buildJiraBundle(
  owner: string,
  repo: string,
  workspaceId: string,
  projectId: string,
): JiraAutomationBundle {
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const ari = `ari:cloud:jira:${workspaceId}:project/${projectId}`;

  const rules: JiraRule[] = PHASES.map((phase) => {
    const body = JSON.stringify({
      event_type: phase.eventType,
      client_payload: {
        phase: phase.label.toLowerCase(),
        ticket_key: '{{issue.key}}',
        issue_type: '{{issue.issuetype.name}}',
        actor: '{{initiator.displayName}}',
        source: 'jira-column',
        ts: '{{now.format("yyyy-MM-dd\'T\'HH:mm:ssXXX")}}',
      },
    });

    return {
      name: `Ferry — ${phase.label} (column trigger)`,
      state: 'DISABLED',
      ruleScope: { resources: [ari] },
      trigger: {
        type: 'ISSUE_TRANSITIONED',
        value: {
          toStatus: { name: phase.statusName },
          eventFilters: [ari],
        },
      },
      actions: [
        {
          type: 'SEND_WEB_REQUEST',
          value: {
            url: dispatchUrl,
            method: 'POST',
            body,
            headers: [
              { name: 'Accept', value: 'application/vnd.github+json' },
              {
                name: 'Authorization',
                value: 'Bearer YOUR_GITHUB_PAT_WITH_REPO_SCOPE',
              },
              { name: 'X-GitHub-Api-Version', value: '2022-11-28' },
              { name: 'Content-Type', value: 'application/json' },
            ],
            delayUnit: 'SECONDS',
            delay: '0',
            waitForResponse: false,
          },
        },
      ],
    };
  });

  return { cloud: true, version: 1, type: 'AUTOMATION', rules };
}

export function stepJiraBundle(
  repoRoot: string,
  owner: string,
  repo: string,
  workspaceId: string,
  projectId: string,
): StepResult {
  const bundle = buildJiraBundle(owner, repo, workspaceId, projectId);
  const outPath = join(repoRoot, 'ferry-jira-automation-rules.json');
  writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  printSuccess(`Generated ferry-jira-automation-rules.json`);
  print('');
  print('  To import these Automation rules into Jira:');
  print('  1. Jira → Project settings → Automation');
  print('  2. Top-right menu → Import rules');
  print('  3. Upload ferry-jira-automation-rules.json');
  print('  4. Replace YOUR_GITHUB_PAT_WITH_REPO_SCOPE in each rule with a fine-grained PAT');
  print('     that has Contents: write on your repo (or use a GitHub App installation token).');
  print('  5. Set the "To status" in each rule to match your Jira column names exactly.');
  print('  6. Enable each rule.');

  return { ok: true };
}
