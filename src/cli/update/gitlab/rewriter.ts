/**
 * GitLab CI version rewriter for `ferry-update --forge gitlab`.
 *
 * Discovers `.gitlab-ci.yml` (and per-role `*.gitlab-ci.yml`) files under the
 * consumer repo and rewrites the pinned Ferry version found in either:
 *
 *   1. A YAML `FERRY_VERSION: <ver>` assignment under `variables:` (the
 *      canonical convention recommended by `examples/consumer-setup-gitlab/`).
 *   2. A literal `@big-emotion/ferry@<ver>` pin inside a `script:` line, used
 *      by consumers who hard-code the version instead of going through the
 *      CI/CD UI variable.
 *
 * The rewriter is **idempotent**: re-running after convergence produces zero
 * diff. The `${FERRY_VERSION}` variable interpolation form is intentionally
 * never rewritten — the value lives in CI/CD UI variables, not in YAML.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

export interface RewriteOptions {
  repoRoot: string;
  toVersion: string;
  /** If true, compute the result but don't write to disk. */
  dryRun?: boolean;
  /** Cap directory recursion depth (defaults to 3). */
  maxDepth?: number;
}

export interface FileRewriteResult {
  /** Path relative to `repoRoot`. */
  relPath: string;
  /** Number of pinned versions replaced. */
  replacements: number;
  /** True when the file's content changed on disk (or would change in dry-run). */
  changed: boolean;
  /** Unified-diff snippet showing the change. Empty when unchanged. */
  diff: string;
}

export interface RewriteResult {
  files: FileRewriteResult[];
  errors: { relPath: string; message: string }[];
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
]);

const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/;

/**
 * Match a `FERRY_VERSION:` assignment in YAML.
 *
 * Captures:
 *   1. leading indent + key + `:` + spaces
 *   2. optional quote char (`"` or `'` or empty)
 *   3. the version literal itself
 *   4. closing quote char (matches group 2, or empty)
 *   5. optional trailing comment / whitespace
 *
 * We match only when the value is a literal — `${...}` and `$FERRY_VERSION`
 * interpolations are skipped (handled by the `${FERRY_VERSION}` branch below,
 * which only triggers if the value is a CI variable rather than a literal).
 */
const FERRY_VERSION_ASSIGN_RE =
  /^(\s*FERRY_VERSION\s*:\s*)(["']?)(v?\d+\.\d+\.\d+(?:[-+][\w.+-]+)?)\2(\s*(?:#.*)?)$/gm;

/**
 * Match a literal `@big-emotion/ferry@<version>` pin in a script line.
 * Skips the `${FERRY_VERSION}` / `$FERRY_VERSION` interpolation forms.
 */
const FERRY_PIN_LITERAL_RE = /(@big-emotion\/ferry@)(v?\d+\.\d+\.\d+(?:[-+][\w.+-]+)?)/g;

/** Normalize a target version: strip a leading `v` if present. */
function bareVersion(v: string): string {
  return v.replace(/^v/, '');
}

/** Reapply the leading `v` only when the original literal had one. */
function matchPrefix(original: string, target: string): string {
  const bare = bareVersion(target);
  return original.startsWith('v') ? `v${bare}` : bare;
}

/**
 * Recursively walk `dir`, returning relative paths to GitLab CI YAML files.
 * Skips heavy / vendor directories. Caps depth to keep behaviour predictable
 * in unusual consumer layouts.
 */
function findGitLabCIFiles(repoRoot: string, maxDepth: number): string[] {
  const results: string[] = [];

  function walk(absDir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(absDir, entry);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (IGNORED_DIRS.has(entry) || entry.startsWith('.git')) continue;
        walk(abs, depth + 1);
        continue;
      }
      // File: match `.gitlab-ci.yml` or `*.gitlab-ci.yml`.
      if (entry === '.gitlab-ci.yml' || entry.endsWith('.gitlab-ci.yml')) {
        results.push(relative(repoRoot, abs));
      }
    }
  }

  walk(repoRoot, 0);
  return results.sort();
}

/**
 * Rewrite a single file's content for a target version. Pure — no I/O.
 * Returns `{ rewritten, replacements }`.
 */
export function rewriteContent(
  content: string,
  toVersion: string,
): { rewritten: string; replacements: number } {
  let count = 0;

  let next = content.replace(
    FERRY_VERSION_ASSIGN_RE,
    (_match, prefix: string, quote: string, oldVer: string, suffix: string) => {
      const replacement = matchPrefix(oldVer, toVersion);
      if (replacement === oldVer) return `${prefix}${quote}${oldVer}${quote}${suffix}`;
      count += 1;
      return `${prefix}${quote}${replacement}${quote}${suffix}`;
    },
  );

  next = next.replace(FERRY_PIN_LITERAL_RE, (_match, head: string, oldVer: string) => {
    const replacement = matchPrefix(oldVer, toVersion);
    if (replacement === oldVer) return `${head}${oldVer}`;
    count += 1;
    return `${head}${replacement}`;
  });

  return { rewritten: next, replacements: count };
}

/** Compute a unified diff (best-effort; empty string on failure). */
function unifiedDiff(label: string, before: string, after: string): string {
  if (before === after) return '';
  const dir = mkdtempSync(join(tmpdir(), 'ferry-gitlab-diff-'));
  try {
    const oldFile = join(dir, 'old');
    const newFile = join(dir, 'new');
    writeFileSync(oldFile, before, 'utf8');
    writeFileSync(newFile, after, 'utf8');
    const result = spawnSync(
      'diff',
      ['-u', `--label=a/${label}`, `--label=b/${label}`, oldFile, newFile],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    if (result.status === 2 || result.error) {
      return `--- a/${label}\n+++ b/${label}\n(diff unavailable)\n`;
    }
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Public entry point. Discover GitLab CI files under `repoRoot`, rewrite the
 * pinned Ferry version to `toVersion`, and return a per-file summary.
 */
export function rewriteGitLabVersion(opts: RewriteOptions): RewriteResult {
  if (!SEMVER_RE.test(opts.toVersion)) {
    throw new Error(`invalid target version: ${opts.toVersion} (expected semver e.g. v1.2.3)`);
  }
  if (!existsSync(opts.repoRoot)) {
    throw new Error(`repo root does not exist: ${opts.repoRoot}`);
  }

  const maxDepth = opts.maxDepth ?? 3;
  const files = findGitLabCIFiles(opts.repoRoot, maxDepth);
  const result: RewriteResult = { files: [], errors: [] };

  for (const relPath of files) {
    const abs = join(opts.repoRoot, relPath);
    let before: string;
    try {
      before = readFileSync(abs, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ relPath, message });
      continue;
    }

    const { rewritten, replacements } = rewriteContent(before, opts.toVersion);
    const changed = rewritten !== before;
    const diff = changed ? unifiedDiff(relPath, before, rewritten) : '';

    if (changed && !opts.dryRun) {
      try {
        writeFileSync(abs, rewritten, 'utf8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ relPath, message });
        continue;
      }
    }

    result.files.push({ relPath, replacements, changed, diff });
  }

  return result;
}
