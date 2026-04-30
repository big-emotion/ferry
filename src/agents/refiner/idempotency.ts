/**
 * Story 3-3: re-run idempotency for the Refiner (FR12).
 */

import type { BatchPrepared } from './batch.js';

const MARKER_REGEX = /\[ferry:refiner-subtask:[^\]]+\]/;

function extractSubtaskMarker(description: string): string | null {
  const match = description.match(MARKER_REGEX);
  return match ? match[0] : null;
}

export function filterExistingSubtasks(
  prepared: BatchPrepared,
  existingDescriptions: string[],
): BatchPrepared {
  const existingMarkers = new Set(
    existingDescriptions.map(extractSubtaskMarker).filter((m): m is string => m !== null),
  );
  const subtasks = prepared.subtasks.filter((s) => {
    const m = extractSubtaskMarker(s.description);
    return m === null || !existingMarkers.has(m);
  });
  return { ...prepared, subtasks };
}
