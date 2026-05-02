import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowItem, AuditIssueState } from './types.js';

export const FERRY_WORKFLOW_FILES = [
  'ferry-refine.yml',
  'ferry-dev.yml',
  'ferry-review.yml',
  'ferry-iterate.yml',
  'ferry-reconciler.yml',
  'ferry-audit-daily.yml',
];

export const FERRY_SECRETS = [
  'FERRY_APP_ID',
  'FERRY_PRIVATE_KEY',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
  'FERRY_REVIEW_TRANSITION_ID',
  'FERRY_ITER_TRANSITION_ID',
];

export const ANTHROPIC_SECRET = 'FERRY_ANTHROPIC_API_KEY';
export const FERRY_VARIABLE = 'FERRY_AUDIT_ISSUE';
export const AUDIT_LABEL = 'ferry:audit-log:active';

export function detectWorkflows(repoRoot: string): WorkflowItem[] {
  const workflowDir = join(repoRoot, '.github', 'workflows');
  return FERRY_WORKFLOW_FILES.map((filename) => ({
    filename,
    present: existsSync(join(workflowDir, filename)),
  }));
}

export function detectCodeownersBlock(repoRoot: string): boolean {
  const codeownersPath = join(repoRoot, '.github', 'CODEOWNERS');
  if (!existsSync(codeownersPath)) return false;
  const content = readFileSync(codeownersPath, 'utf8');
  return content.includes('ferry-');
}

function listSecrets(repo: string): string[] {
  const result = spawnSync('gh', ['secret', 'list', '--repo', repo, '--json', 'name'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.error) return [];
  try {
    const parsed = JSON.parse(result.stdout) as Array<{ name: string }>;
    return parsed.map((s) => s.name);
  } catch {
    return [];
  }
}

export function detectSecrets(repo: string, includeAnthropic: boolean): string[] {
  const all = listSecrets(repo);
  const targets = includeAnthropic ? [...FERRY_SECRETS, ANTHROPIC_SECRET] : FERRY_SECRETS;
  return targets.filter((s) => all.includes(s));
}

function listVariables(repo: string): Array<{ name: string; value: string }> {
  const result = spawnSync(
    'gh',
    ['variable', 'list', '--repo', repo, '--json', 'name,value'],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  if (result.status !== 0 || result.error) return [];
  try {
    return JSON.parse(result.stdout) as Array<{ name: string; value: string }>;
  } catch {
    return [];
  }
}

export function detectVariables(repo: string): string[] {
  const vars = listVariables(repo);
  return vars.filter((v) => v.name === FERRY_VARIABLE).map((v) => v.name);
}

export function detectAuditIssueNumber(repo: string): number | null {
  const vars = listVariables(repo);
  const found = vars.find((v) => v.name === FERRY_VARIABLE);
  if (!found?.value) return null;
  const n = parseInt(found.value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface IssueResponse {
  labels: Array<{ name: string }>;
}

export function detectAuditIssue(repo: string, issueNumber: number): AuditIssueState {
  const result = spawnSync(
    'gh',
    ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,labels'],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  if (result.status !== 0 || result.error) return { number: issueNumber, hasLabel: false };
  try {
    const data = JSON.parse(result.stdout) as IssueResponse;
    const hasLabel = data.labels.some((l) => l.name === AUDIT_LABEL);
    return { number: issueNumber, hasLabel };
  } catch {
    return { number: issueNumber, hasLabel: false };
  }
}
