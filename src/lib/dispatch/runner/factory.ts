import { FerryError } from '../../errors/index.js';
import { GitHubActionsRunner } from './github-actions/index.js';
import { GitLabRunner } from './gitlab/index.js';
import type { CIRunner } from './types.js';

export type ForgeKind = 'github' | 'gitlab';

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
      return new GitLabRunner(token, owner, repo, {
        apiBase: process.env.FERRY_GITLAB_API_BASE,
        pipelineTriggerToken: process.env.FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN,
        triggerRef: process.env.FERRY_GITLAB_TRIGGER_REF,
      });
  }
}
