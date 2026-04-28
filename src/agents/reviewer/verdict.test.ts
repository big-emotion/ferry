import { describe, expect, it } from 'vitest';
import {
  buildVerdict,
  truncateVerdict,
  writeVerdictToBody,
  ReviewerVerdictError,
  countWords,
} from './verdict.js';

describe('reviewer verdict', () => {
  it('builds a 3-field verdict with merge-ready when no findings', () => {
    const v = buildVerdict({
      findings: [],
      diffLines: 30,
    });
    expect(v.decision).toBe('merge-ready');
    expect(v['top-risk']).toBe('none');
    expect(v['reading-time-estimate']).toBeGreaterThanOrEqual(1);
  });

  it('uses changes-requested when findings are present', () => {
    const v = buildVerdict({
      findings: [{ rule_id: 'no-co-authored-by', message: 'remove trailer' }],
      diffLines: 100,
    });
    expect(v.decision).toBe('changes-requested');
    expect(v['top-risk']).not.toBe('none');
  });

  it('countWords splits on whitespace and ignores empty tokens', () => {
    expect(countWords('  hello   world  ')).toBe(2);
    expect(countWords('')).toBe(0);
  });

  it('truncateVerdict throws when summary exceeds 120 words', () => {
    const tooLong = Array.from({ length: 130 }, (_, i) => `w${i}`).join(' ');
    expect(() =>
      truncateVerdict({
        decision: 'changes-requested',
        'top-risk': tooLong,
        'reading-time-estimate': 5,
      }),
    ).toThrow(ReviewerVerdictError);
  });

  it('truncateVerdict passes through verdicts at or under 120 words', () => {
    const v = {
      decision: 'merge-ready' as const,
      'top-risk': 'none',
      'reading-time-estimate': 2,
    };
    expect(truncateVerdict(v)).toEqual(v);
  });

  it('promotes ci-failure to top-risk even when listed after other findings', () => {
    const v = buildVerdict({
      findings: [
        { rule_id: 'no-co-authored-by', message: 'remove trailer' },
        { rule_id: 'ci-failure', message: 'lint job failed' },
      ],
      diffLines: 50,
    });
    expect(v.decision).toBe('changes-requested');
    expect(v['top-risk']).toMatch(/^ci-failure:/);
  });

  it('writes a needs-human verdict block into PR body unchanged', () => {
    const verdict = {
      decision: 'needs-human' as const,
      'top-risk': 'oscillation: 3 iterations exhausted',
      'reading-time-estimate': 4,
    };
    const body = writeVerdictToBody('PR description.', verdict);
    expect(body).toContain('<!-- ferry:reviewer-verdict -->');
    expect(body).toContain('<!-- /ferry:reviewer-verdict -->');
    expect(body).toContain('decision: needs-human');
    expect(body).toContain('top-risk: oscillation: 3 iterations exhausted');
    expect(body).toContain('reading-time-estimate: 4');
    // idempotent re-write
    const body2 = writeVerdictToBody(body, verdict);
    const occurrences = body2.match(/<!-- ferry:reviewer-verdict -->/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('writes idempotent ferry:reviewer-verdict block into PR body', () => {
    const verdict = {
      decision: 'merge-ready' as const,
      'top-risk': 'none',
      'reading-time-estimate': 2,
    };
    const body1 = writeVerdictToBody('Hello world.', verdict);
    expect(body1).toContain('<!-- ferry:reviewer-verdict -->');
    expect(body1).toContain('<!-- /ferry:reviewer-verdict -->');
    expect(body1).toContain('decision: merge-ready');
    // re-writing replaces the slot, body remains stable
    const body2 = writeVerdictToBody(body1, {
      ...verdict,
      'reading-time-estimate': 3,
    });
    const occurrences = body2.match(/<!-- ferry:reviewer-verdict -->/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(body2).toContain('reading-time-estimate: 3');
  });
});
