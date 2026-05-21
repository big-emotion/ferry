/**
 * Deterministic execution-path resolver (ADR-0006 §3, issue #300).
 *
 * Decides whether an agent run takes the bundled-script path or the
 * `claude-code-action` path, and records *why*. The function is **pure**:
 * the caller supplies the resolved gating inputs (config-derived provider
 * fact, the per-ticket label override from `resolveTicketOverrides`, and the
 * prior round-trip count derived from audit comments). No IO, no clock.
 *
 * Resolution order (highest precedence first), per ADR-0006 §3:
 *   1. Explicit `execution_path: script` in ferry.config — a **hard lock**;
 *      never overridden by the label or the heuristic.
 *   2. Provider gate — when `anthropicOnly === false`, returns `script` with
 *      reason `'provider-gate'`; the per-ticket label override is ignored (the
 *      caller is responsible for emitting a warn). Invariant: the claude-code
 *      path is unavailable when any agent provider is not Anthropic (ADR-0006
 *      §1, §6, issue #329).
 *   3. Per-ticket Jira label (`ferry:claude-code` / `ferry:no-claude-code`).
 *      Conflicting labels are already collapsed to the safe `script` path by
 *      `resolveTicketOverrides` (no `LabelConflictError`).
 *   4. Automatic heuristic — escalates an *otherwise-script* default to
 *      claude-code when `role ∈ {developer, iterator}` AND
 *      `priorRoundTrips >= N`. NOTE: with step 2 in place this branch is only
 *      reachable when `anthropicOnly === true`, which already yields a
 *      `claude-code` conditional default — the heuristic is currently dead code.
 *      Retained for forward compatibility if the provider gate is ever relaxed.
 *   5. Conditional default — explicit `claude-code`, else `claude-code` for
 *      an Anthropic-only consumer, else `script`.
 *
 * The recorded reason (`label` / `heuristic` / `default` / `provider-gate`) is
 * emitted into the audit comment marker by `formatExecutionPathAudit` so the
 * Reconciler (ADR-0004) observes which path ran and why.
 */
import type { ExecutionPath, FerryConfig } from '../config.js';

/** The four Ferry agent roles, in the form used by audit-comment markers. */
export type AgentOutputRole = 'developer' | 'iterator' | 'reviewer' | 'refiner';

/**
 * Maps an agent role to its audit-comment marker token. The developer role
 * uses the `dev` token for parity with the bundled-script path; all other
 * roles use their own name verbatim.
 */
export function markerRoleToken(role: AgentOutputRole): string {
  return role === 'developer' ? 'dev' : role;
}

export type ExecutionPathReason = 'label' | 'heuristic' | 'default' | 'provider-gate';

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

  // 2. Provider gate (ADR-0006 §1, §6, issue #329): the claude-code path is
  //    unavailable when any configured agent provider is not Anthropic, regardless
  //    of the per-ticket label or the configured path. When a ferry:claude-code
  //    label is present and silently ignored, the caller is responsible for
  //    emitting a warn (the resolver stays pure — it returns the decision only).
  if (!input.anthropicOnly) {
    return { path: 'script', reason: 'provider-gate' };
  }

  // 3. Per-ticket Jira label (conflicting pair already collapsed to 'script').
  if (input.labelOverride !== undefined) {
    return { path: input.labelOverride, reason: 'label' };
  }

  // 4/5. Conditional default, then heuristic escalation of a script default.
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
 *
 * Recorded `reason` values:
 *   - `default`       — config-explicit or Anthropic-only conditional default.
 *   - `label`         — per-ticket `ferry:claude-code` / `ferry:no-claude-code`.
 *   - `heuristic`     — automatic round-trip escalation.
 *   - `provider-gate` — blocked because at least one agent provider is not
 *                       Anthropic; the claude-code path requires an
 *                       Anthropic-only config (ADR-0006 §1, §6, issue #329).
 */
export function formatExecutionPathAudit(
  role: AgentOutputRole,
  runId: string,
  decision: ExecutionPathDecision,
): string {
  return `[ferry:${markerRoleToken(role)}:${runId}] execution-path: ${decision.path} (reason: ${decision.reason})`;
}
