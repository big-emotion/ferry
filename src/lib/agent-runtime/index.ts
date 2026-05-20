export { requireEnv, loadMcpServers } from './env.js';
export { runAgent } from './run-agent.js';
export type { AgentRole } from './run-agent.js';
export { byEventId, byPrHeadSha, byReviewCommentId } from './idempotency.js';
export { buildSystem, loadOptionalPrompt, buildTicketBlock } from './prompt.js';
export { appendOutput } from './output.js';
export { writeStepSummary } from './step-summary.js';
export type { AgentRunStats, ToolCallRecord } from './step-summary.js';
export {
  configureFerryGitUser,
  makeCommitProgress,
  fetchOriginBranch,
  fetchAndMergeBase,
  checkoutExistingBranch,
  remoteBranchExists,
} from './git.js';
export type { CommitProgressFn } from './git.js';
export { loadFerryConfigFromBaseBranch } from './config-reload.js';
export { makeSecretScan } from './secret-scan.js';
export { logCapabilities, logTypeOverrides, logTicketOverrides } from './labels.js';
export { createGitHubContext } from './context.js';
export type { GitHubContext } from './context.js';
export { resolveGitConfig, resolveBranchPrefix } from './resolve-git-config.js';
export type { ResolvedGitConfig } from './resolve-git-config.js';
export { createLogger } from '../logger/index.js';
export type { Logger } from '../logger/index.js';

// Label utilities — agents must import these through agent-runtime, not directly from labels/.
export {
  resolveCapabilities,
  filterMcpServers,
  resolveTypeOverrides,
} from '../labels/capabilities.js';
export type {
  TicketOverrides,
  AgentPhase,
  PhaseModelOverride,
  ResolvedCapabilities,
} from '../labels/capabilities.js';
export {
  LabelConflictError,
  resolveTicketOverrides,
  applyTicketOverrides,
  hasNonDefaultOverrides,
  buildOverridesAuditComment,
  buildConflictComment,
  applyDryRunMarker,
} from '../labels/overrides.js';

// Per-role pre-loop setup (issue #330). Each agent's *-action.ts delegates the
// stateful, side-effect-light setup chunk (system + initialPrompt + MCP filter
// + idempotency marker + branch/PR probe) to these prepare functions, so the
// future cc-prepare composite can feed `buildClaudeCodeJob` from the same
// source. The shared base type lives in ./prepare.
export type { RolePreparedContextBase } from './prepare.js';
export { prepareRefiner } from './refiner-prepare.js';
export type { PrepareRefinerInput, RefinerPreparedContext } from './refiner-prepare.js';
export { prepareDeveloper, checkoutOrCreateBranchDefault } from './developer-prepare.js';
export type {
  PrepareDeveloperInput,
  DeveloperPreparedContext,
  BranchCheckoutResult,
  CheckoutOrCreateBranchFn,
} from './developer-prepare.js';
export { prepareReviewer } from './reviewer-prepare.js';
export type { PrepareReviewerInput, ReviewerPreparedContext } from './reviewer-prepare.js';
export { prepareIterator } from './iterator-prepare.js';
export type { PrepareIteratorInput, IteratorPreparedContext } from './iterator-prepare.js';
