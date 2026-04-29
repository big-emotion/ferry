import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/sanitization/delimit-untrusted.js';
import { createJiraRestClientFromEnv } from '../../lib/io/jira-rest.js';
import { adfToText, textToAdf } from '../../lib/io/jira-adf.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { scanWithGitleaks } from '../../lib/secret-scan/scan.js';
import { FerryError } from '../../lib/error.js';
import { checkIterationCap } from './cap.js';
import { decideIteratorTransition } from './transition.js';
import { formatCommitMessage } from './prompt.js';
import { runAgentLoop } from '../developer/loop.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();
const SYSTEM_PROMPT_PATH = process.env.FERRY_PROMPT_PATH ?? path.join(REPO_ROOT, 'prompts', 'iterate.md');

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const reviewTransitionId = requireEnv('FERRY_REVIEW_TRANSITION_ID');
  const githubToken = requireEnv('GITHUB_TOKEN');
  const githubRepo = requireEnv('GITHUB_REPO');

  const model = process.env.FERRY_ITER_MODEL ?? 'claude-sonnet-4-6';
  const [owner, repo] = githubRepo.split('/');
  if (!owner || !repo) {
    throw new FerryError('state-invariant', { reason: 'invalid-github-repo', githubRepo });
  }

  const octokit = new Octokit({ auth: githubToken });
  const jira = createJiraRestClientFromEnv();

  const idempotencyMarker = `[ferry:iterator:${eventId}]`;

  const issue = await jira.getIssue(ticketKey);
  const existingComments = issue.fields.comment.comments.map((c) => adfToText(c.body));
  const { skipped } = checkIdempotencyMarker(idempotencyMarker, existingComments);
  if (skipped) {
    console.error(`[ferry:iterate-action] already processed ${eventId}, skipping`);
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const priorIterations = existingComments.filter(
    (c) => c.includes('[ferry:iterator:') && c.includes('complete. Pushed fixes to PR#'),
  ).length;
  checkIterationCap({ iteration: priorIterations, hasFindings: true });

  const branchName = `ferry/${ticketKey}`;
  const { data: pulls } = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branchName}`,
    per_page: 1,
  });

  if (pulls.length === 0) {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} No open PR found for branch ${branchName}. Cannot iterate.`),
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const prNumber = pulls[0].number;

  const { data: recentComments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    sort: 'created',
    direction: 'desc',
    per_page: 30,
  });
  const reviewComments = recentComments.filter((c) => c.body?.includes('[ferry:reviewer:'));
  if (reviewComments.length === 0) {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} No review comment found on PR#${prNumber}. Cannot iterate.`),
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }
  const reviewComment = reviewComments[0].body ?? '';
  if (/\*\*Verdict\*\*:\s*Approved\b/.test(reviewComment)) {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} PR#${prNumber} review shows Approved — no iteration needed.`),
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const system = readFileSync(SYSTEM_PROMPT_PATH, 'utf8');

  execSync('git config user.name "ferry-bot"', { cwd: REPO_ROOT });
  execSync('git config user.email "ferry-bot@users.noreply.github.com"', { cwd: REPO_ROOT });

  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', branchName], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync('git', ['fetch', 'origin', branchName], { cwd: REPO_ROOT });
    execFileSync('git', ['checkout', branchName], { cwd: REPO_ROOT });
  } catch {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} Branch ${branchName} not found on origin. Cannot iterate.`),
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const existingLog = execSync(
    'git log origin/main..HEAD --oneline',
    { cwd: REPO_ROOT, encoding: 'utf8' },
  ).trim();

  const description = adfToText(issue.fields.description);
  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.fields.summary}`,
    `TYPE: ${issue.fields.issuetype.name}`,
    `DESCRIPTION:\n${description}`,
  ].filter(Boolean).join('\n');

  const initialPrompt = [
    '## Jira Ticket',
    delimitUntrusted(ticketBlock),
    '',
    '## Review Findings (fix only what is listed here)',
    delimitUntrusted(reviewComment),
    '',
    existingLog ? `## Existing commits on branch\n${existingLog}` : '',
    '',
    'When you have fixed all findings, call the `done` tool.',
  ].filter(Boolean).join('\n');

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const secretScan = async () => {
    const scanResult = await scanWithGitleaks({
      path: REPO_ROOT,
      binaryPath: process.env.GITLEAKS_PATH ?? 'gitleaks',
    });
    if (scanResult.leaksFound) {
      throw new FerryError('state-invariant', { reason: 'secret-scan-hit', findings: scanResult.findings.length });
    }
  };

  process.env.FERRY_DEV_MAX_ITERATIONS ??= '200';
  process.env.FERRY_DEV_MAX_INPUT_TOKENS ??= '500000';

  const { done, usage, iterations } = await runAgentLoop({
    anthropic,
    model,
    system,
    initialPrompt,
    repoRoot: REPO_ROOT,
    branchName,
    secretScan,
  });

  console.error(`[ferry:iterate-action] done in ${iterations} iterations — actionable=${done.actionable} in=${usage.input_tokens} cache_w=${usage.cache_creation_input_tokens} cache_r=${usage.cache_read_input_tokens} out=${usage.output_tokens}`);

  if (!done.actionable) {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} Cannot fix — ${done.reason_if_not_actionable ?? 'no reason given'}`),
    );
    appendOutput({ ...usage, model });
    process.exit(0);
  }

  const commitMessage = formatCommitMessage({
    ticket_key: ticketKey,
    summary: done.summary,
    rule_ids: [],
    run_id: eventId,
  });

  execSync('git add -A', { cwd: REPO_ROOT });
  const finalStatus = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' });
  if (finalStatus.trim()) {
    await secretScan();
    execFileSync('git', ['commit', '-m', commitMessage], { cwd: REPO_ROOT });
  }
  execFileSync('git', ['push', 'origin', branchName, '--force-with-lease'], { cwd: REPO_ROOT });

  await jira.postTransition(ticketKey, reviewTransitionId);

  const { next_iteration } = decideIteratorTransition({ current_iteration: priorIterations });
  await jira.postComment(
    ticketKey,
    textToAdf(
      `${idempotencyMarker} Iteration ${next_iteration} complete. Pushed fixes to PR#${prNumber}. Moved back to Review.`,
    ),
  );

  appendOutput({ ...usage, model });
  process.exit(0);
}

function appendOutput(usage: { input_tokens: number; output_tokens: number; model?: string }): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    let out = `input_tokens=${usage.input_tokens}\noutput_tokens=${usage.output_tokens}\n`;
    if (usage.model) out += `model=${usage.model}\n`;
    appendFileSync(githubOutput, out);
  }
}

main().catch((err) => {
  console.error('[ferry:iterate-action] fatal:', (err as Error).message);
  process.exit(1);
});
