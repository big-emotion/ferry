import { describe, it, expect } from 'vitest';
import { formatDeveloperCommit, formatBranchName } from './commit.js';

describe('formatDeveloperCommit (Story 4-2 FR15)', () => {
  it('renders the canonical commit message format', () => {
    expect(
      formatDeveloperCommit({
        ticketKey: 'CHAN-27',
        runId: '01HXYZ',
        summary: 'add login button',
      }),
    ).toBe('[CHAN-27] feat: add login button\n\n[ferry:developer:01HXYZ]');
  });

  it('lowercases the leading character of the summary', () => {
    expect(
      formatDeveloperCommit({
        ticketKey: 'CHAN-27',
        runId: 'r1',
        summary: 'Add Login Button',
      }),
    ).toContain('feat: add Login Button');
  });

  it('accepts a custom commit type', () => {
    expect(
      formatDeveloperCommit({
        ticketKey: 'CHAN-27',
        runId: 'r1',
        summary: 'fix off-by-one',
        type: 'fix',
      }),
    ).toContain('fix: fix off-by-one');
  });
});

describe('formatBranchName (Story 4-2)', () => {
  it.each([
    ['CHAN-27', 'ferry/CHAN-27'],
    ['CHAN-100', 'ferry/CHAN-100'],
  ])('formats %s -> %s', (key, expected) => {
    expect(formatBranchName(key)).toBe(expected);
  });
});
