import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFerryConfigFromBaseBranch } from './config-reload.js';
import { DEFAULT_FERRY_CONFIG } from '../config.js';
import type { FerryConfig } from '../config.js';

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn<(cmd: string, args: string[], opts?: unknown) => Buffer | string>(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

const REPO_ROOT = '/repo';
const BASE_BRANCH = 'recette';
const fallback: FerryConfig = { ...DEFAULT_FERRY_CONFIG };

function mockFetchSuccess(): void {
  mockExecFileSync.mockImplementationOnce(() => Buffer.from(''));
}

function mockFetchFailure(): void {
  mockExecFileSync.mockImplementationOnce(() => {
    throw new Error('git fetch failed');
  });
}

function mockGitShow(content: string): void {
  mockExecFileSync.mockImplementationOnce(() => content);
}

function mockGitShowNotFound(): void {
  mockExecFileSync.mockImplementationOnce(() => {
    throw new Error('fatal: Path not found');
  });
}

describe('loadFerryConfigFromBaseBranch', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns config from base_branch when ferry.config.json exists there', () => {
    mockFetchSuccess();
    mockGitShow(JSON.stringify({ limits: { max_tokens_per_run: 5_000_000 } }));

    const cfg = loadFerryConfigFromBaseBranch(BASE_BRANCH, REPO_ROOT, fallback);

    expect(cfg.limits.max_tokens_per_run).toBe(5_000_000);
    expect(cfg.limits.max_iterations).toBe(DEFAULT_FERRY_CONFIG.limits.max_iterations);
  });

  it('uses correct git ref: origin/<baseBranch>:ferry.config.json', () => {
    mockFetchSuccess();
    mockGitShow('{}');

    loadFerryConfigFromBaseBranch(BASE_BRANCH, REPO_ROOT, fallback);

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', BASE_BRANCH],
      expect.objectContaining({ cwd: REPO_ROOT }),
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['show', `origin/${BASE_BRANCH}:ferry.config.json`],
      expect.objectContaining({ cwd: REPO_ROOT }),
    );
  });

  it('returns fallback when git fetch fails (branch does not exist on origin)', () => {
    mockFetchFailure();

    const cfg = loadFerryConfigFromBaseBranch(BASE_BRANCH, REPO_ROOT, fallback);

    expect(cfg).toBe(fallback);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns fallback when ferry.config.json does not exist on base_branch', () => {
    mockFetchSuccess();
    mockGitShowNotFound();

    const cfg = loadFerryConfigFromBaseBranch(BASE_BRANCH, REPO_ROOT, fallback);

    expect(cfg).toBe(fallback);
  });

  it('propagates FerryError when config on base_branch is invalid', () => {
    mockFetchSuccess();
    mockGitShow(JSON.stringify({ models: { dev: { provider: 'invalid', model: 'x' } } }));

    expect(() =>
      loadFerryConfigFromBaseBranch(BASE_BRANCH, REPO_ROOT, fallback),
    ).toThrowError(/invalid-ferry-config/);
  });

  it('returns empty-object config (all defaults) when base_branch has empty ferry.config.json', () => {
    mockFetchSuccess();
    mockGitShow('{}');

    const cfg = loadFerryConfigFromBaseBranch(BASE_BRANCH, REPO_ROOT, fallback);

    expect(cfg).toEqual(DEFAULT_FERRY_CONFIG);
  });
});
