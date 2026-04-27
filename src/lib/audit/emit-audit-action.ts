import { Octokit } from '@octokit/rest';
import { emitAudit, type AuditPayload, type AuditOpts, type AuditUsage } from './index.js';

const REQUIRED_ENV = [
  'GITHUB_TOKEN',
  'FERRY_AUDIT_ISSUE',
  'FERRY_OWNER',
  'FERRY_REPO',
  'FERRY_RUN_ID',
  'FERRY_TICKET',
  'FERRY_PHASE',
  'FERRY_MODEL',
  'FERRY_OUTCOME',
  'FERRY_START_MS',
] as const;

function readEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[ferry:audit] Missing required env var: ${name}`);
  }
  return value;
}

function readNumberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[ferry:audit] Env var ${name} is not a valid number: ${raw}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  for (const name of REQUIRED_ENV) {
    readEnv(name);
  }

  const auditIssueRaw = readEnv('FERRY_AUDIT_ISSUE');
  const auditIssue = Number.parseInt(auditIssueRaw, 10);
  if (!Number.isInteger(auditIssue) || auditIssue <= 0) {
    throw new Error(`[ferry:audit] FERRY_AUDIT_ISSUE is not a positive integer: ${auditIssueRaw}`);
  }

  const startMsRaw = readEnv('FERRY_START_MS');
  const startMs = Number.parseInt(startMsRaw, 10);
  if (!Number.isInteger(startMs) || startMs < 0) {
    throw new Error(`[ferry:audit] FERRY_START_MS is not a non-negative integer: ${startMsRaw}`);
  }

  const usage: AuditUsage = {
    inputTokens: readNumberEnv('FERRY_INPUT_TOKENS', 0),
    outputTokens: readNumberEnv('FERRY_OUTPUT_TOKENS', 0),
    costEur: readNumberEnv('FERRY_COST_EUR', 0),
  };

  const payload: AuditPayload = {
    ticket: readEnv('FERRY_TICKET'),
    phase: readEnv('FERRY_PHASE'),
    runId: readEnv('FERRY_RUN_ID'),
    model: readEnv('FERRY_MODEL'),
    outcome: readEnv('FERRY_OUTCOME'),
    usage,
    start: startMs,
  };

  const octokit = new Octokit({ auth: readEnv('GITHUB_TOKEN') });

  const opts: AuditOpts = {
    octokit,
    owner: readEnv('FERRY_OWNER'),
    repo: readEnv('FERRY_REPO'),
    auditIssue,
  };

  await emitAudit(payload, opts);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[ferry:audit] Failed to emit audit line: ${message}`);
  process.exit(1);
});
