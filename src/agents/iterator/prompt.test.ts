import { describe, expect, it } from 'vitest';
import { buildIteratorPrompt, formatCommitMessage } from './prompt.js';

const baseFinding = {
  rule_id: 'no-skipped-tests',
  message: 'remove .skip',
  file: 'src/foo.test.ts',
  line_start: 3,
  line_end: 3,
};

describe('iterator prompt', () => {
  it('renders correctly with 0 prior iterations', () => {
    const p = buildIteratorPrompt({
      ticket_key: 'CHAN-27',
      iteration_history: [],
      latest_findings: [baseFinding],
      touch_paths: ['src/foo.test.ts'],
      branch_head_sha: 'abc123',
    });
    expect(p).toContain('CHAN-27');
    expect(p).toContain('Iteration: 0');
    expect(p).toContain('no-skipped-tests');
    expect(p).toContain('touch_paths');
  });

  it('injects 1 prior iteration with fingerprints', () => {
    const p = buildIteratorPrompt({
      ticket_key: 'CHAN-27',
      iteration_history: [{ iteration: 0, pr_sha: 'deadbeef', fingerprints: ['f0'] }],
      latest_findings: [baseFinding],
      touch_paths: ['src/foo.test.ts'],
      branch_head_sha: 'abc123',
    });
    expect(p).toContain('Iteration: 1');
    expect(p).toContain('deadbeef');
    expect(p).toContain('f0');
  });

  it('injects 2 prior iterations and renders both', () => {
    const p = buildIteratorPrompt({
      ticket_key: 'CHAN-27',
      iteration_history: [
        { iteration: 0, pr_sha: 'aaa', fingerprints: ['f0'] },
        { iteration: 1, pr_sha: 'bbb', fingerprints: ['f1'] },
      ],
      latest_findings: [baseFinding],
      touch_paths: ['src/foo.test.ts'],
      branch_head_sha: 'ccc',
    });
    expect(p).toContain('aaa');
    expect(p).toContain('bbb');
    expect(p).toContain('ccc');
    expect(p).toContain('Iteration: 2');
  });

  it('still emits the Latest findings section header when findings list is empty', () => {
    const p = buildIteratorPrompt({
      ticket_key: 'CHAN-27',
      iteration_history: [],
      latest_findings: [],
      touch_paths: ['src/foo.test.ts'],
      branch_head_sha: 'abc123',
    });
    expect(p).toContain('Latest findings:');
    expect(p).toContain('Branch HEAD: abc123');
  });

  it('formats iterator commit message with run_id marker', () => {
    const msg = formatCommitMessage({
      ticket_key: 'CHAN-27',
      summary: 'remove .skip',
      rule_ids: ['no-skipped-tests', 'no-co-authored-by'],
      run_id: 'run-1',
    });
    expect(msg).toContain('[CHAN-27] fix: remove .skip');
    expect(msg).toContain('Fixes findings: no-skipped-tests, no-co-authored-by');
    expect(msg).toContain('[ferry:iterator:run-1]');
  });
});
