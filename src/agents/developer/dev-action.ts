import { execSync } from 'node:child_process';
import { validateEnvelope } from '../../lib/envelope/validate.js';
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
  byEventId,
} from '../../lib/agent-runtime/index.js';
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
import { detectTestRunner, repoTree, packageJsonPath } from './workspace.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const reviewTransitionId = requireEnv('FERRY_REVIEW_TRANSITION_ID');
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');
  const { owner, repo, runner, tracker, ferryCfg } = createGitHubContext(REPO_ROOT);

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

  // Branch is determined upfront from the ticket key so restarts resume the same branch.
  const branchName = `ferry/${ticketKey}`;

  configureFerryGitUser(REPO_ROOT);

  let resumeContext = '';
  try {
    execSync(`git ls-remote --exit-code --heads origin ${branchName}`, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    execSync(`git fetch origin ${branchName}`, { cwd: REPO_ROOT });
    execSync(`git checkout ${branchName}`, { cwd: REPO_ROOT });
    const existingLog = execSync('git log origin/main..HEAD --oneline', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    if (existingLog) {
      resumeContext = `\nEXISTING WORK ON BRANCH (already committed — skip these, only do what remains):\n${existingLog}`;
      console.error(
        `[ferry:dev-action] resuming branch ${branchName} — ${existingLog.split('\n').length} prior commit(s)`,
      );
    }
  } catch {
    execSync(`git checkout -B ${branchName}`, { cwd: REPO_ROOT });
    console.error(`[ferry:dev-action] created branch ${branchName}`);
  }

  const secretScan = makeSecretScan(REPO_ROOT);
  const mcpPool = loadMcpServers();
  const capabilities = resolveCapabilities(issue.labels, ferryCfg.labels);
  const hasLabelsConfig = ferryCfg.labels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);

  logCapabilities('[ferry:dev-action]', capabilities);
  if (mcpServers.length > 0) {
    console.error(`[ferry:dev-action] MCP servers: ${mcpServers.map((s) => s.name).join(', ')}`);
  }

  const allToolSchemas = [...TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA, SPAWN_SUBAGENT_SCHEMA];

  let loop!: AgentLoop;
  loop = createAnthropicAgentLoop({
    apiKey: anthropicApiKey,
    model,
    maxIterations: ferryCfg.limits.max_agent_iterations,
    maxInputTokens: ferryCfg.limits.max_tokens_per_run,
    maxTokens: ferryCfg.limits.max_tokens_per_message,
    executeTool,
    commitProgress: makeCommitProgress('[ferry:dev-action]'),
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

  console.error(
    `[ferry:dev-action] done in ${iterations} iterations — actionable=${done.actionable} in=${usage.input_tokens} cache_w=${usage.cache_creation_input_tokens} cache_r=${usage.cache_read_input_tokens} out=${usage.output_tokens}`,
  );

  const idempotencyMarker = byEventId('dev', eventId);

  if (!done.actionable) {
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Cannot implement — ${done.reason_if_not_actionable ?? 'no reason given'}`,
    );
    appendOutput(usage);
    process.exit(0);
  }

  // actionable: commit any remaining changes and push
  const commitMessage = formatDeveloperCommit({
    ticketKey,
    runId: eventId,
    summary: done.summary,
  });

  try {
    execSync('git add -A', { cwd: REPO_ROOT });
    const finalStatus = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' });
    if (finalStatus.trim()) {
      await secretScan();
      execSync(`git commit -m ${JSON.stringify(done.commit_message ?? commitMessage)}`, {
        cwd: REPO_ROOT,
      });
    }
    execSync(`git push origin ${branchName} --force-with-lease`, { cwd: REPO_ROOT });

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

    const prUrl = await runner.createPR(owner, repo, branchName, 'main', prTitle, prBody);

    await tracker.postTransition(ticketKey, reviewTransitionId);
    await tracker.postComment(
      ticketKey,
      `${idempotencyMarker} Implementation complete — PR: ${prUrl}. Moved to Review.`,
    );
  } catch (err) {
    try {
      await tracker.postComment(
        ticketKey,
        `${idempotencyMarker} Dev run failed in post-implementation step — manual intervention required.`,
      );
    } catch {
      // best-effort comment; don't mask the original error
    }
    throw err;
  }

  appendOutput(usage);
  process.exit(0);
}

main().catch((err) => {
  console.error('[ferry:dev-action] fatal:', (err as Error).message);
  process.exit(1);
});
