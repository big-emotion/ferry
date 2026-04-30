import { execSync, execFileSync } from 'node:child_process';

export function configureFerryGitUser(repoRoot: string): void {
  execSync('git config user.name "ferry-bot"', { cwd: repoRoot });
  execSync('git config user.email "ferry-bot@users.noreply.github.com"', { cwd: repoRoot });
}

export type CommitProgressFn = (
  repoRoot: string,
  branchName: string,
  message: string,
  secretScan: () => Promise<void>,
) => Promise<string>;

export function makeCommitProgress(logPrefix: string): CommitProgressFn {
  return async (repoRoot, branchName, message, scan) => {
    execSync('git add -A', { cwd: repoRoot });
    const status = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
    if (!status.trim()) return 'nothing to commit';
    await scan();
    execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: repoRoot });
    execSync(`git push origin ${branchName} --force-with-lease`, { cwd: repoRoot });
    console.error(`${logPrefix} checkpoint: ${message.slice(0, 80)}`);
    return 'committed and pushed';
  };
}

export function checkoutExistingBranch(
  branchName: string,
  repoRoot: string,
): 'ok' | 'not-found' {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', branchName], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    execFileSync('git', ['fetch', 'origin', branchName], { cwd: repoRoot });
    execFileSync('git', ['checkout', branchName], { cwd: repoRoot });
    return 'ok';
  } catch {
    return 'not-found';
  }
}

export function fetchAndMergeMain(repoRoot: string): string[] {
  execFileSync('git', ['fetch', 'origin', 'main'], { cwd: repoRoot });
  try {
    execFileSync('git', ['merge', 'origin/main', '--no-edit'], { cwd: repoRoot });
    return [];
  } catch {
    return execSync('git diff --name-only --diff-filter=U', { cwd: repoRoot, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  }
}
