import type { LabelCapability } from '../config.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { Logger } from '../logger/index.js';

/**
 * Agent phase keys — match the FerryConfig.models property names.
 * Used as the phase segment in ferry:model/<phase>/... and ferry:provider/<phase>/... labels.
 */
export type AgentPhase = 'refiner' | 'dev' | 'review' | 'iterate';

/** Per-phase model/provider override derived from a ferry:model/* or ferry:provider/* label. */
export interface PhaseModelOverride {
  model?: string;
  provider?: 'anthropic' | 'openai' | 'google';
}

/**
 * Overrides derived from built-in ferry:* configuration labels on the Jira ticket.
 *
 * These labels are always recognised regardless of the consumer's ferry.config.json
 * — they are not consumer-configurable.
 *
 * The resolver (`resolveTicketOverrides` in overrides.ts) applies precedence:
 * Jira label > ferry.config.yaml > env vars > defaults.
 */
export interface TicketOverrides {
  // --- ferry:type:* (ticket type) ---

  /** When true, the ticket bypasses the Task skip (FR6) and is processed as a Story. */
  bypassTaskSkip: boolean;
  /**
   * Normalised issue type that agents should use instead of the Jira-reported type.
   * Only set when a ferry:type:force-* label is present.
   */
  typeOverride?: string;
  /**
   * The raw label that triggered the typeOverride, for audit logging.
   * Only set when typeOverride is present.
   */
  forceLabel?: string;

  // --- ferry:model/<phase>/<model-id> and ferry:provider/<phase>/<provider> ---

  /**
   * Per-phase model/provider overrides from ferry:model/* and ferry:provider/* labels.
   * Keys present only when a matching label exists on the ticket.
   */
  modelOverrides?: Partial<Record<AgentPhase, PhaseModelOverride>>;

  // --- ferry:budget/* ---

  /**
   * Cost and token budget overrides from ferry:budget/* labels.
   * ferry:budget/max-cost/<eur> overrides limits.max_cost_eur_per_run.
   * ferry:budget/max-tokens/<n> overrides limits.max_tokens_per_run.
   */
  budget?: {
    maxCostEurPerRun?: number;
    maxTokensPerRun?: number;
  };

  // --- ferry:budget/<eur> ---

  /**
   * Hard EUR cap for this ticket. ferry:budget/<eur> label (e.g. ferry:budget/3).
   * When the accumulated EUR cost exceeds this, the agent throws spend-cap and
   * the ticket is labeled ferry:spend-cap.
   * Overrides limits.max_cost_eur_per_run.
   */
  budgetEur?: number;

  // --- ferry:max-iterations/<n> ---

  /**
   * Cap agent-loop iteration count for this ticket. ferry:max-iterations/<n> label.
   * Overrides limits.max_agent_iterations.
   * Hitting this cap in the Iterator is treated as success-of-intent (no ferry:blocked).
   */
  maxIterations?: number;

  // --- ferry:max-tokens/<n> ---

  /**
   * Cap per-LLM-call output tokens for this ticket. ferry:max-tokens/<n> label.
   * Overrides limits.max_tokens_per_message, forwarded to provider SDK max_tokens.
   */
  maxTokens?: number;

  // --- ferry:skip/<phase> ---

  /**
   * Phases to skip for this ticket.
   * ferry:skip/dev means the Developer agent exits immediately.
   * ferry:skip/refiner sends the ticket straight to Dev.
   * ferry:skip/review auto-approves the PR at the Reviewer phase (requires the
   *   `safety.allow_skip_review` opt-in flag; otherwise the label is ignored).
   * ferry:skip/iter (alias: ferry:skip/iterate) makes the Iterator a no-op.
   */
  skipPhases?: AgentPhase[];

  // --- ferry:no-auto-transition ---

  /**
   * True when the ticket carries the ferry:no-auto-transition label.
   * Disables Ferry's auto-transitions for FR18 (Dev → In Review),
   * FR24 (Reviewer → Ready/Changes), and FR28 (Iterator → In Review).
   * The human moves the Jira column manually.
   */
  noAutoTransition?: boolean;

  // --- ferry:thinking/* ---

  /**
   * Extended-thinking mode override.
   * - `ferry:thinking/on` enables thinking with the default budget.
   * - `ferry:thinking/extended` enables thinking with a larger budget for complex tasks.
   * - `ferry:thinking/off` force-disables thinking even if repo defaults enable it.
   *
   * Anthropic-only — non-Anthropic providers ignore the flag with a stderr warning
   * at invocation time (not at resolution time, so the override stays visible in the audit).
   */
  thinking?: 'on' | 'off' | 'extended';

  // --- ferry:strict-review / ferry:lenient-review ---

