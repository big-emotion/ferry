/**
 * Orchestrator for `ferry-uninstall --forge gitlab`. Pure-ish — receives an
 * IO sink so tests can drive it without spawning a TTY.
 *
 * Safety contract:
 * 1. Dry-run by default. `apply=true` is the only way file deletion happens.
 * 2. Only Ferry-owned content is removed: the canonical template filenames
 *    listed in `cleanup.ts` and `include:` lines that reference them.
 * 3. Idempotent: re-running on a clean repo prints "nothing to remove" and
 *    exits 0 without modifying anything.
 * 4. The CLI never deletes GitLab CI/CD variables, project access tokens, or
 *    pipeline-trigger tokens — those require GitLab API auth and are
 *    irreversible. We print the project Settings URLs the user must visit.
 */

import { confirm, closePrompt } from '../../init/prompt.js';
import {
  FERRY_GITLAB_CI_VARIABLES,
  detectFerryIncludesInRoot,
  detectFerryStubFiles,
  removeFerryIncludesFromRoot,
  removeFerryStubFiles,
  type CleanupExecOptions,
} from './cleanup.js';

export interface GitlabUninstallIO {
  print: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface GitlabUninstallOptions {
  /** Repository root on disk. */
  repoRoot: string;
  /** When false (default), the run prints a plan but performs no I/O. */
  apply: boolean;
  /** Skip the interactive "did you revoke tokens?" prompt. */
  yes: boolean;
  /**
   * Full URL of the GitLab project (e.g. `https://gitlab.com/acme/repo`).
   * Used to print Settings deep-links. When absent, fall back to a generic
   * placeholder so the user still knows where to look.
   */
  projectUrl?: string;
  /** IO sink. Defaults to stdout/stderr printers when omitted. */
  io?: GitlabUninstallIO;
}

const PLACEHOLDER_PROJECT = '<your-gitlab-project>';

function defaultIO(): GitlabUninstallIO {
  return {
    print: (msg) => process.stdout.write(msg + '\n'),
    warn: (msg) => process.stdout.write('  ! ' + msg + '\n'),
    error: (msg) => process.stderr.write('  ✗ ' + msg + '\n'),
  };
}

function settingsBase(projectUrl: string | undefined): string {
  const base = projectUrl?.replace(/\/$/, '') ?? PLACEHOLDER_PROJECT;
  return `${base}/-/settings`;
}

export async function runGitlabUninstall(opts: GitlabUninstallOptions): Promise<number> {
  const io = opts.io ?? defaultIO();
  const { print, warn } = io;

  print('');
  print('ferry-uninstall — GitLab (experimental)');
  print(opts.apply ? '  mode: APPLY (will modify files)' : '  mode: dry-run (no changes)');
  print('');

  // ── Detect ────────────────────────────────────────────────────────────────
  const includes = detectFerryIncludesInRoot(opts.repoRoot);
  const stubs = detectFerryStubFiles(opts.repoRoot);
  const hasIncludeChanges = includes !== null && includes.ferryIncludeLines.length > 0;
  const hasStubChanges = stubs.length > 0;
  const hasAnything = hasIncludeChanges || hasStubChanges;

  if (!hasAnything) {
    print('Nothing to remove — no Ferry templates or includes detected.');
    print('');
    // Still print the manual revocation guidance — the user may have CI/CD
    // variables or tokens left over even if the local files are already
    // gone. Idempotency means safe to call repeatedly; we exit 0.
    printRevocationGuidance(io, opts);
    closePrompt();
    return 0;
  }

  // ── Plan ──────────────────────────────────────────────────────────────────
  print('Will remove:');
  if (hasIncludeChanges && includes) {
    for (const line of includes.ferryIncludeLines) {
      print(`  • include in .gitlab-ci.yml → ${line.trim()}`);
    }
  }
  for (const f of stubs) {
    print(`  • ${f} (Ferry template stub)`);
  }
  print('');
  print('Will NOT touch (no GitLab API call):');
  print('  • GitLab project access token (FERRY_GITLAB_TOKEN)');
  print('  • Pipeline trigger token (FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN)');
  print('  • Any CI/CD variable');
  print('  • Jira Automation rules');
  print('');

  if (!opts.apply) {
    // Surface dry-run plan via the cleanup helpers (they prefix output with
    // `[dry-run]`) — same code path as the apply branch, so behaviour is
    // identical except no writes happen.
    const execOpts = makeExecOpts(io, /* apply */ false);
    removeFerryIncludesFromRoot(opts.repoRoot, execOpts);
    removeFerryStubFiles(opts.repoRoot, stubs, execOpts);
    print('');
    print('Dry-run mode — no files were changed. Re-run with --apply to perform deletion.');
    print('');
    printRevocationGuidance(io, opts);
    closePrompt();
    return 0;
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  if (!opts.yes) {
    const ok = await confirm('Proceed with removal of Ferry includes and stub files?', false);
    if (!ok) {
      print('Aborted.');
      closePrompt();
      return 0;
    }
  }
  closePrompt();

  // ── Execute ───────────────────────────────────────────────────────────────
  const execOpts = makeExecOpts(io, /* apply */ true);
  removeFerryIncludesFromRoot(opts.repoRoot, execOpts);
  removeFerryStubFiles(opts.repoRoot, stubs, execOpts);

  print('');
  print('Local cleanup complete.');
  print('');
  printRevocationGuidance(io, opts);

  if (execOpts.errorCount > 0) {
    warn(`${execOpts.errorCount} error(s) occurred — review the output above.`);
    return 1;
  }
  return 0;
}

interface ExecOptsWithCount extends CleanupExecOptions {
  errorCount: number;
}

function makeExecOpts(io: GitlabUninstallIO, apply: boolean): ExecOptsWithCount {
  const wrapper: ExecOptsWithCount = {
    apply,
    errorCount: 0,
    onAction: (msg) => io.print('  ✓ ' + msg),
    onSkip: (msg) => io.print('  – ' + msg),
    onError: (msg) => {
      wrapper.errorCount += 1;
      io.error(msg);
    },
    onWarn: (msg) => io.warn(msg),
  };
  return wrapper;
}

function printRevocationGuidance(io: GitlabUninstallIO, opts: GitlabUninstallOptions): void {
  const base = settingsBase(opts.projectUrl);
  io.print('Manual steps remaining (no GitLab API token is needed by this CLI):');
  io.print('');
  io.print('  1. Revoke the GitLab project access token  (Project → Settings → Access Tokens):');
  io.print(`       ${base}/access_tokens`);
  io.print('     Look for the token whose name matches FERRY_GITLAB_TOKEN.');
  io.print('');
  io.print('  2. Revoke the pipeline trigger token  (Project → Settings → CI/CD → Triggers):');
  io.print(`       ${base}/ci_cd#js-pipeline-triggers`);
  io.print('     Revoke the Ferry trigger.');
  io.print('');
  io.print('  3. Remove these CI/CD variables  (Project → Settings → CI/CD → Variables):');
  io.print(`       ${base}/ci_cd#js-cicd-variables-settings`);
  for (const v of FERRY_GITLAB_CI_VARIABLES) {
    io.print(`       • ${v}`);
  }
  io.print('     Plus your LLM provider key (one of ANTHROPIC_API_KEY,');
  io.print('     OPENAI_API_KEY, GOOGLE_API_KEY) if it was added solely for Ferry.');
  io.print('');
  io.print('  4. Disable or delete the Jira Automation rules pointing at the trigger.');
  io.print('');
}
