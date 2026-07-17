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

/**
 * Resolve which agent a dispatch targets.
 *
 * Legacy event types map directly. The generic `ferry-transition` event (single
 * any-column Jira rule) maps its `to_status` against the four
 * `workflow.agents.*.trigger_column` names — case-insensitive, trimmed.
 *
 * Returns 'none' when no agent is mapped: the router no-ops on statuses Ferry
 * does not own. The merger is deliberately unreachable from a status move —
 * only the Reviewer-emitted `ferry-merge` dispatch triggers it (ADR-0005).
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
    // merger deliberately absent — ADR-0005 no-auto-merge invariant.
  ];
  const hit = columnToRole.find(([column]) => column.trim().toLowerCase() === wanted);
  return hit ? hit[1] : 'none';
}
