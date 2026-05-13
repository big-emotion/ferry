/**
 * GitLab template installer — idempotent counterpart to the GitHub-side
 * `installWorkflows` helper, but with first-class dry-run support so the
 * wizard can preview drift before touching the working tree.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { printSuccess, printSkip, printWarn } from '../prompt.js';
import type { WorkflowEntry } from '../types.js';

function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export const GITLAB_CI_TARGET_DIR = join('ci', 'ferry');

export interface InstallOptions {
  overwrite: boolean;
  dryRun: boolean;
}

export interface InstallResult {
  ok: true;
  installed: string[];
  skipped: string[];
  wouldInstall: string[];
  wouldOverwrite: string[];
}

export function installGitLabTemplates(
  repoRoot: string,
  templates: WorkflowEntry[],
  options: InstallOptions,
): InstallResult {
  const targetDir = join(repoRoot, GITLAB_CI_TARGET_DIR);
  if (!options.dryRun) {
    mkdirSync(targetDir, { recursive: true });
  }

  const installed: string[] = [];
  const skipped: string[] = [];
  const wouldInstall: string[] = [];
  const wouldOverwrite: string[] = [];

  for (const tmpl of templates) {
    const dest = join(targetDir, tmpl.filename);
    const existing = readIfExists(dest);

    if (existing === undefined) {
      if (options.dryRun) {
        wouldInstall.push(tmpl.filename);
        printSkip(`Would create ${tmpl.filename} (dry-run)`);
        continue;
      }
      // 'wx' fails atomically if the file appeared between the read and the
      // write, avoiding a TOCTOU race with concurrent processes.
      writeFileSync(dest, tmpl.content, { encoding: 'utf8', flag: 'wx' });
      printSuccess(`Wrote ${join(GITLAB_CI_TARGET_DIR, tmpl.filename)}`);
      installed.push(tmpl.filename);
      continue;
    }

    if (existing === tmpl.content) {
      printSkip(`${tmpl.filename} already up-to-date`);
      skipped.push(tmpl.filename);
      continue;
    }

    if (options.dryRun) {
      wouldOverwrite.push(tmpl.filename);
      printWarn(`${tmpl.filename} would be overwritten (dry-run; re-run with --force)`);
      continue;
    }

    if (!options.overwrite) {
      wouldOverwrite.push(tmpl.filename);
      printWarn(
        `${tmpl.filename} exists with different content — skipping (use --force to overwrite)`,
      );
      skipped.push(tmpl.filename);
      continue;
    }

    writeFileSync(dest, tmpl.content, 'utf8');
    printSuccess(`Overwrote ${join(GITLAB_CI_TARGET_DIR, tmpl.filename)}`);
    installed.push(tmpl.filename);
  }

  return { ok: true, installed, skipped, wouldInstall, wouldOverwrite };
}
