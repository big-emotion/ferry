import { spawnSync } from 'child_process';
import { Octokit } from '@octokit/rest';
import { emitAudit, AUDIT_ACTIVE_LABEL } from './index.js';

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

const result = await emitAudit(
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

if (result.rotatedTo !== undefined) {
  process.stdout.write(
    `[ferry:audit] Audit issue rotated: #${auditIssue} → #${result.rotatedTo}\n`,
  );
  process.stdout.write(`[ferry:audit] New active issue has label: ${AUDIT_ACTIVE_LABEL}\n`);

  // Try to update the repository variable so future runs use the new issue directly.
  // Requires variables:write permission on GITHUB_TOKEN; falls back to label discovery if absent.
  const setResult = spawnSync(
    'gh',
    [
      'variable',
      'set',
      'FERRY_AUDIT_ISSUE',
      '--body',
      String(result.rotatedTo),
      '--repo',
      `${owner}/${repo}`,
    ],
    { stdio: 'inherit', env: { ...process.env, GH_TOKEN: token } },
  );
  if (setResult.status === 0) {
    process.stdout.write(`[ferry:audit] FERRY_AUDIT_ISSUE updated to ${result.rotatedTo}\n`);
  } else {
    process.stderr.write(
      `[ferry:audit] Warning: could not update FERRY_AUDIT_ISSUE via gh variable set ` +
        `(token may lack variables:write). ` +
        `Future runs will discover the active issue via the '${AUDIT_ACTIVE_LABEL}' label. ` +
        `To silence this warning, add 'variables: write' to the emit-audit job permissions ` +
        `and update FERRY_AUDIT_ISSUE manually to ${result.rotatedTo}.\n`,
    );
  }
}
