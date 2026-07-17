import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { printSuccess, printWarn, print } from '../prompt.js';
import type { StepResult } from '../types.js';

interface JiraHeader {
  name: string;
  value: string;
  headerSecure: boolean;
}

interface JiraActionValue {
  url: string;
  method: 'POST';
  contentType: 'custom';
  customBody: string;
  headers: JiraHeader[];
}

interface JiraComponent {
  component: 'ACTION';
  type: 'jira.issue.outgoing.webhook';
  value: JiraActionValue;
  schemaVersion: 1;
}

interface JiraTriggerValue {
  eventFilters: string[];
  fromStatus: Array<{ type: 'NAME'; value: string }>;
  toStatus: Array<{ type: 'NAME'; value: string }>;
  eventKey: 'jira:issue_updated';
  issueEvent: 'issue_generic';
}

interface JiraTrigger {
  component: 'TRIGGER';
  type: 'jira.issue.event.trigger:transitioned';
  value: JiraTriggerValue;
  schemaVersion: 1;
}

interface JiraRule {
  name: string;
  state: 'DISABLED';
  trigger: JiraTrigger;
  components: JiraComponent[];
  ruleScope: { resources: string[] };
  labels: string[];
  tags: string[];
  canOtherRuleTrigger: boolean;
  notifyOnError: 'FIRSTERROR';
}

interface JiraAutomationBundle {
  cloud: true;
  rules: JiraRule[];
}

export interface StatusNames {
  refine: string;
  dev: string;
  review: string;
  iterate: string;
}

export const DEFAULT_STATUS_NAMES: StatusNames = {
  refine: 'Refinement',
  dev: 'In Development',
  review: 'In Review',
  iterate: 'Changes Requested',
};

function buildPhases(statusNames: StatusNames) {
  return [
    { eventType: 'ferry-refine', statusName: statusNames.refine, label: 'Refine' },
    { eventType: 'ferry-dev', statusName: statusNames.dev, label: 'Dev' },
    { eventType: 'ferry-review', statusName: statusNames.review, label: 'Review' },
    { eventType: 'ferry-iterate', statusName: statusNames.iterate, label: 'Iterate' },
  ] as const;
}

export function buildJiraBundle(
  owner: string,
  repo: string,
  workspaceId: string,
  projectId: string,
  statusNames: StatusNames = DEFAULT_STATUS_NAMES,
): JiraAutomationBundle {
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const ari = `ari:cloud:jira:${workspaceId}:project/${projectId}`;

  const rules: JiraRule[] = buildPhases(statusNames).map((phase) => {
    const customBody = JSON.stringify({
      event_type: phase.eventType,
      client_payload: {
        version: 'v1',
        event_id: '{{issue.key}}-{{issue.id}}',
        ticket_key: '{{issue.key}}',
        phase: phase.label.toLowerCase(),
        source: 'jira-column',
        ts: '{{now.jiraDate}}',
        issue_type: '{{issue.issuetype.name}}',
      },
    });

    return {
      name: `Ferry — ${phase.label} (column trigger)`,
      state: 'DISABLED',
      ruleScope: { resources: [ari] },
      trigger: {
        component: 'TRIGGER',
        type: 'jira.issue.event.trigger:transitioned',
        value: {
          eventFilters: [ari],
          fromStatus: [],
          toStatus: [{ type: 'NAME', value: phase.statusName }],
          eventKey: 'jira:issue_updated',
          issueEvent: 'issue_generic',
        },
        schemaVersion: 1,
      },
      components: [
        {
          component: 'ACTION',
          type: 'jira.issue.outgoing.webhook',
          value: {
            url: dispatchUrl,
            method: 'POST',
            contentType: 'custom',
            customBody,
            headers: [
              { name: 'Accept', value: 'application/vnd.github+json', headerSecure: false },
              {
                name: 'Authorization',
                // headerSecure: true so Jira treats this as a secret field
                value: 'Bearer YOUR_GITHUB_PAT_WITH_REPO_SCOPE',
                headerSecure: true,
              },
              { name: 'X-GitHub-Api-Version', value: '2022-11-28', headerSecure: false },
              { name: 'Content-Type', value: 'application/json', headerSecure: false },
            ],
          },
          schemaVersion: 1,
        },
      ],
      labels: [],
      tags: [],
      canOtherRuleTrigger: false,
      notifyOnError: 'FIRSTERROR',
    };
  });

  return { cloud: true, rules };
}

