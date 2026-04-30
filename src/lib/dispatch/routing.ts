/**
 * Story 2-1: phase → workflow routing source of truth.
 *
 * Why: prior to this module each test file and the (future) external dispatcher hardcoded
 * the `repository_dispatch` types separately. Drift was a question of when, not if.
 * `PHASE_TO_WORKFLOW` is the single object consulted by the dispatcher, the binding test,
 * and the dry-run E2E suite (FR1).
 */

import type { EventPhase } from '../envelope/types.js';

export type WorkflowFile = 'refine.yml' | 'dev.yml' | 'review.yml' | 'iterate.yml';
export type DispatchType = 'ferry-refine' | 'ferry-dev' | 'ferry-review' | 'ferry-iterate';

export type PhaseRoute = Readonly<{
  workflow: WorkflowFile;
  dispatchType: DispatchType;
}>;

type RoutingTable = Readonly<Record<Exclude<EventPhase, 'reconcile'>, PhaseRoute>>;

export const PHASE_TO_WORKFLOW: RoutingTable = Object.freeze({
  refine: Object.freeze({ workflow: 'refine.yml', dispatchType: 'ferry-refine' }),
  dev: Object.freeze({ workflow: 'dev.yml', dispatchType: 'ferry-dev' }),
  review: Object.freeze({ workflow: 'review.yml', dispatchType: 'ferry-review' }),
  iterate: Object.freeze({ workflow: 'iterate.yml', dispatchType: 'ferry-iterate' }),
}) as RoutingTable;

export function phaseToWorkflow(phase: keyof RoutingTable): WorkflowFile {
  return PHASE_TO_WORKFLOW[phase].workflow;
}

export function phaseToDispatchType(phase: keyof RoutingTable): DispatchType {
  return PHASE_TO_WORKFLOW[phase].dispatchType;
}

/**
 * Story 2-1 AC4 / FR6: ticket-type filter.
 *
 * Ferry processes Story / Bug / Spike issues by default. Task issues are skipped by design
 * (Tasks are sub-tasks created by the Refiner — re-processing them would loop).
 * Defensive: missing `ticket_type` defaults to processing — Jira Automation rules
 * are the operator's responsibility; we don't want a broken rule to silently skip
 * everything.
 *
 * The allowlist is configurable via ferry.config (ticket_types.dev_allowlist /
 * ticket_types.refine_allowlist). Pass the appropriate list from FerryConfig;
 * omit to use the default set.
 */
export type TicketType = 'Story' | 'Task' | 'Bug' | 'Spike';

const DEFAULT_PROCESSED_TICKET_TYPES: ReadonlySet<string> = new Set<TicketType>(['Story', 'Bug', 'Spike']);

export function shouldProcessTicketType(
  ticketType: TicketType | undefined,
  allowlist?: readonly string[],
): boolean {
  if (ticketType === undefined) {
    return true;
  }
  const allowed = allowlist ? new Set(allowlist) : DEFAULT_PROCESSED_TICKET_TYPES;
  return allowed.has(ticketType);
}

export interface SkipCommentInput {
  runId: string;
  ticketType: TicketType;
  phase: keyof RoutingTable;
}

export function skipCommentForTaskType(input: SkipCommentInput): string {
  const agent = input.phase === 'refine' ? 'refiner' : input.phase;
  return `[ferry:${agent}:${input.runId}] Skipped — ticket type ${input.ticketType} is not processed by Ferry`;
}
