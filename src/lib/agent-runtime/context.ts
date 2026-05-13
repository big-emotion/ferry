import { createRunnerFromEnv } from '../dispatch/runner/factory.js';
import type { CIRunner } from '../dispatch/runner/types.js';
import { createTrackerFromEnv } from '../io/tracker/factory.js';
import { loadFerryConfig } from '../config.js';
import type { FerryConfig } from '../config.js';
import type { IssueTracker } from '../io/tracker/types.js';
import { FerryError } from '../errors/index.js';
import { requireEnv } from './env.js';

export interface GitHubContext {
  owner: string;
  repo: string;
  runner: CIRunner;
  tracker: IssueTracker;
  ferryCfg: FerryConfig;
}

export function createGitHubContext(repoRoot: string): GitHubContext {
  const githubToken = requireEnv('GITHUB_TOKEN');
  const githubRepo = requireEnv('GITHUB_REPO');
  const [owner, repo] = githubRepo.split('/');
  if (!owner || !repo) {
    throw new FerryError('state-invariant', { reason: 'invalid-github-repo', githubRepo });
  }
  const ferryCfg = loadFerryConfig(repoRoot);
  const runner = createRunnerFromEnv(githubToken, owner, repo);
  const tracker = createTrackerFromEnv();
  return { owner, repo, runner, tracker, ferryCfg };
}
