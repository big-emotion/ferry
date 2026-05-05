import Anthropic from '@anthropic-ai/sdk';
import { resolveAnthropicAuth } from '../../lib/llm/anthropic-auth.js';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { gateCi } from './ci-gate.js';
import { detectMergeConflicts, buildFileList, runReviewLoop } from './review-loop.js';
import { resolveCapabilities } from '../../lib/labels/capabilities.js';
import { FerryError } from '../../lib/errors/index.js';
import {
  requireEnv,
  appendOutput,
  writeStepSummary,
  buildSystem,
  loadOptionalPrompt,
  buildTicketBlock,
  createGitHubContext,
  resolveGitConfig,
  loadFerryConfigFromBaseBranch,
  logCapabilities,
  byEventId,
  byPrHeadSha,
  runAgent,
} from '../../lib/agent-runtime/index.js';
import { countPriorIterations } from './changes-guard.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';
import type { Logger } from '../../lib/agent-runtime/index.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const { owner, repo, runner, tracker, ferryCfg: initialCfg } = createGitHubContext(REPO_ROOT);
  // Reload config from base_branch — the workspace may contain the default branch's config.
  const { baseBranch } = await resolveGitConfig(initialCfg, runner, owner, repo);
  const ferryCfg = loadFerryConfigFromBaseBranch(baseBranch, REPO_ROOT, initialCfg);
  const { provider, model } = ferryCfg.models.review;
  if (provider !== 'anthropic') {
    throw new FerryError('state-invariant', {
      reason: 'unsupported-provider',
      provider,
      phase: 'reviewer',
      detail:
        "The reviewer phase requires provider 'anthropic'. OpenAI and Google support for agentic phases is planned for a future release.",
    });
  }
  const reviewerWorkflow = ferryCfg.workflow.agents.reviewer;
  const shouldTransitionChanges = reviewerWorkflow.auto_transition_changes !== null;
  const shouldTransitionApprove = reviewerWorkflow.auto_transition_approve !== null;
  const iterTransitionId = shouldTransitionChanges ? requireEnv('FERRY_ITER_TRANSITION_ID') : '';
  const approveTransitionId = shouldTransitionApprove
    ? requireEnv('FERRY_APPROVE_TRANSITION_ID')
    : '';

  const issue = await tracker.getIssue(ticketKey);
  const existingComments = issue.comments;

  const capabilities = resolveCapabilities(issue.labels, ferryCfg.labels, logger);
  logCapabilities(logger, capabilities);

  // Find PR for this ticket's branch
  const branchName = `ferry/${ticketKey}`;
  const prs = await runner.listPRsForBranch(owner, repo, branchName);

  if (prs.length === 0) {
    const errorMarker = byEventId('reviewer', eventId);
    const { skipped } = checkIdempotencyMarker(errorMarker, existingComments);
    if (!skipped) {
      await tracker.postComment(
        ticketKey,
        `${errorMarker} No open PR found for branch ${branchName}. Cannot review.`,
      );
    }
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider });
    return;
  }

  const prNumber = prs[0].number;
  // Fetch the full PR to get the `mergeable` field (not available in list response)
  const pr = await runner.getPR({ owner, repo, prNumber });
  const headSha = pr.headSha;
  const mergeable = pr.mergeable;

  // Idempotency keyed on head SHA — a new push always produces a new SHA,
  // so the review runs fresh after each iteration regardless of event_id.
  const idempotencyMarker = byPrHeadSha('reviewer', headSha);
  const { skipped } = checkIdempotencyMarker(idempotencyMarker, existingComments);
  if (skipped) {
    logger.info('already processed, skipping', { sha: headSha.slice(0, 7) });
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider });
    return;
  }

  // CI gate
  const ciStatus = await runner.getCommitStatus(owner, repo, headSha);
  const ciOutcome = gateCi({ status: ciStatus });

  if (!ciOutcome.proceed) {
    if (ciOutcome.outcome === 'pending-ci') {
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} CI checks are still pending on ${headSha.slice(0, 7)}. Will retry when CI completes.`,
      );
      appendOutput({ input_tokens: 0, output_tokens: 0, model, provider });
      return;
    }

    const ciMessage =
      ciOutcome.findings[0]?.message ?? 'CI checks failed. See the Actions run for details.';
    const ciTransitionNote = shouldTransitionChanges ? ' Moved to Dev Iteration.' : '';
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} CI checks failed.${ciTransitionNote}`,
    );
    await runner.commentOnPR(
      { owner, repo, prNumber },
      `${idempotencyMarker}\n\n**CI failed:** ${ciMessage}`,
    );
    if (shouldTransitionChanges) {
      await tracker.postTransition(ticketKey, iterTransitionId);
    }
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider });
    return;
  }

  // Fetch ALL PR files (paginated)
  const files = await runner.listPRFiles({ owner, repo, prNumber });
  const fileMap = new Map<string, string | undefined>(files.map((f) => [f.filename, f.patch]));

  // Detect merge conflicts in patches
  const conflictedFiles = detectMergeConflicts(files);
  const hasMergeConflicts = mergeable === false || conflictedFiles.length > 0;

  // Fetch commits for context
  const commits = await runner.listPRCommits({ owner, repo, prNumber });
  const commitLog = commits
    .map((c) => `${c.sha.slice(0, 7)} ${c.message.split('\n')[0]}`)
    .join('\n');

  const ticketBlock = buildTicketBlock(ticketKey, issue);

  const mergeConflictWarning = hasMergeConflicts
    ? `\n⚠️  MERGE CONFLICTS DETECTED — mergeable=${String(mergeable)}${conflictedFiles.length > 0 ? `, conflicted files: ${conflictedFiles.join(', ')}` : ''}`
    : '';

  const initialPrompt = [
    '## Jira Ticket',
    delimitUntrusted(ticketBlock),
    '',
    '## PR Metadata',
    `PR #${prNumber}: ${pr.title}`,
    `Base: ${pr.baseRef} ← Head: ${branchName} (${headSha.slice(0, 7)})`,
    `Files changed: ${files.length}  Commits: ${commits.length}`,
    mergeConflictWarning,
    '',
    '## Commits',
    commitLog,
    '',
    '## Changed files (status  +additions  -deletions  path)',
    buildFileList(files),
    '',
    'Use get_file_patch to inspect individual file diffs, get_file_content for full file contents.',
    'When you have enough information, call finish_review.',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const system = buildSystem('review', REPO_ROOT, {
    extraParts: [loadOptionalPrompt('review-comment', REPO_ROOT)],
    separator: '\n\n---\n\n',
  });
  const anthropic = new Anthropic(resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' }));

  const {
    result: review,
    inputTokens,
    outputTokens,
    iterations: reviewIterations,
    toolCounts: reviewToolCounts,
    toolCallRecords: reviewToolCallRecords,
  } = await runReviewLoop({
    anthropic,
    model,
    system,
    initialPrompt,
    fileMap,
    runner,
    owner,
    repo,
    headSha,
    maxIterations: ferryCfg.limits.reviewer_max_iterations,
    maxTokens: ferryCfg.limits.reviewer_max_tokens,
    logger,
  });

  logger.info('reviewed', {
    ticket: ticketKey,
    pr: prNumber,
    approved: review.approved,
    in: inputTokens,
    out: outputTokens,
  });

  writeStepSummary({
    role: 'reviewer',
    iterations: reviewIterations,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    toolCounts: reviewToolCounts,
    toolCallRecords: reviewToolCallRecords,
    filesTouched: [],
    branchPushed: '',
    outcome: review.approved ? 'approved' : 'changes_requested',
  });

  if (review.approved) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Approved. PR#${prNumber} is ready to merge.`,
    );
    await runner.addLabelsToPR({ owner, repo, prNumber }, ['ferry:approved']);
    await runner.removeLabelFromPR({ owner, repo, prNumber }, 'ferry:reviewing').catch(() => {});
    await runner.markPRReadyForReview(owner, repo, prNumber);
    await runner.commentOnPR({ owner, repo, prNumber }, review.comment);
    if (shouldTransitionApprove) {
      await tracker.postTransition(ticketKey, approveTransitionId);
    }
  } else {
    const priorIterations = countPriorIterations(existingComments);
    const cap = ferryCfg.limits.max_iterations;
    const capReached = priorIterations >= cap;

    await runner.commentOnPR({ owner, repo, prNumber }, review.comment);

    if (!capReached) {
      const changesNote = shouldTransitionChanges ? ' Moved to Dev Iteration.' : '';
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} Changes requested (iteration ${priorIterations + 1}/${cap}).${changesNote} See PR#${prNumber} for details.`,
      );
      if (shouldTransitionChanges) {
        await tracker.postTransition(ticketKey, iterTransitionId);
      }
    } else {
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} Changes requested (re-review). Iteration cap (${cap}) reached; see PR#${prNumber} and move ticket manually.`,
      );
    }
  }

  appendOutput({ input_tokens: inputTokens, output_tokens: outputTokens, model, provider });
}

void runAgent('reviewer', main);
