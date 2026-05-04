import { execFileSync } from 'node:child_process';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA, executeTool } from '../developer/tools.js';
import { createAnthropicAgentLoop } from '../../lib/llm/agent-loop/anthropic.js';
import { resolveAnthropicAuth } from '../../lib/llm/anthropic-auth.js';
import { FerryError } from '../../lib/errors/index.js';
import { checkIterationCap } from './cap.js';
import { decideIteratorTransition } from './transition.js';
import { formatCommitMessage } from './prompt.js';
import { resolveCapabilities, filterMcpServers } from '../../lib/labels/capabilities.js';
import {
  requireEnv,
  loadMcpServers,
  buildSystem,
  buildTicketBlock,
  appendOutput,
  configureFerryGitUser,
  makeCommitProgress,
  makeSecretScan,
  logCapabilities,
  fetchAndMergeBase,
  checkoutExistingBranch,
  createGitHubContext,
  resolveGitConfig,
  loadFerryConfigFromBaseBranch,
  byEventId,
  byReviewCommentId,
  runAgent,
} from '../../lib/agent-runtime/index.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';
import type { Logger } from '../../lib/agent-runtime/index.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const anthropicAuth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
  const { owner, repo, runner, tracker, ferryCfg: initialCfg } = createGitHubContext(REPO_ROOT);

  // Resolve baseBranch before using any config values, then reload config from that branch.
  // On repository_dispatch, actions/checkout resolves to the default branch, not base_branch,
  // so the workspace may contain a stale ferry.config.json.
  const { baseBranch, workingBranchPrefix } = await resolveGitConfig(
    initialCfg,
    runner,
    owner,
    repo,
  );
  const ferryCfg = loadFerryConfigFromBaseBranch(baseBranch, REPO_ROOT, initialCfg);

  const { provider: iterProvider, model } = ferryCfg.models.iterate;
  if (iterProvider !== 'anthropic') {
    throw new FerryError('state-invariant', {
      reason: 'unsupported-provider',
      provider: iterProvider,
      phase: 'iterator',
      detail:
        "The iterator phase requires provider 'anthropic'. OpenAI and Google support for agentic phases is planned for a future release.",
    });
  }
  const iteratorWorkflow = ferryCfg.workflow.agents.iterator;
  const shouldAutoTransition = iteratorWorkflow.auto_transition !== null;
  const reviewTransitionId = shouldAutoTransition ? requireEnv('FERRY_REVIEW_TRANSITION_ID') : '';

  const issue = await tracker.getIssue(ticketKey);
  const existingComments = issue.comments;

  // Labels are re-read from Jira on each iterate-action invocation (each review→iterate cycle),
  // so a label added between iterations takes effect on the next cycle.
  const mcpPool = loadMcpServers();
  const capabilities = resolveCapabilities(issue.labels, ferryCfg.labels);
  const hasLabelsConfig = ferryCfg.labels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);

  logCapabilities(logger, capabilities);

  const priorIterations = existingComments.filter(
    (c) => c.includes('[ferry:iterator:') && c.includes('complete. Pushed fixes to PR#'),
  ).length;
  checkIterationCap(
    { iteration: priorIterations, hasFindings: true },
    ferryCfg.limits.max_iterations,
  );
  const branchName = `${workingBranchPrefix}${ticketKey}`;
  const prs = await runner.listPRsForBranch(owner, repo, branchName);

  if (prs.length === 0) {
    // Review ID not yet known — use event_id to prevent duplicate error comments
    const eventMarker = byEventId('iterator', eventId);
    const { skipped } = checkIdempotencyMarker(eventMarker, existingComments);
    if (!skipped) {
      await tracker.postComment(
        ticketKey,
        `${eventMarker} No open PR found for branch ${branchName}. Cannot iterate.`,
      );
    }
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider: iterProvider });
    return;
  }

  const prNumber = prs[0].number;

  const recentComments = await runner.listPRComments({ owner, repo, prNumber }, 30);
  const reviewComments = recentComments.filter((c) => c.body.includes('[ferry:reviewer:'));
  if (reviewComments.length === 0) {
    const eventMarker = byEventId('iterator', eventId);
    const { skipped } = checkIdempotencyMarker(eventMarker, existingComments);
    if (!skipped) {
      await tracker.postComment(
        ticketKey,
        `${eventMarker} No review comment found on PR#${prNumber}. Cannot iterate.`,
      );
    }
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider: iterProvider });
    return;
  }

  const latestReview = reviewComments[0];

  // Primary idempotency: anchored on the GitHub review comment ID so re-triggering
  // works automatically whenever the reviewer posts new findings.
  const idempotencyMarker = byReviewCommentId('iterator', latestReview.id);
  const { skipped } = checkIdempotencyMarker(idempotencyMarker, existingComments);
  if (skipped) {
    logger.info('review comment already handled, skipping', { review_comment_id: latestReview.id });
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider: iterProvider });
    return;
  }

  const reviewComment = latestReview.body;
  if (/\*\*Verdict\*\*:\s*Approved\b/.test(reviewComment)) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} PR#${prNumber} review shows Approved — no iteration needed.`,
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider: iterProvider });
    return;
  }

  const system = buildSystem('iterate', REPO_ROOT);

  configureFerryGitUser(REPO_ROOT);

  if (checkoutExistingBranch(branchName, REPO_ROOT) === 'not-found') {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Branch ${branchName} not found on origin. Cannot iterate.`,
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider: iterProvider });
    return;
  }

  const mergeConflicts = fetchAndMergeBase(baseBranch, REPO_ROOT);

  const existingLog = execFileSync('git', ['log', `origin/${baseBranch}..HEAD`, '--oneline'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();

  const ticketBlock = buildTicketBlock(ticketKey, issue);

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

  const secretScan = makeSecretScan(REPO_ROOT);

  const loop = createAnthropicAgentLoop({
    ...anthropicAuth,
    model,
    maxIterations: ferryCfg.limits.max_agent_iterations,
    maxInputTokens: ferryCfg.limits.max_tokens_per_run,
    maxTokens: ferryCfg.limits.max_tokens_per_message,
    executeTool,
    commitProgress: makeCommitProgress(logger),
    logger,
  });

  const { done, usage, iterations } = await loop.run({
    system,
    initialPrompt,
    tools: [...TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA],
    repoRoot: REPO_ROOT,
    branchName,
    secretScan,
    mcpServers,
  });

  logger.info('done', {
    iterations,
    actionable: done.actionable,
    in: usage.input_tokens,
    cache_w: usage.cache_creation_input_tokens,
    cache_r: usage.cache_read_input_tokens,
    out: usage.output_tokens,
  });

  if (!done.actionable) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Cannot fix — ${done.reason_if_not_actionable ?? 'no reason given'}`,
    );
    appendOutput({ ...usage, model, provider: iterProvider });
    process.exit(0);
  }

  const commitMessage = formatCommitMessage({
    ticket_key: ticketKey,
    summary: done.summary,
    rule_ids: [],
    run_id: eventId,
  });

  execFileSync('git', ['add', '-A'], { cwd: REPO_ROOT });
  const finalStatus = execFileSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  if (finalStatus) {
    await secretScan();
    execFileSync('git', ['commit', '-m', commitMessage], { cwd: REPO_ROOT });
  }
  execFileSync('git', ['push', 'origin', branchName, '--force-with-lease'], { cwd: REPO_ROOT });

  if (shouldAutoTransition) {
    await tracker.postTransition(ticketKey, reviewTransitionId);
  }

  const { next_iteration } = decideIteratorTransition({ current_iteration: priorIterations });
  const transitionNote = shouldAutoTransition ? ' Moved back to Review.' : '';
  await tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Iteration ${next_iteration} complete. Pushed fixes to PR#${prNumber}.${transitionNote}`,
  );

  appendOutput({ ...usage, model, provider: iterProvider });
  process.exit(0);
}

void runAgent('iterator', main);
