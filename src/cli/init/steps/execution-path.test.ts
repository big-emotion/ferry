import { describe, it, expect } from 'vitest';
import { EXECUTION_PATH_QUESTION, parseExecutionPathChoice } from './execution-path.js';

describe('parseExecutionPathChoice', () => {
  it('defaults to "script" for the (a) answer', () => {
    expect(parseExecutionPathChoice('a')).toBe('script');
    expect(parseExecutionPathChoice('A')).toBe('script');
  });

  it('selects "claude-code" for the (b) answer', () => {
    expect(parseExecutionPathChoice('b')).toBe('claude-code');
    expect(parseExecutionPathChoice('B')).toBe('claude-code');
  });

  it('accepts explicit path names (case/space-insensitive)', () => {
    expect(parseExecutionPathChoice('  Claude-Code ')).toBe('claude-code');
    expect(parseExecutionPathChoice('claude-code-action')).toBe('claude-code');
    expect(parseExecutionPathChoice('script')).toBe('script');
  });

  it('falls back to the safe "script" path for empty or unknown input', () => {
    expect(parseExecutionPathChoice('')).toBe('script');
    expect(parseExecutionPathChoice('   ')).toBe('script');
    expect(parseExecutionPathChoice('yolo')).toBe('script');
  });

  it('exposes a prompt that names both options', () => {
    expect(EXECUTION_PATH_QUESTION).toMatch(/script/i);
    expect(EXECUTION_PATH_QUESTION).toMatch(/claude-code/i);
  });
});
