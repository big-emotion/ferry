import { describe, it, expect, afterEach } from 'vitest';
import { resolveForgeFromEnv, createRunnerFromEnv } from './factory.js';
import { GitHubActionsRunner } from './github-actions/index.js';
import { GitLabRunner } from './gitlab/index.js';
import { FerryError } from '../../errors/index.js';

const FORGE_VAR = 'FERRY_FORGE';
const GITLAB_VARS = [
  'FERRY_GITLAB_API_BASE',
  'FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN',
  'FERRY_GITLAB_TRIGGER_REF',
];

afterEach(() => {
  delete process.env[FORGE_VAR];
  for (const v of GITLAB_VARS) delete process.env[v];
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

  it('returns a GitLabRunner for FERRY_FORGE=gitlab', () => {
    process.env[FORGE_VAR] = 'gitlab';
    const runner = createRunnerFromEnv('token', 'owner', 'repo');
    expect(runner).toBeInstanceOf(GitLabRunner);
  });

  it('propagates GitLab options from env vars', () => {
    process.env[FORGE_VAR] = 'gitlab';
    process.env.FERRY_GITLAB_API_BASE = 'https://gitlab.example/api/v4';
    process.env.FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN = 'trig';
    process.env.FERRY_GITLAB_TRIGGER_REF = 'release';
    const runner = createRunnerFromEnv('token', 'owner', 'repo');
    expect(runner).toBeInstanceOf(GitLabRunner);
  });
});
