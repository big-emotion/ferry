import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { printSuccess, printWarn, print } from '../prompt.js';
import type { StepResult } from '../types.js';

// Placeholder for site-specific Atlassian Resource Identifier.
// Users must replace with their actual workspace and project IDs.
const ARI_PLACEHOLDER = 'ari:cloud:jira:YOUR_WORKSPACE_ID:project/YOUR_PROJECT_ID';

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

const PHASES = [
  { eventType: 'ferry-refine', statusName: 'Refinement', label: 'Refine' },
  { eventType: 'ferry-dev', statusName: 'In Development', label: 'Dev' },
  { eventType: 'ferry-review', statusName: 'In Review', label: 'Review' },
  { eventType: 'ferry-iterate', statusName: 'Iteration', label: 'Iterate' },
] as const;

export function buildJiraBundle(owner: string, repo: string): JiraAutomationBundle {
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  const rules: JiraRule[] = PHASES.map((phase) => {
    const customBody = JSON.stringify({
      event_type: phase.eventType,
      client_payload: {
        phase: phase.label.toLowerCase(),
        ticket_key: '{{issue.key}}',
        issue_type: '{{issue.issuetype.name}}',
        actor: '{{initiator.displayName}}',
        source: 'jira-column',
        ts: "{{now.format(\"yyyy-MM-dd'T'HH:mm:ssXXX\")}}",
      },
    });

    return {
      name: `Ferry — ${phase.label} (column trigger)`,
      state: 'DISABLED',
      trigger: {
        component: 'TRIGGER',
        type: 'jira.issue.event.trigger:transitioned',
        value: {
          eventFilters: [ARI_PLACEHOLDER],
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
      ruleScope: { resources: [ARI_PLACEHOLDER] },
      labels: [],
      tags: [],
      canOtherRuleTrigger: false,
      notifyOnError: 'FIRSTERROR',
    };
  });

  return { cloud: true, rules };
}

function buildManualSetupDoc(owner: string, repo: string): string {
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  const rules = PHASES.map((phase) => {
    const body = JSON.stringify(
      {
        event_type: phase.eventType,
        client_payload: {
          phase: phase.label.toLowerCase(),
          ticket_key: '{{issue.key}}',
          issue_type: '{{issue.issuetype.name}}',
          actor: '{{initiator.displayName}}',
          source: 'jira-column',
          ts: "{{now.format(\"yyyy-MM-dd'T'HH:mm:ssXXX\")}}",
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

  return `# Ferry — Jira Automation Manual Setup

This file was generated by \`ferry-init\` as a manual-setup fallback.
Use it to create Jira Automation rules by hand if the JSON import does not work.

> **Why manual?** The JSON import format changes between Jira Cloud versions.
> Creating rules manually in the UI always works on every Jira tier (Free, Standard, Premium).

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

export function stepJiraBundle(repoRoot: string, owner: string, repo: string): StepResult {
  const bundle = buildJiraBundle(owner, repo);
  const jsonPath = join(repoRoot, 'ferry-jira-automation-rules.beta.json');
  writeFileSync(jsonPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  const mdPath = join(repoRoot, 'ferry-jira-automation-setup.md');
  writeFileSync(mdPath, buildManualSetupDoc(owner, repo), 'utf8');

  printSuccess(`Generated ferry-jira-automation-rules.beta.json`);
  printSuccess(`Generated ferry-jira-automation-setup.md (manual fallback)`);
  print('');
  printWarn('The JSON import is BETA — Jira Cloud\'s import format changes frequently.');
  printWarn(
    'Before importing the JSON, replace the two YOUR_* placeholders with your Jira',
  );
  printWarn('workspace ID and project ID (see ferry-jira-automation-setup.md for details).');
  print('');
  print('  Option A — JSON import (beta):');
  print('    1. Jira → Project settings → Automation → Import rules (top-right menu)');
  print('    2. Upload ferry-jira-automation-rules.beta.json');
  print('    3. Replace YOUR_GITHUB_PAT_WITH_REPO_SCOPE in each rule');
  print('    4. Enable each rule');
  print('');
  print('  Option B — Manual setup (recommended):');
  print('    Follow ferry-jira-automation-setup.md — step-by-step UI walkthrough');

  return { ok: true };
}
