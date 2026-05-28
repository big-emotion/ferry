/**
 * Execution-path routing for Ferry's direct-action wrappers.
 *
 * Resolver precedence:
 *   1. Explicit `execution_path: script` hard lock.
 *   2. Provider gates for direct-action paths.
 *   3. Per-ticket Jira label override.
 *   4. Automatic Claude Code heuristic.
 *   5. Conditional default.
 */
import type { ExecutionPath, FerryConfig, LlmRoute } from '../config.js';

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
  /** `ferry.config.execution_path`. `undefined` → conditional default. */
  configuredPath: ExecutionPath | undefined;
  /** True when every configured agent provider is Anthropic. */
  anthropicOnly: boolean;
  /** Provider configured for the role currently being routed. */
  roleProvider: LlmRoute['provider'];
  /** Per-ticket execution-path override resolved from Jira labels. */
  labelOverride?: ExecutionPath;
  role: AgentOutputRole;
  /** Prior Ferry round-trips for this ticket (caller derives from audit comments). */
  priorRoundTrips: number;
  /** Heuristic round-trip threshold N (`routing.claude_code_round_trip_threshold`). */
  roundTripThreshold: number;
}

/** Roles eligible for the automatic claude-code escalation heuristic (ADR-0006 §3.2). */
const HEURISTIC_ROLES: ReadonlySet<AgentOutputRole> = new Set(['developer', 'iterator']);

/** True when all four configured agent providers are Anthropic. */
export function isAnthropicOnlyConfig(cfg: FerryConfig): boolean {
  const m = cfg.models;
  return (
    m.refiner.provider === 'anthropic' &&
    m.dev.provider === 'anthropic' &&
    m.review.provider === 'anthropic' &&
    m.iterate.provider === 'anthropic'
  );
}

export function providerForRole(cfg: FerryConfig, role: AgentOutputRole): LlmRoute['provider'] {
  switch (role) {
    case 'developer':
      return cfg.models.dev.provider;
    case 'iterator':
      return cfg.models.iterate.provider;
    case 'reviewer':
      return cfg.models.review.provider;
    case 'refiner':
      return cfg.models.refiner.provider;
  }
}

function isDirectPathAvailable(path: ExecutionPath, input: ExecutionPathInput): boolean {
  if (path === 'script') return true;
  if (path === 'claude-code') return input.anthropicOnly;
  if (path === 'codex-cli') return input.roleProvider === 'openai';
  return false;
}

/** Pure, deterministic execution-path decision. */
export function resolveExecutionPath(input: ExecutionPathInput): ExecutionPathDecision {
  // 1. Explicit `execution_path: script` is a hard lock — never overridden.
  if (input.configuredPath === 'script') {
    return { path: 'script', reason: 'default' };
  }

  const requestedDirectPath: Exclude<ExecutionPath, 'script'> | undefined =
    input.labelOverride === 'claude-code' || input.labelOverride === 'codex-cli'
      ? input.labelOverride
      : input.configuredPath === 'claude-code' || input.configuredPath === 'codex-cli'
        ? input.configuredPath
        : undefined;

  // 2. Direct-action provider gates. Claude Code remains Anthropic-only;
  // Codex CLI is role-local OpenAI-only. Unsupported direct paths fail closed.
  if (requestedDirectPath !== undefined && !isDirectPathAvailable(requestedDirectPath, input)) {
    return { path: 'script', reason: 'provider-gate' };
  }

  // Preserve ADR-0006's existing non-Anthropic fallback reason for the legacy
  // conditional default and no-claude labels. OpenAI users must opt into Codex
  // explicitly with `execution_path: codex-cli` or `ferry:codex-cli`.
  if (!input.anthropicOnly && requestedDirectPath === undefined) {
    return { path: 'script', reason: 'provider-gate' };
  }

  // 3. Per-ticket Jira label.
  if (input.labelOverride !== undefined) {
    return { path: input.labelOverride, reason: 'label' };
  }

  // 4/5. Conditional default, then heuristic escalation of a script default.
  const defaultPath: ExecutionPath =
    input.configuredPath === 'claude-code' || input.configuredPath === 'codex-cli'
      ? input.configuredPath
      : input.anthropicOnly
        ? 'claude-code'
        : 'script';

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

/** Formats the execution-path decision as a fingerprinted audit-comment line. */
export function formatExecutionPathAudit(
  role: AgentOutputRole,
  runId: string,
  decision: ExecutionPathDecision,
): string {
  return `[ferry:${markerRoleToken(role)}:${runId}] execution-path: ${decision.path} (reason: ${decision.reason})`;
}
