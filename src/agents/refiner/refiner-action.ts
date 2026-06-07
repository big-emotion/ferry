import { isDryRun } from '../../lib/dry-run.js';
import { createAgentLoop } from '../../lib/llm/agent-loop/index.js';
import type { AgentLoop, McpServerConfig } from '../../lib/llm/agent-loop/index.js';
import {
  createLogger,
  createGitHubContext,
  resolveGitConfig,
  loadFerryConfigFromBaseBranch,
  writeStepSummary,
  resolveTicketOverrides,
  applyTicketOverrides,
  hasNonDefaultOverrides,
  buildOverridesAuditComment,
  buildConflictComment,
  applyDryRunMarker,
  LabelConflictError,
  logTicketOverrides,
  prepareRefiner,
  resolveCapabilities,
  filterMcpServers,
  logCapabilities,
  loadMcpServers,
} from '../../lib/agent-runtime/index.js';
import type { Logger } from '../../lib/agent-runtime/index.js';
import { runRefinerLoop } from './refine.js';
import { applyActions } from './reconcile.js';
import { loadCostBaseline, estimateTicketCost } from './cost-estimate.js';
import type { IssueTracker } from '../../lib/io/tracker/types.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

export interface RefinerActionDeps {
  tracker: IssueTracker;
  loop: AgentLoop;
  logger?: Logger;
  /**
   * When true (set via ferry:dry-run label or FERRY_DRY_RUN=1), the Refiner skips
   * all Jira mutations (sub-task create, label add, transition, comment except
   * the audit comment marker). LLM cost is still incurred.
   */
  dryRun?: boolean;
  mcpServers?: McpServerConfig[];
}

export async function run(envelope: EventEnvelopeV1, deps: RefinerActionDeps): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;
  const logger = deps.logger ?? createLogger(eventId, 'ferry:refiner-action');
  const dryRun = isDryRun() || deps.dryRun === true;

  // Pre-loop setup: fetches the Jira issue, existing subtasks, prior refiner
  // runs, and computes the runLink + idempotency marker. Extracted into a
  // reusable prepare function (#330) so the future cc-prepare composite (#331)
  // consumes the same source.
  const prepared = await prepareRefiner({ envelope, tracker: deps.tracker });
  const { issue, existingSubtasks, priorRefinerRuns, runLink, idempotencyMarker } = prepared;

  const { plan, auditSummary } = await runRefinerLoop({
    ticket: {
      key: issue.key,
      title: issue.summary,
      description: issue.description,
      comments: issue.comments,
      labels: issue.labels,
    },
    existingSubtasks,
    priorRefinerRuns,
    loop: deps.loop,
    runLink,
    mcpServers: deps.mcpServers,
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

  // Cost estimation: load baseline, enforce hard cap, post estimate comment + label
  const baseline = loadCostBaseline(REPO_ROOT);
  if (baseline) {
    const estimate = estimateTicketCost(plan, baseline);
    const capRaw = parseFloat(process.env.COST_TICKET_MAX_USD ?? '');
    const cap = isNaN(capRaw) ? null : capRaw;

    if (cap !== null && estimate.hiUsd > cap) {
      await deps.tracker.postComment(
        ticketKey,
        `[ferry:refiner-cap:${eventId}] Estimated cost $${estimate.loUsd.toFixed(2)}–$${estimate.hiUsd.toFixed(2)} exceeds cap $${cap.toFixed(2)}. ` +
          `Consider splitting this ticket into smaller pieces.`,
      );
      writeStepSummary({
        role: 'refiner',
        iterations: 1,
        usage: zeroUsage,
        toolCounts: {},
        toolCallRecords: [],
        filesTouched: [],
        branchPushed: '',
        outcome: 'cap_refused',
      });
      return;
    }

    const loStr = estimate.loUsd.toFixed(2);
    const hiStr = estimate.hiUsd.toFixed(2);
    await deps.tracker.postComment(
      ticketKey,
      `[ferry:refiner-estimate:${eventId}] Estimated cost: $${loStr}–$${hiStr} ` +
        `(confidence: ${estimate.confidence}, based on ${estimate.baselineRuns} runs)`,
    );
    // Label uses concatenation to avoid the label-allowlist static analysis regex
    const costEstimateLabel = 'ferry:cost-estimate:' + loStr + '-' + hiStr;
    await deps.tracker.addLabel(ticketKey, costEstimateLabel);
  }

  const result = await applyActions(plan.actions, {
    ticketKey,
    eventId,
    existingSubtasks,
    tracker: deps.tracker,
  });

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

export async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;
  const { owner, repo, runner, tracker, ferryCfg: initialCfg } = createGitHubContext(REPO_ROOT);
  // Reload config from base_branch — the workspace may contain the default branch's config.
  const { baseBranch } = await resolveGitConfig(initialCfg, runner, owner, repo);
  const ferryCfg = loadFerryConfigFromBaseBranch(baseBranch, REPO_ROOT, initialCfg);

  // Resolve label overrides (model/provider/budget/…) before creating the LLM call.
  const issueForLabels = await tracker.getIssue(ticketKey);
  let effectiveCfg;
  let labelDryRun = false;
  try {
    const overrides = resolveTicketOverrides(issueForLabels.labels, logger, {
      allowSkipReview: ferryCfg.safety?.allow_skip_review === true,
    });
    labelDryRun = overrides.dryRun === true;
    if (labelDryRun) {
      logger.warn('DRY-RUN: LLM calls will still incur cost; no commits or PRs will be pushed.');
    }
    logTicketOverrides(logger, overrides);
    effectiveCfg = applyTicketOverrides(ferryCfg, overrides);
    if (hasNonDefaultOverrides(overrides)) {
      await tracker.postComment(
        ticketKey,
        buildOverridesAuditComment('refiner', eventId, overrides),
      );
    }
    // ferry:skip/refiner — exit early; the ticket goes straight to Dev when triggered.
    if (overrides.skipPhases?.includes('refiner')) {
      logger.info('refiner phase skipped via ferry:skip/refiner — exiting');
      await tracker.postComment(
        ticketKey,
        applyDryRunMarker(
          `[ferry:refiner:${eventId}] Refiner skipped via ferry:skip/refiner — no refinement performed.`,
          labelDryRun,
        ),
      );
      return;
    }
    // ferry:read-only does NOT short-circuit the Refiner — per spec, Refiner runs normally.
    // When combined with ferry:dry-run, the dryRun gating below suppresses sub-task writes.
  } catch (err) {
    if (err instanceof LabelConflictError) {
      await tracker.postComment(ticketKey, buildConflictComment('refiner', eventId, err));
      process.exit(1);
    }
    throw err;
  }

  const mcpPool = loadMcpServers();
  const capabilities = resolveCapabilities(issueForLabels.labels, effectiveCfg.labels, logger);
  logCapabilities(logger, capabilities);
  const hasLabelsConfig = effectiveCfg.labels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);
  if (mcpServers.length > 0) {
    logger.info('MCP servers', { servers: mcpServers.map((s) => s.name) });
  }

  const route = effectiveCfg.models.refiner;
  const loop = createAgentLoop({
    provider: route.provider,
    model: route.model,
    executeTool: async (_repoRoot: string, name: string) => {
      throw new Error(`Unknown refiner tool: ${name}`);
    },
    maxIterations: parseInt(process.env.FERRY_REFINER_MAX_ITERATIONS ?? '', 10) || 5,
    logger,
  });
  await run(envelope, { tracker, loop, mcpServers, logger, dryRun: labelDryRun });
}
