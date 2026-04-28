import { describe, expect, it } from 'vitest';
import { FerryError } from '../../lib/error.js';
import { enforceScope } from './apply.js';

const ITERATOR_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1 +1 @@',
  '-foo',
  '+bar',
].join('\n');

const WORKFLOW_DIFF = [
  'diff --git a/.github/workflows/dev.yml b/.github/workflows/dev.yml',
  '--- a/.github/workflows/dev.yml',
  '+++ b/.github/workflows/dev.yml',
  '@@ -1 +1 @@',
  '-foo',
  '+bar',
].join('\n');

describe('iterator apply (FR26 wiring)', () => {
  it('accepts an in-scope iterator diff', () => {
    expect(() => enforceScope({ diff: ITERATOR_DIFF, touchPaths: ['src/foo.ts'] })).not.toThrow();
  });

  it('hard-rejects iterator diffs that touch .github/**', () => {
    let caught: unknown;
    try {
      enforceScope({ diff: WORKFLOW_DIFF, touchPaths: ['.github/workflows/dev.yml'] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('state-invariant');
  });
});
