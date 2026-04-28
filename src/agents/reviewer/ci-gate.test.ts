import { describe, expect, it } from 'vitest';
import { gateCi } from './ci-gate.js';

describe('reviewer ci-gate', () => {
  it('pending CI returns pending-ci with no findings and skip flag', () => {
    const out = gateCi({ status: 'pending' });
    expect(out.outcome).toBe('pending-ci');
    expect(out.proceed).toBe(false);
    expect(out.findings).toEqual([]);
    expect(out.tokens.input).toBe(0);
    expect(out.tokens.output).toBe(0);
    expect(out.cost_eur).toBe(0);
  });

  it('red CI returns synthetic ci-failure finding and transitions to changes-requested', () => {
    const out = gateCi({
      status: 'red',
      failure_summary: 'lint failed on src/foo.ts:12',
    });
    expect(out.outcome).toBe('ci-red');
    expect(out.proceed).toBe(false);
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.rule_id).toBe('ci-failure');
    expect(f.message).toContain('lint failed');
    expect(out.next_state).toBe('changes-requested');
    expect(out.tokens.input).toBe(0);
    expect(out.tokens.output).toBe(0);
    expect(out.cost_eur).toBe(0);
  });

  it('green CI proceeds and emits no synthetic findings', () => {
    const out = gateCi({ status: 'green' });
    expect(out.outcome).toBe('ci-green');
    expect(out.proceed).toBe(true);
    expect(out.findings).toEqual([]);
  });

  it('red CI without summary still emits a finding with a default message', () => {
    const out = gateCi({ status: 'red' });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].message.length).toBeGreaterThan(0);
  });
});
