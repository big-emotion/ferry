import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import {
  appendOutput,
  createGitHubContext,
  resolveBranchPrefix,
  resolveGitConfig,
  loadFerryConfigFromBaseBranch,
  byEventId,
} from '../../lib/agent-runtime/index.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';
import type { Logger } from '../../lib/agent-runtime/index.js';

export type MergeStrategy = 'squash' | 'merge' | 'rebase';

const VALID_STRATEGIES: ReadonlySet<string> = new Set(['squash', 'merge', 'rebase']);

export function resolveMergeStrategy(): MergeStrategy {
  const raw = process.env.FERRY_MERGE_STRATEGY ?? 'squash';
  if (!VALID_STRATEGIES.has(raw)) {
    return 'squash';
  }
  return raw as MergeStrategy;
}

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

export async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const { owner, repo, runner, tracker, ferryCfg: initialCfg } = createGitHubContext(REPO_ROOT);

  const resolvedGit = await resolveGitConfig(initialCfg, runner, owner, repo);
  const ferryCfg = loadFerryConfigFromBaseBranch(resolvedGit.baseBranch, REPO_ROOT, initialCfg);

  const issue = await tracker.getIssue(ticketKey);
  const existingComments = issue.comments;

  const idempotencyMarker = byEventId('merger', eventId);
  const { skipped } = checkIdempotencyMarker(idempotencyMarker, existingComments);
  if (skipped) {
    logger.info('already processed this merge event — skipping', { eventId });
    appendOutput({ input_tokens: 0, output_tokens: 0 });
    return;
  }

  const branchName = `${resolveBranchPrefix(ferryCfg.git.working_branch_prefix, issue)}${ticketKey}`;

  const prs = await runner.listPRsForBranch(owner, repo, branchName);
  if (prs.length === 0) {
    logger.info('no open PR found for branch — possibly already merged', { branch: branchName });
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} No open PR found for branch \`${branchName}\` — already merged or not yet created.`,
    );
    appendOutput({ input_tokens: 0, output_tokens: 0 });
    return;
  }

  const prNumber = prs[0].number;
  const strategy = resolveMergeStrategy();

  logger.info('merging PR', { prNumber, strategy, branch: branchName });

  const doneTransitionId = process.env.FERRY_MERGE_DONE_TRANSITION_ID;
  const transitionNote = doneTransitionId ? ' — transitioning ticket.' : '.';

  await runner.mergePR({ owner, repo, prNumber }, strategy);

  await tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Merged PR#${prNumber} via \`${strategy}\`${transitionNote}`,
  );

  if (doneTransitionId) {
    await tracker.postTransition(ticketKey, doneTransitionId);
  }

  appendOutput({ input_tokens: 0, output_tokens: 0 });
}

// ferry-agent CLI calls main() via runAgent — no direct invocation here.
