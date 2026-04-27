import { Octokit } from '@octokit/rest';
import { emitAudit } from './index.js';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const token = requireEnv('GITHUB_TOKEN');
const auditIssueStr = requireEnv('FERRY_AUDIT_ISSUE');
const owner = requireEnv('FERRY_OWNER');
const repo = requireEnv('FERRY_REPO');
const runId = requireEnv('FERRY_RUN_ID');
const ticket = requireEnv('FERRY_TICKET');
const phase = requireEnv('FERRY_PHASE');
const model = requireEnv('FERRY_MODEL');
const outcome = requireEnv('FERRY_OUTCOME');
const startMsStr = requireEnv('FERRY_START_MS');

const auditIssue = parseInt(auditIssueStr, 10);
if (isNaN(auditIssue)) throw new Error(`FERRY_AUDIT_ISSUE must be a number, got: ${auditIssueStr}`);

const start = parseInt(startMsStr, 10);
if (isNaN(start)) throw new Error(`FERRY_START_MS must be a number, got: ${startMsStr}`);

const inputTokens = parseInt(process.env['FERRY_INPUT_TOKENS'] ?? '0', 10) || 0;
const outputTokens = parseInt(process.env['FERRY_OUTPUT_TOKENS'] ?? '0', 10) || 0;
const costEur = parseFloat(process.env['FERRY_COST_EUR'] ?? '0') || 0;

const octokit = new Octokit({ auth: token });

await emitAudit(
  {
    ticket,
    phase,
    runId,
    model,
    outcome,
    usage: { inputTokens, outputTokens, costEur },
    start,
  },
  { octokit, owner, repo, auditIssue },
);
