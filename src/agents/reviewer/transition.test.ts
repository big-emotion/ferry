import { describe, expect, it } from 'vitest';
import { decideReviewerTransition } from './transition.js';

describe('reviewer transition', () => {
  it('merge-ready transitions to Ready to Merge with ferry:ready label', () => {
    const t = decideReviewerTransition({ decision: 'merge-ready' });
    expect(t.jira_status).toBe('Ready to Merge');
    expect(t.add_labels).toContain('ferry:ready');
    expect(t.remove_labels).toContain('ferry:reviewing');
    expect(t.next_phase).toBe('ready');
    expect(t.self_dispatch).toBe(false);
  });

  it('changes-requested transitions to Changes Requested and never self-dispatches', () => {
    const t = decideReviewerTransition({ decision: 'changes-requested' });
    expect(t.jira_status).toBe('Changes Requested');
    expect(t.next_phase).toBe('iterating');
    expect(t.remove_labels).toContain('ferry:reviewing');
    // Ferry must not self-trigger Iterator (FR40)
    expect(t.self_dispatch).toBe(false);
  });

  it('needs-human escalates without changing the column', () => {
    const t = decideReviewerTransition({ decision: 'needs-human' });
    expect(t.jira_status).toBeUndefined();
    expect(t.add_labels).toContain('needs-human');
    expect(t.next_phase).toBe('escalated');
  });
});
