import { FerryError } from '../../errors/index.js';
import type { TrackerTransition } from './types.js';

/**
 * Resolve the id of the transition that lands an issue on `targetStatusName`.
 *
 * The match is against each transition's *target status* (`toStatus`). On some
 * boards a transition's own label differs from the status it reaches (a
 * transition labelled "IN REVIEW" can land on the localized status "Revue en
 * cours"); the value a consumer configures is the status name, so the target
 * status is the field to compare. Matching is case-insensitive and ignores
 * surrounding whitespace.
 *
 * Returns the first matching transition id, or `null` when none targets that
 * status.
 */
export function matchTransitionId(
  transitions: TrackerTransition[],
  targetStatusName: string,
): string | null {
  const wanted = targetStatusName.trim().toLowerCase();
  if (wanted === '') return null;
  const hit = transitions.find((t) => t.toStatus.trim().toLowerCase() === wanted);
  return hit ? hit.id : null;
}

export interface ConfiguredTransitionParams {
  ticketKey: string;
  /**
   * The configured target status name (`workflow.agents.*.auto_transition*`),
   * or null/empty when this transition is intentionally disabled.
   */
  targetStatusName: string | null | undefined;
  /**
   * An explicit transition id (`FERRY_*_TRANSITION_ID`). When set it wins,
   * preserving the pre-auto-resolution behaviour and allowing a manual override
   * on boards the status-name match cannot handle.
   */
  explicitId?: string | null | undefined;
  /** Fetches the transitions available on the issue (usually `tracker.getTransitions`). */
  fetchTransitions: (key: string) => Promise<TrackerTransition[]>;
}

/**
 * Resolve which transition id an agent should apply, honouring precedence:
 *
 *   1. an explicit `FERRY_*_TRANSITION_ID` when non-empty (override / back-compat)
 *   2. otherwise auto-resolve from the configured status name via the tracker
 *   3. otherwise `''` — the transition is disabled (no status name, no explicit id)
 *
 * Throws when a status name is configured but no available transition lands on
 * it, listing the reachable statuses so the misconfiguration is actionable.
 */
export async function resolveConfiguredTransitionId(
  params: ConfiguredTransitionParams,
): Promise<string> {
  const explicit = params.explicitId?.trim();
  if (explicit) return explicit;

  const wanted = params.targetStatusName?.trim();
  if (!wanted) return '';

  const transitions = await params.fetchTransitions(params.ticketKey);
  const id = matchTransitionId(transitions, wanted);
  if (id === null) {
    throw new FerryError('state-invariant', {
      reason: 'transition-not-found',
      ticket: params.ticketKey,
      configuredStatus: wanted,
      availableStatuses: transitions.map((t) => t.toStatus),
    });
  }
  return id;
}
