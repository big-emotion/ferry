import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatStepSummary, writeStepSummary } from './step-summary.js';
import type { AgentRunStats } from './step-summary.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

const zeroUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const baseStats: AgentRunStats = {
  role: 'developer',
  iterations: 5,
  usage: {
    input_tokens: 12000,
    output_tokens: 3000,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 8000,
  },
  toolCounts: { bash: 10, read_file: 4, write_file: 2 },
  toolCallRecords: [
    { name: 'read_file', outputSize: 50000 },
    { name: 'read_file', outputSize: 30000 },
    { name: 'bash', outputSize: 200 },
    { name: 'bash', outputSize: 150 },
    { name: 'write_file', outputSize: 1000 },
    { name: 'write_file', outputSize: 2000 },
  ],
  filesTouched: ['src/foo.ts', 'src/bar.ts'],
  branchPushed: 'ferry/PROJ-1',
  outcome: 'implemented',
};

describe('formatStepSummary', () => {
  it('includes the role in the heading', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('## Ferry developer');
  });

  it('shows outcome and iteration count', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('`implemented`');
    expect(out).toContain('| Iterations | 5 |');
  });

  it('shows token counts when non-zero', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('12,000');
    expect(out).toContain('3,000');
    expect(out).toContain('500');
    expect(out).toContain('8,000');
  });

  it('omits token rows when all counts are zero', () => {
    const out = formatStepSummary({ ...baseStats, usage: zeroUsage });
    expect(out).not.toContain('Input tokens');
    expect(out).not.toContain('Output tokens');
  });

  it('shows tool usage table sorted by call count descending', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('`bash`');
    expect(out).toContain('`read_file`');
    expect(out).toContain('`write_file`');
    const bashIdx = out.indexOf('`bash`');
    const readIdx = out.indexOf('`read_file`');
    expect(bashIdx).toBeLessThan(readIdx);
  });

  it('shows top-5 tool calls by output size', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('Top 5 tool calls by output size');
    expect(out).toContain('50,000');
    expect(out).toContain('30,000');
  });

  it('limits top-N table to 5 entries even with more records', () => {
    const many: AgentRunStats = {
      ...baseStats,
      toolCallRecords: Array.from({ length: 10 }, (_, i) => ({
        name: 'read_file',
        outputSize: (10 - i) * 1000,
      })),
    };
    const out = formatStepSummary(many);
    const header = 'Top 5 tool calls by output size';
    expect(out).toContain(header);
    // 5 data rows + header row + separator = 7 lines; check the last entry is 6,000
    expect(out).toContain('6,000');
    expect(out).not.toContain('5,000');
  });

  it('formats numbers in en-US regardless of host locale (regression #226)', () => {
    // Simulate a non-English host locale: patch toLocaleString to use 'fr-FR' when
    // no explicit locale is passed. If production code ever drops the 'en-US' argument,
    // French formatting (non-breaking-space grouping) will cause these assertions to fail.
    const original = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (
      locale?: string | string[],
      opts?: Intl.NumberFormatOptions,
    ) {
      return original.call(this, locale ?? 'fr-FR', opts);
    };
    try {
      const out = formatStepSummary(baseStats);
      expect(out).toContain('12,000');
      expect(out).toContain('3,000');
      expect(out).toContain('50,000');
      expect(out).toContain('30,000');
    } finally {
      Number.prototype.toLocaleString = original;
    }
  });

  it('shows files touched', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('`src/foo.ts`');
    expect(out).toContain('`src/bar.ts`');
  });

  it('omits files section when filesTouched is empty', () => {
    const out = formatStepSummary({ ...baseStats, filesTouched: [] });
    expect(out).not.toContain('Files touched');
  });

  it('shows branch pushed', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('`ferry/PROJ-1`');
  });

  it('omits branch when branchPushed is empty', () => {
    const out = formatStepSummary({ ...baseStats, branchPushed: '' });
    expect(out).not.toContain('Branch pushed');
  });

  it('shows success recommendation for implemented outcome', () => {
    const out = formatStepSummary(baseStats);
    expect(out).toContain('✅');
  });

  it('shows blocked recommendation for blocked outcome', () => {
    const out = formatStepSummary({ ...baseStats, outcome: 'blocked' });
    expect(out).toContain('🚨');
  });

  it('shows token-cap recommendation when stopReason is input-token-budget-exceeded', () => {
    const out = formatStepSummary({
      ...baseStats,
      outcome: 'blocked',
      stopReason: 'input-token-budget-exceeded',
    });
    expect(out).toContain('max_tokens_per_run');
  });

  it('shows iteration-cap recommendation when stopReason is iteration-cap-exceeded', () => {
    const out = formatStepSummary({
      ...baseStats,
      outcome: 'blocked',
      stopReason: 'iteration-cap-exceeded',
    });
    expect(out).toContain('Iteration cap exceeded');
  });

  it('shows approved recommendation for reviewer approved outcome', () => {
    const out = formatStepSummary({ ...baseStats, role: 'reviewer', outcome: 'approved' });
    expect(out).toContain('✅');
    expect(out).toContain('ready to merge');
  });

  it('shows changes-requested recommendation', () => {
    const out = formatStepSummary({ ...baseStats, role: 'reviewer', outcome: 'changes_requested' });
    expect(out).toContain('🔄');
  });
});

describe('writeStepSummary', () => {
  it('writes formatted markdown to GITHUB_STEP_SUMMARY', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-step-test-'));
    const outFile = join(dir, 'summary.md');
    writeFileSync(outFile, '');
    vi.stubEnv('GITHUB_STEP_SUMMARY', outFile);

    writeStepSummary(baseStats);

    const contents = readFileSync(outFile, 'utf8');
    expect(contents).toContain('## Ferry developer');
    expect(contents).toContain('`implemented`');
  });

  it('is a no-op when GITHUB_STEP_SUMMARY is not set', () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    expect(() => writeStepSummary(baseStats)).not.toThrow();
  });
});
