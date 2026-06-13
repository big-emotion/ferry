import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTicketWorktree } from './worktree.js';

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync,
}));

describe('ensureTicketWorktree', () => {
  const dirs: string[] = [];

  beforeEach(() => {
    execFileSync.mockReset();
  });

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates a dedicated ferry/<KEY> worktree from the base branch', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ferry-local-worktree-'));
    dirs.push(repoRoot);
    execFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'symbolic-ref') return 'origin/main\n';
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') return '';
      return '';
    });

    const out = ensureTicketWorktree({
      repoRoot,
      ticketKey: 'CHAN-9',
    });

    expect(out).toEqual({
      branch: 'ferry/CHAN-9',
      worktreePath: `${repoRoot}/.ferry-local/worktrees/CHAN-9`,
      created: true,
      baseBranch: 'main',
    });
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      [
        'worktree',
        'add',
        '-B',
        'ferry/CHAN-9',
        `${repoRoot}/.ferry-local/worktrees/CHAN-9`,
        'origin/main',
      ],
      { cwd: repoRoot, stdio: 'pipe' },
    );
  });

  it('reuses an existing ticket worktree without touching the primary checkout', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ferry-local-worktree-'));
    dirs.push(repoRoot);
    execFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') {
        return `${repoRoot}/.ferry-local/worktrees/CHAN-9  abcdef [ferry/CHAN-9]\n`;
      }
      return '';
    });

    const out = ensureTicketWorktree({
      repoRoot,
      ticketKey: 'CHAN-9',
      baseBranch: 'main',
    });

    expect(out.created).toBe(false);
    expect(execFileSync).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['checkout']),
      expect.anything(),
    );
  });
});
