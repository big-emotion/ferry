/**
 * 15-minute reconciler (FR50, FR51, NFR-P4).
 *
 * Pure decision engine: given a snapshot of Ferry-managed tickets — Jira
 * column, current state.phase, and minutes-since-last-audit — decide which
 * tickets need a fresh dispatch. Side effects (actually issuing the
 * repository_dispatch and pruning) live in reconciler.yml.
 */

import { generateULID } from '../lib/ulid/index.js';

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

// Terminal/holding columns: Ferry must not dispatch a phase when a ticket
// sits here without a state file. Listed explicitly so unknown columns
// stay unknown (and skipped) instead of silently mapping to 'refine'.
const TERMINAL_COLUMNS = new Set<string>(['Paused', 'Cancelled', 'Ready to Merge', 'Needs Human']);

const FRESH_AUDIT_WINDOW_MIN = 20;

export interface TicketSnapshot {
  ticket_key: string;
  jira_column: string;
  state_phase?: string;
  last_audit_minutes_ago: number;
}

export interface ReconcileInput {
  tickets: TicketSnapshot[];
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
  // No state file: only consider tickets whose column actually maps to a
  // dispatchable phase, AND whose last audit is older than the fresh window.
  // Terminal/unknown columns are never auto-dispatched.
  if (TERMINAL_COLUMNS.has(t.jira_column)) return false;
  if (COLUMN_TO_PHASE[t.jira_column] === undefined) return false;
  return t.last_audit_minutes_ago >= FRESH_AUDIT_WINDOW_MIN;
}

function inferPhase(column: string): string | undefined {
  return COLUMN_TO_PHASE[column];
}

export function reconcileTickets(input: ReconcileInput): ReconcileOutcome {
  const dispatched: DispatchDirective[] = [];
  for (const t of input.tickets) {
    if (!isMismatch(t)) continue;
    const phase = inferPhase(t.jira_column);
    if (phase === undefined) continue; // defensive: terminal/unknown columns never dispatch
    dispatched.push({
      ticket_key: t.ticket_key,
      source: 'reconciler',
      phase,
      event_id: generateULID(),
    });
  }
  return { scanned: input.tickets.length, dispatched };
}
