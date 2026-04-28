/**
 * Shared scope-enforced diff apply primitives.
 *
 * Both the Developer (story 4-2) and the Iterator (story 6-1, FR26) must
 * apply LLM-emitted diffs only against the touch_paths declared on the
 * ticket, plus the canonical state file `.ferry/state.json`. Diffs that
 * touch `.github/**` are hard-rejected to prevent the agent from rewriting
 * its own pipeline.
 *
 * This module is the single source of truth: `src/agents/developer/diff.ts`
 * was the original location during story 4-2 implementation, and this file
 * re-exports those helpers under the canonical path named in the
 * architecture doc so the Iterator can import them without leaking
 * Developer-internal paths into other agents.
 */

import { FerryError } from '../error.js';
import {
  STATE_FILE_PATH,
  BLOCKED_PATH_PREFIXES,
  parseDiffPaths,
  enforceScope as enforceScopeRaw,
} from '../../agents/developer/diff.js';

export { STATE_FILE_PATH, BLOCKED_PATH_PREFIXES, parseDiffPaths };

export interface ApplyDiffInput {
  diff: string;
  touchPaths: readonly string[];
}

/**
 * Validates that every path mentioned in a unified diff is either inside
 * the allowed touch_paths or is `.ferry/state.json`. Throws a typed
 * `FerryError('state-invariant', { reason: 'scope-violation', ... })` on
 * the first offending path. Returns nothing on success.
 */
export function enforceScope(input: ApplyDiffInput): void {
  if (input.touchPaths === undefined) {
    throw new FerryError('state-invariant', {
      reason: 'scope-violation',
      why: 'missing-touch-paths',
    });
  }
  enforceScopeRaw(input.diff, new Set(input.touchPaths));
}

/**
 * Convenience: returns true when the diff is in scope, false (with the
 * thrown FerryError surfaced via the second tuple element) otherwise.
 * Useful for orchestration layers that want to log without throwing.
 */
export function checkScope(input: ApplyDiffInput): { ok: true } | { ok: false; error: FerryError } {
  try {
    enforceScope(input);
    return { ok: true };
  } catch (e) {
    if (e instanceof FerryError) return { ok: false, error: e };
    throw e;
  }
}