  /**
   * Reviewer rubric override for this ticket.
   * - `ferry:strict-review` → 'strict' — Reviewer applies a stricter rubric (blocks more easily).
   * - `ferry:lenient-review` → 'lenient' — Reviewer applies a more permissive rubric (passes more easily).
   *
   * Consumed when assembling the Reviewer's prompt; ignored by other agents.
   */
  reviewRubric?: 'strict' | 'lenient';

  // --- ferry:git/* + ferry:base/* + ferry:target/* + ferry:pr/* ---

  /**
   * Git behaviour overrides derived from ferry:git/*, ferry:base/*, ferry:target/* and ferry:pr/* labels.
   * - noPr (ferry:git/no-pr)             — skips PR creation at the end of a Developer run.
   * - baseBranch (ferry:base/<branch>)   — overrides git.base_branch (the branch Ferry creates ferry/... from).
   * - targetBranch (ferry:target/<branch>) — overrides git.target_branch (the branch the PR is opened against).
   * - prDraft (ferry:pr/draft or ferry:pr/ready) — true forces draft, false forces ready-for-review.
   */
  git?: {
    noPr?: boolean;
    baseBranch?: string;
    targetBranch?: string;
    prDraft?: boolean;
  };

  // --- ferry:paused (safety) ---

  /**
   * True when the ticket carries the ferry:paused label (applied by cost governance).
   * Agents should exit immediately without processing when this is true.
   */
  paused?: boolean;

  // --- ferry:dry-run (validation / no side effects) ---

  /**
   * True when the ticket carries the ferry:dry-run label.
   * Suppresses all external write side effects (branch push, PR creation, Jira
   * label / transition / sub-task writes) so prompts and MCP wiring can be
   * validated without committing real work. LLM calls still happen and incur
   * token cost. Audit comments still post, prefixed with `[dry-run]`.
   */
  dryRun?: boolean;

  // --- ferry:read-only (Refiner-only run) ---

  /**
   * True when the ticket carries the ferry:read-only label.
   * Only the Refiner runs; Developer / Reviewer / Iterator short-circuit at
   * action entry with a single audit comment. When combined with ferry:dry-run,
   * even the Refiner's Jira sub-task writes are suppressed (per dryRun gating).
   */
  readOnly?: boolean;

  // --- direct-action execution path labels ---

  /**
   * Per-ticket execution-path override (ADR-0006 §3, #300).
   * - `ferry:claude-code`    → 'claude-code' (force the claude-code-action path).
   * - `ferry:codex-cli`      → 'codex-cli' (force the openai/codex-action path).
   * - `ferry:no-claude-code` → 'script' (force the bundled script path).
   * - `ferry:no-codex-cli`   → 'script' (force the bundled script path).
   *
   * Conflicting labels (both present) resolve to the **safe path** `'script'`
   * — deliberately, this pair does NOT throw `LabelConflictError`: a routing
   * ambiguity must fail closed onto the deterministic script path rather than
   * block the ticket.
   *
   * Multiple positive direct-action labels, or a positive/negative pair for
   * the same path, resolve to the **safe path** `'script'`.
   *
   * Consumed by `resolveExecutionPath` (src/lib/cc-wrappers/routing.ts): it
   * takes precedence over the heuristic and the conditional default, but an
   * explicit `execution_path: script` in ferry.config still wins.
   *
   * **Provider gate (issue #329):** the `ferry:claude-code` override is
   * honoured **only when `anthropicOnly === true`**. When any agent's configured
   * provider is not Anthropic, the resolver returns
   * `{ path: 'script', reason: 'provider-gate' }` and the label is a logged
   * no-op — the caller emits a warn. This ensures the claude-code path is never
   * activated without the Anthropic token infrastructure (ADR-0006 §6).
   */
  executionPath?: 'claude-code' | 'codex-cli' | 'script';
  /** @deprecated Use executionPath. Retained for older callers/tests. */
  claudeCodePath?: 'claude-code' | 'script';
}

/** Built-in label → normalised issue type mapping. Order matters: last match wins. */
const FORCE_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'ferry:type:force-bug': 'Bug',
  'ferry:type:force-spike': 'Spike',
  'ferry:type:force-story': 'Story',
});

const ENABLE_TASK_LABEL = 'ferry:type:enable-task';

/**
 * Alias namespace ferry:as/<type> (issue #242). Maps directly to the same
 * typeOverride field as ferry:type:force-<type> but with stricter conflict
 * semantics — multiple ferry:as/<x> with different suffixes throw
 * LabelConflictError, and mixing ferry:as/<a> with ferry:type:force-<b>
 * also throws when <a> and <b> resolve to different values.
 *
 * Unlike ferry:type:enable-task, the alias namespace does NOT bypass the
 * FR6 Task-skip — a Task ticket with ferry:as/story is still skipped.
 */
export const AS_LABEL_PREFIX = 'ferry:as/';

