import type { CIRunner } from '../dispatch/runner/types.js';
import type { FerryConfig } from '../config.js';

export interface ResolvedGitConfig {
  baseBranch: string;
  targetBranch: string;
  workingBranchPrefix: string | Record<string, string>;
}

/**
 * Resolves the working branch prefix for a given issue.
 *
 * Resolution order (mapping case):
 *   1. ferry:type:<name> label on the issue → mapping[name]
 *   2. issue.issueType in mapping → mapping[issueType]
 *   3. mapping.default
 */
export function resolveBranchPrefix(
  prefix: string | Record<string, string>,
  issue: { issueType: string; labels: string[] },
): string {
  if (typeof prefix === 'string') return prefix;

  for (const label of issue.labels) {
    const match = /^ferry:type:(.+)$/.exec(label);
    if (match) {
      const labelType = match[1];
      if (labelType in prefix) return prefix[labelType];
      break;
    }
  }

  if (issue.issueType in prefix) return prefix[issue.issueType];

  return prefix['default'];
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
