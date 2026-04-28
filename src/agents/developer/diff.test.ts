import { describe, it, expect } from 'vitest';
import { parseDiffPaths, enforceScope, STATE_FILE_PATH } from './diff.js';
import { FerryError } from '../../lib/error.js';

const sampleDiff = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1 +1,2 @@
+// new line
 old line
diff --git a/src/bar.ts b/src/bar.ts
index 3333333..4444444 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1 +1,2 @@
+// new
 old
`;

describe('parseDiffPaths (Story 4-2)', () => {
  it('returns deduped paths from diff --git headers', () => {
    expect(parseDiffPaths(sampleDiff).sort()).toEqual(['src/bar.ts', 'src/foo.ts']);
  });

  it('returns empty array for empty diff', () => {
    expect(parseDiffPaths('')).toEqual([]);
  });
});

describe('enforceScope (Story 4-2)', () => {
  it('passes when every path is in the allow-list', () => {
    expect(() => enforceScope(sampleDiff, new Set(['src/foo.ts', 'src/bar.ts']))).not.toThrow();
  });

  it('passes when a path is the well-known state file', () => {
    const stateDiff = `diff --git a/${STATE_FILE_PATH} b/${STATE_FILE_PATH}\n@@ +1\n+x\n`;
    expect(() => enforceScope(stateDiff, new Set([]))).not.toThrow();
  });

  it('throws scope-violation when a path is outside the allow-list', () => {
    expect(() => enforceScope(sampleDiff, new Set(['src/foo.ts']))).toThrow(FerryError);
  });

  it('hard-rejects .github/** even if explicitly allowed (defense-in-depth)', () => {
    const evil = `diff --git a/.github/workflows/dev.yml b/.github/workflows/dev.yml\n@@ +1\n+x\n`;
    expect(() => enforceScope(evil, new Set(['.github/workflows/dev.yml']))).toThrow(
      /scope-violation/,
    );
  });

  it('rename diffs require BOTH old and new paths in allowedPaths (documented behaviour)', () => {
    const renameDiff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'rename from src/old.ts',
      'rename to src/new.ts',
      'index 1111111..2222222 100644',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
    ].join('\n');
    // Only the new path in scope -> throws because old path is also extracted.
    expect(() => enforceScope(renameDiff, new Set(['src/new.ts']))).toThrow(/scope-violation/);
    // Both paths in scope -> passes.
    expect(() => enforceScope(renameDiff, new Set(['src/old.ts', 'src/new.ts']))).not.toThrow();
  });
});
