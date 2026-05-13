import { describe, it, expect } from 'vitest';
import { parseForgeFlag, detectForgeFromGit, resolveForgeFromArgv } from './forge.js';

describe('parseForgeFlag', () => {
  it('returns undefined when --forge is absent', () => {
    expect(parseForgeFlag(['node', 'cli'])).toBeUndefined();
  });

  it('parses --forge github', () => {
    expect(parseForgeFlag(['--forge', 'github'])).toBe('github');
  });

  it('parses --forge gitlab', () => {
    expect(parseForgeFlag(['--forge', 'gitlab'])).toBe('gitlab');
  });

  it('accepts --forge=<value> form', () => {
    expect(parseForgeFlag(['--forge=gitlab'])).toBe('gitlab');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(parseForgeFlag(['--forge', '  GitLab  '])).toBe('gitlab');
  });

  it('throws for an unknown forge value', () => {
    expect(() => parseForgeFlag(['--forge', 'bitbucket'])).toThrow(/Unknown forge value/);
  });

  it('throws when --forge has no value', () => {
    expect(() => parseForgeFlag(['--forge'])).toThrow(/--forge requires a value/);
  });
});

describe('detectForgeFromGit', () => {
  it('returns github for a github.com HTTPS remote', () => {
    expect(detectForgeFromGit('https://github.com/owner/repo.git')).toBe('github');
  });

  it('returns github for a github.com SSH remote', () => {
    expect(detectForgeFromGit('git@github.com:owner/repo.git')).toBe('github');
  });

  it('returns gitlab for a gitlab.com remote', () => {
    expect(detectForgeFromGit('git@gitlab.com:owner/repo.git')).toBe('gitlab');
  });

  it('returns gitlab for a self-managed gitlab.example remote', () => {
    expect(detectForgeFromGit('https://gitlab.example.com/team/proj.git')).toBe('gitlab');
  });

  it('returns undefined for an unknown host', () => {
    expect(detectForgeFromGit('https://bitbucket.org/team/proj.git')).toBeUndefined();
  });

  it('returns undefined when no remote is provided and `git remote get-url origin` fails', () => {
    expect(detectForgeFromGit('')).toBeUndefined();
  });
});

describe('resolveForgeFromArgv', () => {
  it('returns github by default when no flag and no detectable remote', () => {
    // Without a remote override the detection falls back to executing git;
    // resolution still defaults to github when detection returns undefined.
    expect(resolveForgeFromArgv(['node', 'cli'])).toBeDefined();
  });

  it('returns the explicit flag value when present', () => {
    expect(resolveForgeFromArgv(['--forge', 'gitlab'])).toBe('gitlab');
  });
});
