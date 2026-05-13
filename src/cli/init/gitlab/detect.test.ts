import { describe, it, expect } from 'vitest';
import { detectGitLabProject } from './detect.js';

describe('detectGitLabProject', () => {
  it('parses an SSH gitlab.com remote', () => {
    expect(detectGitLabProject('git@gitlab.com:acme/widgets.git')).toEqual({
      host: 'gitlab.com',
      path: 'acme/widgets',
    });
  });

  it('parses an HTTPS gitlab.com remote', () => {
    expect(detectGitLabProject('https://gitlab.com/acme/widgets.git')).toEqual({
      host: 'gitlab.com',
      path: 'acme/widgets',
    });
  });

  it('parses an HTTPS gitlab.com remote without trailing .git', () => {
    expect(detectGitLabProject('https://gitlab.com/acme/widgets')).toEqual({
      host: 'gitlab.com',
      path: 'acme/widgets',
    });
  });

  it('parses subgroup paths (a/b/c)', () => {
    expect(detectGitLabProject('https://gitlab.com/acme/team/widgets.git')).toEqual({
      host: 'gitlab.com',
      path: 'acme/team/widgets',
    });
  });

  it('parses a self-managed GitLab instance', () => {
    expect(detectGitLabProject('https://gitlab.example.com/team/proj.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'team/proj',
    });
  });

  it('parses an SSH self-managed gitlab instance', () => {
    expect(detectGitLabProject('git@gitlab.example.com:team/proj.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'team/proj',
    });
  });

  it('returns undefined for github remotes', () => {
    expect(detectGitLabProject('git@github.com:owner/repo.git')).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(detectGitLabProject('')).toBeUndefined();
  });

  it('returns undefined for an unknown host', () => {
    expect(detectGitLabProject('https://bitbucket.org/team/proj.git')).toBeUndefined();
  });
});
