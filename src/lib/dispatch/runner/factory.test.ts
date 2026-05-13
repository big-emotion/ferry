import { describe, it, expect, afterEach } from 'vitest';
import { resolveForgeFromEnv, createRunnerFromEnv } from './factory.js';
import { GitHubActionsRunner } from './github-actions/index.js';
import { FerryError } from '../../errors/index.js';

const FORGE_VAR = 'FERRY_FORGE';

afterEach(() => {
  delete process.env[FORGE_VAR];
});

describe('resolveForgeFromEnv', () => {
  it('defaults to github when FERRY_FORGE is unset', () => {
    delete process.env[FORGE_VAR];
    expect(resolveForgeFromEnv()).toBe('github');
  });

  it('treats empty string as github default', () => {
    process.env[FORGE_VAR] = '';
    expect(resolveForgeFromEnv()).toBe('github');
  });

  it('returns github for FERRY_FORGE=github', () => {
    process.env[FORGE_VAR] = 'github';
    expect(resolveForgeFromEnv()).toBe('github');
  });

  it('is case-insensitive and trims whitespace', () => {
    process.env[FORGE_VAR] = '  GitHub  ';
    expect(resolveForgeFromEnv()).toBe('github');
  });

  it('returns gitlab for FERRY_FORGE=gitlab', () => {
    process.env[FORGE_VAR] = 'gitlab';
    expect(resolveForgeFromEnv()).toBe('gitlab');
  });

  it('throws FerryError for unknown forge value', () => {
    process.env[FORGE_VAR] = 'bitbucket';
    expect(() => resolveForgeFromEnv()).toThrow(FerryError);
  });
});

describe('createRunnerFromEnv', () => {
  it('returns a GitHubActionsRunner for FERRY_FORGE=github', () => {
    process.env[FORGE_VAR] = 'github';
    const runner = createRunnerFromEnv('token', 'owner', 'repo');
    expect(runner).toBeInstanceOf(GitHubActionsRunner);
  });

  it('returns a GitHubActionsRunner when FERRY_FORGE is unset', () => {
    delete process.env[FORGE_VAR];
    const runner = createRunnerFromEnv('token', 'owner', 'repo');
    expect(runner).toBeInstanceOf(GitHubActionsRunner);
  });

  it('throws a clear FerryError for FERRY_FORGE=gitlab pointing at the tracking issue', () => {
    process.env[FORGE_VAR] = 'gitlab';
    expect(() => createRunnerFromEnv('token', 'owner', 'repo')).toThrowError(
      /gitlab-runner-not-implemented/,
    );
    try {
      createRunnerFromEnv('token', 'owner', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(FerryError);
      const ferryErr = err as FerryError;
      expect(ferryErr.code).toBe('state-invariant');
      expect(ferryErr.context?.tracking).toBe('https://github.com/big-emotion/ferry/issues/210');
    }
  });
});
