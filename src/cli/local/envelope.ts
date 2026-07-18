import type { EventEnvelopeV1, EventPhase } from '../../lib/envelope/types.js';
import type { WorkflowConfig } from '../../lib/config.js';
import { FerryError } from '../../lib/errors/index.js';

export interface LocalEnvelopeInput {
  ticketKey: string;
  status: string;
  ts: string;
  workflow: WorkflowConfig;
  source?: EventEnvelopeV1['source'];
  eventId?: string;
}

export function mapStatusToPhase(
  status: string,
  workflow: WorkflowConfig,
): Extract<EventPhase, 'refine' | 'dev' | 'review' | 'iterate' | 'merge'> | null {
  if (status === workflow.agents.refiner.trigger_column) return 'refine';
  if (status === workflow.agents.developer.trigger_column) return 'dev';
  if (status === workflow.agents.reviewer.trigger_column) return 'review';
  if (status === workflow.agents.iterator.trigger_column) return 'iterate';
  if (status === workflow.agents.merger.trigger_column) return 'merge';
  return null;
}

export function buildLocalEnvelope(input: LocalEnvelopeInput): EventEnvelopeV1 {
  const phase = mapStatusToPhase(input.status, input.workflow);
  if (!phase) {
    throw new FerryError('state-invariant', {
      reason: 'local-runner-unmapped-status',
      message: `No local-runner phase mapping for status: ${input.status}`,
    });
  }
  return {
    version: 'v1',
    event_id: input.eventId ?? `${Date.parse(input.ts)}-${input.ticketKey}`,
    ticket_key: input.ticketKey,
    phase,
    source: input.source ?? 'jira-column',
    ts: input.ts,
  };
}
