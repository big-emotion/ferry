import { FerryError } from '../../errors/index.js';
import { GitHubActionsRunner } from './github-actions/index.js';
import type { CIRunner } from './types.js';

export type ForgeKind = 'github' | 'gitlab';

const GITLAB_TRACKING_ISSUE = 'https://github.com/big-emotion/ferry/issues/210';

export function resolveForgeFromEnv(): ForgeKind {
  const raw = (process.env.FERRY_FORGE ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'github') return 'github';
  if (raw === 'gitlab') return 'gitlab';
  throw new FerryError('state-invariant', {
    reason: 'unknown-forge',
    value: raw,
    supported: ['github', 'gitlab'],
  });
}

export function createRunnerFromEnv(token: string, owner: string, repo: string): CIRunner {
  const forge = resolveForgeFromEnv();
  switch (forge) {
    case 'github':
      return new GitHubActionsRunner(token, owner, repo);
    case 'gitlab':
      throw new FerryError('state-invariant', {
        reason: 'gitlab-runner-not-implemented',
        tracking: GITLAB_TRACKING_ISSUE,
      });
  }
}
