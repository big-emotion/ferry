/**
 * Phase → workflow routing source of truth.
 *
 * `PHASE_TO_WORKFLOW` is the single object consulted by the dispatcher, the
 * binding test, and the dry-run E2E suite (FR1). Keeping the table here
 * prevents drift between tests and the production dispatcher.
 */

import type { EventPhase } from '../envelope/types.js';

export type WorkflowFile =
  | 'ferry-refine.yml'
  | 'ferry-dev.yml'
  | 'ferry-review.yml'
  | 'ferry-iterate.yml';
export type DispatchType = 'ferry-refine' | 'ferry-dev' | 'ferry-review' | 'ferry-iterate';

export type PhaseRoute = Readonly<{
  workflow: WorkflowFile;
  dispatchType: DispatchType;
}>;

type RoutingTable = Readonly<Record<Exclude<EventPhase, 'reconcile'>, PhaseRoute>>;

export const PHASE_TO_WORKFLOW: RoutingTable = Object.freeze({
  refine: Object.freeze({ workflow: 'ferry-refine.yml', dispatchType: 'ferry-refine' }),
  dev: Object.freeze({ workflow: 'ferry-dev.yml', dispatchType: 'ferry-dev' }),
  review: Object.freeze({ workflow: 'ferry-review.yml', dispatchType: 'ferry-review' }),
  iterate: Object.freeze({ workflow: 'ferry-iterate.yml', dispatchType: 'ferry-iterate' }),
}) as RoutingTable;

export function phaseToWorkflow(phase: keyof RoutingTable): WorkflowFile {
  return PHASE_TO_WORKFLOW[phase].workflow;
}

export function phaseToDispatchType(phase: keyof RoutingTable): DispatchType {
  return PHASE_TO_WORKFLOW[phase].dispatchType;
}

/**
 * FR6: ticket-type filter.
 *
 * Ferry only re-processes Task issues defensively — the Refiner creates them as
 * sub-tasks, and re-running on those would loop. Other types pass through.
 */
export function shouldSkipForTaskType(issueType: string): { skip: boolean; reason?: string } {
  if (issueType === 'Task') {
    return { skip: true, reason: 'ticket type Task is not processed by Ferry' };
  }
  return { skip: false };
}

export function buildTaskSkipComment(role: string, runId: string): string {
  return `[ferry:${role}:${runId}] Skipped — ticket type Task is not processed by Ferry`;
}
