import { describe, it, expect, vi } from 'vitest';
import { resolveGitConfig, resolveBranchPrefix } from './resolve-git-config.js';
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

function makeIssue(opts: { issueType?: string; labels?: string[] } = {}): {
  issueType: string;
  labels: string[];
} {
  return { issueType: opts.issueType ?? 'Story', labels: opts.labels ?? [] };
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

  it('uses custom working_branch_prefix string', async () => {
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

  it('passes through a mapping working_branch_prefix unchanged', async () => {
    const runner = makeMockRunner('main');
    const mapping = { Bug: 'bugfix/', Story: 'feature/', default: 'ferry/' };
    const cfg = makeConfig({ working_branch_prefix: mapping });
    const result = await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(result.workingBranchPrefix).toEqual(mapping);
  });

  it('only calls getRepoDefaultBranch once when both base and target are null', async () => {
    const runner = makeMockRunner('next');
    const cfg = makeConfig({ base_branch: null, target_branch: null });
    await resolveGitConfig(cfg, runner, 'org', 'repo');
    expect(runner.getRepoDefaultBranch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBranchPrefix', () => {
  describe('string prefix (static)', () => {
    it('returns the string as-is', () => {
      expect(resolveBranchPrefix('ferry/', makeIssue())).toBe('ferry/');
    });

    it('returns custom static prefix', () => {
      expect(resolveBranchPrefix('bot/', makeIssue({ issueType: 'Bug' }))).toBe('bot/');
    });
  });

  describe('mapping prefix — issueType resolution', () => {
    const mapping = {
      Bug: 'bugfix/',
      Story: 'feature/',
      Task: 'chore/',
      default: 'ferry/',
    };

    it('maps Bug to bugfix/', () => {
      expect(resolveBranchPrefix(mapping, makeIssue({ issueType: 'Bug' }))).toBe('bugfix/');
    });

    it('maps Story to feature/', () => {
      expect(resolveBranchPrefix(mapping, makeIssue({ issueType: 'Story' }))).toBe('feature/');
    });

    it('maps Task to chore/', () => {
      expect(resolveBranchPrefix(mapping, makeIssue({ issueType: 'Task' }))).toBe('chore/');
    });

    it('falls back to default when issueType not in mapping', () => {
      expect(resolveBranchPrefix(mapping, makeIssue({ issueType: 'Epic' }))).toBe('ferry/');
    });
  });

  describe('mapping prefix — ferry:type label override', () => {
    const mapping = {
      Bug: 'bugfix/',
      Story: 'feature/',
      hotfix: 'hotfix/',
      default: 'ferry/',
    };

    it('label ferry:type:Bug overrides issueType Story', () => {
      // Label X must match a mapping key — here "Bug" overrides Story's normal prefix
      const issue = makeIssue({ issueType: 'Story', labels: ['ferry:type:Bug'] });
      expect(resolveBranchPrefix(mapping, issue)).toBe('bugfix/');
    });

    it('label ferry:type:hotfix maps to hotfix/ when in mapping', () => {
      const issue = makeIssue({ issueType: 'Story', labels: ['ferry:type:hotfix'] });
      expect(resolveBranchPrefix(mapping, issue)).toBe('hotfix/');
    });

    it('label ferry:type:<X> with unknown X falls through to issueType', () => {
      const issue = makeIssue({ issueType: 'Bug', labels: ['ferry:type:unknown-type'] });
      expect(resolveBranchPrefix(mapping, issue)).toBe('bugfix/');
    });

    it('only the first ferry:type label is used', () => {
      const extendedMapping = { ...mapping, chore: 'chore/' };
      const issue = makeIssue({
        issueType: 'Bug',
        labels: ['ferry:type:hotfix', 'ferry:type:chore'],
      });
      expect(resolveBranchPrefix(extendedMapping, issue)).toBe('hotfix/');
    });

    it('ignores non-ferry:type labels', () => {
      const issue = makeIssue({
        issueType: 'Story',
        labels: ['ferry:approved', 'ferry:reviewing'],
      });
      expect(resolveBranchPrefix(mapping, issue)).toBe('feature/');
    });
  });

  describe('mapping prefix — default fallback', () => {
    it('uses default when neither label nor issueType match', () => {
      const mapping = { Bug: 'bugfix/', default: 'feature/' };
      expect(resolveBranchPrefix(mapping, makeIssue({ issueType: 'Spike' }))).toBe('feature/');
    });

    it('uses default with no labels and unrecognised issueType', () => {
      const mapping = { default: 'chore/' };
      expect(resolveBranchPrefix(mapping, makeIssue({ issueType: 'CustomType' }))).toBe('chore/');
    });
  });
});
