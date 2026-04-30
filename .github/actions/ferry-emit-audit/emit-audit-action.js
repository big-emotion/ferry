// Self-contained audit emission bundle for ferry-emit-audit composite action.
// Octokit is loaded via createRequire so it resolves from this action's own node_modules.
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { Octokit } = _require('@octokit/rest');

function requireEnv(name) {
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

const marker = `[ferry:audit:${runId}]`;

const MAX_PAGES = 10;
for (let page = 1; page <= MAX_PAGES; page++) {
  const existing = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: auditIssue,
    per_page: 100,
    page,
  });
  if (existing.data.some((c) => typeof c.body === 'string' && c.body.startsWith(marker))) {
    process.exit(0);
  }
  if (existing.data.length < 100) break;
}

const auditLine = {
  ticket,
  phase,
  run_id: runId,
  model,
  input_tokens: inputTokens,
  output_tokens: outputTokens,
  cost_eur: costEur,
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
