/**
 * Deterministic execution-path resolver (ADR-0006 §3, issue #300).
 *
 * Decides whether an agent run takes the bundled-script path or the
 * `claude-code-action` path, and records *why*. The function is **pure**:
 * the caller supplies the resolved gating inputs (config-derived provider
 * fact, the per-ticket label override from `resolveTicketOverrides`, and the
 * prior round-trip count derived from audit comments — the same mechanism
 * `cc-wrappers/contract.ts` uses for `priorIterations`). No IO, no clock.
 *
 * Resolution order (highest precedence first), per ADR-0006 §3:
 *   1. Explicit `execution_path: script` in ferry.config — a **hard lock**;
 *      never overridden by the label or the heuristic.
 *   2. Per-ticket Jira label (`ferry:claude-code` / `ferry:no-claude-code`).
 *      Conflicting labels are already collapsed to the safe `script` path by
 *      `resolveTicketOverrides` (no `LabelConflictError`).
 *   3. Automatic heuristic — escalates an *otherwise-script* default to
 *      claude-code when `role ∈ {developer, iterator}` AND
 *      `priorRoundTrips >= N`.
 *   4. Conditional default — explicit `claude-code`, else `claude-code` for
 *      an Anthropic-only consumer, else `script`.
 *
 * The recorded reason (`label` / `heuristic` / `default`) is emitted into the
 * audit comment marker by `formatExecutionPathAudit` so the Reconciler
 * (ADR-0004) observes which path ran and why.
 */
import type { ExecutionPath, FerryConfig } from '../config.js';
import type { AgentOutputRole } from './agent-output.js';
import { markerRoleToken } from './contract.js';

export type ExecutionPathReason = 'label' | 'heuristic' | 'default';

export interface ExecutionPathDecision {
  path: ExecutionPath;
  reason: ExecutionPathReason;
}

export interface ExecutionPathInput {
  /**
   * `ferry.config.execution_path`. `undefined` → the conditional default
   * applies; `'script'` → hard lock; `'claude-code'` → explicit but still
   * adjustable by the per-ticket label.
   */
  configuredPath: ExecutionPath | undefined;
  /** True when every configured agent provider is Anthropic (see `isAnthropicOnlyConfig`). */
  anthropicOnly: boolean;
  /**
   * Per-ticket override resolved from `ferry:claude-code` /
   * `ferry:no-claude-code` (`TicketOverrides.claudeCodePath`). Conflicting
   * labels arrive already collapsed to `'script'`.
   */
  labelOverride?: ExecutionPath;
  role: AgentOutputRole;
  /** Prior Ferry round-trips for this ticket (caller derives from audit comments). */
  priorRoundTrips: number;
  /** Heuristic round-trip threshold N (`routing.claude_code_round_trip_threshold`). */
  roundTripThreshold: number;
}

/** Roles eligible for the automatic claude-code escalation heuristic (ADR-0006 §3.2). */
const HEURISTIC_ROLES: ReadonlySet<AgentOutputRole> = new Set(['developer', 'iterator']);

/**
 * True when all four configured agent providers are Anthropic — the
 * precondition for the claude-code conditional default (ADR-0006 §1). A
 * single OpenAI/Google agent keeps the consumer on the multi-provider
 * script path.
 */
export function isAnthropicOnlyConfig(cfg: FerryConfig): boolean {
  const m = cfg.models;
  return (
    m.refiner.provider === 'anthropic' &&
    m.dev.provider === 'anthropic' &&
    m.review.provider === 'anthropic' &&
    m.iterate.provider === 'anthropic'
  );
}

/** Pure, deterministic execution-path decision. See module doc for precedence. */
export function resolveExecutionPath(input: ExecutionPathInput): ExecutionPathDecision {
  // 1. Explicit `execution_path: script` is a hard lock — never overridden.
  if (input.configuredPath === 'script') {
    return { path: 'script', reason: 'default' };
  }

  // 2. Per-ticket Jira label (conflicting pair already collapsed to 'script').
  if (input.labelOverride !== undefined) {
    return { path: input.labelOverride, reason: 'label' };
  }

  // 3/4. Conditional default, then heuristic escalation of a script default.
  const defaultPath: ExecutionPath =
    input.configuredPath === 'claude-code' || input.anthropicOnly ? 'claude-code' : 'script';

  if (
    defaultPath === 'script' &&
    HEURISTIC_ROLES.has(input.role) &&
    input.roundTripThreshold > 0 &&
    input.priorRoundTrips >= input.roundTripThreshold
  ) {
    return { path: 'claude-code', reason: 'heuristic' };
  }

  return { path: defaultPath, reason: 'default' };
}

/**
 * Formats the execution-path decision as a fingerprinted audit-comment line
 * following the standard `[ferry:<role>:<run-id>] …` convention (developer
 * uses the `dev` marker token for script parity). Consumed by the contract
 * apply step on the claude-code path so the resolved route + reason land in
 * the audit log.
 */
export function formatExecutionPathAudit(
  role: AgentOutputRole,
  runId: string,
  decision: ExecutionPathDecision,
): string {
  return `[ferry:${markerRoleToken(role)}:${runId}] execution-path: ${decision.path} (reason: ${decision.reason})`;
}
