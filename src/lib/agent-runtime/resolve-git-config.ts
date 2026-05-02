import type { CIRunner } from '../dispatch/runner/types.js';
import type { FerryConfig } from '../config.js';

export interface ResolvedGitConfig {
  baseBranch: string;
  targetBranch: string;
  workingBranchPrefix: string;
}

export async function resolveGitConfig(
  ferryCfg: FerryConfig,
  runner: CIRunner,
  owner: string,
  repo: string,
): Promise<ResolvedGitConfig> {
  const { base_branch, target_branch, working_branch_prefix } = ferryCfg.git;
  const baseBranch = base_branch ?? (await runner.getRepoDefaultBranch(owner, repo));
  const targetBranch = target_branch ?? baseBranch;
  return { baseBranch, targetBranch, workingBranchPrefix: working_branch_prefix };
}
