export type EventPhase = 'refine' | 'dev' | 'review' | 'iterate' | 'reconcile';

export type EventSource = 'jira-column' | 'jira-label' | 'jira-mention' | 'reconciler';

export interface EventEnvelopeV1 {
  version: 'v1';
  event_id: string;
  ticket_key: string;
  phase: EventPhase;
  source: EventSource;
  ts: string;
  instructions?: string;
}
