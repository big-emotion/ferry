import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowItem, AuditIssueState } from './types.js';
import { AUDIT_LABEL } from './detect.js';

export interface ExecOptions {
  dryRun: boolean;
  onAction: (msg: string) => void;
  onSkip: (msg: string) => void;
  onError: (msg: string) => void;
}

export function removeWorkflows(
  repoRoot: string,
  workflows: WorkflowItem[],
  opts: ExecOptions,
): void {
  const workflowDir = join(repoRoot, '.github', 'workflows');
  for (const wf of workflows) {
    if (!wf.present) {
      opts.onSkip(`${wf.filename} not present — skipping`);
      continue;
    }
    if (opts.dryRun) {
      opts.onAction(`[dry-run] Would delete .github/workflows/${wf.filename}`);
      continue;
    }
    const dest = join(workflowDir, wf.filename);
    try {
      unlinkSync(dest);
      opts.onAction(`Deleted .github/workflows/${wf.filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onError(`Failed to delete ${wf.filename}: ${msg}`);
    }
  }
}

export function removeCodeownersBlock(repoRoot: string, opts: ExecOptions): void {
  const codeownersPath = join(repoRoot, '.github', 'CODEOWNERS');
  if (!existsSync(codeownersPath)) {
    opts.onSkip('.github/CODEOWNERS not present — skipping');
    return;
  }
  const content = readFileSync(codeownersPath, 'utf8');
  const lines = content.split('\n');
  const filtered = lines.filter((line) => !line.includes('ferry-'));
  const updated = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  if (updated === content) {
    opts.onSkip('.github/CODEOWNERS has no Ferry entries — skipping');
    return;
  }
  if (opts.dryRun) {
    opts.onAction('[dry-run] Would remove Ferry block from .github/CODEOWNERS');
    return;
  }
  try {
    writeFileSync(codeownersPath, updated, 'utf8');
    opts.onAction('Removed Ferry block from .github/CODEOWNERS (file kept)');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.onError(`Failed to edit .github/CODEOWNERS: ${msg}`);
  }
}

export function removeSecrets(repo: string, secrets: string[], opts: ExecOptions): void {
  if (secrets.length === 0) {
    opts.onSkip('No Ferry secrets found — skipping');
    return;
  }
  for (const name of secrets) {
    if (opts.dryRun) {
      opts.onAction(`[dry-run] Would delete secret ${name}`);
      continue;
    }
    try {
      execSync(`gh secret delete ${name} --repo ${repo}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      opts.onAction(`Deleted secret ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onError(`Failed to delete secret ${name}: ${msg}`);
    }
  }
}

export function removeVariable(repo: string, name: string, opts: ExecOptions): void {
  if (opts.dryRun) {
    opts.onAction(`[dry-run] Would delete repo variable ${name}`);
    return;
  }
  try {
    execSync(`gh variable delete ${name} --repo ${repo}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    opts.onAction(`Deleted repo variable ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.onError(`Failed to delete variable ${name}: ${msg}`);
  }
}

export function handleAuditIssue(
  repo: string,
  issue: AuditIssueState,
  closeIt: boolean,
  opts: ExecOptions,
): void {
  if (issue.hasLabel) {
    if (opts.dryRun) {
      opts.onAction(
        `[dry-run] Would remove label '${AUDIT_LABEL}' from issue #${issue.number}`,
      );
    } else {
      try {
        execSync(
          `gh issue edit ${issue.number} --repo ${repo} --remove-label "${AUDIT_LABEL}"`,
          {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        opts.onAction(`Removed label '${AUDIT_LABEL}' from issue #${issue.number}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.onError(`Failed to remove label from issue #${issue.number}: ${msg}`);
      }
    }
  } else {
    opts.onSkip(
      `Issue #${issue.number} does not have label '${AUDIT_LABEL}' — skipping label removal`,
    );
  }

  if (closeIt) {
    if (opts.dryRun) {
      opts.onAction(`[dry-run] Would close issue #${issue.number}`);
    } else {
      try {
        execSync(`gh issue close ${issue.number} --repo ${repo}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        opts.onAction(`Closed issue #${issue.number}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.onError(`Failed to close issue #${issue.number}: ${msg}`);
      }
    }
  }
}
