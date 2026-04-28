import { describe, expect, it } from 'vitest';
import { fingerprint, fingerprintFinding } from './index.js';

describe('fingerprint', () => {
  it('is deterministic for the same inputs', () => {
    const a = fingerprint({
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 4,
      rule_id: 'no-co-authored-by',
    });
    const b = fingerprint({
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 4,
      rule_id: 'no-co-authored-by',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes windows path separators to POSIX', () => {
    const a = fingerprint({
      file: 'src\\foo\\bar.ts',
      line_start: 1,
      line_end: 1,
      rule_id: 'tests-accompany-source-changes',
    });
    const b = fingerprint({
      file: 'src/foo/bar.ts',
      line_start: 1,
      line_end: 1,
      rule_id: 'tests-accompany-source-changes',
    });
    expect(a).toBe(b);
  });

  it('different rule_ids produce different fingerprints', () => {
    const a = fingerprint({
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 1,
      rule_id: 'no-co-authored-by',
    });
    const b = fingerprint({
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 1,
      rule_id: 'no-skipped-tests',
    });
    expect(a).not.toBe(b);
  });

  it('fingerprintFinding tolerates missing line numbers via 0,0 default', () => {
    const fp = fingerprintFinding({
      rule_id: 'ci-failure',
      message: 'lint failed',
    });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
