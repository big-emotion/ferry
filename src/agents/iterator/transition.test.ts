import { describe, expect, it } from 'vitest';
import { decideIteratorTransition } from './transition.js';

describe('iterator transition', () => {
  it('returns In Review with ferry:reviewing label and increments iteration', () => {
    const t = decideIteratorTransition({ current_iteration: 0 });
    expect(t.jira_status).toBe('In Review');
    expect(t.add_labels).toContain('ferry:reviewing');
    expect(t.remove_labels).toContain('ferry:iterating');
    expect(t.next_phase).toBe('reviewing');
    expect(t.next_iteration).toBe(1);
    expect(t.self_dispatch).toBe(false);
  });

  it('caps iteration increments to non-negative inputs', () => {
    const t = decideIteratorTransition({ current_iteration: 2 });
    expect(t.next_iteration).toBe(3);
  });
});
