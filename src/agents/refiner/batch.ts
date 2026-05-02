/**
 * Story 3-2: atomic batch sub-task creation (FR10).
 */

import { FerryError } from '../../lib/errors/index.js';
import type { RefinerOutput, RefinerSubtask } from './schema.js';

export const SUBTASK_CAP = 12;

export interface BatchPrepared {
  subtasks: RefinerSubtask[];
  truncated: boolean;
  originalCount: number;
  planId: string;
}

export function prepareBatch(plan: RefinerOutput, planId: string, cap?: number): BatchPrepared {
  const subtaskCap = cap ?? (parseInt(process.env.FERRY_REFINER_SUBTASK_CAP ?? '', 10) || SUBTASK_CAP);
  const original = plan.subtasks;
  const truncated = original.length > subtaskCap;
  const slice = truncated ? original.slice(0, subtaskCap) : original;
  const subtasks = slice.map((s, i) => ({
    title: s.title,
    description: `${s.description}\n\n[ferry:refiner-subtask:${planId}:${i}]`,
  }));
  return {
    subtasks,
    truncated,
    originalCount: original.length,
    planId,
  };
}

export interface CreatedSubtaskRef {
  id: string;
}

export type CreateBatchFn = (items: RefinerSubtask[]) => Promise<CreatedSubtaskRef[]>;

export interface BatchApplied {
  createdCount: number;
  ids: string[];
}

export async function applyBatch(
  prepared: BatchPrepared,
  create: CreateBatchFn,
): Promise<BatchApplied> {
  try {
    const refs = await create(prepared.subtasks);
    return { createdCount: refs.length, ids: refs.map((r) => r.id) };
  } catch (e) {
    throw new FerryError('transient', {
      reason: 'batch-create-failed',
      cause: e instanceof Error ? e.message : String(e),
    });
  }
}
