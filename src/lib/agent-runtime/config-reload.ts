import { execFileSync } from 'node:child_process';
import { parseFerryConfigJson } from '../config.js';
import type { FerryConfig } from '../config.js';

/**
 * Fetches origin/<baseBranch> and re-reads ferry.config.json from it.
 *
 * This ensures agents use the config from the consumer's configured base_branch
 * rather than the repo's default branch (which is what a bare `actions/checkout`
 * without `ref:` resolves to on repository_dispatch events).
 *
 * As a side effect, fetching origin/<baseBranch> also makes it available for
 * subsequent `git log origin/<base>..HEAD` calls in the developer agent.
 *
 * Returns `fallback` when the branch or file is absent on origin.
 * Propagates FerryError when ferry.config.json exists but fails validation.
 */
export function loadFerryConfigFromBaseBranch(
  baseBranch: string,
  repoRoot: string,
  fallback: FerryConfig,
): FerryConfig {
  try {
    execFileSync('git', ['fetch', 'origin', baseBranch], { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    return fallback;
  }
  let jsonContent: string;
  try {
    jsonContent = execFileSync('git', ['show', `origin/${baseBranch}:ferry.config.json`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    return fallback;
  }
  return parseFerryConfigJson(jsonContent);
}
