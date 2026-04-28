/**
 * Story 2-4: phase-status helpers (FR42 / FR44).
 *
 * `phaseToStatusLabel` maps the routing phase to the active phase status
 * label (e.g. ferry-refining) applied to the GitHub PR + Jira ticket while
 * the workflow is running.
 *
 * `formatPhaseStatusComment` renders the per-phase Jira comment whose first
 * line is the canonical idempotency marker `[ferry:<role>:<run_id>]`. The
 * caller uses `checkIdempotencyMarker` from `src/lib/io/idempotency.ts` to
 * detect a re-run and edit the existing comment in place.
 */

import type { EventPhase } from '../envelope/types.js';

type AgentPhase = Exclude<EventPhase, 'reconcile'>;

const PHASE_LABEL: Readonly<Record<AgentPhase, string>> = Object.freeze({
  refine: 'ferry:refining',
  dev: 'ferry:developing',
  review: 'ferry:reviewing',
  iterate: 'ferry:iterating',
});

/**
 * Maps each agent phase to the agent name used inside the canonical idempotency
 * marker `[ferry:<agent>:<run_id>]`.
 *
 * NOTE (Story 2-4 epic-2 review nit): only `refine` is renamed to `refiner`.
 * `dev`, `review`, and `iterate` deliberately use the phase verbatim here, while
 * `triggers.ts` uses the longer `developer`/`reviewer`/`iterator` form for
 * agent:<role> Jira labels and @agent-<role> mention parsing. The two conventions
 * coexist intentionally for now: marker length matters for Jira comment
 * truncation and operator-visible diff readability, while label/mention names
 * favor unambiguous role nouns. Aligning the two is tracked as a follow-up
 * (operator-facing rename, requires migration of historical comments) and
 * deferred from this PR per the epic-2 review recommendation.
 */
const PHASE_AGENT: Readonly<Record<AgentPhase, string>> = Object.freeze({
  refine: 'refiner',
  dev: 'dev',
  review: 'review',
  iterate: 'iterate',
});

export function phaseToStatusLabel(phase: AgentPhase): string {
  return PHASE_LABEL[phase];
}

export function phaseStatusMarker(phase: AgentPhase, runId: string): string {
  return `[ferry:${PHASE_AGENT[phase]}:${runId}]`;
}

export interface PhaseStatusInput {
  phase: AgentPhase;
  runId: string;
  outcome: string;
  costEur: number;
  runUrl: string;
}

function formatCost(eur: number): string {
  const safe = eur > 0 ? eur : 0;
  return `€${safe.toFixed(2)}`;
}

export function formatPhaseStatusComment(input: PhaseStatusInput): string {
  const marker = phaseStatusMarker(input.phase, input.runId);
  return [
    marker,
    `Phase: ${input.phase}`,
    `Outcome: ${input.outcome}`,
    `Cost: ${formatCost(input.costEur)}`,
    `Run: ${input.runUrl}`,
  ].join('\n');
}
