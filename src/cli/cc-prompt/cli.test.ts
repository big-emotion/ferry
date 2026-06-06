import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  parseArgs,
  renderPrompt,
  formatGithubOutput,
  UsageError,
  type CcPromptArgs,
} from './cli.js';
import type { CcAgent } from '../../lib/prompts/cc-prompt.js';

const BUNDLED: Record<CcAgent, string> = {
  refiner: 'refiner default TICKET_KEY RUN_ID',
  dev: 'dev default TICKET_KEY RUN_ID REVIEW_TRANSITION_ID',
  review: 'review TICKET_KEY RUN_ID APPROVE_TRANSITION_ID CHANGES_TRANSITION_ID',
  iterate: 'iterate TICKET_KEY RUN_ID REVIEW_TRANSITION_ID',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseArgs', () => {
  it('parses a dev invocation', () => {
    const args = parseArgs([
      '--agent',
      'dev',
      '--ticket-key',
      'ABC-1',
      '--run-id',
      'r9',
      '--review-transition-id',
      '31',
      '--repo-root',
      '/repo',
    ]);
    expect(args.agent).toBe('dev');
    expect(args.repoRoot).toBe('/repo');
    expect(args.outputName).toBe('prompt');
    expect(args.values).toEqual({
      TICKET_KEY: 'ABC-1',
      RUN_ID: 'r9',
      REVIEW_TRANSITION_ID: '31',
    });
  });

  it('rejects a missing --agent', () => {
    expect(() => parseArgs(['--ticket-key', 'X'])).toThrow(UsageError);
  });

  it('rejects an unknown --agent', () => {
    expect(() => parseArgs(['--agent', 'wizard', '--ticket-key', 'X', '--run-id', 'y'])).toThrow(
      /must be one of/,
    );
  });

  it('rejects a missing --ticket-key', () => {
    expect(() => parseArgs(['--agent', 'refiner', '--run-id', 'y'])).toThrow(/--ticket-key/);
  });

  it('allows an empty approve transition id for the reviewer', () => {
    const args = parseArgs([
      '--agent',
      'review',
      '--ticket-key',
      'X-1',
      '--run-id',
      'y',
      '--approve-transition-id',
      '',
      '--changes-transition-id',
      '41',
    ]);
    expect(args.values.APPROVE_TRANSITION_ID).toBe('');
    expect(args.values.CHANGES_TRANSITION_ID).toBe('41');
  });

  it('defaults a missing transition flag to an empty string', () => {
    const args = parseArgs(['--agent', 'dev', '--ticket-key', 'X-1', '--run-id', 'y']);
    expect(args.values.REVIEW_TRANSITION_ID).toBe('');
  });

  it('honours --output-name', () => {
    const args = parseArgs([
      '--agent',
      'refiner',
      '--ticket-key',
      'X',
      '--run-id',
      'y',
      '--output-name',
      'sys',
    ]);
    expect(args.outputName).toBe('sys');
  });
});

describe('renderPrompt', () => {
  const args: CcPromptArgs = {
    path: 'claude-code',
    agent: 'dev',
    repoRoot: '/repo',
    outputName: 'prompt',
    values: { TICKET_KEY: 'ABC-1', RUN_ID: 'r9', REVIEW_TRANSITION_ID: '31' },
  };

  it('substitutes tokens in the bundled default when no override exists', () => {
    const result = renderPrompt(args, BUNDLED, () => false);
    expect(result.source).toBe('bundled');
    expect(result.text).toBe('dev default ABC-1 r9 31');
  });

  it('uses the consumer override when present', () => {
    const result = renderPrompt(
      args,
      BUNDLED,
      (p) => p === '/repo/prompts/dev.claude-code.md',
      () => 'custom TICKET_KEY',
    );
    expect(result.source).toBe('override');
    expect(result.text).toBe('custom ABC-1');
  });

  it('throws when the consumer override is empty', () => {
    expect(() =>
      renderPrompt(
        args,
        BUNDLED,
        (p) => p === '/repo/prompts/dev.claude-code.md',
        () => '   \n  ',
      ),
    ).toThrow(/empty/);
  });
});

describe('formatGithubOutput', () => {
  it('wraps the value in a heredoc block', () => {
    expect(formatGithubOutput('prompt', 'hello', () => 'DELIM')).toBe(
      'prompt<<DELIM\nhello\nDELIM\n',
    );
  });

  it('strips a trailing newline from the value', () => {
    expect(formatGithubOutput('prompt', 'hello\n\n', () => 'D')).toBe('prompt<<D\nhello\nD\n');
  });

  it('regenerates the delimiter when it collides with a content line', () => {
    const gen = vi.fn<() => string>().mockReturnValueOnce('COLLIDE').mockReturnValue('SAFE');
    expect(formatGithubOutput('prompt', 'a\nCOLLIDE\nb', gen)).toBe(
      'prompt<<SAFE\na\nCOLLIDE\nb\nSAFE\n',
    );
  });
});
