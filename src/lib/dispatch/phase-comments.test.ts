import { describe, it, expect } from 'vitest';
import {
  phaseToStatusLabel,
  formatPhaseStatusComment,
  phaseStatusMarker,
} from './phase-comments.js';

describe('phaseToStatusLabel (Story 2-4 FR44)', () => {
  it.each([
    ['refine', 'ferry:refining'],
    ['dev', 'ferry:developing'],
    ['review', 'ferry:reviewing'],
    ['iterate', 'ferry:iterating'],
  ] as const)('%s → %s', (phase, label) => {
    expect(phaseToStatusLabel(phase)).toBe(label);
  });
});

describe('phaseStatusMarker (Story 2-4)', () => {
  it.each([
    ['refine', 'r1', '[ferry:refiner:r1]'],
    ['dev', 'r2', '[ferry:dev:r2]'],
    ['review', 'r3', '[ferry:review:r3]'],
    ['iterate', 'r4', '[ferry:iterate:r4]'],
  ] as const)('%s/%s → %s', (phase, runId, marker) => {
    expect(phaseStatusMarker(phase, runId)).toBe(marker);
  });

  // Story 2-4 epic-2 review nit (Finding 1): the agent-name convention here
  // (verbatim phase for dev/review/iterate, refiner for refine) intentionally
  // differs from triggers.ts (developer/reviewer/iterator). This test pins
  // the current behavior so any future rename is intentional and reviewed.
  it('uses the abbreviated phase verbatim for dev/review/iterate (NOT developer/reviewer/iterator) per the documented convention gap', () => {
    expect(phaseStatusMarker('dev', 'x')).not.toContain('developer');
    expect(phaseStatusMarker('review', 'x')).not.toContain('reviewer');
    expect(phaseStatusMarker('iterate', 'x')).not.toContain('iterator');
    expect(phaseStatusMarker('refine', 'x')).toContain('refiner');
  });
});

describe('formatPhaseStatusComment (Story 2-4 FR42)', () => {
  it('renders the documented per-phase status comment shape', () => {
    const text = formatPhaseStatusComment({
      phase: 'refine',
      runId: '01HXYZ',
      outcome: 'Refinement complete',
      costEur: 0.0234,
      runUrl: 'https://github.com/big-emotion/ferry/actions/runs/123',
    });
    expect(text.startsWith('[ferry:refiner:01HXYZ]')).toBe(true);
    expect(text).toContain('Phase: refine');
    expect(text).toContain('Outcome: Refinement complete');
    expect(text).toContain('Cost: €0.02');
    expect(text).toContain('https://github.com/big-emotion/ferry/actions/runs/123');
  });

  it('always renders cost with two decimal places', () => {
    const text = formatPhaseStatusComment({
      phase: 'dev',
      runId: 'r1',
      outcome: 'ok',
      costEur: 1,
      runUrl: 'https://example.com/run/1',
    });
    expect(text).toContain('Cost: €1.00');
  });

  it('clamps negative costs to 0.00 (defensive)', () => {
    const text = formatPhaseStatusComment({
      phase: 'dev',
      runId: 'r1',
      outcome: 'ok',
      costEur: -0.5,
      runUrl: 'https://example.com/run/1',
    });
    expect(text).toContain('Cost: €0.00');
  });
});
