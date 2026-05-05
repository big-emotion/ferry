import { describe, it, expect } from 'vitest';
import { prepareBatch, subtaskContentHash } from './batch.js';
import { filterExistingSubtasks } from './idempotency.js';
import type { SubtaskDraft } from './batch.js';

const createDrafts: SubtaskDraft[] = [
  { title: 'A', description: 'do A' },
  { title: 'B', description: 'do B' },
];

describe('Refiner idempotency dry-run (FR12 — content-hash re-trigger guard)', () => {
  it('a re-run producing identical create-actions produces zero net new sub-tasks', async () => {
    let nextId = 0;
    const create = async (items: { description: string }[]) =>
      items.map(() => ({ id: `t-${nextId++}` }));

    // First run.
    const first = filterExistingSubtasks(prepareBatch(createDrafts), []);
    const firstRefs = await create(first.subtasks);
    expect(firstRefs).toHaveLength(2);

    // Simulate Jira now contains those sub-task descriptions.
    const existing = first.subtasks.map((s) => s.description);

    // Second run (same create-actions, different event_id — re-trigger scenario).
    const second = filterExistingSubtasks(prepareBatch(createDrafts), existing);
    expect(second.subtasks).toHaveLength(0);
    const secondRefs = await create(second.subtasks);
    expect(secondRefs).toHaveLength(0);
  });

  it('content hash is stable across runs for the same title+description', () => {
    const h1 = subtaskContentHash('Add login button', 'Users want a login button');
    const h2 = subtaskContentHash('Add login button', 'Users want a login button');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(12);
  });
});
