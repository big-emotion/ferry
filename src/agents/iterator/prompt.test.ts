import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { buildIteratorPrompt, formatCommitMessage } from './prompt.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const iteratePrompt = readFileSync(path.join(repoRoot, 'prompts/iterate.md'), 'utf8');

const baseFinding = {
  rule_id: 'no-skipped-tests',
  message: 'remove .skip',
  file: 'src/foo.test.ts',
  line_start: 3,
  line_end: 3,
};

describe('prompts/iterate.md system prompt', () => {
  it('forbids node_modules and framework spelunking', () => {
    expect(iteratePrompt).toContain('Do NOT read `node_modules/`');
    expect(iteratePrompt).toContain('framework internals');
  });

  it('provides done({actionable: false}) escape hatch for missing framework knowledge', () => {
    expect(iteratePrompt).toContain('done({actionable: false, reason_if_not_actionable: ...})');
  });

  it('instructs parallel tool_use blocks with one-file-per-call rule', () => {
    expect(iteratePrompt).toContain('emit multiple `tool_use` blocks in one turn');
    expect(iteratePrompt).toContain('One file = one tool call');
  });
});

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
    expect(p).toContain('Iteration: 2');
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

  it('omits Fixes findings line when rule_ids is empty', () => {
    const msg = formatCommitMessage({
      ticket_key: 'CHAN-27',
      summary: 'address review feedback',
      rule_ids: [],
      run_id: 'run-2',
    });
    expect(msg).toContain('[CHAN-27] fix: address review feedback');
    expect(msg).not.toContain('Fixes findings');
    expect(msg).toContain('[ferry:iterator:run-2]');
  });
});
