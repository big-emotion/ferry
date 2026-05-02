import { describe, it, expect, vi } from 'vitest';
import { resolveGitConfig } from './resolve-git-config.js';
import type { FerryConfig } from '../config.js';
import { DEFAULT_FERRY_CONFIG } from '../config.js';
import type { CIRunner } from '../dispatch/runner/types.js';

function makeMockRunner(defaultBranch = 'main'): CIRunner {
  return {
    getRepoDefaultBranch: vi.fn().mockResolvedValue(defaultBranch),
  } as unknown as CIRunner;
}

function makeConfig(git: Partial<FerryConfig['git']>): FerryConfig {
  return {
    ...DEFAULT_FERRY_CONFIG,
    git: { ...DEFAULT_FERRY_CONFIG.git, ...git },
  };
}

describe('resolveGitConfig', () => {
  it('resolves base_branch from repo default when null', async () => {
    const runner = makeMockRunner('develop');
    const cfg = makeConfig({ base_branch: null, target_branch: null });
    const result = await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(result.baseBranch).toBe('develop');
    expect(result.targetBranch).toBe('develop');
  });

  it('uses configured base_branch without calling the API', async () => {
    const runner = makeMockRunner('main');
    const cfg = makeConfig({ base_branch: 'release/v2', target_branch: null });
    const result = await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(result.baseBranch).toBe('release/v2');
    expect(result.targetBranch).toBe('release/v2');
    expect(runner.getRepoDefaultBranch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('uses explicit target_branch independently of base_branch', async () => {
    const runner = makeMockRunner('main');
    const cfg = makeConfig({ base_branch: 'develop', target_branch: 'staging' });
    const result = await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(result.baseBranch).toBe('develop');
    expect(result.targetBranch).toBe('staging');
  });

  it('uses custom working_branch_prefix', async () => {
    const runner = makeMockRunner('main');
    const cfg = makeConfig({ working_branch_prefix: 'bot/' });
    const result = await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(result.workingBranchPrefix).toBe('bot/');
  });

  it('defaults working_branch_prefix to ferry/', async () => {
    const runner = makeMockRunner('main');
    const cfg = makeConfig({});
    const result = await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(result.workingBranchPrefix).toBe('ferry/');
  });

  it('only calls getRepoDefaultBranch once when both base and target are null', async () => {
    const runner = makeMockRunner('next');
    const cfg = makeConfig({ base_branch: null, target_branch: null });
    await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(runner.getRepoDefaultBranch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});