export function buildManualSetupDoc(
  owner: string,
  repo: string,
  statusNames: StatusNames = DEFAULT_STATUS_NAMES,
): string {
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  const rules = buildPhases(statusNames).map((phase) => {
    const body = JSON.stringify(
      {
        event_type: phase.eventType,
        client_payload: {
          version: 'v1',
          event_id: '{{issue.key}}-{{issue.id}}',
          ticket_key: '{{issue.key}}',
          phase: phase.label.toLowerCase(),
          source: 'jira-column',
          ts: '{{now.jiraDate}}',
          issue_type: '{{issue.issuetype.name}}',
        },
      },
      null,
      2,
    );

    return `### Rule: Ferry — ${phase.label} (column trigger)

**Trigger:** When: Issue → Status changed → To status: \`${phase.statusName}\`

**Action:** Send web request
- URL: \`${dispatchUrl}\`
- Method: \`POST\`
- Web request body: Custom data

Headers:
| Name | Value | Secret? |
|------|-------|---------|
| \`Accept\` | \`application/vnd.github+json\` | No |
| \`Authorization\` | \`Bearer YOUR_GITHUB_PAT_WITH_REPO_SCOPE\` | **Yes** |
| \`X-GitHub-Api-Version\` | \`2022-11-28\` | No |
| \`Content-Type\` | \`application/json\` | No |

Custom body:
\`\`\`json
${body}
\`\`\`
`;
  });

  return `# Ferry — Jira Automation Setup

This file was generated by \`ferry-init\`. Follow it to create Jira Automation rules
in the Jira UI. This is the recommended setup path.

> **Why manual?** The JSON import feature (**Automation → ⋮ → Import rules**) is beta
> and breaks across Jira Cloud releases. Creating rules manually in the UI works on
> every Jira tier (Free, Standard, Premium) and is always up-to-date.

## Prerequisites

- A GitHub fine-grained Personal Access Token (PAT) with **Contents: write** permission
  on \`${owner}/${repo}\`, OR a GitHub App installation token. Replace
  \`YOUR_GITHUB_PAT_WITH_REPO_SCOPE\` in every rule below with that token.
- Jira Automation enabled on your project (included in all Jira Cloud tiers).

## Steps for each rule

1. Go to your Jira project → **Project settings** → **Automation**
2. Click **Create rule** (top-right)
3. Add the trigger and action as described below
4. Click **Save** — leave the rule **Disabled** until your column names match exactly
5. Enable each rule once you have verified column names in your board

> **Column names must match exactly.** Update the "To status" in each rule to match the
> column names on your Jira board. The defaults below are suggestions.

---

${rules.join('\n---\n\n')}
---

## Security notes

- Mark the \`Authorization\` header as **secret** in the Jira UI (toggle the lock icon).
  This prevents the token from appearing in Jira audit logs.
- Rotate your PAT if it is ever exposed.
- Never commit a real token to this file — this file is safe to commit as-is since
  it only contains the placeholder \`YOUR_GITHUB_PAT_WITH_REPO_SCOPE\`.

## Verifying a rule works

After enabling a rule, move a Jira issue to the target column and check:
1. The Jira Automation audit log (Project settings → Automation → rule → Audit log)
2. The GitHub Actions tab on \`${owner}/${repo}\` — a workflow run should appear within seconds.
`;
}

/**
 * Router-model bundle: ONE rule firing on ANY status change. The payload
 * carries `to_status`; the router workflow maps it to an agent via
 * `workflow.agents.*.trigger_column` and no-ops on statuses Ferry does not
 * own. Renaming or adding columns never requires touching Jira again.
 */
