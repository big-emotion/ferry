/**
 * Apply the discriminated-union actions returned by the Refiner LLM.
 *
 * Handles create / keep / mark_stale / noop actions. The caller is responsible
 * for posting the top-level audit comment; this module only performs per-action
 * side effects (subtask creation, stale comments on subtasks).
 */

import type { RefinerAction } from './schema.js';
import type { TrackerSubtask, IssueTracker } from '../../lib/io/tracker/types.js';
import { prepareBatch, applyBatch } from './batch.js';
import { filterExistingSubtasks } from './idempotency.js';

const LOCKED_STATUSES = new Set(['In Progress', 'Done']);

export interface ReconcileContext {
  ticketKey: string;
  eventId: string;
  existingSubtasks: TrackerSubtask[];
  tracker: IssueTracker;
}

export interface ReconcileResult {
  createdCount: number;
  keptCount: number;
  staledCount: number;
  noop: boolean;
  noopReason?: string;
}

export async function applyActions(
  actions: RefinerAction[],
  ctx: ReconcileContext,
): Promise<ReconcileResult> {
  const noopAction = actions.find((a) => a.type === 'noop');
  if (noopAction) {
    return {
      createdCount: 0,
      keptCount: 0,
      staledCount: 0,
      noop: true,
      noopReason: noopAction.reason,
    };
  }

  const existingByKey = new Map(ctx.existingSubtasks.map((s) => [s.key, s]));
  const existingDescriptions = ctx.existingSubtasks.map((s) => s.description);
  const staleMarkerPrefix = `[ferry:refiner-stale:${ctx.eventId}]`;

  let keptCount = 0;
  let staledCount = 0;

  for (const action of actions) {
    if (action.type === 'keep') {
      keptCount++;
      continue;
    }

    if (action.type === 'mark_stale') {
      const existing = existingByKey.get(action.existing_key);
      if (existing && LOCKED_STATUSES.has(existing.status)) {
        await ctx.tracker.postComment(
          ctx.ticketKey,
          `${staleMarkerPrefix} Would mark ${action.existing_key} stale but it is ${existing.status} — ${action.reason}`,
        );
      } else {
        await ctx.tracker.postComment(action.existing_key, `${staleMarkerPrefix} ${action.reason}`);
      }
      staledCount++;
    }
  }

  const createActions = actions.filter(
    (a): a is { type: 'create'; title: string; description: string } => a.type === 'create',
  );

  let createdCount = 0;
  if (createActions.length > 0) {
    const batch = filterExistingSubtasks(prepareBatch(createActions), existingDescriptions);
    const applied = await applyBatch(batch, (items) =>
      Promise.all(
        items.map((item) => ctx.tracker.createSubtask(ctx.ticketKey, item.title, item.description)),
      ),
    );
    createdCount = applied.createdCount;
  }

  return { createdCount, keptCount, staledCount, noop: false };
}
