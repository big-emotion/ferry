import { describe, expect, it } from 'vitest';
import { FerryError } from '../error.js';
import { enforceScope, checkScope, parseDiffPaths, STATE_FILE_PATH } from './apply.js';

const FOO_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 111..222 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1 +1 @@',
  '-foo',
  '+bar',
].join('\n');

const STATE_DIFF = [
  'diff --git a/.ferry/state.json b/.ferry/state.json',
  '--- a/.ferry/state.json',
  '+++ b/.ferry/state.json',
  '@@ -1 +1 @@',
  '-{}',
  '+{"x":1}',
].join('\n');

const WORKFLOW_DIFF = [
  'diff --git a/.github/workflows/dev.yml b/.github/workflows/dev.yml',
  '--- a/.github/workflows/dev.yml',
  '+++ b/.github/workflows/dev.yml',
  '@@ -1 +1 @@',
  '-name: dev',
  '+name: dev2',
].join('\n');

const OUT_OF_SCOPE_DIFF = [
  'diff --git a/src/bar.ts b/src/bar.ts',
  '--- a/src/bar.ts',
  '+++ b/src/bar.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

describe('parseDiffPaths', () => {
  it('extracts both old and new paths from each header', () => {
    const paths = parseDiffPaths(FOO_DIFF);
    expect(paths).toEqual(['src/foo.ts']);
  });

  it('returns an empty list for empty diffs', () => {
    expect(parseDiffPaths('')).toEqual([]);
  });
});

describe('enforceScope', () => {
  it('accepts a diff that only touches allowed paths', () => {
    expect(() => enforceScope({ diff: FOO_DIFF, touchPaths: ['src/foo.ts'] })).not.toThrow();
  });

  it('always allows .ferry/state.json regardless of touch_paths', () => {
    expect(() => enforceScope({ diff: STATE_DIFF, touchPaths: ['src/foo.ts'] })).not.toThrow();
    expect(STATE_FILE_PATH).toBe('.ferry/state.json');
  });

  it('hard-rejects .github/** with reason: blocked-prefix', () => {
    let caught: unknown;
    try {
      enforceScope({ diff: WORKFLOW_DIFF, touchPaths: ['.github/workflows/dev.yml'] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('state-invariant');
    expect((caught as FerryError).context).toMatchObject({
      reason: 'scope-violation',
      why: 'blocked-prefix',
    });
  });

  it('rejects paths outside touch_paths with reason: not-in-allowlist', () => {
    let caught: unknown;
    try {
      enforceScope({ diff: OUT_OF_SCOPE_DIFF, touchPaths: ['src/foo.ts'] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).context).toMatchObject({
      reason: 'scope-violation',
      why: 'not-in-allowlist',
      path: 'src/bar.ts',
    });
  });

  it('rejects when touchPaths is undefined with reason: missing-touch-paths', () => {
    let caught: unknown;
    try {
      // Intentionally simulating an undefined input slipping through type-erased glue.
      enforceScope({ diff: FOO_DIFF, touchPaths: undefined as unknown as string[] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).context).toMatchObject({
      reason: 'scope-violation',
      why: 'missing-touch-paths',
    });
  });
});

describe('checkScope', () => {
  it('returns ok:true on a valid diff', () => {
    const r = checkScope({ diff: FOO_DIFF, touchPaths: ['src/foo.ts'] });
    expect(r.ok).toBe(true);
  });

  it('returns ok:false with a FerryError on a scope violation', () => {
    const r = checkScope({ diff: OUT_OF_SCOPE_DIFF, touchPaths: ['src/foo.ts'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(FerryError);
      expect(r.error.code).toBe('state-invariant');
    }
  });
});
