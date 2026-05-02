import { execFileSync } from 'node:child_process';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
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
  createGitHubContext,
  resolveGitConfig,
  byEventId,
  runAgent,
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
import { createAnthropicAgentLoop } from '../../lib/llm/agent-loop/anthropic.js';
import type { AgentLoop } from '../../lib/llm/agent-loop/types.js';
import { resolveCapabilities, filterMcpServers } from '../../lib/labels/capabilities.js';
import { resolveAnthropicAuth } from '../../lib/llm/anthropic-auth.js';
import { detectTestRunner, repoTree, packageJsonPath } from './workspace.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const dryRun = isDryRun();
  if (dryRun) {
    logger.info('DRY_RUN mode — no branch push, no PR, no Jira writes');
  }

  const anthropicAuth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
  const { owner, repo, runner, tracker, ferryCfg } = createGitHubContext(REPO_ROOT);
  const { provider: devProvider } = ferryCfg.models.dev;
  if (devProvider !== 'anthropic') {
    throw new FerryError('state-invariant', {
      reason: 'unsupported-provider',
      provider: devProvider,
      phase: 'developer',
      detail:
        "The developer phase requires provider 'anthropic'. OpenAI and Google support for agentic phases is planned for a future release.",
    });
  }
  const devWorkflow = ferryCfg.workflow.agents.developer;
  const shouldAutoTransition = devWorkflow.auto_transition !== null;
  const reviewTransitionId =
    dryRun || !shouldAutoTransition ? '' : requireEnv('FERRY_REVIEW_TRANSITION_ID');
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');

  const issue = await tracker.getIssue(ticketKey);
  const labels = issue.labels.join(', ');
  const comments = issue.comments.map((c) => `Comment: ${c}`).join('\n');
  const ticketBlock = buildTicketBlock(ticketKey, issue, { labels, comments });

  const subtasks = await tracker.getSubtasks(ticketKey);
  const testRunner = detectTestRunner(packageJsonPath(REPO_ROOT));
  const tree = repoTree(REPO_ROOT);

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

  const system = buildSystem('dev', REPO_ROOT);
  const model = ferryCfg.models.dev.model;

  const { baseBranch, targetBranch, workingBranchPrefix } = await resolveGitConfig(
    ferryCfg,
    runner,
    owner,
    repo,
  );

  // Branch is determined upfront from the ticket key so restarts resume the same branch.
  const branchName = `${workingBranchPrefix}${ticketKey}`;

  configureFerryGitUser(REPO_ROOT);

  let resumeContext = '';
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
  } catch {
    execFileSync('git', ['checkout', '-B', branchName], { cwd: REPO_ROOT });
    logger.info('created branch', { branch: branchName });
  }

  const secretScan = makeSecretScan(REPO_ROOT);
  const mcpPool = loadMcpServers();
  const capabilities = resolveCapabilities(issue.labels, ferryCfg.labels);
  const hasLabelsConfig = ferryCfg.labels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);

  logCapabilities(logger, capabilities);
  if (mcpServers.length > 0) {
    logger.info('MCP servers', { servers: mcpServers.map((s) => s.name) });
  }

  const allToolSchemas = [...TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA, SPAWN_SUBAGENT_SCHEMA];

  let loop!: AgentLoop;
  loop = createAnthropicAgentLoop({
    ...anthropicAuth,
    model,
    maxIterations: ferryCfg.limits.max_agent_iterations,
    maxInputTokens: ferryCfg.limits.max_tokens_per_run,
    maxTokens: ferryCfg.limits.max_tokens_per_message,
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

  const { done, usage, iterations } = await loop.run({
    system,
    initialPrompt: initialPrompt + resumeContext,
    tools: allToolSchemas,
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

  const idempotencyMarker = byEventId('dev', eventId);

  if (!done.actionable) {
    if (!dryRun) {
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} Cannot implement — ${done.reason_if_not_actionable ?? 'no reason given'}`,
      );
    } else {
      logger.info('DRY_RUN — not actionable', {
        reason: done.reason_if_not_actionable ?? 'no reason given',
      });
    }
    appendOutput({ ...usage, model, provider: devProvider });
    process.exit(0);
  }

  // actionable: commit any remaining changes and push
  const commitMessage = formatDeveloperCommit({
    ticketKey,
    runId: eventId,
    summary: done.summary,
  });

  try {
    execFileSync('git', ['add', '-A'], { cwd: REPO_ROOT });
    const finalStatus = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (finalStatus.trim()) {
      await secretScan();
      execFileSync('git', ['commit', '-m', done.commit_message ?? commitMessage], {
        cwd: REPO_ROOT,
      });
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
        summary: done.summary,
        diff: diffOutput,
      });
      logger.info('DRY_RUN — skipped: git push, PR creation, Jira transition, Jira comment');
      appendOutput({ ...usage, model, provider: devProvider });
      process.exit(0);
    }

    execFileSync('git', ['push', 'origin', branchName, '--force-with-lease'], { cwd: REPO_ROOT });

    const prTitle = formatPullRequestTitle({ ticketKey, summary: done.summary });
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

    if (shouldAutoTransition) {
      await tracker.postTransition(ticketKey, reviewTransitionId);
    }
    const transitionNote = shouldAutoTransition ? ' Moved to Review.' : '';
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Implementation complete — PR: ${prUrl}.${transitionNote}`,
    );
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

  appendOutput({ ...usage, model, provider: devProvider });
  process.exit(0);
}

void runAgent('developer', main);
