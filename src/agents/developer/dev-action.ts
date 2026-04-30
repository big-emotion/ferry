import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import * as path from 'node:path';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/llm/delimit-untrusted.js';
import { createTrackerFromEnv } from '../../lib/io/tracker/factory.js';
import { scanWithGitleaks } from '../../lib/safety/scan.js';
import { FerryError } from '../../lib/errors/index.js';
import { GitHubActionsRunner } from '../../lib/dispatch/runner/github-actions/index.js';
import { formatDeveloperCommit } from './commit.js';
import { formatPullRequestTitle, formatPullRequestBody } from './pr.js';
import {
  TOOL_SCHEMAS,
  COMMIT_PROGRESS_SCHEMA,
  SPAWN_SUBAGENT_SCHEMA,
  executeTool,
} from './tools.js';
import { createAnthropicAgentLoop } from '../../lib/llm/agent-loop/anthropic.js';
import type { AgentLoop, McpServerConfig } from '../../lib/llm/agent-loop/types.js';
import { loadFerryConfig } from '../../lib/config.js';
import { resolvePromptPath, loadProjectSnippet } from '../../lib/prompts/resolve.js';
import { resolveCapabilities, filterMcpServers } from '../../lib/labels/capabilities.js';
import { resolveAnthropicAuth } from '../../lib/llm/anthropic-auth.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

function loadMcpServers(): McpServerConfig[] {
  const raw = process.env.AGENT_MCP_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is McpServerConfig =>
        s !== null &&
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>).name === 'string' &&
        typeof (s as Record<string, unknown>).url === 'string',
    );
  } catch {
    return [];
  }
}

function detectTestRunner(packageJsonPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<
      string,
      string
    >;
    if (deps.vitest) return 'vitest';
    if (deps.jest) return 'jest';
    if (deps.mocha) return 'mocha';
    if (deps.ava) return 'ava';
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    if (Object.values(scripts).some((s) => s.includes('node:test'))) return 'node:test';
    return 'none';
  } catch {
    return 'none';
  }
}

function repoTree(repoRoot: string): string {
  try {
    return execFileSync(
      'find',
      [
        repoRoot,
        '-maxdepth',
        '2',
        '-not',
        '-path',
        '*/node_modules/*',
        '-not',
        '-path',
        '*/.git/*',
      ],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .join('\n');
  } catch {
    return '(unavailable)';
  }
}

async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const anthropicAuth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
  const reviewTransitionId = requireEnv('FERRY_REVIEW_TRANSITION_ID');
  const githubToken = requireEnv('GITHUB_TOKEN');
  const githubRepo = requireEnv('GITHUB_REPO');
  const jiraBaseUrl = requireEnv('FERRY_JIRA_BASE_URL');

  const [owner, repo] = githubRepo.split('/');
  if (!owner || !repo) {
    throw new FerryError('state-invariant', { reason: 'invalid-github-repo', githubRepo });
  }

  const runner = new GitHubActionsRunner(githubToken, owner, repo);
  const tracker = createTrackerFromEnv();
  const issue = await tracker.getIssue(ticketKey);
  const description = issue.description;
  const comments = issue.comments.map((c) => `Comment: ${c}`).join('\n');
  const labels = issue.labels.join(', ');

  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.summary}`,
    `TYPE: ${issue.issueType}`,
    `LABELS: ${labels || 'none'}`,
    `DESCRIPTION:\n${description}`,
    comments ? `COMMENTS:\n${comments}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const subtasks = await tracker.getSubtasks(ticketKey);
  const testRunner = detectTestRunner(path.join(REPO_ROOT, 'package.json'));
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

  const systemBase = readFileSync(resolvePromptPath('dev', REPO_ROOT), 'utf8');
  const projectSnippet = loadProjectSnippet(REPO_ROOT);
  const system = projectSnippet
    ? `${systemBase}\n\n## Project conventions\n\n${projectSnippet}`
    : systemBase;
  const ferryCfg = loadFerryConfig(REPO_ROOT);
  const model = ferryCfg.models.dev.model;

  // Branch is determined upfront from the ticket key so restarts resume the same branch.
  const branchName = `ferry/${ticketKey}`;

  execSync('git config user.name "ferry-bot"', { cwd: REPO_ROOT });
  execSync('git config user.email "ferry-bot@users.noreply.github.com"', { cwd: REPO_ROOT });

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

  const secretScan = async () => {
    const scanResult = await scanWithGitleaks({
      path: REPO_ROOT,
      binaryPath: process.env.GITLEAKS_PATH ?? 'gitleaks',
    });
    if (scanResult.leaksFound) {
      throw new FerryError('state-invariant', {
        reason: 'secret-scan-hit',
        findings: scanResult.findings.length,
      });
    }
  };

  const allToolSchemas = [...TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA, SPAWN_SUBAGENT_SCHEMA];
  const mcpPool = loadMcpServers();
  const capabilities = resolveCapabilities(issue.labels, ferryCfg.labels);
  const hasLabelsConfig = ferryCfg.labels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);

  if (capabilities.triggeredLabels.length > 0) {
    console.error(
      `[ferry:dev-action] label capabilities: labels=[${capabilities.triggeredLabels.join(',')}] mcp=[${capabilities.mcpServerNames.join(',')}]`,
    );
  }
  if (capabilities.unknownFerryLabels.length > 0) {
    console.error(
      `[ferry:dev-action] unknown ferry labels (ignored): ${capabilities.unknownFerryLabels.join(', ')}`,
    );
  }
  if (mcpServers.length > 0) {
    console.error(`[ferry:dev-action] MCP servers: ${mcpServers.map((s) => s.name).join(', ')}`);
  }

  let loop!: AgentLoop;
  loop = createAnthropicAgentLoop({
    ...anthropicAuth,
    model,
    maxIterations: ferryCfg.limits.max_agent_iterations,
    maxInputTokens: ferryCfg.limits.max_tokens_per_run,
    maxTokens: ferryCfg.limits.max_tokens_per_message,
    executeTool,
    commitProgress: async (repoRoot, branchName, message, scan) => {
      execSync('git add -A', { cwd: repoRoot });
      const status = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
      if (!status.trim()) return 'nothing to commit';
      await scan();
      execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: repoRoot });
      execSync(`git push origin ${branchName} --force-with-lease`, { cwd: repoRoot });
      console.error(`[ferry:dev-action] checkpoint: ${message.slice(0, 80)}`);
      return 'committed and pushed';
    },
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

  const idempotencyMarker = `[ferry:dev:${eventId}]`;

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
      tldr: done.summary,
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

function appendOutput(usage: { input_tokens: number; output_tokens: number }): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(
      githubOutput,
      `input_tokens=${usage.input_tokens}\noutput_tokens=${usage.output_tokens}\n`,
    );
  }
}

main().catch((err) => {
  console.error('[ferry:dev-action] fatal:', (err as Error).message);
  process.exit(1);
});
