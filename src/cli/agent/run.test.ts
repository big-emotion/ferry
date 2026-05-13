import { describe, it, expect } from 'vitest';
import { parseArgs, CliUsageError } from './run.js';

const SCRIPT = ['node', 'agent.js'] as const;

describe('parseArgs', () => {
  it('parses run --role refiner', () => {
    expect(parseArgs([...SCRIPT, 'run', '--role', 'refiner'])).toEqual({
      command: 'run',
      role: 'refiner',
    });
  });

  it('accepts --role=<value> form', () => {
    expect(parseArgs([...SCRIPT, 'run', '--role=developer'])).toEqual({
      command: 'run',
      role: 'developer',
    });
  });

  it.each(['refiner', 'developer', 'reviewer', 'iterator'] as const)('accepts role: %s', (role) => {
    expect(parseArgs([...SCRIPT, 'run', '--role', role])).toEqual({ command: 'run', role });
  });

  it('rejects an unknown command', () => {
    expect(() => parseArgs([...SCRIPT, 'execute', '--role', 'refiner'])).toThrow(CliUsageError);
  });

  it('rejects missing command', () => {
    expect(() => parseArgs([...SCRIPT])).toThrow(CliUsageError);
  });

  it('rejects missing --role flag', () => {
    expect(() => parseArgs([...SCRIPT, 'run'])).toThrow(/Missing --role/);
  });

  it('rejects an unknown role value', () => {
    expect(() => parseArgs([...SCRIPT, 'run', '--role', 'planner'])).toThrow(/Invalid role/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs([...SCRIPT, 'run', '--mystery'])).toThrow(/Unknown argument/);
  });
});
