import { describe, it, expect } from 'vitest';
import { parseIssueNumber } from './repo-setup.js';

describe('parseIssueNumber', () => {
  it('extracts the number from the issue URL gh prints on create', () => {
    expect(parseIssueNumber('https://github.com/big-emotion/ferry/issues/42')).toBe(42);
  });

  it('tolerates trailing newline and surrounding whitespace', () => {
    expect(parseIssueNumber('  https://github.com/acme/site/issues/7\n')).toBe(7);
  });

  it('reads the number even when extra output follows the URL', () => {
    const stdout = 'Creating issue in acme/site\n\nhttps://github.com/acme/site/issues/1337\n';
    expect(parseIssueNumber(stdout)).toBe(1337);
  });

  it('returns null when the output contains no issue URL', () => {
    expect(parseIssueNumber('gh: could not create issue')).toBeNull();
  });

  it('returns null for empty output', () => {
    expect(parseIssueNumber('')).toBeNull();
  });
});
