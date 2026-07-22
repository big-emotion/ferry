import { execSync } from 'node:child_process';
import { printSuccess, printSkip } from '../prompt.js';
import type { StepResult } from '../types.js';

const AUDIT_ISSUE_TITLE = 'Ferry audit log';
const AUDIT_ISSUE_BODY =
  "This issue is Ferry's append-only audit log: every agent run appends one journal " +
  'comment here. Do not close it — closing breaks the run history the reconciler and ' +
  'cost checks read from.';

/**
 * Extract the issue number from `gh issue create` stdout, which prints the URL
 * of the created issue (e.g. `https://github.com/owner/repo/issues/42`). Returns
 * null when no `/issues/<n>` segment is present so the caller can fail loudly
 * rather than set FERRY_AUDIT_ISSUE to a bogus value.
 */
export function parseIssueNumber(ghStdout: string): number | null {
  const match = ghStdout.match(/\/issues\/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function listRepoVariables(fullRepo: string): string[] {
  try {
    const output = execSync(`gh variable list --repo ${fullRepo} --json name`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (JSON.parse(output) as Array<{ name: string }>).map((v) => v.name);
  } catch {
    return [];
  }
}

/**
 * Create the append-only audit-log issue and point FERRY_AUDIT_ISSUE at it.
 * Idempotent: skips when the variable already exists unless `overwrite` is set,
 * in which case a fresh issue is created and the variable repointed.
 */
export function stepAuditIssue(fullRepo: string, overwrite: boolean): StepResult {
  if (listRepoVariables(fullRepo).includes('FERRY_AUDIT_ISSUE') && !overwrite) {
    printSkip('FERRY_AUDIT_ISSUE already set — skipping audit issue creation');
    return { ok: true };
  }

  let createdUrl: string;
  try {
    createdUrl = execSync(
      `gh issue create --repo ${fullRepo} --title ${JSON.stringify(AUDIT_ISSUE_TITLE)} --body ${JSON.stringify(AUDIT_ISSUE_BODY)}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Failed to create audit issue: ${msg}` };
  }

  const issueNumber = parseIssueNumber(createdUrl);
  if (issueNumber === null) {
    return {
      ok: false,
      reason: `Could not parse the created issue number from gh output: ${createdUrl.trim()}`,
    };
  }

  try {
    execSync(`gh variable set FERRY_AUDIT_ISSUE --repo ${fullRepo} --body ${issueNumber}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `Created audit issue #${issueNumber} but failed to set FERRY_AUDIT_ISSUE: ${msg}`,
    };
  }

  printSuccess(`Created audit issue #${issueNumber} and set FERRY_AUDIT_ISSUE=${issueNumber}`);
  return { ok: true };
}

function readWorkflowPermission(fullRepo: string): string | null {
  try {
    return execSync(
      `gh api repos/${fullRepo}/actions/permissions/workflow --jq .default_workflow_permissions`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Grant Actions workflows write access to repo contents (needed for the agents
 * to push branches and open PRs on `${{ github.token }}`). The PUT sets desired
 * state so it is inherently idempotent; we still read first to skip a redundant
 * call and to log whether anything actually changed. `overwrite` forces the PUT
 * even when the setting already reads `write`.
 */
export function stepWorkflowPermissions(fullRepo: string, overwrite: boolean): StepResult {
  const current = readWorkflowPermission(fullRepo);
  if (current === 'write' && !overwrite) {
    printSkip('Default workflow permissions already read+write — skipping');
    return { ok: true };
  }

  try {
    // Mirror the documented manual command exactly (INSTALL.md §Step 3): grant
    // write access AND allow Actions to approve PRs. Whether Ferry truly needs
    // can_approve_pull_request_reviews is worth a separate least-privilege review;
    // this PR automates the documented behaviour rather than changing it.
    execSync(
      `gh api -X PUT repos/${fullRepo}/actions/permissions/workflow -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Failed to set workflow permissions: ${msg}` };
  }

  if (current === 'write') {
    printSuccess('Re-applied default workflow permissions = read+write');
  } else {
    printSuccess(`Set default workflow permissions to read+write (was ${current ?? 'unreadable'})`);
  }
  return { ok: true };
}
