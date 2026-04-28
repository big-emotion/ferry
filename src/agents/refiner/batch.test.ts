import { describe, it, expect, vi } from 'vitest';
import { prepareBatch, applyBatch, SUBTASK_CAP } from './batch.js';
import type { RefinerOutput } from './schema.js';
import { FerryError } from '../../lib/error.js';

function makePlan(n: number): RefinerOutput {
  return {
    subtasks: Array.from({ length: n }, (_, i) => ({
      title: `Sub ${i + 1}`,
      description: `Desc ${i + 1}`,
    })),
    touch_paths: ['src/x.ts'],
    output_locale: 'en',
    audit_summary: `${n} planned`,
  };
}

describe('prepareBatch (Story 3-2)', () => {
  it('passes through plans at or below the cap', () => {
    const result = prepareBatch(makePlan(SUBTASK_CAP), 'plan-1');
    expect(result.truncated).toBe(false);
    expect(result.originalCount).toBe(SUBTASK_CAP);
    expect(result.subtasks).toHaveLength(SUBTASK_CAP);
  });

  it('truncates plans above the cap', () => {
    const result = prepareBatch(makePlan(SUBTASK_CAP + 5), 'plan-1');
    expect(result.truncated).toBe(true);
    expect(result.originalCount).toBe(SUBTASK_CAP + 5);
    expect(result.subtasks).toHaveLength(SUBTASK_CAP);
  });

  it('appends an idempotency footer to each sub-task description', () => {
    const result = prepareBatch(makePlan(2), 'plan-xyz');
    expect(result.subtasks[0].description).toContain('[ferry:refiner-subtask:plan-xyz:0]');
    expect(result.subtasks[1].description).toContain('[ferry:refiner-subtask:plan-xyz:1]');
  });

  it('SUBTASK_CAP is 12 per the spec', () => {
    expect(SUBTASK_CAP).toBe(12);
  });
});

describe('applyBatch (Story 3-2)', () => {
  it('returns the count of created sub-tasks on success', async () => {
    const create = vi.fn(async (items: { title: string }[]) =>
      items.map((_, i) => ({ id: `t-${i}` })),
    );
    const result = await applyBatch(prepareBatch(makePlan(3), 'plan-1'), create);
    expect(result).toEqual({ createdCount: 3, ids: ['t-0', 't-1', 't-2'] });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('wraps callback failure in FerryError(transient) (FR10 atomicity)', async () => {
    const create = async () => {
      throw new Error('500 Internal Server Error');
    };
    await expect(applyBatch(prepareBatch(makePlan(3), 'plan-1'), create)).rejects.toBeInstanceOf(
      FerryError,
    );
  });
});
