import { describe, it, expect } from 'vitest';
import { prepareBatch, applyBatch } from './batch.js';
import { filterExistingSubtasks } from './idempotency.js';
import type { RefinerOutput } from './schema.js';

const plan: RefinerOutput = {
  subtasks: [
    { title: 'A', description: 'do A' },
    { title: 'B', description: 'do B' },
  ],
  touch_paths: ['x'],
  output_locale: 'en',
  audit_summary: '2 planned',
};

describe('Refiner idempotency dry-run (Story 3-3 AC4)', () => {
  it('a re-run on the same plan_id with prior sub-tasks produces zero net new', async () => {
    const planId = 'plan-1';
    let nextId = 0;
    const create = async (items: { description: string }[]) =>
      items.map(() => ({ id: `t-${nextId++}` }));

    // First run.
    const first = filterExistingSubtasks(prepareBatch(plan, planId), []);
    const firstApplied = await applyBatch(first, create);
    expect(firstApplied.createdCount).toBe(2);

    // Simulate Jira now contains those sub-task descriptions.
    const existing = first.subtasks.map((s) => s.description);

    // Second run (same plan_id).
    const second = filterExistingSubtasks(prepareBatch(plan, planId), existing);
    expect(second.subtasks).toHaveLength(0);
    const secondApplied = await applyBatch(second, create);
    expect(secondApplied.createdCount).toBe(0);
  });
});
