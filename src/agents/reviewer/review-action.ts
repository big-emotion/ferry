import { appendFileSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/sanitization/delimit-untrusted.js';
import { createTrackerFromEnv } from '../../lib/io/tracker/factory.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { gateCi } from './ci-gate.js';
import { FerryError } from '../../lib/error.js';
import { GitHubActionsRunner } from '../../lib/dispatch/runner/github-actions/index.js';
import { detectMergeConflicts, buildFileList, runReviewLoop } from './review-loop.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();
const SYSTEM_PROMPT_PATH =
  process.env.FERRY_PROMPT_PATH ?? path.join(REPO_ROOT, 'prompts', 'review.md');
const COMMENT_TEMPLATE_PATH =
  process.env.FERRY_REVIEW_TEMPLATE_PATH ?? path.join(REPO_ROOT, 'prompts', 'review-comment.md');

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
  const githubToken = requireEnv('GITHUB_TOKEN');
  const iterTransitionId = requireEnv('FERRY_ITER_TRANSITION_ID');
  const githubRepo = requireEnv('GITHUB_REPO');

  const model = process.env.FERRY_REVIEW_MODEL ?? 'claude-sonnet-4-6';

  const [owner, repo] = githubRepo.split('/');
  if (!owner || !repo) {
    throw new FerryError('state-invariant', { reason: 'invalid-github-repo', githubRepo });
  }
  const runner = new GitHubActionsRunner(githubToken, owner, repo);
  const tracker = createTrackerFromEnv();

  const issue = await tracker.getIssue(ticketKey);
  const existingComments = issue.comments;

  // Find PR for this ticket's branch
  const branchName = `ferry/${ticketKey}`;
  const prs = await runner.listPRsForBranch(owner, repo, branchName);

  if (prs.length === 0) {
    const errorMarker = `[ferry:reviewer:${eventId}]`;
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
  const idempotencyMarker = `[ferry:reviewer:${headSha.slice(0, 7)}]`;
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

  // Build ticket context
  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.summary}`,
    `TYPE: ${issue.issueType}`,
    `DESCRIPTION:\n${issue.description}`,
  ]
    .filter(Boolean)
    .join('\n');

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

  const systemBase = readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  let commentTemplate = '';
  try {
    commentTemplate = readFileSync(COMMENT_TEMPLATE_PATH, 'utf8');
  } catch {
    /* optional */
  }
  const system = commentTemplate ? `${systemBase}\n\n---\n\n${commentTemplate}` : systemBase;
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

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
  console.error('[ferry:review-action] fatal:', (err as Error).message);
  process.exit(1);
});
