import type { FerryConfig } from '../config.js';
import type { AgentOutputRole } from '../cc-wrappers/routing.js';
import type { EventPhase } from '../envelope/types.js';

/** Legacy per-agent dispatch events keep their direct role mapping forever. */
const EVENT_TYPE_TO_ROLE: Readonly<Record<string, AgentOutputRole>> = Object.freeze({
  'ferry-refine': 'refiner',
  'ferry-dev': 'developer',
  'ferry-review': 'reviewer',
  'ferry-iterate': 'iterator',
  'ferry-merge': 'merger',
});

const ROLE_TO_PHASE: Readonly<Record<AgentOutputRole, EventPhase>> = Object.freeze({
  refiner: 'refine',
  developer: 'dev',
  reviewer: 'review',
  iterator: 'iterate',
  merger: 'merge',
});

/** The audit/emit phase token for a resolved role. */
export function roleToPhase(role: AgentOutputRole): EventPhase {
  return ROLE_TO_PHASE[role];
}

const ROLE_TO_MODEL_VAR: Readonly<Record<AgentOutputRole, string>> = Object.freeze({
  refiner: 'FERRY_REFINER_MODEL',
  developer: 'FERRY_DEV_MODEL',
  reviewer: 'FERRY_REVIEW_MODEL',
  iterator: 'FERRY_ITER_MODEL',
  merger: 'FERRY_MERGER_MODEL',
});

/** ferry-cc-prompt / ferry-run-claude-agent agent naming (CC_AGENTS). */
const ROLE_TO_CC_AGENT: Readonly<Record<AgentOutputRole, string>> = Object.freeze({
  refiner: 'refiner',
  developer: 'dev',
  reviewer: 'review',
  iterator: 'iterate',
  merger: 'merge',
});

/** The claude-code agent name for a role, as ferry-cc-prompt expects it. */
export function roleToCcAgent(role: AgentOutputRole): string {
  return ROLE_TO_CC_AGENT[role];
}

/**
 * The repo-variable name carrying the model override for a role. Surfaced as a
 * route output so the router workflow can look the model up dynamically
 * (`vars[outputs.model_var]`) without a per-role job.
 */
export function roleToModelVar(role: AgentOutputRole): string {
  return ROLE_TO_MODEL_VAR[role];
}

/**
 * Resolve which agent a dispatch targets.
 *
 * Legacy event types map directly. The generic `ferry-transition` event (single
 * any-column Jira rule) maps its `to_status` against the five
 * `workflow.agents.*.trigger_column` names — case-insensitive, trimmed.
 *
 * Returns 'none' when no agent is mapped: the router no-ops on statuses Ferry
 * does not own. Moving a ticket into the merger's trigger_column is treated as
 * an explicit human merge order, equivalent to the Reviewer-emitted
 * `ferry-merge` dispatch (ADR-0005 rev. 2).
 */
export function deriveAgentRole(
  eventType: string,
  toStatus: string | undefined,
  cfg: FerryConfig,
): AgentOutputRole | 'none' {
  const direct = EVENT_TYPE_TO_ROLE[eventType];
  if (direct) return direct;
  if (eventType !== 'ferry-transition') return 'none';

  const wanted = toStatus?.trim().toLowerCase();
  if (!wanted) return 'none';

  const agents = cfg.workflow.agents;
  const columnToRole: ReadonlyArray<[string, AgentOutputRole]> = [
    [agents.refiner.trigger_column, 'refiner'],
    [agents.developer.trigger_column, 'developer'],
    [agents.reviewer.trigger_column, 'reviewer'],
    [agents.iterator.trigger_column, 'iterator'],
    [agents.merger.trigger_column, 'merger'],
  ];
  const hit = columnToRole.find(([column]) => column.trim().toLowerCase() === wanted);
  return hit ? hit[1] : 'none';
}
