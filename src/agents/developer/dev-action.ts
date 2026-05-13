import { execFileSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
import {
  requireEnv,
  loadMcpServers,
  buildSystem,
  buildTicketBlock,
  appendOutput,
  writeStepSummary,
  configureFerryGitUser,
  makeCommitProgress,
  makeSecretScan,
  logCapabilities,
  logTicketOverrides,
  createGitHubContext,
  resolveGitConfig,
  resolveBranchPrefix,
  loadFerryConfigFromBaseBranch,
} from '../../lib/agent-runtime/index.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';
import type { Logger } from '../../lib/agent-runtime/index.js';
import { isDryRun } from '../../lib/dry-run.js';
import { FerryError } from '../../lib/errors/index.js';
import { formatDeveloperCommit } from './commit.js';
import { formatPullRequestTitle, formatPullRequestBody } from './pr.js';
import {
  TOOL_SCHEMAS,
  COMMIT_PROGRESS_SCHEMA,
  SPAWN_SUBAGENT_SCHEMA,
  executeTool,
} from './tools.js';
import { createAgentLoop } from '../../lib/llm/agent-loop/index.js';
import type { AgentLoop } from '../../lib/llm/agent-loop/types.js';
import {
  resolveCapabilities,
  filterMcpServers,
  resolveTicketOverrides,
  applyTicketOverrides,
  hasNonDefaultOverrides,
  buildOverridesAuditComment,
  buildConflictComment,
  applyDryRunMarker,
  LabelConflictError,
} from '../../lib/agent-runtime/index.js';
import { detectTestRunner, repoTree, packageJsonPath, detectPackageManager } from './workspace.js';
import { assertDevOutputContract } from './outcome-guard.js';
import { runWipFinalizer } from './wip-finalizer.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

export async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  let dryRun = isDryRun();
  if (dryRun) {
    logger.info('DRY_RUN mode — no branch push, no PR, no Jira writes');
  }

  const { owner, repo, runner, tracker, ferryCfg: initialCfg } = createGitHubContext(REPO_ROOT);

  // Resolve baseBranch before using any config values, then reload config from that branch.
  // On repository_dispatch, actions/checkout resolves to the default branch, not base_branch,
  // so the workspace may contain a stale ferry.config.json.
  const { baseBranch, targetBranch } = await resolveGitConfig(initialCfg, runner, owner, repo);
  // loadFerryConfigFromBaseBranch also fetches origin/<baseBranch>, which makes
  // `git log origin/<base>..HEAD` work correctly later in this function.
  const ferryCfg = loadFerryConfigFromBaseBranch(baseBranch, REPO_ROOT, initialCfg);

  const devWorkflow = ferryCfg.workflow.agents.developer;
  const configAutoTransition = devWorkflow.auto_transition !== null;

  const issue = await tracker.getIssue(ticketKey);

  // Resolve label overrides (model/provider/budget/…) — Jira labels take highest precedence.
  let effectiveCfg = ferryCfg;
  let typeOverride: string | undefined;
  let forceLabel: string | undefined;
  let noAutoTransition = false;
  try {
    const overrides = resolveTicketOverrides(issue.labels, logger, {
      allowSkipReview: ferryCfg.safety?.allow_skip_review === true,
    });
    typeOverride = overrides.typeOverride;
    forceLabel = overrides.forceLabel;
    noAutoTransition = overrides.noAutoTransition === true;
    // ferry:dry-run label → enable dry-run mode (same gating as FERRY_DRY_RUN env var).
    if (overrides.dryRun === true && !dryRun) {
      dryRun = true;
      logger.warn('DRY-RUN: LLM calls will still incur cost; no commits or PRs will be pushed.');
    }
    effectiveCfg = applyTicketOverrides(ferryCfg, overrides);
    logTicketOverrides(logger, overrides);
    if (hasNonDefaultOverrides(overrides)) {
      await tracker.postComment(
        ticketKey,
        buildOverridesAuditComment('developer', eventId, overrides),
      );
    }
    // ferry:read-only — Developer short-circuits at entry; Refiner runs normally.
    if (overrides.readOnly === true) {
      logger.info('read-only mode — developer agent skipped');
      await tracker.postComment(
        ticketKey,
        applyDryRunMarker(
          `[ferry:developer:${eventId}] read-only: agent skipped`,
          overrides.dryRun,
        ),
      );
      process.exit(0);
    }
    // ferry:skip/dev — Developer exits immediately.
    if (overrides.skipPhases?.includes('dev')) {
      logger.info('dev phase skipped via ferry:skip/dev — exiting');
      await tracker.postComment(
        ticketKey,
        applyDryRunMarker(
          `[ferry:developer:${eventId}] Developer skipped via ferry:skip/dev — no implementation performed.`,
          overrides.dryRun,
        ),
      );
      process.exit(0);
    }
  } catch (err) {
    if (err instanceof LabelConflictError) {
      await tracker.postComment(ticketKey, buildConflictComment('developer', eventId, err));
      process.exit(1);
    }
    throw err;
  }

  // FR18 auto-transition is gated by config, the ferry:no-auto-transition label,
  // and dry-run mode (dry-run suppresses all external writes).
  const shouldAutoTransition = configAutoTransition && !noAutoTransition && !dryRun;
  const reviewTransitionId = !shouldAutoTransition ? '' : requireEnv('FERRY_REVIEW_TRANSITION_ID');
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');

  const { provider: devProvider } = effectiveCfg.models.dev;
  const labels = issue.labels.join(', ');
  const comments = issue.comments.map((c) => `Comment: ${c}`).join('\n');
  const ticketBlock = buildTicketBlock(ticketKey, issue, {
    labels,
    comments,
    typeOverride,
  });

  const subtasks = await tracker.getSubtasks(ticketKey);
  const testRunner = detectTestRunner(packageJsonPath(REPO_ROOT));
  const pkgManagerHint = detectPackageManager(REPO_ROOT);
  const tree = repoTree(REPO_ROOT);

  const system = buildSystem('dev', REPO_ROOT, {
    extraParts: pkgManagerHint ? [`## Detected package manager\n\n${pkgManagerHint}`] : [],
  });
  const model = effectiveCfg.models.dev.model;

  // Branch is determined upfront from the ticket key so restarts resume the same branch.
  const branchName = `${resolveBranchPrefix(effectiveCfg.git.working_branch_prefix, issue)}${ticketKey}`;

  configureFerryGitUser(REPO_ROOT);

  let resumeContext = '';
  let branchHeadSha = '';
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', branchName], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    execFileSync('git', ['fetch', 'origin', branchName], { cwd: REPO_ROOT });
    execFileSync('git', ['checkout', branchName], { cwd: REPO_ROOT });
    const existingLog = execFileSync('git', ['log', `origin/${baseBranch}..HEAD`, '--oneline'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    if (existingLog) {
      resumeContext = `\nEXISTING WORK ON BRANCH (already committed — skip these, only do what remains):\n${existingLog}`;
      logger.info('resuming branch', {
        branch: branchName,
        prior_commits: existingLog.split('\n').length,
      });
    }
    branchHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    execFileSync('git', ['checkout', '-B', branchName], { cwd: REPO_ROOT });
    logger.info('created branch', { branch: branchName });
  }

  // Pre-flight: check for an open Ferry PR on this branch and inject context.
  let existingPrUrl = '';
  let existingPrContext = '';
  if (branchHeadSha && !dryRun) {
    try {
      const openPrs = await runner.listPRsForBranch(owner, repo, branchName);
      if (openPrs.length > 0) {
        const pr = openPrs[0];
        existingPrUrl = `https://github.com/${owner}/${repo}/pull/${pr.number}`;
        const prRef = { owner, repo, prNumber: pr.number };
        const prFiles = await runner.listPRFiles(prRef);
        const fileList = prFiles.map((f) => `${f.status}: ${f.filename}`).join('\n');
        existingPrContext = [
          `\nEXISTING_IMPLEMENTATION:`,
          `Open PR: ${existingPrUrl} (head: ${branchHeadSha.slice(0, 7)})`,
          `Changed files:\n${fileList}`,
          `If the spec is already fully satisfied by the existing code, call \`done\` with outcome="already_satisfied".`,
        ].join('\n');
        logger.info('existing PR found', { pr: existingPrUrl, files: prFiles.length });
      }
    } catch {
      // best-effort: if PR check fails, proceed without context
    }
  }

  // Idempotency marker: keyed on branch head SHA so re-runs on the same state collapse.
  const idempotencyMarker = branchHeadSha
    ? `[ferry:dev:${branchHeadSha.slice(0, 7)}]`
    : `[ferry:dev:${eventId}]`;

  const initialPrompt = [
    delimitUntrusted(ticketBlock),
    '',
    subtasks.length > 0 ? `SUBTASKS:\n${subtasks.join('\n')}` : 'SUBTASKS: (none)',
    '',
    `TEST_RUNNER: ${testRunner}`,
    '',
    `REPO TREE (depth 2):\n${tree}`,
    '',
    'When you have finished implementing, call the `done` tool.',
  ].join('\n');

  const secretScan = makeSecretScan(REPO_ROOT);
  const mcpPool = loadMcpServers();
  const capabilities = resolveCapabilities(issue.labels, effectiveCfg.labels);
  const hasLabelsConfig = effectiveCfg.labels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);

  logCapabilities(logger, capabilities);
  if (mcpServers.length > 0) {
    logger.info('MCP servers', { servers: mcpServers.map((s) => s.name) });
  }

  const allToolSchemas = [...TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA, SPAWN_SUBAGENT_SCHEMA];

  let loop!: AgentLoop;
  loop = createAgentLoop({
    provider: devProvider,
    model,
    maxIterations: effectiveCfg.limits.max_agent_iterations,
    maxInputTokens: effectiveCfg.limits.max_tokens_per_run,
    maxTokens: effectiveCfg.limits.max_tokens_per_message,
    maxCostEur: effectiveCfg.limits.max_cost_eur_per_run,
    executeTool,
    commitProgress: makeCommitProgress(logger, { dryRun }),
    spawnSubagent: (task) =>
      loop.run({
        system,
        initialPrompt: task,
        tools: allToolSchemas.filter((t) => t.name !== 'spawn_subagent'),
        repoRoot: REPO_ROOT,
        branchName,
        secretScan,
        mcpServers,
      }),
    logger,
  });

  let loopResult: Awaited<ReturnType<typeof loop.run>>;
  try {
    loopResult = await loop.run({
      system,
      initialPrompt: initialPrompt + resumeContext + existingPrContext,
      tools: allToolSchemas,
      repoRoot: REPO_ROOT,
      branchName,
      secretScan,
      mcpServers,
    });
  } catch (loopErr) {
    // EUR budget cap: apply ferry:spend-cap label and post audit comment.
    if (
      !dryRun &&
      loopErr instanceof FerryError &&
      loopErr.code === 'spend-cap' &&
      loopErr.context?.reason === 'eur-budget-exceeded'
    ) {
      const consumedEur = (loopErr.context.consumed as number | undefined) ?? 0;
      const capEur = (loopErr.context.cap as number | undefined) ?? 0;
      try {
        await tracker.addLabel(ticketKey, 'ferry:spend-cap');
        await tracker.postComment(
          ticketKey,
          `[ferry:dev:${eventId}] Budget cap €${capEur} reached — €${consumedEur.toFixed(4)} spent. Labeled ferry:spend-cap.`,
        );
      } catch {
        // best-effort
      }
    }
    await runWipFinalizer({
      error: loopErr,
      ticketKey,
      eventId,
      branchName,
      repoRoot: REPO_ROOT,
      secretScan,
      tracker,
      logger,
      dryRun,
      model,
      provider: devProvider,
    });
    throw loopErr;
  }

  const { done, usage, iterations } = loopResult;

  const resolvedOutcome = done.outcome ?? (done.actionable ? 'implemented' : 'blocked');

  logger.info('done', {
    iterations,
    outcome: resolvedOutcome,
    in: usage.input_tokens,
    cache_w: usage.cache_creation_input_tokens,
    cache_r: usage.cache_read_input_tokens,
    out: usage.output_tokens,
  });

  // ── blocked ──────────────────────────────────────────────────────────────
  if (resolvedOutcome === 'blocked') {
    const reason = done.reason ?? done.reason_if_not_actionable ?? 'no reason given';
    if (!dryRun) {
      await tracker.addLabel(ticketKey, 'ferry:blocked');
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} 🚨 BLOCKED — ${reason}. Manual intervention required.`,
      );
    } else {
      logger.info('DRY_RUN — blocked', { reason });
    }
    writeStepSummary({
      role: 'developer',
      iterations,
      usage,
      toolCounts: loopResult.toolCounts,
      toolCallRecords: loopResult.toolCallRecords,
      filesTouched: [],
      branchPushed: '',
      outcome: 'blocked',
    });
    appendOutput({ ...usage, model, provider: devProvider });
    process.exit(1);
  }

  // ── implemented | already_satisfied ──────────────────────────────────────
  const commitMessage = formatDeveloperCommit({
    ticketKey,
    runId: eventId,
    summary: done.summary,
  });

  let summaryFilesTouched: string[] = [];
  let summaryBranchPushed = '';

  try {
    let verificationNoteWritten = false;

    if (resolvedOutcome === 'already_satisfied') {
      const verificationDir = path.join(REPO_ROOT, '.ferry', 'verifications');
      const verificationPath = path.join(verificationDir, `${ticketKey}.md`);
      const validationLines =
        (done.validation ?? []).length > 0
          ? (done.validation ?? []).map((v) => `- \`${v.command}\`: ${v.outcome}`).join('\n')
          : '_none recorded_';
      const verificationContent = [
        `# Verification: ${ticketKey}`,
        ``,
        `**Date:** ${new Date().toISOString()}`,
        ``,
        `## Summary`,
        done.summary,
        ``,
        `## Validation`,
        validationLines,
      ].join('\n');
      await fsp.mkdir(verificationDir, { recursive: true });
      await fsp.writeFile(verificationPath, verificationContent, 'utf8');
      verificationNoteWritten = true;
    }

    execFileSync('git', ['add', '-A'], { cwd: REPO_ROOT });
    const finalStatus = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (finalStatus.trim()) {
      await secretScan();
      const msg =
        resolvedOutcome === 'already_satisfied'
          ? `chore(${ticketKey}): add verification note — spec already satisfied`
          : (done.commit_message ?? commitMessage);
      execFileSync('git', ['commit', '-m', msg], { cwd: REPO_ROOT });
    }

    if (dryRun) {
      let diffOutput = '(no local changes)';
      try {
        diffOutput = execFileSync(
          'sh',
          [
            '-c',
            'git diff HEAD~1..HEAD --stat 2>/dev/null || git show --stat HEAD 2>/dev/null || echo "(no commits yet)"',
          ],
          { cwd: REPO_ROOT, encoding: 'utf8' },
        );
      } catch {
        // best-effort
      }
      logger.info('DRY_RUN — implementation summary', {
        outcome: resolvedOutcome,
        summary: done.summary,
        diff: diffOutput,
      });
      logger.info('DRY_RUN — skipped: git push, PR creation, Jira transition, Jira comment');
      writeStepSummary({
        role: 'developer',
        iterations,
        usage,
        toolCounts: loopResult.toolCounts,
        toolCallRecords: loopResult.toolCallRecords,
        filesTouched: [],
        branchPushed: '',
        outcome: resolvedOutcome,
      });
      appendOutput({ ...usage, model, provider: devProvider });
      process.exit(0);
    }

    execFileSync('git', ['push', 'origin', branchName, '--force-with-lease'], { cwd: REPO_ROOT });
    const branchPushed = true;
    summaryBranchPushed = branchName;
    try {
      const diff = execFileSync('git', ['diff', '--name-only', `origin/${baseBranch}...HEAD`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      summaryFilesTouched = diff.trim().split('\n').filter(Boolean);
    } catch {
      // best-effort
    }

    const prTitle =
      resolvedOutcome === 'already_satisfied'
        ? `verify(${ticketKey}): existing implementation satisfies spec`
        : formatPullRequestTitle({ ticketKey, summary: issue.summary });
    const prBody = formatPullRequestBody({
      ticketKey,
      jiraBaseUrl,
      runId: eventId,
      summary: done.summary,
      subtasks,
      validation: done.validation ?? [],
      notes: done.notes ?? [],
    });

    const prUrl = await runner.createPR(owner, repo, branchName, targetBranch, prTitle, prBody);

    // Output-contract guard: verify all required outputs exist before terminal comment.
    assertDevOutputContract(resolvedOutcome, { branchPushed, prUrl, verificationNoteWritten });

    if (shouldAutoTransition) {
      await tracker.postTransition(ticketKey, reviewTransitionId);
    }
    const transitionNote = shouldAutoTransition
      ? ' Moved to Review.'
      : noAutoTransition
        ? ' FR18 auto-transition skipped (ferry:no-auto-transition).'
        : '';

    const forceOverrideName = forceLabel?.split(':').at(-1);
    const overrideNote = typeOverride
      ? ` [type override: ${JSON.stringify({ issuetype: typeOverride, issuetype_raw: issue.issueType, override: forceOverrideName })}]`
      : '';

    const terminalComment =
      resolvedOutcome === 'already_satisfied'
        ? `${idempotencyMarker} Spec already satisfied — verification PR: ${prUrl}.${transitionNote}${overrideNote}`
        : `${idempotencyMarker} Implementation complete — PR: ${prUrl}.${transitionNote}${overrideNote}`;

    await tracker.postComment(ticketKey, terminalComment);
  } catch (err) {
    if (!dryRun) {
      try {
        await tracker.postComment(
          ticketKey,
          `${idempotencyMarker} Dev run failed in post-implementation step — manual intervention required.`,
        );
      } catch {
        // best-effort comment; don't mask the original error
      }
    }
    throw err;
  }

  writeStepSummary({
    role: 'developer',
    iterations,
    usage,
    toolCounts: loopResult.toolCounts,
    toolCallRecords: loopResult.toolCallRecords,
    filesTouched: summaryFilesTouched,
    branchPushed: summaryBranchPushed,
    outcome: resolvedOutcome,
  });
  appendOutput({ ...usage, model, provider: devProvider });
  process.exit(0);
}
