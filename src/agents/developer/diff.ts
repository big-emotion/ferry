/**
 * Story 4-2: scope-enforced diff path checker.
 *
 * Known limitation (rename diffs): `parseDiffPaths` extracts BOTH the `a/`
 * and `b/` paths from each `diff --git a/<src> b/<dst>` header, so when a
 * file is renamed, `enforceScope` requires both the old and the new path
 * to be present in `allowedPaths`. This is conservative and intentional:
 * the Refiner's touch_paths list represents every path the diff is allowed
 * to touch, including the source path of a rename. Callers that wish to
 * accept a rename to a brand-new path must include both names in scope.
 */

import { FerryError } from '../../lib/error.js';

export const STATE_FILE_PATH = '.ferry/state.json';
export const BLOCKED_PATH_PREFIXES: readonly string[] = ['.github/'];

const DIFF_HEADER_RE = /^diff --git a\/(\S+) b\/(\S+)/gm;

export function parseDiffPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const match of diff.matchAll(DIFF_HEADER_RE)) {
    paths.add(match[1]);
    paths.add(match[2]);
  }
  return Array.from(paths);
}

export function enforceScope(diff: string, allowedPaths: ReadonlySet<string>): void {
  const paths = parseDiffPaths(diff);
  for (const path of paths) {
    if (BLOCKED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      throw new FerryError('state-invariant', {
        reason: 'scope-violation',
        path,
        why: 'blocked-prefix',
      });
    }
    if (path === STATE_FILE_PATH) continue;
    if (!allowedPaths.has(path)) {
      throw new FerryError('state-invariant', {
        reason: 'scope-violation',
        path,
        why: 'not-in-allowlist',
      });
    }
  }
}