export function buildRouterJiraBundle(
  owner: string,
  repo: string,
  workspaceId: string,
  projectId: string,
): JiraAutomationBundle {
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const ari = `ari:cloud:jira:${workspaceId}:project/${projectId}`;

  const customBody = JSON.stringify({
    event_type: 'ferry-transition',
    client_payload: {
      version: 'v1',
      event_id: '{{issue.key}}-{{issue.id}}',
      ticket_key: '{{issue.key}}',
      phase: 'transition',
      source: 'jira-column',
      ts: '{{now.jiraDate}}',
      issue_type: '{{issue.issuetype.name}}',
      to_status: '{{issue.status.name}}',
    },
  });

  const rule: JiraRule = {
    name: 'Ferry — transition (any column)',
    state: 'DISABLED',
    ruleScope: { resources: [ari] },
    trigger: {
      component: 'TRIGGER',
      type: 'jira.issue.event.trigger:transitioned',
      value: {
        eventFilters: [ari],
        fromStatus: [],
        // Empty = no To-status filter: every transition fires; the router no-ops
        // on statuses that map to no agent.
        toStatus: [],
        eventKey: 'jira:issue_updated',
        issueEvent: 'issue_generic',
      },
      schemaVersion: 1,
    },
    components: [
      {
        component: 'ACTION',
        type: 'jira.issue.outgoing.webhook',
        value: {
          url: dispatchUrl,
          method: 'POST',
          contentType: 'custom',
          customBody,
          headers: [
            { name: 'Accept', value: 'application/vnd.github+json', headerSecure: false },
            {
              name: 'Authorization',
              // headerSecure: true so Jira treats this as a secret field
              value: 'Bearer YOUR_GITHUB_PAT_WITH_REPO_SCOPE',
              headerSecure: true,
            },
            { name: 'X-GitHub-Api-Version', value: '2022-11-28', headerSecure: false },
            { name: 'Content-Type', value: 'application/json', headerSecure: false },
          ],
        },
        schemaVersion: 1,
      },
    ],
    labels: [],
    tags: [],
    canOtherRuleTrigger: false,
    notifyOnError: 'FIRSTERROR',
  };

  return { cloud: true, rules: [rule] };
}

export function buildRouterManualSetupDoc(owner: string, repo: string): string {
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const body = JSON.stringify(
    {
      event_type: 'ferry-transition',
      client_payload: {
        version: 'v1',
        event_id: '{{issue.key}}-{{issue.id}}',
        ticket_key: '{{issue.key}}',
        phase: 'transition',
        source: 'jira-column',
        ts: '{{now.jiraDate}}',
        issue_type: '{{issue.issuetype.name}}',
        to_status: '{{issue.status.name}}',
      },
    },
    null,
    2,
  );

  return `# Ferry — Jira Automation Setup (router model)

This file was generated by \`ferry-init\`. Ferry's router model needs exactly
**one** Jira Automation rule: it fires on every status change and sends the
target status to GitHub. The Ferry router workflow maps the status to the right
agent via \`ferry.config\` (\`workflow.agents.*.trigger_column\`) and ignores
statuses Ferry does not own — so renaming or adding columns never requires
touching Jira again.

## Prerequisites

- A GitHub fine-grained Personal Access Token (PAT) with **Contents: write** permission
  on \`${owner}/${repo}\`, OR a GitHub App installation token. Replace
  \`YOUR_GITHUB_PAT_WITH_REPO_SCOPE\` below with that token.
- Jira Automation enabled on your project (included in all Jira Cloud tiers).

## The single rule

1. Go to your Jira project → **Project settings** → **Automation**
2. Click **Create rule** (top-right)
3. Add the trigger and action below
4. Click **Save**, then **Enable** the rule

### Rule: Ferry — transition (any column)

**Trigger:** When: Issue → Status changed — leave **From status** and **To status** empty
(no filter: every transition fires; the router ignores unmapped statuses)

**Action:** Send web request
- URL: \`${dispatchUrl}\`
- Method: \`POST\`
- Web request body: Custom data

Headers:
| Name | Value | Secret? |
|------|-------|---------|
| \`Accept\` | \`application/vnd.github+json\` | No |
| \`Authorization\` | \`Bearer YOUR_GITHUB_PAT_WITH_REPO_SCOPE\` | **Yes** |
| \`X-GitHub-Api-Version\` | \`2022-11-28\` | No |
| \`Content-Type\` | \`application/json\` | No |

Custom body:
\`\`\`json
${body}
\`\`\`

## Security notes

- Mark the \`Authorization\` header as **secret** in the Jira UI (toggle the lock icon).
  This prevents the token from appearing in Jira audit logs.
- Rotate your PAT if it is ever exposed.
- Never commit a real token to this file — this file is safe to commit as-is since
  it only contains the placeholder \`YOUR_GITHUB_PAT_WITH_REPO_SCOPE\`.

## Note on the Merger

Moving a ticket into a "merge" column does nothing by design: the Merger is only
triggered by the \`ferry-merge\` event the Reviewer dispatches on approval
(ADR-0005). The single rule above cannot reach it.

## Verifying the rule works

After enabling the rule, move a Jira issue to any Ferry column and check:
1. The Jira Automation audit log (Project settings → Automation → rule → Audit log)
2. The GitHub Actions tab on \`${owner}/${repo}\` — a "Ferry — Router" run should appear within seconds.
`;
}

