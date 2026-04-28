/**
 * Story 2-1: phase → workflow routing source of truth.
 *
 * Why: prior to this module each test file and the (future) external dispatcher hardcoded
 * the `repository_dispatch` types separately. Drift was a question of when, not if.
 * `PHASE_TO_WORKFLOW` is the single object consulted by the dispatcher, the binding test,
 * and the dry-run E2E suite (FR1).
 */

import type { EventPhase } from '../envelope/types.js';
import { FerryError } from '../error.js';

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

function lookupRoute(phase: keyof RoutingTable): PhaseRoute {
  const route = PHASE_TO_WORKFLOW[phase];
  if (!route) {
    throw new FerryError('state-invariant', {
      reason: 'unknown-phase',
      phase: String(phase),
    });
  }
  return route;
}

export function phaseToWorkflow(phase: keyof RoutingTable): WorkflowFile {
  return lookupRoute(phase).workflow;
}

export function phaseToDispatchType(phase: keyof RoutingTable): DispatchType {
  return lookupRoute(phase).dispatchType;
}

/**
 * Story 2-1 AC4 / FR6: ticket-type filter.
 *
 * Ferry processes Story / Bug / Spike issues. Task issues are skipped by design
 * (Tasks are sub-tasks created by the Refiner — re-processing them would loop).
 * Defensive: missing `ticket_type` defaults to processing — Jira Automation rules
 * are the operator's responsibility; we don't want a broken rule to silently skip
 * everything.
 */
export type TicketType = 'Story' | 'Task' | 'Bug' | 'Spike';

const PROCESSED_TICKET_TYPES = new Set<TicketType>(['Story', 'Bug', 'Spike']);

export function shouldProcessTicketType(ticketType: TicketType | undefined): boolean {
  if (ticketType === undefined) {
    return true;
  }
  return PROCESSED_TICKET_TYPES.has(ticketType);
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
