import { describe, it, expect, vi } from 'vitest';
import { prepareBatch, applyBatch, SUBTASK_CAP, subtaskContentHash } from './batch.js';
import type { SubtaskDraft } from './batch.js';
import { FerryError } from '../../lib/errors/index.js';

function makeDrafts(n: number): SubtaskDraft[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Sub ${i + 1}`,
    description: `Desc ${i + 1}`,
  }));
}

describe('prepareBatch', () => {
  it('passes through plans at or below the cap', () => {
    const result = prepareBatch(makeDrafts(SUBTASK_CAP));
    expect(result.truncated).toBe(false);
    expect(result.originalCount).toBe(SUBTASK_CAP);
    expect(result.subtasks).toHaveLength(SUBTASK_CAP);
  });

  it('truncates plans above the cap', () => {
    const result = prepareBatch(makeDrafts(SUBTASK_CAP + 5));
    expect(result.truncated).toBe(true);
    expect(result.originalCount).toBe(SUBTASK_CAP + 5);
    expect(result.subtasks).toHaveLength(SUBTASK_CAP);
  });

  it('appends a content-hash idempotency footer to each sub-task description', () => {
    const drafts: SubtaskDraft[] = [
      { title: 'A', description: 'do A' },
      { title: 'B', description: 'do B' },
    ];
    const result = prepareBatch(drafts);
    const hashA = subtaskContentHash('A', 'do A');
    const hashB = subtaskContentHash('B', 'do B');
    expect(result.subtasks[0].description).toContain(`[ferry:refiner-subtask:${hashA}]`);
    expect(result.subtasks[1].description).toContain(`[ferry:refiner-subtask:${hashB}]`);
  });

  it('content hash is stable: identical title+description yields the same marker', () => {
    const drafts: SubtaskDraft[] = [{ title: 'Same', description: 'same desc' }];
    const r1 = prepareBatch(drafts);
    const r2 = prepareBatch(drafts);
    expect(r1.subtasks[0].description).toBe(r2.subtasks[0].description);
  });

  it('SUBTASK_CAP is 12 per the spec', () => {
    expect(SUBTASK_CAP).toBe(12);
  });
});

describe('applyBatch', () => {
  it('returns the count of created sub-tasks on success', async () => {
    const create = vi.fn(async (items: { title: string }[]) =>
      items.map((_, i) => ({ id: `t-${i}` })),
    );
    const result = await applyBatch(prepareBatch(makeDrafts(3)), create);
    expect(result).toEqual({ createdCount: 3, ids: ['t-0', 't-1', 't-2'] });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('wraps callback failure in FerryError(transient) (FR10 atomicity)', async () => {
    const create = async () => {
      throw new Error('500 Internal Server Error');
    };
    await expect(applyBatch(prepareBatch(makeDrafts(3)), create)).rejects.toBeInstanceOf(
      FerryError,
    );
  });
});
