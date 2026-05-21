/**
 * Deterministic contract wrapper steps for the claude-code execution path
 * (ADR-0006 §2, issue #301). Public surface consumed by the action job (#302).
 */
export { validateAgentOutput } from './agent-output.js';
export type {
  AgentOutputV1,
  AgentOutputRole,
  DeveloperAgentOutput,
  IteratorAgentOutput,
  ReviewerAgentOutput,
  DeveloperOutcome,
  ReviewerVerdict,
} from './agent-output.js';

export { decideContract, markerRoleToken, resolveContractMarker } from './contract.js';
export type {
  ContractDecision,
  ContractContext,
  MarkerContext,
  TransitionPlan,
  TransitionIdEnv,
} from './contract.js';

export { applyContract, checkContractIdempotency } from './apply.js';
export type { ApplyContractDeps, ApplyContractResult } from './apply.js';

export {
  resolveExecutionPath,
  isAnthropicOnlyConfig,
  formatExecutionPathAudit,
} from './routing.js';
export type { ExecutionPathDecision, ExecutionPathReason, ExecutionPathInput } from './routing.js';
