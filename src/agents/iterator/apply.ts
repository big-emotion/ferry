/**
 * Iterator-side scope-enforced diff apply (FR26 / story 6-1 AC2).
 *
 * Re-exports `enforceScope` from the shared `src/lib/diff/apply.ts` module
 * so the Iterator path is exercised by the same primitive as the Developer.
 * Tests in `apply.test.ts` confirm the wiring; the unified diff itself is
 * applied by `git apply` in the iterate.yml step, not here.
 */

export { enforceScope, checkScope, parseDiffPaths, STATE_FILE_PATH } from '../../lib/diff/apply.js';