/** Suffix → normalised issue type mapping for the ferry:as/<type> namespace. */
export const AS_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  bug: 'Bug',
  spike: 'Spike',
  story: 'Story',
});

/** All recognised built-in ferry:type:* and ferry:as/<type> labels (suppress warnings). */
const BUILTIN_TYPE_LABELS: ReadonlySet<string> = new Set([
  ENABLE_TASK_LABEL,
  ...Object.keys(FORCE_TYPE_LABELS),
  ...Object.keys(AS_TYPE_LABELS).map((s) => `${AS_LABEL_PREFIX}${s}`),
]);

/**
 * Resolves built-in ferry:type:* labels from the ticket label list.
 *
 * This is a pure function with no config dependency — these labels are always
 * recognised and do not need to be declared in ferry.config.json.
 */
export function resolveTypeOverrides(labels: string[]): TicketOverrides {
  let bypassTaskSkip = false;
  let typeOverride: string | undefined;
  let forceLabel: string | undefined;

  for (const label of labels) {
    if (label === ENABLE_TASK_LABEL) {
      bypassTaskSkip = true;
    } else if (Object.prototype.hasOwnProperty.call(FORCE_TYPE_LABELS, label)) {
      typeOverride = FORCE_TYPE_LABELS[label];
      forceLabel = label;
    }
  }

  return { bypassTaskSkip, typeOverride, forceLabel };
}

/**
 * Returns true when a label is a recognised built-in ferry:type:* label.
 * Used by resolveCapabilities to suppress unknown-label warnings.
 */
export function isBuiltinTypeLabel(label: string): boolean {
  return BUILTIN_TYPE_LABELS.has(label);
}

export interface ResolvedCapabilities {
  mcpServerNames: string[];
  serverAllowedTools: Record<string, string[]>; // server name → tools (empty = all allowed)
  triggeredLabels: string[];
  unknownFerryLabels: string[];
}

/**
 * Resolves ticket labels against the ferry.config labels section.
 *
 * Only labels declared in configLabels are honoured. Any ferry:* label
 * not present in configLabels is logged to stderr and excluded.
 */
export function resolveCapabilities(
  ticketLabels: string[],
  configLabels: Record<string, LabelCapability> | undefined,
  logger?: Logger,
): ResolvedCapabilities {
  if (!configLabels) {
    return {
      mcpServerNames: [],
      serverAllowedTools: {},
      triggeredLabels: [],
      unknownFerryLabels: [],
    };
  }

  const triggeredLabels: string[] = [];
  const unknownFerryLabels: string[] = [];

  // server name → union of allowed tools (null = all tools allowed)
  const serverToolSets: Record<string, Set<string> | null> = {};

  for (const label of ticketLabels) {
    if (Object.prototype.hasOwnProperty.call(configLabels, label)) {
      triggeredLabels.push(label);
      const cap = configLabels[label];
      for (const server of cap.mcp_servers ?? []) {
        if (cap.tools && cap.tools.length > 0) {
          if (serverToolSets[server] === undefined) {
            serverToolSets[server] = new Set(cap.tools);
          } else if (serverToolSets[server] !== null) {
            for (const t of cap.tools) serverToolSets[server].add(t);
          }
          // if already null (all tools allowed from a previous label), keep null
        } else {
          serverToolSets[server] = null; // all tools from this server allowed
        }
      }
    } else if (label.startsWith('ferry:')) {
      // Built-in type labels (ferry:type:*) are always recognised — suppress the warning.
      if (!isBuiltinTypeLabel(label)) {
        unknownFerryLabels.push(label);
        logger?.warn('unknown ferry label ignored', { label });
      }
    }
  }

  const serverAllowedTools: Record<string, string[]> = {};
  for (const [server, tools] of Object.entries(serverToolSets)) {
    serverAllowedTools[server] = tools ? [...tools] : [];
  }

  return {
    mcpServerNames: Object.keys(serverToolSets),
    serverAllowedTools,
    triggeredLabels,
    unknownFerryLabels,
  };
}

/**
 * Filters a pool of MCP servers to those enabled by the resolved capabilities.
 * Applies per-server tool allowlists where specified.
 *
 * If configLabels is undefined (no labels section in ferry.config), returns
 * the full pool unchanged to preserve backward compatibility.
 */
export function filterMcpServers(
  pool: McpServerConfig[],
  capabilities: ResolvedCapabilities,
  hasLabelsConfig: boolean,
): McpServerConfig[] {
  if (!hasLabelsConfig) return pool;
  return pool
    .filter((s) => capabilities.mcpServerNames.includes(s.name))
    .map((s): McpServerConfig => {
      const allowedTools = capabilities.serverAllowedTools[s.name];
      if (allowedTools && allowedTools.length > 0) {
        return { ...s, allowed_tools: allowedTools } as McpServerConfig;
      }
      return s;
    });
}
