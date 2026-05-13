import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cleanup primitives for `ferry-uninstall --forge gitlab`.
 *
 * Conservative by design: we only remove `include:` entries that reference
 * the canonical Ferry templates (the filenames shipped under
 * `examples/consumer-setup-gitlab/`). User-authored includes are never
 * touched, and the `.gitlab-ci.yml` file is preserved even if removing all
 * Ferry entries would leave it as an empty stub — that case raises a notice
 * via `onWarn` and the user is asked to delete the file by hand.
 */

export const FERRY_GITLAB_TEMPLATE_FILES = [
  'refine.gitlab-ci.yml',
  'dev.gitlab-ci.yml',
  'review.gitlab-ci.yml',
  'iterate.gitlab-ci.yml',
  'reconcile.gitlab-ci.yml',
  'cost-daily.gitlab-ci.yml',
] as const;

/**
 * Project-level CI/CD variables documented in
 * `examples/consumer-setup-gitlab/README.md`. The CLI lists these but does
 * **not** remove them — we cannot delete protected/masked variables without
 * a GitLab API token, and confirming "yes, delete from the GitLab project"
 * with no rollback path is out of scope for this CLI.
 */
export const FERRY_GITLAB_CI_VARIABLES = [
  'FERRY_VERSION',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
  'FERRY_GITLAB_TOKEN',
  'FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN',
  'FERRY_REVIEW_TRANSITION_ID',
  'FERRY_ITER_TRANSITION_ID',
  'FERRY_APPROVE_TRANSITION_ID',
  'FERRY_AUDIT_ISSUE',
] as const;

export interface CleanupExecOptions {
  /** When false, the function prints what it would do but performs no I/O. */
  apply: boolean;
  onAction: (msg: string) => void;
  onSkip: (msg: string) => void;
  onError: (msg: string) => void;
  onWarn: (msg: string) => void;
}

export interface DetectedIncludes {
  /** Path to the root .gitlab-ci.yml. */
  filePath: string;
  /** Full source as read from disk. */
  source: string;
  /** Original lines (newline-split, no trailing newline element). */
  lines: string[];
  /** Indices into `lines` of include entries that point at Ferry templates. */
  ferryIncludeLineIndices: number[];
  /** The matched include lines themselves (parallel to `ferryIncludeLineIndices`). */
  ferryIncludeLines: string[];
}

/**
 * Return the Ferry template stub filenames that currently exist at the repo
 * root. The list is restricted to the canonical filenames in
 * `FERRY_GITLAB_TEMPLATE_FILES` — random `*.gitlab-ci.yml` files written by
 * the user are never reported.
 */
export function detectFerryStubFiles(repoRoot: string): string[] {
  return FERRY_GITLAB_TEMPLATE_FILES.filter((f) => existsSync(join(repoRoot, f)));
}

/**
 * Match `include:` entries that reference a Ferry template. We only treat a
 * line as a Ferry include when the referenced path's basename is one of the
 * canonical template filenames; this avoids false positives on user paths
 * that contain the substring "ferry" but point elsewhere.
 */
function isFerryIncludeLine(line: string): boolean {
  const trimmed = line.trim();
  // Must look like a YAML list entry pointing at a file. Accept either the
  // short form (`- 'foo.yml'`) or the long form (`- local: 'foo.yml'`,
  // `- project: ...`, etc.). We don't try to be a YAML parser — we just
  // look for a quoted or bare path whose basename matches a Ferry template.
  if (!trimmed.startsWith('-')) return false;
  for (const tpl of FERRY_GITLAB_TEMPLATE_FILES) {
    // Match the basename at a path boundary (start of string, `/`, or quote).
    const pattern = new RegExp(`(^|[/'"\\s])${escapeRegex(tpl)}($|['"\\s])`);
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectFerryIncludesInRoot(repoRoot: string): DetectedIncludes | null {
  const filePath = join(repoRoot, '.gitlab-ci.yml');
  if (!existsSync(filePath)) return null;
  const source = readFileSync(filePath, 'utf8');
  const lines = source.split('\n');
  // Drop the trailing empty element produced by a final newline so the
  // indices align with editor line numbers and round-trip cleanly.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const ferryIncludeLineIndices: number[] = [];
  const ferryIncludeLines: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isFerryIncludeLine(lines[i])) {
      ferryIncludeLineIndices.push(i);
      ferryIncludeLines.push(lines[i]);
    }
  }
  return { filePath, source, lines, ferryIncludeLineIndices, ferryIncludeLines };
}

/**
 * Strip every detected Ferry include line from the root `.gitlab-ci.yml`.
 * Non-Ferry content (other includes, stages, jobs, comments, whitespace)
 * is preserved verbatim. When the resulting file has no meaningful content
 * left, we keep the file on disk and emit a `onWarn` notice — deleting the
 * file is the user's call because it may hold project-level CI config that
 * predated Ferry.
 */
export function removeFerryIncludesFromRoot(repoRoot: string, opts: CleanupExecOptions): void {
  const detected = detectFerryIncludesInRoot(repoRoot);
  if (!detected) {
    opts.onSkip('.gitlab-ci.yml not present — nothing to remove');
    return;
  }
  if (detected.ferryIncludeLines.length === 0) {
    opts.onSkip('.gitlab-ci.yml has no Ferry includes — nothing to remove');
    return;
  }

  const prefix = opts.apply ? '' : '[dry-run] ';
  for (const line of detected.ferryIncludeLines) {
    opts.onAction(`${prefix}Removed Ferry include: ${line.trim()}`);
  }

  if (!opts.apply) return;

  const toRemove = new Set(detected.ferryIncludeLineIndices);
  const kept = detected.lines.filter((_, idx) => !toRemove.has(idx));
  const newSource = kept.join('\n') + (detected.source.endsWith('\n') ? '\n' : '');
  writeFileSync(detected.filePath, newSource, 'utf8');

  // If the file is now effectively empty (only blank lines or comments),
  // warn rather than delete — the user may want to keep it as a scaffold.
  if (isEffectivelyEmpty(newSource)) {
    opts.onWarn(
      '.gitlab-ci.yml is now empty after Ferry-include removal — file kept for you to delete or repopulate manually.',
    );
  }
}

function isEffectivelyEmpty(source: string): boolean {
  // A line is "structural" if it's `<key>:` with no value — keeping it on
  // disk after we've stripped every list item underneath leaves a dangling
  // YAML key (e.g. `include:` with nothing below it). Treat the file as
  // empty when only blanks, comments, and structural-only keys remain.
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line)) continue;
    return false;
  }
  return true;
}

/**
 * Delete the standalone Ferry template files at the repo root (the files
 * `ferry-init --forge gitlab` will write in part C of #214). We only
 * delete files in the canonical list — passing a user filename is a no-op.
 */
export function removeFerryStubFiles(
  repoRoot: string,
  files: readonly string[],
  opts: CleanupExecOptions,
): void {
  const allowed = new Set<string>(FERRY_GITLAB_TEMPLATE_FILES);
  const prefix = opts.apply ? '' : '[dry-run] ';
  for (const f of files) {
    if (!allowed.has(f)) {
      opts.onSkip(`${f} is not a Ferry template — refusing to delete`);
      continue;
    }
    const filePath = join(repoRoot, f);
    if (!existsSync(filePath)) {
      // Idempotency: a previous run already removed it.
      continue;
    }
    if (!opts.apply) {
      opts.onAction(`${prefix}Deleted ${f}`);
      continue;
    }
    try {
      rmSync(filePath, { force: true });
      opts.onAction(`Deleted ${f}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onError(`Failed to delete ${f}: ${msg}`);
    }
  }
}
