/**
 * Atomic batch sub-task creation (FR10).
 *
 * Idempotency markers use a SHA-256 content hash of (title + description) so
 * that identical sub-tasks across different event runs collapse naturally.
 */

import { createHash } from 'node:crypto';
import { FerryError } from '../../lib/errors/index.js';

export const SUBTASK_CAP = 12;

export interface SubtaskDraft {
  title: string;
  description: string;
}

export interface BatchPrepared {
  subtasks: SubtaskDraft[];
  truncated: boolean;
  originalCount: number;
}

export function subtaskContentHash(title: string, description: string): string {
  return createHash('sha256').update(`${title}\n${description}`).digest('hex').slice(0, 12);
}

export function prepareBatch(createActions: SubtaskDraft[], cap?: number): BatchPrepared {
  const subtaskCap =
    cap ?? (parseInt(process.env.FERRY_REFINER_SUBTASK_CAP ?? '', 10) || SUBTASK_CAP);
  const truncated = createActions.length > subtaskCap;
  const slice = truncated ? createActions.slice(0, subtaskCap) : createActions;
  const subtasks = slice.map((s) => ({
    title: s.title,
    description: `${s.description}\n\n[ferry:refiner-subtask:${subtaskContentHash(s.title, s.description)}]`,
  }));
  return {
    subtasks,
    truncated,
    originalCount: createActions.length,
  };
}

export interface CreatedSubtaskRef {
  id: string;
}

export type CreateBatchFn = (items: SubtaskDraft[]) => Promise<CreatedSubtaskRef[]>;

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
