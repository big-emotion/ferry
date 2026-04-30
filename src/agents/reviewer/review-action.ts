import Anthropic from '@anthropic-ai/sdk';
import { resolveAnthropicAuth } from '../../lib/llm/anthropic-auth.js';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { gateCi } from './ci-gate.js';
import { detectMergeConflicts, buildFileList, runReviewLoop } from './review-loop.js';
import { resolveCapabilities } from '../../lib/labels/capabilities.js';
import {
  requireEnv,
  appendOutput,
  buildSystem,
  loadOptionalPrompt,
  buildTicketBlock,
  createGitHubContext,
  logCapabilities,
  byEventId,
  byPrHeadSha,
} from '../../lib/agent-runtime/index.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const iterTransitionId = requireEnv('FERRY_ITER_TRANSITION_ID');
  const { owner, repo, runner, tracker, ferryCfg } = createGitHubContext(REPO_ROOT);
  const model = ferryCfg.models.review.model;

  const issue = await tracker.getIssue(ticketKey);
  const existingComments = issue.comments;

  const capabilities = resolveCapabilities(issue.labels, ferryCfg.labels);
  logCapabilities('[ferry:review-action]', capabilities);

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
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
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
    console.error(`[ferry:review-action] already processed ${headSha.slice(0, 7)}, skipping`);
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
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
      appendOutput({ input_tokens: 0, output_tokens: 0, model });
      return;
    }

    const ciMessage =
      ciOutcome.findings[0]?.message ?? 'CI checks failed. See the Actions run for details.';
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} CI checks failed. Moved to Dev Iteration.`,
    );
    await runner.commentOnPR(
      { owner, repo, prNumber },
      `${idempotencyMarker}\n\n**CI failed:** ${ciMessage}`,
    );
    await tracker.postTransition(ticketKey, iterTransitionId);
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
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
    maxIterations: ferryCfg.limits.max_agent_iterations,
    maxTokens: ferryCfg.limits.max_tokens_per_message,
  });

  console.error(
    `[ferry:review-action] reviewed ${ticketKey} PR#${prNumber} — approved=${review.approved} in=${inputTokens} out=${outputTokens}`,
  );

  if (review.approved) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Approved. PR#${prNumber} is ready to merge.`,
    );
    await runner.addLabelsToPR({ owner, repo, prNumber }, ['ferry:approved']);
    await runner.removeLabelFromPR({ owner, repo, prNumber }, 'ferry:reviewing').catch(() => {});
    await runner.commentOnPR({ owner, repo, prNumber }, review.comment);
  } else {
    const hasIteratorMarker = existingComments.some((c) => c.includes('[ferry:iterator:'));

    await runner.commentOnPR({ owner, repo, prNumber }, review.comment);

    if (!hasIteratorMarker) {
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} Changes requested. Moved to Dev Iteration. See PR#${prNumber} for details.`,
      );
      await tracker.postTransition(ticketKey, iterTransitionId);
    } else {
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} Changes requested (re-review). See PR#${prNumber} comments and move ticket manually.`,
      );
    }
  }

  appendOutput({ input_tokens: inputTokens, output_tokens: outputTokens, model });
}

main().catch((err) => {
  console.error('[ferry:review-action] fatal:', (err as Error).message);
  process.exit(1);
});
