import { execFileSync } from 'node:child_process';
import type { CheckResult } from '../types.js';

const LABEL = 'Audit issue';
const REMEDY =
  'Follow README Step 1: create a GitHub issue, then run `gh variable set FERRY_AUDIT_ISSUE --body "<issue-number>" --repo <owner/repo>`';

export function checkAuditIssue(repo: string): CheckResult {
  let rawValue: string;
  try {
    rawValue = execFileSync('gh', ['variable', 'get', 'FERRY_AUDIT_ISSUE', '--repo', repo], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return {
      label: LABEL,
      status: 'red',
      detail: 'FERRY_AUDIT_ISSUE repo variable is not set',
      remedy: REMEDY,
    };
  }

  if (!rawValue) {
    return {
      label: LABEL,
      status: 'red',
      detail: 'FERRY_AUDIT_ISSUE repo variable is empty',
      remedy: REMEDY,
    };
  }

  if (!/^\d+$/.test(rawValue) || parseInt(rawValue, 10) <= 0) {
    return {
      label: LABEL,
      status: 'red',
      detail: `FERRY_AUDIT_ISSUE="${rawValue}" is not a positive integer`,
      remedy: REMEDY,
    };
  }

  const issueNumber = parseInt(rawValue, 10);

  interface IssueState {
    state: string;
  }

  let issue: IssueState;
  try {
    const out = execFileSync(
      'gh',
      ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'state'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    issue = JSON.parse(out) as IssueState;
  } catch {
    return {
      label: LABEL,
      status: 'red',
      detail: `Issue #${issueNumber} not found in ${repo}`,
      remedy: REMEDY,
    };
  }

  if (issue.state !== 'OPEN') {
    return {
      label: LABEL,
      status: 'red',
      detail: `Issue #${issueNumber} is ${issue.state.toLowerCase()} — audit issue must be open`,
      remedy: REMEDY,
    };
  }

  return {
    label: LABEL,
    status: 'green',
    detail: `FERRY_AUDIT_ISSUE=#${issueNumber} is open`,
  };
}
