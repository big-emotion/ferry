import type { Octokit } from '@octokit/rest';

export interface AuditUsage {
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

export interface AuditPayload {
  ticket: string;
  phase: string;
  runId: string;
  model: string;
  outcome: string;
  usage: AuditUsage | null;
  start: number;
  triggeredLabels?: string[];
  resolvedMcpServers?: string[];
}

export interface AuditOpts {
  octokit: Octokit;
  owner: string;
  repo: string;
  auditIssue: number;
}

export interface AuditResult {
  rotatedTo?: number;
}

export const ROTATION_THRESHOLD = 900;
export const AUDIT_ACTIVE_LABEL = 'ferry:audit-log:active';

function getRotationThreshold(): number {
  return parseInt(process.env.FERRY_AUDIT_ROTATION_THRESHOLD ?? '', 10) || ROTATION_THRESHOLD;
}
const ROTATION_MARKER = '[ferry:audit:rotation]';
const MAX_PAGES = 10;

function parseAuditSeq(title: string): number {
  const m = title.match(/\(#(\d+)\)\s*$/);
  return m ? parseInt(m[1], 10) : 1;
}

export async function findActiveAuditIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<number | null> {
  const result = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: AUDIT_ACTIVE_LABEL,
    state: 'open',
    per_page: 1,
  });
  if (result.data.length === 0) return null;
  return result.data[0].number;
}

export async function rotateAuditIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  currentIssueNumber: number,
): Promise<number> {
  const current = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: currentIssueNumber,
  });

  const nextSeq = parseAuditSeq(current.data.title) + 1;
  const newTitle = `Ferry Audit Log (#${nextSeq})`;

  const created = await octokit.rest.issues.create({
    owner,
    repo,
    title: newTitle,
    body: `Ferry audit log — continued from #${currentIssueNumber}.\n\nDo not close. Ferry writes audit comments here.`,
    labels: [AUDIT_ACTIVE_LABEL],
  });

  const newIssueNumber = created.data.number;

  try {
    await octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: currentIssueNumber,
      name: AUDIT_ACTIVE_LABEL,
    });
  } catch {
    // label may not be present on old issue — ignore
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: currentIssueNumber,
    body: `${ROTATION_MARKER}\nAudit log continued in #${newIssueNumber} — ${newTitle}.`,
  });

  return newIssueNumber;
}

export async function emitAudit(payload: AuditPayload, opts: AuditOpts): Promise<AuditResult> {
  const { octokit, owner, repo } = opts;
  let auditIssue = opts.auditIssue;
  const {
    ticket,
    phase,
    runId,
    model,
    outcome,
    usage,
    start,
    triggeredLabels,
    resolvedMcpServers,
  } = payload;

  let rotatedTo: number | undefined;

  // Check capacity; rotate if at or past 90% of the 1000-comment cap
  const issueData = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: auditIssue,
  });

  if (issueData.data.comments >= getRotationThreshold()) {
    // Prefer an already-rotated active issue (stale FERRY_AUDIT_ISSUE variable case)
    const activeIssue = await findActiveAuditIssue(octokit, owner, repo);
    if (activeIssue !== null && activeIssue !== auditIssue) {
      rotatedTo = activeIssue;
      auditIssue = activeIssue;
    } else {
      const newIssue = await rotateAuditIssue(octokit, owner, repo, auditIssue);
      rotatedTo = newIssue;
      auditIssue = newIssue;
    }
  }

  const marker = `[ferry:audit:${runId}]`;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const existing = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: auditIssue,
      per_page: 100,
      page,
    });
    if (existing.data.some((c) => typeof c.body === 'string' && c.body.startsWith(marker)))
      return { rotatedTo };
    if (existing.data.length < 100) break;
  }

  const auditLine: Record<string, unknown> = {
    ticket,
    phase,
    run_id: runId,
    model,
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cost_eur: usage?.costEur ?? 0,
    outcome,
    duration_ms: Math.round(Date.now() - start),
    timestamp: new Date().toISOString(),
  };

  if (triggeredLabels !== undefined) auditLine.triggered_labels = triggeredLabels;
  if (resolvedMcpServers !== undefined) auditLine.resolved_mcp_servers = resolvedMcpServers;

  const body = `${marker}\n${JSON.stringify(auditLine)}`;

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: auditIssue,
    body,
  });

  return { rotatedTo };
}
