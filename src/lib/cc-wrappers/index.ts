/**
 * Deterministic execution-path routing for Ferry agent runs (ADR-0006 §3).
 *
 * Decides whether an agent run takes the bundled-script path or the
 * `claude-code-action` path, and records *why*. All exports come from the
 * pure `./routing.js` resolver.
 */
export {
  resolveExecutionPath,
  isAnthropicOnlyConfig,
  formatExecutionPathAudit,
  markerRoleToken,
} from './routing.js';
export type {
  ExecutionPathDecision,
  ExecutionPathReason,
  ExecutionPathInput,
  AgentOutputRole,
} from './routing.js';
