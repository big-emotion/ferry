import { pathToFileURL } from 'node:url';
import { isDryRun } from '../../lib/dry-run.js';
import { createLlmCall } from '../../lib/llm/call.js';
import {
  runAgent,
  createLogger,
  createGitHubContext,
  resolveGitConfig,
  loadFerryConfigFromBaseBranch,
  writeStepSummary,
} from '../../lib/agent-runtime/index.js';
import type { Logger } from '../../lib/agent-runtime/index.js';
import { runRefiner } from './refine.js';
import { applyActions } from './reconcile.js';
import type { IssueTracker } from '../../lib/io/tracker/types.js';
import type { LlmCall } from './refine.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

const PRIOR_RUN_MARKER = /\[ferry:refiner:[^\]]+\]/;

export interface RefinerActionDeps {
  tracker: IssueTracker;
  callLlm: LlmCall;
  logger?: Logger;
}

export async function run(envelope: EventEnvelopeV1, deps: RefinerActionDeps): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;
  const logger = deps.logger ?? createLogger(eventId, 'ferry:refiner-action');
  const dryRun = isDryRun();

  const issue = await deps.tracker.getIssue(ticketKey);
  const runLink = `https://github.com/${process.env.GITHUB_REPO ?? 'unknown'}/actions/runs/${process.env.GITHUB_RUN_ID ?? '0'}`;

  const existingSubtasks = await deps.tracker.getSubtaskDetails(ticketKey);
  const priorRefinerRuns = issue.comments.filter((c) => PRIOR_RUN_MARKER.test(c));

  const { plan, auditSummary } = await runRefiner({
    ticket: {
      key: issue.key,
      title: issue.summary,
      description: issue.description,
      comments: issue.comments,
      labels: issue.labels,
    },
    existingSubtasks,
    priorRefinerRuns,
    callLlm: deps.callLlm,
    runLink,
  });

  const zeroUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  if (dryRun) {
    logger.info('DRY_RUN — plan (no Jira writes)', {
      ticket: ticketKey,
      subtaskCount: auditSummary.subtaskCount,
      actions: plan.actions.map((a) => a.type),
    });
    writeStepSummary({
      role: 'refiner',
      iterations: 1,
      usage: zeroUsage,
      toolCounts: {},
      toolCallRecords: [],
      filesTouched: [],
      branchPushed: '',
      outcome: 'dry_run',
    });
    return;
  }

  const result = await applyActions(plan.actions, {
    ticketKey,
    eventId,
    existingSubtasks,
    tracker: deps.tracker,
  });

  const idempotencyMarker = `[ferry:refiner:${eventId}]`;

  if (result.noop) {
    logger.info('noop — existing sub-tasks still valid', { ticket: ticketKey });
    await deps.tracker.postComment(
      ticketKey,
      `${idempotencyMarker} No changes needed — existing ${existingSubtasks.length} sub-task(s) still valid. ${result.noopReason ?? ''}`.trimEnd(),
    );
    writeStepSummary({
      role: 'refiner',
      iterations: 1,
      usage: zeroUsage,
      toolCounts: {},
      toolCallRecords: [],
      filesTouched: [],
      branchPushed: '',
      outcome: 'noop',
    });
    return;
  }

  logger.info('reconcile complete', {
    ticket: ticketKey,
    created: result.createdCount,
    kept: result.keptCount,
    staled: result.staledCount,
  });

  await deps.tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Refined. Created ${result.createdCount}, kept ${result.keptCount}, staled ${result.staledCount} sub-task(s). See run: ${runLink}`,
  );

  writeStepSummary({
    role: 'refiner',
    iterations: 1,
    usage: zeroUsage,
    toolCounts: {},
    toolCallRecords: [],
    filesTouched: [],
    branchPushed: '',
    outcome: 'refined',
  });
}

async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { owner, repo, runner, tracker, ferryCfg: initialCfg } = createGitHubContext(REPO_ROOT);
  // Reload config from base_branch — the workspace may contain the default branch's config.
  const { baseBranch } = await resolveGitConfig(initialCfg, runner, owner, repo);
  const ferryCfg = loadFerryConfigFromBaseBranch(baseBranch, REPO_ROOT, initialCfg);
  const route = ferryCfg.models.refiner;
  const callLlm: LlmCall = createLlmCall(route);
  await run(envelope, { tracker, callLlm, logger });
}

// Only invoke main() when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runAgent('refiner', main);
}
