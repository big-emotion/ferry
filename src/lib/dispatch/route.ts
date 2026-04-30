import { FerryError } from '../errors/index.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';

export type EventPhase = EventEnvelopeV1['phase'];

export function phaseToWorkflow(phase: EventPhase): string {
  switch (phase) {
    case 'refine':
      return 'refine.yml';
    case 'dev':
      return 'dev.yml';
    case 'review':
      return 'review.yml';
    case 'iterate':
      return 'iterate.yml';
    default:
      throw new FerryError('state-invariant', { message: `Unknown phase '${phase as string}'` });
  }
}

export function shouldSkipForTaskType(issueType: string): { skip: boolean; reason?: string } {
  if (issueType === 'Task') {
    return { skip: true, reason: 'ticket type Task is not processed by Ferry' };
  }
  return { skip: false };
}

export function buildTaskSkipComment(role: string, runId: string): string {
  return `[ferry:${role}:${runId}] Skipped — ticket type Task is not processed by Ferry`;
}
