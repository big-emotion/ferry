import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/sanitization/delimit-untrusted.js';
import { createTrackerFromEnv } from '../../lib/io/tracker/factory.js';
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


async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const reviewTransitionId = requireEnv('FERRY_REVIEW_TRANSITION_ID');
  const githubRepo = requireEnv('GITHUB_REPO');
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');

  const tracker = createTrackerFromEnv();
  const issue = await tracker.getIssue(ticketKey);
  const description = issue.description;
  const comments = issue.comments.map((c) => `Comment: ${c}`).join('\n');
  const labels = issue.labels.join(', ');

  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.summary}`,
    `TYPE: ${issue.issueType}`,
    `LABELS: ${labels || 'none'}`,
    `DESCRIPTION:\n${description}`,
    comments ? `COMMENTS:\n${comments}` : '',
  ].filter(Boolean).join('\n');

  const subtasks = await tracker.getSubtasks(ticketKey);
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

  // Branch is determined upfront from the ticket key so restarts resume the same branch.
  const branchName = `ferry/${ticketKey}`;

  execSync('git config user.name "ferry-bot"', { cwd: REPO_ROOT });
  execSync('git config user.email "ferry-bot@users.noreply.github.com"', { cwd: REPO_ROOT });

  let resumeContext = '';
  try {
    execSync(`git ls-remote --exit-code --heads origin ${branchName}`, { cwd: REPO_ROOT, stdio: 'pipe' });
    execSync(`git fetch origin ${branchName}`, { cwd: REPO_ROOT });
    execSync(`git checkout ${branchName}`, { cwd: REPO_ROOT });
    const existingLog = execSync(
      'git log origin/main..HEAD --oneline',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim();
    if (existingLog) {
      resumeContext = `\nEXISTING WORK ON BRANCH (already committed — skip these, only do what remains):\n${existingLog}`;
      console.error(`[ferry:dev-action] resuming branch ${branchName} — ${existingLog.split('\n').length} prior commit(s)`);
    }
  } catch {
    execSync(`git checkout -B ${branchName}`, { cwd: REPO_ROOT });
    console.error(`[ferry:dev-action] created branch ${branchName}`);
  }

  const secretScan = async () => {
    const scanResult = await scanWithGitleaks({
      path: REPO_ROOT,
      binaryPath: process.env.GITLEAKS_PATH ?? 'gitleaks',
    });
    if (scanResult.leaksFound) {
      throw new FerryError('state-invariant', { reason: 'secret-scan-hit', findings: scanResult.findings.length });
    }
  };

  const { done, usage, iterations } = await runAgentLoop({
    anthropic,
    model,
    system,
    initialPrompt: initialPrompt + resumeContext,
    repoRoot: REPO_ROOT,
    branchName,
    secretScan,
  });

  console.error(`[ferry:dev-action] done in ${iterations} iterations — actionable=${done.actionable} in=${usage.input_tokens} cache_w=${usage.cache_creation_input_tokens} cache_r=${usage.cache_read_input_tokens} out=${usage.output_tokens}`);

  const idempotencyMarker = `[ferry:dev:${eventId}]`;

  if (!done.actionable) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Cannot implement — ${done.reason_if_not_actionable ?? 'no reason given'}`,
    );
    appendOutput(usage);
    process.exit(0);
  }

  // actionable: commit any remaining changes and push
  const commitMessage = formatDeveloperCommit({
    ticketKey,
    runId: eventId,
    summary: done.summary,
  });

  execSync('git add -A', { cwd: REPO_ROOT });
  const finalStatus = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' });
  if (finalStatus.trim()) {
    await secretScan();
    execSync(`git commit -m ${JSON.stringify(done.commit_message ?? commitMessage)}`, { cwd: REPO_ROOT });
  }
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

  await tracker.postTransition(ticketKey, reviewTransitionId);
  await tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Implementation complete — PR: ${prUrl}. Moved to Review.`,
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
