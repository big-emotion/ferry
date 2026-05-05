import { describe, it, expect } from 'vitest';
import { filterExistingSubtasks } from './idempotency.js';
import { prepareBatch, subtaskContentHash } from './batch.js';
import type { SubtaskDraft } from './batch.js';

const drafts: SubtaskDraft[] = [
  { title: 'A', description: 'do A' },
  { title: 'B', description: 'do B' },
  { title: 'C', description: 'do C' },
];

describe('filterExistingSubtasks (FR12)', () => {
  it('drops sub-tasks whose content-hash marker is already present', () => {
    const prepared = prepareBatch(drafts);
    // Simulate B already existing in Jira
    const hashB = subtaskContentHash('B', 'do B');
    const existing = [`old description [ferry:refiner-subtask:${hashB}]`];
    const filtered = filterExistingSubtasks(prepared, existing);
    expect(filtered.subtasks).toHaveLength(2);
    expect(filtered.subtasks.map((s) => s.title)).toEqual(['A', 'C']);
  });

  it('returns input unchanged when no markers match', () => {
    const prepared = prepareBatch(drafts);
    const filtered = filterExistingSubtasks(prepared, ['unrelated text']);
    expect(filtered.subtasks).toHaveLength(3);
  });

  it('handles all-already-existing case (zero net new)', () => {
    const prepared = prepareBatch(drafts);
    const existing = prepared.subtasks.map((s) => s.description);
    const filtered = filterExistingSubtasks(prepared, existing);
    expect(filtered.subtasks).toHaveLength(0);
  });
});
