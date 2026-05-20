/**
 * Developer role pre-loop setup (issue #330).
 *
 * Extracted from `src/agents/developer/dev-action.ts`. Builds the developer
 * system prompt, ticket block, initial prompt, capability-filtered MCP pool,
 * idempotency marker, and (best-effort) existing-PR context. Performs the
 * branch checkout / create via an injectable helper so the function stays
 * testable without spinning up git.
 *
 * The action calls this AFTER label-override resolution, base/target branch
 * validation, and any `process.exit` short-circuits — the prepare function
 * has no Jira side effects, no `process.exit`, and only the git/GitHub reads
 * the dev workflow has always performed.
 */

import { execFileSync } from 'node:child_process';
import { delimitUntrusted } from '../llm/delimit-untrusted.js';
import { configureFerryGitUser as defaultConfigureFerryGitUser } from './git.js';
import { byEventId, byPrHeadSha } from './idempotency.js';
import { buildSystem as defaultBuildSystem, buildTicketBlock } from './prompt.js';
import { resolveBranchPrefix } from './resolve-git-config.js';
import {
  resolveCapabilities,
  filterMcpServers,
  type ResolvedCapabilities,
} from '../labels/capabilities.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { CIRunner } from '../dispatch/runner/types.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { FerryConfig } from '../config.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';
import type { Logger } from '../logger/index.js';
import type { RolePreparedContextBase } from './prepare.js';

export interface BranchCheckoutResult {
  /** HEAD SHA after checkout, or "" when a fresh branch was just created. */
  branchHeadSha: string;
  /** Trimmed `git log origin/<base>..HEAD --oneline` — empty if no prior commits. */
  existingLog: string;
}

export type CheckoutOrCreateBranchFn = (
  branchName: string,
  baseBranch: string,
  repoRoot: string,
  logger: Logger,
) => BranchCheckoutResult;

/**
 * Default branch checkout: try to fetch/checkout the existing branch on
 * origin; on any failure create a fresh local branch from the current HEAD.
 * Mirrors the original inline logic in `dev-action.ts` verbatim.
 */
export const checkoutOrCreateBranchDefault: CheckoutOrCreateBranchFn = (
  branchName,
  baseBranch,
  repoRoot,
  logger,
) => {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', branchName], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    execFileSync('git', ['fetch', 'origin', branchName], { cwd: repoRoot });
    execFileSync('git', ['checkout', branchName], { cwd: repoRoot });
    const existingLog = execFileSync('git', ['log', `origin/${baseBranch}..HEAD`, '--oneline'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    if (existingLog) {
      logger.info('resuming branch', {
        branch: branchName,
        prior_commits: existingLog.split('\n').length,
      });
    }
    const branchHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    return { branchHeadSha, existingLog };
  } catch {
    execFileSync('git', ['checkout', '-B', branchName], { cwd: repoRoot });
    logger.info('created branch', { branch: branchName });
    return { branchHeadSha: '', existingLog: '' };
  }
};

export interface PrepareDeveloperInput {
  envelope: EventEnvelopeV1;
  issue: TrackerIssue;
  effectiveCfg: FerryConfig;
  /** From `tracker.getSubtasks(ticketKey)` — already fetched by the action. */
  subtasks: string[];
  /** From `detectTestRunner(packageJsonPath(...))`. */
  testRunner: string;
  /** From `detectPackageManager(...)`; null/undefined hide the extra system-prompt part. */
  pkgManagerHint: string | null | undefined;
  /** From `repoTree(...)`. */
  tree: string;
  typeOverride: string | undefined;
  owner: string;
  repo: string;
  baseBranch: string;
  runner: CIRunner;
  mcpPool: McpServerConfig[];
  repoRoot: string;
  dryRun: boolean;
  logger: Logger;
  /** Test seam — defaults to the real `buildSystem`. */
  _buildSystem?: typeof defaultBuildSystem;
  /** Test seam — defaults to executing git commands. */
  _checkoutOrCreateBranch?: CheckoutOrCreateBranchFn;
  /** Test seam — defaults to `configureFerryGitUser`. */
  _configureGitUser?: (repoRoot: string) => void;
}

export interface DeveloperPreparedContext extends RolePreparedContextBase {
  capabilities: ResolvedCapabilities;
  /** Working branch name derived from `working_branch_prefix` + ticket key. */
  branchName: string;
  /** Empty when a fresh branch was just created; otherwise the HEAD SHA. */
  branchHeadSha: string;
  /** Empty when no open Ferry PR exists on the branch (or dry-run skipped the probe). */
  existingPrUrl: string;
  /** Original (pre-concatenation) initial prompt — exposed for the cc-prepare composite. */
  baseInitialPrompt: string;
  /** Subtasks list — forwarded for downstream PR-body construction. */
  subtasks: string[];
}

export async function prepareDeveloper(
  input: PrepareDeveloperInput,
): Promise<DeveloperPreparedContext> {
  const {
    envelope,
    issue,
    effectiveCfg,
    subtasks,
    testRunner,
    pkgManagerHint,
    tree,
    typeOverride,
    owner,
    repo,
    baseBranch,
    runner,
    mcpPool,
    repoRoot,
    dryRun,
    logger,
  } = input;
  const buildSystem = input._buildSystem ?? defaultBuildSystem;
  const checkoutOrCreateBranch = input._checkoutOrCreateBranch ?? checkoutOrCreateBranchDefault;
  const configureGitUser = input._configureGitUser ?? defaultConfigureFerryGitUser;

  const ticketKey = envelope.ticket_key;
  const eventId = envelope.event_id;

  const labels = issue.labels.join(', ');
  const comments = issue.comments.map((c) => `Comment: ${c}`).join('\n');
  const ticketBlock = buildTicketBlock(ticketKey, issue, {
    labels,
    comments,
    typeOverride,
  });

  const system = buildSystem('dev', repoRoot, {
    extraParts: pkgManagerHint ? [`## Detected package manager\n\n${pkgManagerHint}`] : [],
  });

  // Branch is determined upfront from the ticket key so restarts resume the same branch.
  const branchName = `${resolveBranchPrefix(effectiveCfg.git.working_branch_prefix, issue)}${ticketKey}`;

  configureGitUser(repoRoot);

  const { branchHeadSha, existingLog } = checkoutOrCreateBranch(
    branchName,
    baseBranch,
    repoRoot,
    logger,
  );

  const resumeContext = existingLog
    ? `\nEXISTING WORK ON BRANCH (already committed — skip these, only do what remains):\n${existingLog}`
    : '';

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
    ? byPrHeadSha('dev', branchHeadSha)
    : byEventId('dev', eventId);

  const baseInitialPrompt = [
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

  const initialPrompt = baseInitialPrompt + resumeContext + existingPrContext;

  const capabilities = resolveCapabilities(issue.labels, effectiveCfg.labels);
  const hasLabelsConfig = effectiveCfg.labels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);

  return {
    system,
    initialPrompt,
    baseInitialPrompt,
    mcpServers,
    idempotencyMarker,
    ticketBlock,
    subtasks,
    capabilities,
    branchName,
    branchHeadSha,
    existingPrUrl,
  };
}
