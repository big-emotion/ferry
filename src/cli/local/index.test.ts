import { describe, expect, it } from 'vitest';
import { CliUsageError, parseArgs } from './index.js';

const SCRIPT = ['node', 'local.js'] as const;

describe('parseArgs', () => {
  it('parses poll --once --dry-run', () => {
    expect(parseArgs([...SCRIPT, 'poll', '--once', '--dry-run'])).toEqual({
      command: 'poll',
      once: true,
      dryRun: true,
      port: 8787,
    });
  });

  it('parses serve with a custom port', () => {
    expect(parseArgs([...SCRIPT, 'serve', '--port', '9999'])).toEqual({
      command: 'serve',
      once: false,
      dryRun: false,
      port: 9999,
    });
  });

  it('rejects unknown commands', () => {
    expect(() => parseArgs([...SCRIPT, 'ship'])).toThrow(CliUsageError);
  });
});
