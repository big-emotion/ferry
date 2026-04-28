import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/sanitization/delimit-untrusted.js';
import { createJiraRestClientFromEnv } from '../../lib/io/jira-rest.js';
import { adfToText } from '../../lib/io/jira-adf.js';
import { scanWithGitleaks } from '../../lib/secret-scan/scan.js';
import { FerryError } from '../../lib/error.js';
import { formatDeveloperCommit } from './commit.js';
import { formatPullRequestTitle, formatPullRequestBody } from './pr.js';
import { runAgentLoop } from './loop.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();
const SYSTEM_PROMPT_PATH = process.env.FERRY_PROMPT_PATH ?? path.join(REPO_ROOT, 'prompts', 'dev.md');

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

function detectTestRunner(packageJsonPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
    if (deps.vitest) return 'vitest';
    if (deps.jest) return 'jest';
    if (deps.mocha) return 'mocha';
    if (deps.ava) return 'ava';
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    if (Object.values(scripts).some((s) => s.includes('node:test'))) return 'node:test';
    return 'none';
  } catch {
    return 'none';
  }
}

async function fetchSubtaskSummaries(ticketKey: string): Promise<string[]> {
  const baseUrl = requireEnv('FERRY_JIRA_BASE_URL');
  const email = requireEnv('FERRY_JIRA_EMAIL');
  const apiToken = requireEnv('FERRY_JIRA_API_TOKEN');
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;

  const jql = encodeURIComponent(`parent=${ticketKey} ORDER BY created ASC`);
  const resp = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/rest/api/3/search?jql=${jql}&fields=summary&maxResults=50`,
    { headers: { Authorization: authHeader, Accept: 'application/json' } },
  );
  if (!resp.ok) return [];
  const data = (await resp.json()) as { issues?: Array<{ key: string; fields: { summary: string } }> };
  return (data.issues ?? []).map((i) => `- [${i.key}] ${i.fields.summary}`);
}

function repoTree(repoRoot: string): string {
  try {
    return execFileSync('find', [
      repoRoot,
      '-maxdepth', '2',
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.git/*',
    ], { encoding: 'utf8' }).split('\n').filter(Boolean).join('\n');
  } catch {
    return '(unavailable)';
  }
}

function sanitizeBranchName(raw: string, ticketKey: string): string {
  if (!raw) return `ferry/${ticketKey}`;
  const sanitized = raw.replace(/[^a-zA-Z0-9/_.-]/g, '-').slice(0, 100);
  return sanitized || `ferry/${ticketKey}`;
}

async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const reviewTransitionId = requireEnv('FERRY_REVIEW_TRANSITION_ID');
  const githubRepo = requireEnv('GITHUB_REPO');
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');

  const jira = createJiraRestClientFromEnv();
  const issue = await jira.getIssue(ticketKey);
  const description = adfToText(issue.fields.description);
  const comments = issue.fields.comment.comments
    .map((c) => `Comment: ${adfToText(c.body)}`)
    .join('\n');
  const labels = issue.fields.labels.join(', ');

  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.fields.summary}`,
    `TYPE: ${issue.fields.issuetype.name}`,
    `LABELS: ${labels || 'none'}`,
    `DESCRIPTION:\n${description}`,
    comments ? `COMMENTS:\n${comments}` : '',
  ].filter(Boolean).join('\n');

  const subtasks = await fetchSubtaskSummaries(ticketKey);
  const testRunner = detectTestRunner(path.join(REPO_ROOT, 'package.json'));
  const tree = repoTree(REPO_ROOT);

  const initialPrompt = [
    delimitUntrusted(ticketBlock),
    '',
    subtasks.length > 0
      ? `SUBTASKS:\n${subtasks.join('\n')}`
      : 'SUBTASKS: (none)',
    '',
    `TEST_RUNNER: ${testRunner}`,
    '',
    `REPO TREE (depth 2):\n${tree}`,
    '',
    'When you have finished implementing, call the `done` tool.',
  ].join('\n');

  const system = readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const model = process.env.FERRY_DEV_MODEL ?? 'claude-opus-4-5';

  const { done, usage, iterations } = await runAgentLoop({
    anthropic,
    model,
    system,
    initialPrompt,
    repoRoot: REPO_ROOT,
  });

  console.error(`[ferry:dev-action] done in ${iterations} iterations — actionable=${done.actionable} in=${usage.input_tokens} cache_w=${usage.cache_creation_input_tokens} cache_r=${usage.cache_read_input_tokens} out=${usage.output_tokens}`);

  const idempotencyMarker = `[ferry:dev:${eventId}]`;
  const jiraEmail = requireEnv('FERRY_JIRA_EMAIL');
  const jiraApiToken = requireEnv('FERRY_JIRA_API_TOKEN');
  const authHeader = `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64')}`;

  if (!done.actionable) {
    const body = `${idempotencyMarker} Cannot implement — ${done.reason_if_not_actionable ?? 'no reason given'}`;
    await fetch(
      `${jiraBaseUrl.replace(/\/+$/, '')}/rest/api/3/issue/${ticketKey}/comment`,
      {
        method: 'POST',
        headers: { Authorization: authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
          },
        }),
      },
    );
    appendOutput(usage);
    process.exit(0);
  }

  // actionable: commit and push
  const branchName = sanitizeBranchName(done.branch_name ?? '', ticketKey);
  const commitMessage = formatDeveloperCommit({
    ticketKey,
    runId: eventId,
    summary: done.summary,
  });

  execSync('git config user.name "ferry-bot"', { cwd: REPO_ROOT });
  execSync('git config user.email "ferry-bot@users.noreply.github.com"', { cwd: REPO_ROOT });
  execSync(`git checkout -B ${branchName}`, { cwd: REPO_ROOT });
  execSync('git add -A', { cwd: REPO_ROOT });

  // Secret scan on staged content
  const scanResult = await scanWithGitleaks({
    path: REPO_ROOT,
    binaryPath: process.env.GITLEAKS_PATH ?? 'gitleaks',
  });
  if (scanResult.leaksFound) {
    throw new FerryError('state-invariant', {
      reason: 'secret-scan-hit',
      findings: scanResult.findings.length,
    });
  }

  execSync(`git commit -m ${JSON.stringify(commitMessage)}`, { cwd: REPO_ROOT });
  execSync(`git push origin ${branchName} --force-with-lease`, { cwd: REPO_ROOT });

  const prTitle = formatPullRequestTitle({ ticketKey, summary: done.summary });
  const prBody = formatPullRequestBody({
    ticketKey,
    jiraBaseUrl,
    runId: eventId,
    tldr: done.summary,
  });

  let prUrl: string;
  try {
    const result = execFileSync(
      'gh',
      ['pr', 'create', '--title', prTitle, '--body', prBody, '--base', 'main', '--head', branchName],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    prUrl = result.trim();
  } catch {
    prUrl = execFileSync(
      'gh',
      ['pr', 'view', branchName, '--json', 'url', '-q', '.url'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim();
  }

  // Jira transition
  await fetch(
    `${jiraBaseUrl.replace(/\/+$/, '')}/rest/api/3/issue/${ticketKey}/transitions`,
    {
      method: 'POST',
      headers: { Authorization: authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: reviewTransitionId } }),
    },
  );

  // Jira comment
  const doneComment = `${idempotencyMarker} Implementation complete — PR: ${prUrl}. Moved to Review.`;
  await fetch(
    `${jiraBaseUrl.replace(/\/+$/, '')}/rest/api/3/issue/${ticketKey}/comment`,
    {
      method: 'POST',
      headers: { Authorization: authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: doneComment }] }],
        },
      }),
    },
  );

  appendOutput(usage);
  process.exit(0);
}

function appendOutput(usage: { input_tokens: number; output_tokens: number }): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `input_tokens=${usage.input_tokens}\noutput_tokens=${usage.output_tokens}\n`);
  }
}

main().catch((err) => {
  console.error('[ferry:dev-action] fatal:', (err as Error).message);
  process.exit(1);
});
