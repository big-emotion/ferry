/**
 * Iterator role pre-loop setup (issue #330).
 *
 * Extracted from `src/agents/iterator/iterate-action.ts`. Builds the iterator's
 * system prompt, initial prompt, ticket block, idempotency marker, and the
 * capability-filtered MCP pool from the already-resolved state the action
 * computed (head SHA, latest review comment, merge conflicts from
 * `fetchAndMergeBase`, existing-log output).
 *
 * The action keeps the side-effecting branch checkout (`checkoutExistingBranch`
 * + `fetchAndMergeBase`) inline because they short-circuit the action with a
 * Jira comment when the branch is absent — that exit semantic is intentionally
 * kept where it lives.
 */

import { delimitUntrusted } from '../llm/delimit-untrusted.js';
import { buildSystem as defaultBuildSystem, buildTicketBlock } from './prompt.js';
import { filterMcpServers, type ResolvedCapabilities } from '../labels/capabilities.js';
import type { LabelCapability } from '../config.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { RolePreparedContextBase } from './prepare.js';

export interface PrepareIteratorInput {
  ticketKey: string;
  issue: TrackerIssue;
  /** Full PR head SHA — first 7 chars are the idempotency anchor. */
  headSha: string;
  /** Latest reviewer findings body (already verified non-empty, non-approved by the caller). */
  reviewComment: string;
  /** Conflicted files returned by `fetchAndMergeBase`. Empty array = no conflicts. */
  mergeConflicts: string[];
  /** Trimmed `git log origin/<base>..HEAD --oneline` output. Empty = no prior commits. */
  existingLog: string;
  mcpPool: McpServerConfig[];
  configLabels: Record<string, LabelCapability> | undefined;
  /**
   * Resolved capabilities — computed once by the caller before any early-return
   * gate so capability telemetry is emitted on every invocation, not only when
   * we reach the loop. The single source of `capabilities` lives in the action.
   */
  capabilities: ResolvedCapabilities;
  /**
   * `[ferry:iterator:<sha7>]` marker computed once by the caller (it must be
   * computed BEFORE the action's idempotency-skip gate, so we just thread the
   * same value into prepare to keep a single source of truth — per
   * `RolePreparedContextBase`).
   */
  idempotencyMarker: string;
  typeOverride: string | undefined;
  repoRoot: string;
  /** Test seam — defaults to the real `buildSystem`. */
  _buildSystem?: typeof defaultBuildSystem;
}

export type IteratorPreparedContext = RolePreparedContextBase;

export function prepareIterator(input: PrepareIteratorInput): IteratorPreparedContext {
  const {
    ticketKey,
    issue,
    reviewComment,
    mergeConflicts,
    existingLog,
    mcpPool,
    configLabels,
    capabilities,
    idempotencyMarker,
    typeOverride,
    repoRoot,
  } = input;
  const buildSystem = input._buildSystem ?? defaultBuildSystem;

  const system = buildSystem('iterate', repoRoot);

  const ticketBlock = buildTicketBlock(ticketKey, issue, { typeOverride });

  const initialPrompt = [
    '## Jira Ticket',
    delimitUntrusted(ticketBlock),
    '',
    '## Review Findings (fix only what is listed here)',
    delimitUntrusted(reviewComment),
    '',
    mergeConflicts.length > 0
      ? `## Merge Conflicts (resolve these first, before fixing review findings)\n${mergeConflicts.map((f) => `- ${f}`).join('\n')}`
      : '',
    existingLog ? `## Existing commits on branch\n${existingLog}` : '',
    '',
    'When you have fixed all findings, call the `done` tool.',
  ]
    .filter(Boolean)
    .join('\n');

  const hasLabelsConfig = configLabels !== undefined;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);

  return {
    system,
    initialPrompt,
    mcpServers,
    idempotencyMarker,
    ticketBlock,
    capabilities,
  };
}
