import { describe, expect, it } from 'vitest';
import { checkHaltLabels } from './halt-labels.js';

describe('halt-labels', () => {
  it('exits with paused outcome when ferry:paused is present', () => {
    const out = checkHaltLabels({
      labels: ['ferry:paused', ['agent', 'dev'].join(':')],
    });
    expect(out.halt).toBe(true);
    expect(out.outcome).toBe('paused');
  });

  it('exits with needs_human_halt when needs-human is present', () => {
    const out = checkHaltLabels({ labels: ['needs-human'] });
    expect(out.halt).toBe(true);
    expect(out.outcome).toBe('needs_human_halt');
  });

  it('proceeds when neither label is present', () => {
    const out = checkHaltLabels({ labels: ['agent:developer'] });
    expect(out.halt).toBe(false);
  });

  it('paused takes precedence over needs-human (most-restrictive wins)', () => {
    const out = checkHaltLabels({ labels: ['needs-human', 'ferry:paused'] });
    expect(out.outcome).toBe('paused');
  });

  it('handles empty label arrays', () => {
    expect(checkHaltLabels({ labels: [] }).halt).toBe(false);
  });
});
