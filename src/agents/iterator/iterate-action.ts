import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import * as path from 'node:path';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
import { createTrackerFromEnv } from '../../lib/io/tracker/factory.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { scanWithGitleaks } from '../../lib/safety/scan.js';
import { FerryError } from '../../lib/errors/index.js';
import { GitHubActionsRunner } from '../../lib/dispatch/runner/github-actions/index.js';
import { TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA, executeTool } from '../developer/tools.js';
import { createAnthropicAgentLoop } from '../../lib/llm/agent-loop/anthropic.js';
import { checkIterationCap } from './cap.js';
import { decideIteratorTransition } from './transition.js';
import { formatCommitMessage } from './prompt.js';
import { loadFerryConfig } from '../../lib/config.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();
const SYSTEM_PROMPT_PATH =
  process.env.FERRY_PROMPT_PATH ?? path.join(REPO_ROOT, 'prompts', 'iterate.md');

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

  const ferryCfg = loadFerryConfig(REPO_ROOT);
  const model = ferryCfg.models.iterate.model;
  const [owner, repo] = githubRepo.split('/');
  if (!owner || !repo) {
    throw new FerryError('state-invariant', { reason: 'invalid-github-repo', githubRepo });
  }

  const runner = new GitHubActionsRunner(githubToken, owner, repo);
  const tracker = createTrackerFromEnv();

  const issue = await tracker.getIssue(ticketKey);
  const existingComments = issue.comments;

  const priorIterations = existingComments.filter(
    (c) => c.includes('[ferry:iterator:') && c.includes('complete. Pushed fixes to PR#'),
  ).length;
  checkIterationCap({ iteration: priorIterations, hasFindings: true }, ferryCfg.limits.max_iterations);

  const branchName = `ferry/${ticketKey}`;
  const prs = await runner.listPRsForBranch(owner, repo, branchName);

  if (prs.length === 0) {
    // Review ID not yet known — use event_id to prevent duplicate error comments
    const eventMarker = `[ferry:iterator:${eventId}]`;
    const { skipped } = checkIdempotencyMarker(eventMarker, existingComments);
    if (!skipped) {
      await tracker.postComment(
        ticketKey,
        `${eventMarker} No open PR found for branch ${branchName}. Cannot iterate.`,
      );
    }
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const prNumber = prs[0].number;

  const recentComments = await runner.listPRComments({ owner, repo, prNumber }, 30);
  const reviewComments = recentComments.filter((c) => c.body.includes('[ferry:reviewer:'));
  if (reviewComments.length === 0) {
    const eventMarker = `[ferry:iterator:${eventId}]`;
    const { skipped } = checkIdempotencyMarker(eventMarker, existingComments);
    if (!skipped) {
      await tracker.postComment(
        ticketKey,
        `${eventMarker} No review comment found on PR#${prNumber}. Cannot iterate.`,
      );
    }
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const latestReview = reviewComments[0];

  // Primary idempotency: anchored on the GitHub review comment ID so re-triggering
  // works automatically whenever the reviewer posts new findings.
  const idempotencyMarker = `[ferry:iterator:${latestReview.id}]`;
  const { skipped } = checkIdempotencyMarker(idempotencyMarker, existingComments);
  if (skipped) {
    console.error(
      `[ferry:iterate-action] review comment ${latestReview.id} already handled, skipping`,
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const reviewComment = latestReview.body;
  if (/\*\*Verdict\*\*:\s*Approved\b/.test(reviewComment)) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} PR#${prNumber} review shows Approved — no iteration needed.`,
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const system = readFileSync(SYSTEM_PROMPT_PATH, 'utf8');

  execSync('git config user.name "ferry-bot"', { cwd: REPO_ROOT });
  execSync('git config user.email "ferry-bot@users.noreply.github.com"', { cwd: REPO_ROOT });

  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', branchName], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    execFileSync('git', ['fetch', 'origin', branchName], { cwd: REPO_ROOT });
    execFileSync('git', ['checkout', branchName], { cwd: REPO_ROOT });
  } catch {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Branch ${branchName} not found on origin. Cannot iterate.`,
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  execFileSync('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT });
  let mergeConflicts: string[] = [];
  try {
    execFileSync('git', ['merge', 'origin/main', '--no-edit'], { cwd: REPO_ROOT });
  } catch {
    mergeConflicts = execSync('git diff --name-only --diff-filter=U', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  }

  const existingLog = execSync('git log origin/main..HEAD --oneline', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();

  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.summary}`,
    `TYPE: ${issue.issueType}`,
    `DESCRIPTION:\n${issue.description}`,
  ]
    .filter(Boolean)
    .join('\n');

  const initialPrompt = [
    '## Jira Ticket',
    delimitUntrusted(ticketBlock),
    '',
    '## Review Findings (fix only what is listed here)',
    delimitUntrusted(reviewComment),
    '',
    mergeConflicts.length > 0
      ? `## Merge Conflicts (resolve these first, before fixing review findings)\n${mergeConflicts.map((f) => `- ${f}`).join('\n')}`
      : '',
    existingLog ? `## Existing commits on branch\n${existingLog}` : '',
    '',
    'When you have fixed all findings, call the `done` tool.',
  ]
    .filter(Boolean)
    .join('\n');

  const secretScan = async () => {
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
  };

  const loop = createAnthropicAgentLoop({
    apiKey: anthropicApiKey,
    model,
    maxIterations: ferryCfg.limits.max_agent_iterations,
    maxInputTokens: ferryCfg.limits.max_tokens_per_run,
    maxTokens: ferryCfg.limits.max_tokens_per_message,
    executeTool,
    commitProgress: async (repoRoot, branchName, message, scan) => {
      execSync('git add -A', { cwd: repoRoot });
      const status = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
      if (!status.trim()) return 'nothing to commit';
      await scan();
      execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: repoRoot });
      execSync(`git push origin ${branchName} --force-with-lease`, { cwd: repoRoot });
      console.error(`[ferry:iterate-action] checkpoint: ${message.slice(0, 80)}`);
      return 'committed and pushed';
    },
  });

  const { done, usage, iterations } = await loop.run({
    system,
    initialPrompt,
    tools: [...TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA],
    repoRoot: REPO_ROOT,
    branchName,
    secretScan,
  });

  console.error(
    `[ferry:iterate-action] done in ${iterations} iterations — actionable=${done.actionable} in=${usage.input_tokens} cache_w=${usage.cache_creation_input_tokens} cache_r=${usage.cache_read_input_tokens} out=${usage.output_tokens}`,
  );

  if (!done.actionable) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Cannot fix — ${done.reason_if_not_actionable ?? 'no reason given'}`,
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

  await tracker.postTransition(ticketKey, reviewTransitionId);

  const { next_iteration } = decideIteratorTransition({ current_iteration: priorIterations });
  await tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Iteration ${next_iteration} complete. Pushed fixes to PR#${prNumber}. Moved back to Review.`,
  );

  appendOutput({ ...usage, model });
  process.exit(0);
}

function appendOutput(usage: {
  input_tokens: number;
  output_tokens: number;
  model?: string;
}): void {
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
