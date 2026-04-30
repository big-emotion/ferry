import { describe, it, expect } from 'vitest';
import { filterExistingSubtasks } from './idempotency.js';
import { prepareBatch } from './batch.js';
import type { RefinerOutput } from './schema.js';

const plan: RefinerOutput = {
  subtasks: [
    { title: 'A', description: 'do A' },
    { title: 'B', description: 'do B' },
    { title: 'C', description: 'do C' },
  ],
  touch_paths: ['x'],
  output_locale: 'en',
  audit_summary: '3 planned',
};

describe('filterExistingSubtasks (Story 3-3 FR12)', () => {
  it('drops sub-tasks whose marker is already present in existing list', () => {
    const prepared = prepareBatch(plan, 'plan-1');
    const existing = ['old description [ferry:refiner-subtask:plan-1:1]'];
    const filtered = filterExistingSubtasks(prepared, existing);
    expect(filtered.subtasks).toHaveLength(2);
    expect(filtered.subtasks.map((s) => s.title)).toEqual(['A', 'C']);
  });

  it('returns input unchanged when no markers match', () => {
    const prepared = prepareBatch(plan, 'plan-1');
    const filtered = filterExistingSubtasks(prepared, ['unrelated text']);
    expect(filtered.subtasks).toHaveLength(3);
  });

  it('handles all-already-existing case (zero net new)', () => {
    const prepared = prepareBatch(plan, 'plan-1');
    const existing = prepared.subtasks.map((s) => s.description);
    const filtered = filterExistingSubtasks(prepared, existing);
    expect(filtered.subtasks).toHaveLength(0);
  });
});
