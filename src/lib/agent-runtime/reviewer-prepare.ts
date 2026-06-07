/**
 * Reviewer role pre-loop setup (issue #330).
 *
 * Extracted from `src/agents/reviewer/review-action.ts`. Builds the reviewer's
 * system prompt (with optional review-comment overlay and rubric override),
 * the initial prompt with PR metadata + commits + changed files, the
 * idempotency marker keyed on PR head SHA, and the filename→patch map the
 * review loop consumes.
 *
 * The action keeps PR resolution + CI gating + idempotency-skip checks inline
 * because they short-circuit with Jira/PR comments and have role-specific exit
 * semantics. This prepare function runs *after* those gates have been passed.
 */

import { delimitUntrusted } from '../llm/delimit-untrusted.js';
import {
  buildSystem as defaultBuildSystem,
  buildTicketBlock,
  loadOptionalPrompt as defaultLoadOptionalPrompt,
} from './prompt.js';
import {
  type ResolvedCapabilities,
  type TicketOverrides,
  filterMcpServers,
} from '../labels/capabilities.js';
import { applyRubricToPrompt, detectMergeConflicts, buildFileList } from './reviewer-helpers.js';
import type { LabelCapability } from '../config.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { PR, PRFile } from '../dispatch/runner/types.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { RolePreparedContextBase } from './prepare.js';

export interface PrepareReviewerInput {
  ticketKey: string;
  issue: TrackerIssue;
  pr: PR;
  files: PRFile[];
  commits: Array<{ sha: string; message: string }>;
  branchName: string;
  typeOverride: string | undefined;
  reviewRubric: TicketOverrides['reviewRubric'];
  /**
   * Resolved capabilities — computed once by the caller before any early-return
   * gate so capability telemetry is emitted on every invocation. The single
   * source of `capabilities` lives in the action.
   */
  capabilities: ResolvedCapabilities;
  /**
   * `[ferry:reviewer:<sha7>]` marker computed once by the caller (it must be
   * computed BEFORE the action's idempotency-skip gate; we just thread the
   * same value into prepare to keep a single source of truth — per
   * `RolePreparedContextBase`).
   */
  idempotencyMarker: string;
  repoRoot: string;
  /**
   * Full MCP server pool to filter by capabilities. When provided together
   * with `configLabels`, the returned `mcpServers` is the capability-filtered
   * subset. When omitted (legacy / test), returns an empty list.
   */
  mcpPool?: McpServerConfig[];
  /**
   * `effectiveCfg.labels` — used to determine whether a labels section exists.
   * When undefined (no labels in ferry.config), filterMcpServers returns the
   * full pool unfiltered (backward-compatible with pre-label configs).
   */
  configLabels?: Record<string, LabelCapability>;
  /** Test seam — defaults to the real `buildSystem`. */
  _buildSystem?: typeof defaultBuildSystem;
  /** Test seam — defaults to the real `loadOptionalPrompt`. */
  _loadOptionalPrompt?: typeof defaultLoadOptionalPrompt;
}

export interface ReviewerPreparedContext extends RolePreparedContextBase {
  /** filename → patch map consumed by the review loop's `get_file_patch` handler. */
  fileMap: Map<string, string | undefined>;
}

export function prepareReviewer(input: PrepareReviewerInput): ReviewerPreparedContext {
  const {
    ticketKey,
    issue,
    pr,
    files,
    commits,
    branchName,
    typeOverride,
    reviewRubric,
    capabilities,
    idempotencyMarker,
    repoRoot,
    mcpPool,
    configLabels,
  } = input;
  const buildSystem = input._buildSystem ?? defaultBuildSystem;
  const loadOptionalPrompt = input._loadOptionalPrompt ?? defaultLoadOptionalPrompt;

  const headSha = pr.headSha;
  const prNumber = pr.number;

  // file map + merge-conflict detection mirror the original review-action exactly
  const fileMap = new Map<string, string | undefined>(files.map((f) => [f.filename, f.patch]));
  const conflictedFiles = detectMergeConflicts(files);
  const hasMergeConflicts = pr.mergeable === false || conflictedFiles.length > 0;

  const commitLog = commits
    .map((c) => `${c.sha.slice(0, 7)} ${c.message.split('\n')[0]}`)
    .join('\n');

  const ticketBlock = buildTicketBlock(ticketKey, issue, { typeOverride });

  const mergeConflictWarning = hasMergeConflicts
    ? `\n⚠️  MERGE CONFLICTS DETECTED — mergeable=${String(pr.mergeable)}${conflictedFiles.length > 0 ? `, conflicted files: ${conflictedFiles.join(', ')}` : ''}`
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
    'When you have enough information, call done.',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const baseSystem = buildSystem('review', repoRoot, {
    extraParts: [loadOptionalPrompt('review-comment', repoRoot)],
    separator: '\n\n---\n\n',
  });
  const system = applyRubricToPrompt(baseSystem, reviewRubric);

  const hasLabelsConfig = configLabels !== undefined;
  const mcpServers: McpServerConfig[] =
    mcpPool !== undefined ? filterMcpServers(mcpPool, capabilities, hasLabelsConfig) : [];

  return {
    system,
    initialPrompt,
    mcpServers,
    idempotencyMarker,
    ticketBlock,
    capabilities,
    fileMap,
  };
}
