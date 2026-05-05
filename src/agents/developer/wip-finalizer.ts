import { execFileSync } from 'node:child_process';
import type { IssueTracker } from '../../lib/io/tracker/types.js';
import type { Logger } from '../../lib/logger/index.js';
import { FerryError } from '../../lib/errors/index.js';
import { appendOutput } from '../../lib/agent-runtime/output.js';

export interface WipFinalizerOptions {
  error: unknown;
  ticketKey: string;
  eventId: string;
  branchName: string;
  repoRoot: string;
  secretScan: () => Promise<void>;
  tracker: IssueTracker;
  logger: Logger;
  dryRun: boolean;
  model: string;
  provider: string;
}

export function classifyError(err: unknown): { code: string; detail: string } {
  if (err instanceof FerryError) {
    const reason = (err.context?.reason as string | undefined) ?? 'unknown';
    if (err.code === 'spend-cap') {
      const cap = err.context?.cap;
      const consumed = err.context?.consumed;
      const detail =
        cap != null && consumed != null
          ? `spend cap exceeded (used ${Math.round(Number(consumed)).toLocaleString()} / ${Math.round(Number(cap)).toLocaleString()} tokens)`
          : 'spend cap exceeded';
      return { code: err.code, detail };
    }
    if (err.code === 'state-invariant' && reason === 'iteration-cap-exceeded') {
      return {
        code: err.code,
        detail: `max iterations reached (cap: ${err.context?.cap ?? 'unknown'})`,
      };
    }
    return { code: err.code, detail: reason };
  }
  const msg = (err as Error)?.message ?? String(err);
  return { code: 'unknown', detail: msg.slice(0, 200) };
}

export async function runWipFinalizer(opts: WipFinalizerOptions): Promise<void> {
  const {
    error,
    ticketKey,
    eventId,
    branchName,
    repoRoot,
    secretScan,
    tracker,
    logger,
    dryRun,
    model,
    provider,
  } = opts;

  const { code, detail } = classifyError(error);
  logger.info('wip_finalizer', { code, detail, branch: branchName });

  // 1. Commit any staged/unstaged changes (best-effort).
  let committed = false;
  try {
    execFileSync('git', ['add', '-A'], { cwd: repoRoot });
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (status.trim()) {
      await secretScan();
      const wipMsg = `wip(${ticketKey}): interrupted — ${code}\n\n[ferry:dev:${eventId}]`;
      execFileSync('git', ['commit', '-m', wipMsg], { cwd: repoRoot });
      committed = true;
      logger.info('wip_committed', { branch: branchName });
    } else {
      logger.info('wip_nothing_to_commit');
    }
  } catch (commitErr) {
    logger.error('wip_commit_failed', { error: (commitErr as Error).message });
  }

  // 2. Push the branch (best-effort; skipped in dryRun).
  let pushed = false;
  if (!dryRun) {
    try {
      execFileSync('git', ['push', 'origin', branchName, '--force-with-lease'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
      pushed = true;
    } catch {
      // --force-with-lease requires an upstream tracking ref; fall back for first-time pushes.
      try {
        execFileSync('git', ['push', 'origin', branchName], { cwd: repoRoot, stdio: 'pipe' });
        pushed = true;
      } catch (pushErr) {
        logger.error('wip_push_failed', { error: (pushErr as Error).message });
      }
    }
    if (pushed) {
      logger.info('wip_pushed', { branch: branchName, committed });
    }
  } else {
    logger.info('DRY_RUN — wip push skipped');
  }

  // 3. Post Jira comment (best-effort; skipped in dryRun).
  if (!dryRun) {
    const wipMarker = `[ferry:dev:wip:${eventId}]`;
    const branchRef = pushed ? ` WIP pushed to branch \`${branchName}\`.` : '';
    const comment =
      `${wipMarker} ⚠️ Dev run interrupted — ${detail}.${branchRef} ` +
      `The next run will resume from this state.`;
    try {
      await tracker.postComment(ticketKey, comment);
      logger.info('wip_jira_comment_posted');
    } catch (commentErr) {
      logger.error('wip_jira_comment_failed', { error: (commentErr as Error).message });
    }
  } else {
    logger.info('DRY_RUN — wip Jira comment skipped', { detail });
  }

  // 4. Emit zeroed audit tokens so the run-developer step output is always populated after failure.
  appendOutput({ input_tokens: 0, output_tokens: 0, model, provider });
}