export function stepRouterJiraBundle(
  repoRoot: string,
  owner: string,
  repo: string,
  workspaceId: string,
  projectId: string,
): StepResult {
  const bundle = buildRouterJiraBundle(owner, repo, workspaceId, projectId);
  const jsonPath = join(repoRoot, 'ferry-jira-automation-rules.beta.json');
  writeFileSync(jsonPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  const mdPath = join(repoRoot, 'ferry-jira-automation-setup.md');
  writeFileSync(mdPath, buildRouterManualSetupDoc(owner, repo), 'utf8');

  printSuccess(`Generated ferry-jira-automation-setup.md (single any-column rule walkthrough)`);
  printSuccess(`Generated ferry-jira-automation-rules.beta.json (advanced reference only)`);
  print('');
  printWarn('JSON import (beta) is unreliable — follow ferry-jira-automation-setup.md instead.');
  printWarn('Replace YOUR_GITHUB_PAT_WITH_REPO_SCOPE before enabling.');
  print('');
  print('  Setup — ONE rule only (follow ferry-jira-automation-setup.md):');
  print('    1. Project Settings → Automation → Create rule');
  print('    2. Trigger: Issue transitioned — leave From/To status EMPTY');
  print('    3. Action: Send web request → POST dispatches URL (see .md file)');
  print('    4. Replace YOUR_GITHUB_PAT_WITH_REPO_SCOPE');
  print('    5. Enable the rule');

  return { ok: true };
}

export function stepJiraBundle(
  repoRoot: string,
  owner: string,
  repo: string,
  workspaceId: string,
  projectId: string,
  statusNames: StatusNames = DEFAULT_STATUS_NAMES,
): StepResult {
  const bundle = buildJiraBundle(owner, repo, workspaceId, projectId, statusNames);
  const jsonPath = join(repoRoot, 'ferry-jira-automation-rules.beta.json');
  writeFileSync(jsonPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  const mdPath = join(repoRoot, 'ferry-jira-automation-setup.md');
  writeFileSync(mdPath, buildManualSetupDoc(owner, repo, statusNames), 'utf8');

  printSuccess(`Generated ferry-jira-automation-setup.md (step-by-step UI walkthrough)`);
  printSuccess(`Generated ferry-jira-automation-rules.beta.json (advanced reference only)`);
  print('');
  printWarn('JSON import (beta) is unreliable — follow ferry-jira-automation-setup.md instead.');
  printWarn('Replace YOUR_GITHUB_PAT_WITH_REPO_SCOPE in each rule before enabling.');
  print('');
  print('  Setup — follow ferry-jira-automation-setup.md for the full UI walkthrough:');
  print('    1. Project Settings → Automation → Create rule');
  print('    2. Trigger: Issue transitioned → To status: <column>');
  print('    3. Action: Send web request → POST dispatches URL (see .md file)');
  print('    4. Replace YOUR_GITHUB_PAT_WITH_REPO_SCOPE in each rule');
  print('    5. Enable each rule');
  print('');
  print('  Advanced: ferry-jira-automation-rules.beta.json can be imported via');
  print('  Automation → ⋮ → Import rules, but this feature is beta and breaks');
  print('  across Jira Cloud releases. Use ferry-jira-automation-setup.md instead.');

  return { ok: true };
}
