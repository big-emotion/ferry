/**
 * 15-minute reconciler (FR50, FR51, NFR-P4).
 *
 * Pure decision engine: given a snapshot of Ferry-managed tickets — Jira
 * column, current state.phase, and minutes-since-last-audit — decide which
 * tickets need a fresh dispatch. Side effects (actually issuing the
 * repository_dispatch and pruning) live in reconciler.yml.
 */

import { ulid } from 'ulid';

const PHASE_TO_COLUMN: Record<string, string> = {
  refining: 'Refinement',
  developing: 'In Development',
  reviewing: 'In Review',
  iterating: 'Changes Requested',
  ready: 'Ready to Merge',
  paused: 'Paused',
  cancelled: 'Cancelled',
  'needs-human': 'Needs Human',
};

const COLUMN_TO_PHASE: Record<string, string> = {
  Refinement: 'refine',
  'In Development': 'dev',
  'In Review': 'review',
  'Changes Requested': 'iterate',
};

const FRESH_AUDIT_WINDOW_MIN = 20;

export interface TicketSnapshot {
  ticket_key: string;
  jira_column: string;
  state_phase?: string;
  last_audit_minutes_ago: number;
}

export interface ReconcileInput {
  tickets: TicketSnapshot[];
  now_iso: string;
}

export interface DispatchDirective {
  ticket_key: string;
  source: 'reconciler';
  phase: string;
  event_id: string;
}

export interface ReconcileOutcome {
  scanned: number;
  dispatched: DispatchDirective[];
}

function isMismatch(t: TicketSnapshot): boolean {
  if (t.state_phase !== undefined) {
    const expected = PHASE_TO_COLUMN[t.state_phase];
    if (expected === undefined) return false;
    return expected !== t.jira_column;
  }
  // No state file: only dispatch if last audit is older than the fresh window.
  return t.last_audit_minutes_ago >= FRESH_AUDIT_WINDOW_MIN;
}

function inferPhase(column: string): string {
  return COLUMN_TO_PHASE[column] ?? 'refine';
}

export function reconcileTickets(input: ReconcileInput): ReconcileOutcome {
  const dispatched: DispatchDirective[] = [];
  for (const t of input.tickets) {
    if (!isMismatch(t)) continue;
    dispatched.push({
      ticket_key: t.ticket_key,
      source: 'reconciler',
      phase: inferPhase(t.jira_column),
      event_id: ulid(),
    });
  }
  return { scanned: input.tickets.length, dispatched };
}
