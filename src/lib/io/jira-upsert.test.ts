import { describe, expect, it } from 'vitest';
import { upsertJiraComment } from './jira-upsert.js';

describe('upsertJiraComment', () => {
  it('updates in place when an existing marker matches the role', () => {
    const existing = [
      { id: 1, body: '[ferry:refiner:run-old] previous content' },
      { id: 2, body: 'unrelated comment' },
    ];
    const out = upsertJiraComment({
      existing_comments: existing,
      role: 'refiner',
      run_id: 'run-new',
      body: 'new content',
    });
    expect(out.action).toBe('update');
    expect(out.target_id).toBe(1);
    expect(out.body).toContain('[ferry:refiner:run-new]');
    expect(out.body).toContain('new content');
  });

  it('creates a new comment when no marker for the role exists', () => {
    const out = upsertJiraComment({
      existing_comments: [{ id: 99, body: 'unrelated' }],
      role: 'refiner',
      run_id: 'run-1',
      body: 'first refiner comment',
    });
    expect(out.action).toBe('create');
    expect(out.target_id).toBeUndefined();
    expect(out.body).toContain('[ferry:refiner:run-1]');
  });

  it('different roles produce separate comments', () => {
    const existing = [{ id: 1, body: '[ferry:refiner:run-1] refining note' }];
    const out = upsertJiraComment({
      existing_comments: existing,
      role: 'developer',
      run_id: 'run-2',
      body: 'developer note',
    });
    expect(out.action).toBe('create');
  });

  it('matches the existing comment by role marker prefix only (run_id is ignored)', () => {
    const existing = [{ id: 7, body: '[ferry:reviewer:abc] verdict block' }];
    const out = upsertJiraComment({
      existing_comments: existing,
      role: 'reviewer',
      run_id: 'xyz',
      body: 'updated verdict',
    });
    expect(out.action).toBe('update');
    expect(out.target_id).toBe(7);
  });
});
