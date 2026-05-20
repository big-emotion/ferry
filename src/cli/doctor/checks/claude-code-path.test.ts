import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

import { resolveExecutionPath, checkClaudeCodePath } from './claude-code-path.js';

function makeRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ferry-cc-path-'));
}

function writeConfig(root: string, obj: unknown): void {
  writeFileSync(join(root, 'ferry.config.json'), JSON.stringify(obj, null, 2));
}

describe('resolveExecutionPath', () => {
  let root: string;
  beforeEach(() => {
    root = makeRepoRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('defaults to script when no ferry.config.* is present', () => {
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('defaults to script when execution_path is absent', () => {
    writeConfig(root, { limits: { max_iterations: 3 } });
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('returns script when execution_path is explicitly "script"', () => {
    writeConfig(root, { execution_path: 'script' });
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('returns claude-code when execution_path is "claude-code"', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    expect(resolveExecutionPath(root)).toBe('claude-code');
  });

  it('defaults to script for an unknown execution_path value', () => {
    writeConfig(root, { execution_path: 'magic' });
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('defaults to script when ferry.config.json is unparseable', () => {
    writeFileSync(join(root, 'ferry.config.json'), '{ not json');
    expect(resolveExecutionPath(root)).toBe('script');
  });
});

describe('checkClaudeCodePath', () => {
  let root: string;

  beforeEach(() => {
    vi.resetAllMocks();
    root = makeRepoRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('skips (does not flag a missing token) when execution_path is script', async () => {
    writeConfig(root, { execution_path: 'script' });
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
    expect(res.detail).toContain('script');
  });

  it('skips when no ferry.config.* is present (default script)', async () => {
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
  });

  it('is red when execution_path is claude-code and the token is absent everywhere', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockExecSync.mockReturnValue(JSON.stringify([{ name: 'FERRY_APP_ID' }]));
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(res.remedy).toContain('claude setup-token');
  });

  it('is green when execution_path is claude-code and the secret exists in the repo', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockExecSync.mockReturnValue(
      JSON.stringify([{ name: 'FERRY_APP_ID' }, { name: 'CLAUDE_CODE_OAUTH_TOKEN' }]),
    );
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('claude-code');
  });

  it('is green when a well-formed token is supplied locally', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    const res = await checkClaudeCodePath({
      repoRoot: root,
      repo: 'owner/repo',
      claudeCodeOauthToken: 'sk-ant-oat01-abc123',
    });
    expect(res.status).toBe('green');
  });

  it('is yellow when the supplied token looks like an Anthropic API key (forbidden on this path)', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    const res = await checkClaudeCodePath({
      repoRoot: root,
      repo: 'owner/repo',
      claudeCodeOauthToken: 'sk-ant-api03-abc123',
    });
    expect(res.status).toBe('yellow');
    expect(res.detail.toLowerCase()).toContain('api key');
  });

  it('does not query repo secrets when execution_path is script', async () => {
    writeConfig(root, { execution_path: 'script' });
    await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('is yellow when execution_path is claude-code but a model uses a non-Anthropic provider (issue #329)', async () => {
    writeConfig(root, {
      execution_path: 'claude-code',
      models: {
        refiner: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        dev: { provider: 'openai', model: 'gpt-5' },
        review: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        iterate: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      },
    });
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('yellow');
    expect(res.detail.toLowerCase()).toContain('provider');
    expect(res.detail).toContain('provider-gate');
  });

  it('does not warn about providers when execution_path is script (mixed-provider is valid for script)', async () => {
    writeConfig(root, {
      execution_path: 'script',
      models: { dev: { provider: 'openai', model: 'gpt-5' } },
    });
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
  });
});
