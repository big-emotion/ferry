import { describe, it, expect, vi } from 'vitest';
import { matchTransitionId, resolveConfiguredTransitionId } from './transition-match.js';
import type { TrackerTransition } from './types.js';

// Mirrors the transitions of the FER board (fetched live). id 3 deliberately
// lands on the localized status "Revue en cours" — the resolver must key off
// the target status, not any transition label.
const FER_TRANSITIONS: TrackerTransition[] = [
  { id: '21', toStatus: 'REFINEMENT' },
  { id: '2', toStatus: 'IN DEVELOPMENT' },
  { id: '3', toStatus: 'Revue en cours' },
  { id: '5', toStatus: 'CHANGES REQUESTED' },
  { id: '4', toStatus: 'TO MERGE' },
  { id: '31', toStatus: 'Terminé(e)' },
];

describe('matchTransitionId', () => {
  it('resolves the id of the transition that lands on the target status', () => {
    expect(matchTransitionId(FER_TRANSITIONS, 'TO MERGE')).toBe('4');
    expect(matchTransitionId(FER_TRANSITIONS, 'CHANGES REQUESTED')).toBe('5');
    expect(matchTransitionId(FER_TRANSITIONS, 'REFINEMENT')).toBe('21');
    expect(matchTransitionId(FER_TRANSITIONS, 'Revue en cours')).toBe('3');
  });

  it('compares case-insensitively and trims surrounding whitespace', () => {
    expect(matchTransitionId(FER_TRANSITIONS, '  to merge ')).toBe('4');
  });

  it('returns null when no transition lands on the target status', () => {
    expect(matchTransitionId(FER_TRANSITIONS, 'Done')).toBeNull();
  });

  it('returns null for an empty or whitespace-only target status', () => {
    expect(matchTransitionId(FER_TRANSITIONS, '')).toBeNull();
    expect(matchTransitionId(FER_TRANSITIONS, '   ')).toBeNull();
  });

  it('returns the first match when several transitions target the same status', () => {
    const dupes: TrackerTransition[] = [
      { id: '7', toStatus: 'Changes Requested' },
      { id: '9', toStatus: 'Changes Requested' },
    ];
    expect(matchTransitionId(dupes, 'Changes Requested')).toBe('7');
  });
});

describe('resolveConfiguredTransitionId', () => {
  const fetchFer = () => Promise.resolve(FER_TRANSITIONS);

  it('auto-resolves the configured status name via the tracker', async () => {
    const id = await resolveConfiguredTransitionId({
      ticketKey: 'FER-9',
      targetStatusName: 'TO MERGE',
      fetchTransitions: fetchFer,
    });
    expect(id).toBe('4');
  });

  it('returns the explicit id without fetching when one is provided', async () => {
    const fetchTransitions = vi.fn(fetchFer);
    const id = await resolveConfiguredTransitionId({
      ticketKey: 'FER-9',
      targetStatusName: 'TO MERGE',
      explicitId: '  99 ',
      fetchTransitions,
    });
    expect(id).toBe('99');
    expect(fetchTransitions).not.toHaveBeenCalled();
  });

  it('returns an empty string when the transition is disabled (no status, no id)', async () => {
    const fetchTransitions = vi.fn(fetchFer);
    for (const targetStatusName of [null, undefined, '', '   ']) {
      const id = await resolveConfiguredTransitionId({
        ticketKey: 'FER-9',
        targetStatusName,
        fetchTransitions,
      });
      expect(id).toBe('');
    }
    expect(fetchTransitions).not.toHaveBeenCalled();
  });

  it('throws an actionable error when the configured status matches no transition', async () => {
    await expect(
      resolveConfiguredTransitionId({
        ticketKey: 'FER-9',
        targetStatusName: 'In Review', // label, not the "Revue en cours" status
        fetchTransitions: fetchFer,
      }),
    ).rejects.toThrow(/Revue en cours/); // context lists the reachable statuses
  });
});
