import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatBranchName } from '../../agents/developer/commit.js';

export interface TicketWorktreePlan {
  branch: string;
  worktreePath: string;
}

export interface EnsureTicketWorktreeOptions {
  repoRoot: string;
  ticketKey: string;
  baseBranch?: string | null;
}

export interface TicketWorktreeResult extends TicketWorktreePlan {
  baseBranch: string;
  created: boolean;
}

export function getTicketWorktreePlan(repoRoot: string, ticketKey: string): TicketWorktreePlan {
  return {
    branch: formatBranchName(ticketKey),
    worktreePath: join(repoRoot, '.ferry-local', 'worktrees', ticketKey),
  };
}

function resolveBaseBranch(repoRoot: string, baseBranch?: string | null): string {
  if (baseBranch) return baseBranch;
  const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
  return ref.replace(/^origin\//, '');
}

function hasWorktree(repoRoot: string, worktreePath: string, branch: string): boolean {
  const output = execFileSync('git', ['worktree', 'list'], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return output.includes(`${worktreePath} `) || output.includes(`[${branch}]`);
}

export function ensureTicketWorktree(options: EnsureTicketWorktreeOptions): TicketWorktreeResult {
  const { repoRoot, ticketKey } = options;
  const { branch, worktreePath } = getTicketWorktreePlan(repoRoot, ticketKey);
  const resolvedBaseBranch = resolveBaseBranch(repoRoot, options.baseBranch);
  mkdirSync(join(repoRoot, '.ferry-local', 'worktrees'), { recursive: true });

  if (hasWorktree(repoRoot, worktreePath, branch)) {
    return {
      branch,
      worktreePath,
      baseBranch: resolvedBaseBranch,
      created: false,
    };
  }

  execFileSync(
    'git',
    ['worktree', 'add', '-B', branch, worktreePath, `origin/${resolvedBaseBranch}`],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  );

  return {
    branch,
    worktreePath,
    baseBranch: resolvedBaseBranch,
    created: true,
  };
}
