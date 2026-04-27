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
}

export interface AuditOpts {
  octokit: Octokit;
  owner: string;
  repo: string;
  auditIssue: number;
}

export async function emitAudit(payload: AuditPayload, opts: AuditOpts): Promise<void> {
  const { octokit, owner, repo, auditIssue } = opts;
  const { ticket, phase, runId, model, outcome, usage, start } = payload;

  const marker = `[ferry:audit:${runId}]`;

  const existing = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: auditIssue,
    per_page: 50,
  });

  const alreadyPosted = existing.data.some(
    (c) => typeof c.body === 'string' && c.body.startsWith(marker),
  );
  if (alreadyPosted) return;

  const auditLine = {
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

  const body = `${marker}\n${JSON.stringify(auditLine)}`;

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: auditIssue,
    body,
  });
}
