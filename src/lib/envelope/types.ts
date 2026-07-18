export type EventPhase =
  | 'refine'
  | 'dev'
  | 'review'
  | 'iterate'
  | 'reconcile'
  | 'merge'
  | 'transition';

export type EventSource =
  | 'jira-column'
  | 'jira-label'
  | 'jira-mention'
  | 'reconciler'
  | 'ferry-agent';

export type TicketType = 'Story' | 'Task' | 'Bug' | 'Spike';

export interface EventEnvelopeV1 {
  version: 'v1';
  event_id: string;
  ticket_key: string;
  phase: EventPhase;
  source: EventSource;
  ts: string;
  instructions?: string;
  ticket_type?: TicketType;
  /** Story 2-1 (PR #18) compatibility alias — accepted in payloads, normalized to ticket_type. */
  issue_type?: string;
  /**
   * Target status name for the generic `ferry-transition` event (single
   * any-column Jira rule). The router maps it to an agent via
   * `workflow.agents.*.trigger_column` — merger included (ADR-0005 rev. 2).
   */
  to_status?: string;
}
