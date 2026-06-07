import { createToolCallLoop } from '../../lib/llm/tool-loop/index.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { gateCi } from './ci-gate.js';
import { runReviewLoop } from './review-loop.js';
import {
  resolveCapabilities,
  resolveTicketOverrides,
  applyTicketOverrides,
  hasNonDefaultOverrides,
  buildOverridesAuditComment,
  buildConflictComment,
  applyDryRunMarker,
  LabelConflictError,
} from '../../lib/agent-runtime/index.js';
import {
  requireEnv,
  appendOutput,
  writeStepSummary,
  createGitHubContext,
  resolveGitConfig,
  resolveBranchPrefix,
  loadFerryConfigFromBaseBranch,
  logCapabilities,
  logTicketOverrides,
  byEventId,
  byPrHeadSha,
  prepareReviewer,
} from '../../lib/agent-runtime/index.js';
import { countPriorIterations } from './changes-guard.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';
import type { Logger } from '../../lib/agent-runtime/index.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

export async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const { owner, repo, runner, tracker, ferryCfg: initialCfg } = createGitHubContext(REPO_ROOT);
  // Reload config from base_branch — the workspace may contain the default branch's config.
  const { baseBranch } = await resolveGitConfig(initialCfg, runner, owner, repo);
  const ferryCfg = loadFerryConfigFromBaseBranch(baseBranch, REPO_ROOT, initialCfg);
  const reviewerWorkflow = ferryCfg.workflow.agents.reviewer;
  const configTransitionChanges = reviewerWorkflow.auto_transition_changes !== null;
  const configTransitionApprove = reviewerWorkflow.auto_transition_approve !== null;

  const issue = await tracker.getIssue(ticketKey);
  const existingComments = issue.comments;

  // Resolve label overrides (model/provider/budget/…) — Jira labels take highest precedence.
  let effectiveCfg: typeof ferryCfg;
  let typeOverride: string | undefined;
  let autoApprove = false;
  let noAutoTransition = false;
  let dryRun = false;
  let thinkingOverride: 'on' | 'off' | 'extended' | undefined;
  let reviewRubricOverride: 'strict' | 'lenient' | undefined;
  try {
    const overrides = resolveTicketOverrides(issue.labels, logger, {
      allowSkipReview: ferryCfg.safety?.allow_skip_review === true,
    });
    typeOverride = overrides.typeOverride;
    autoApprove = overrides.skipPhases?.includes('review') === true;
    noAutoTransition = overrides.noAutoTransition === true;
    dryRun = overrides.dryRun === true;
    thinkingOverride = overrides.thinking;
    reviewRubricOverride = overrides.reviewRubric;
    if (dryRun) {
      logger.warn('DRY-RUN: LLM calls will still incur cost; no commits or PRs will be pushed.');
    }
    effectiveCfg = applyTicketOverrides(ferryCfg, overrides);
    logTicketOverrides(logger, overrides);
    if (hasNonDefaultOverrides(overrides)) {
      await tracker.postComment(
        ticketKey,
        buildOverridesAuditComment('reviewer', eventId, overrides),
      );
    }
    // ferry:read-only — Reviewer short-circuits at entry; Refiner runs normally.
    if (overrides.readOnly === true) {
      logger.info('read-only mode — reviewer agent skipped');
      await tracker.postComment(
        ticketKey,
        applyDryRunMarker(`[ferry:reviewer:${eventId}] read-only: agent skipped`, overrides.dryRun),
      );
      return;
    }
  } catch (err) {
    if (err instanceof LabelConflictError) {
      await tracker.postComment(ticketKey, buildConflictComment('reviewer', eventId, err));
      process.exit(1);
    }
    throw err;
  }

  // FR24 auto-transitions are gated by config, the ferry:no-auto-transition label,
  // and the ferry:dry-run label (dry-run suppresses all external writes).
  const shouldTransitionChanges = configTransitionChanges && !noAutoTransition && !dryRun;
  const shouldTransitionApprove = configTransitionApprove && !noAutoTransition && !dryRun;
  const iterTransitionId = shouldTransitionChanges ? requireEnv('FERRY_ITER_TRANSITION_ID') : '';
  const approveTransitionId = shouldTransitionApprove
    ? requireEnv('FERRY_APPROVE_TRANSITION_ID')
    : '';

  const { provider, model } = effectiveCfg.models.review;

  const capabilities = resolveCapabilities(issue.labels, effectiveCfg.labels, logger);
  logCapabilities(logger, capabilities);

  // Find PR for this ticket's branch
  const branchName = `${resolveBranchPrefix(effectiveCfg.git.working_branch_prefix, issue)}${ticketKey}`;
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

  // Idempotency keyed on head SHA — a new push always produces a new SHA,
  // so the review runs fresh after each iteration regardless of event_id.
  const idempotencyMarker = byPrHeadSha('reviewer', headSha);
  const { skipped } = checkIdempotencyMarker(idempotencyMarker, existingComments);
  if (skipped) {
    logger.info('already processed, skipping', { sha: headSha.slice(0, 7) });
    appendOutput({ input_tokens: 0, output_tokens: 0, model, provider });
    return;
  }

  // ferry:skip/review — auto-approve without running the review loop.
  // Gated above by `safety.allow_skip_review`; this branch only runs when the opt-in is on.
  if (autoApprove) {
    logger.info('review phase skipped via ferry:skip/review — auto-approving', {
      pr: prNumber,
      sha: headSha.slice(0, 7),
    });
    const approveTransitionNote = shouldTransitionApprove
      ? ' Moved to next column.'
      : noAutoTransition
        ? ' FR24 auto-transition skipped (ferry:no-auto-transition).'
        : '';
    await tracker.postComment(
      ticketKey,
      applyDryRunMarker(
        `${idempotencyMarker} Auto-approved via ferry:skip/review — review loop bypassed. PR#${prNumber}.${approveTransitionNote}`,
        dryRun,
      ),
    );
    if (!dryRun) {
      await runner.addLabelsToPR({ owner, repo, prNumber }, ['ferry:approved']);
      await runner.removeLabelFromPR({ owner, repo, prNumber }, 'ferry:reviewing').catch(() => {});
      await runner.markPRReadyForReview(owner, repo, prNumber);
      await runner.commentOnPR(
        { owner, repo, prNumber },
        `${idempotencyMarker} Auto-approved via ferry:skip/review label — review skipped per ticket opt-in.`,
      );
      if (shouldTransitionApprove) {
        await tracker.postTransition(ticketKey, approveTransitionId);
      }
    }
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

  // Fetch ALL PR files (paginated) + commits for context.
  const files = await runner.listPRFiles({ owner, repo, prNumber });
  const commits = await runner.listPRCommits({ owner, repo, prNumber });

  // Pre-loop setup: builds the reviewer system prompt (with review-comment
  // overlay + rubric override), the initial prompt, the filename→patch map,
  // and the capability-filtered MCP pool. Extracted into a reusable prepare
  // function (#330) so the future cc-prepare composite (#331) consumes the
  // same source. `capabilities` and `idempotencyMarker` are threaded in
  // from the action (single source of truth — see `RolePreparedContextBase`).
  const prepared = prepareReviewer({
    ticketKey,
    issue,
    pr,
    files,
    commits,
    branchName,
    typeOverride,
    reviewRubric: reviewRubricOverride,
    capabilities,
    idempotencyMarker,
    repoRoot: REPO_ROOT,
  });
  const { system, initialPrompt, fileMap } = prepared;

  const loop = createToolCallLoop({ provider, model, thinking: thinkingOverride, logger });

  const {
    result: review,
    inputTokens,
    outputTokens,
    iterations: reviewIterations,
    toolCounts: reviewToolCounts,
    toolCallRecords: reviewToolCallRecords,
  } = await runReviewLoop({
    loop,
    system,
    initialPrompt,
    fileMap,
    runner,
    owner,
    repo,
    headSha,
    maxIterations: effectiveCfg.limits.reviewer_max_iterations,
    maxTokens: effectiveCfg.limits.reviewer_max_tokens,
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
      applyDryRunMarker(`${idempotencyMarker} Approved. PR#${prNumber} is ready to merge.`, dryRun),
    );
    if (!dryRun) {
      await runner.addLabelsToPR({ owner, repo, prNumber }, ['ferry:approved']);
      await runner.removeLabelFromPR({ owner, repo, prNumber }, 'ferry:reviewing').catch(() => {});
      await runner.markPRReadyForReview(owner, repo, prNumber);
      await runner.commentOnPR({ owner, repo, prNumber }, review.comment);
      if (shouldTransitionApprove) {
        await tracker.postTransition(ticketKey, approveTransitionId);
      }
      // FR32: dispatch ferry-merge best-effort — a dispatch failure must never lose an approval.
      // The reviewer job on the script path requires contents: write for repository_dispatch.
      try {
        await runner.dispatch('merge', { ...envelope, phase: 'merge' });
      } catch (err) {
        logger.warn('ferry-merge dispatch failed (non-fatal)', { error: (err as Error).message });
      }
    }
  } else {
    const priorIterations = countPriorIterations(existingComments);
    const cap = effectiveCfg.limits.max_iterations;
    const capReached = priorIterations >= cap;

    if (!dryRun) {
      await runner.commentOnPR({ owner, repo, prNumber }, review.comment);
    }

    if (!capReached) {
      const changesNote = shouldTransitionChanges ? ' Moved to Dev Iteration.' : '';
      await tracker.postComment(
        ticketKey,
        applyDryRunMarker(
          `${idempotencyMarker} Changes requested (iteration ${priorIterations + 1}/${cap}).${changesNote} See PR#${prNumber} for details.`,
          dryRun,
        ),
      );
      if (shouldTransitionChanges) {
        await tracker.postTransition(ticketKey, iterTransitionId);
      }
    } else {
      await tracker.postComment(
        ticketKey,
        applyDryRunMarker(
          `${idempotencyMarker} Changes requested (re-review). Iteration cap (${cap}) reached; see PR#${prNumber} and move ticket manually.`,
          dryRun,
        ),
      );
    }
  }

  appendOutput({ input_tokens: inputTokens, output_tokens: outputTokens, model, provider });
}
