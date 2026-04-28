import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import Anthropic from '@anthropic-ai/sdk';

// ── env ──────────────────────────────────────────────────────────────────────

const required = [
  'FERRY_ENVELOPE_PAYLOAD',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'FERRY_REVIEW_TRANSITION_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[ferry:dev] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const envelope = JSON.parse(process.env.FERRY_ENVELOPE_PAYLOAD);
const ticketKey = envelope.ticket_key;
const eventId = envelope.event_id;

const jiraBaseUrl = process.env.FERRY_JIRA_BASE_URL.replace(/\/$/, '');
const jiraEmail = process.env.FERRY_JIRA_EMAIL;
const jiraToken = process.env.FERRY_JIRA_API_TOKEN;
const reviewTransitionId = process.env.FERRY_REVIEW_TRANSITION_ID;
const model = process.env.FERRY_MODEL ?? 'claude-sonnet-4-6';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const promptPath =
  process.env.FERRY_PROMPT_PATH ?? path.join(repoRoot, 'prompts', 'dev.md');

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns true if any existing Jira comment body contains the given prefix. */
async function jiraCommentExists(key, prefix) {
  const res = await fetch(
    `${jiraBaseUrl}/rest/api/3/issue/${key}/comment?maxResults=50`,
    { method: 'GET', headers: jiraHeaders() },
  );
  if (!res.ok) return false;
  const data = await res.json();
  return (data.comments ?? []).some((c) => adfToText(c.body).includes(prefix));
}

function jiraHeaders() {
  const token = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** Recursively extract plain text from an ADF node. */
function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const children = (node.content ?? []).map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList'].includes(node.type)) {
    return children + '\n';
  }
  return children;
}

function adfDoc(text) {
  return {
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: repoRoot, encoding: 'utf-8', ...opts }).trim();
}

function spawn(file, args, opts = {}) {
  const result = spawnSync(file, args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
  }
  return (result.stdout ?? '').trim();
}

// ── 1. fetch Jira ticket ──────────────────────────────────────────────────────

const issueUrl = `${jiraBaseUrl}/rest/api/3/issue/${ticketKey}?fields=summary,description,comment,labels,issuetype`;
const issueRes = await fetch(issueUrl, { method: 'GET', headers: jiraHeaders() });
if (!issueRes.ok) {
  console.error(`[ferry:dev] Jira GET ${ticketKey} failed: ${issueRes.status}`);
  process.exit(1);
}
const issue = await issueRes.json();
const fields = issue.fields;

const title = fields.summary ?? '';
const description = fields.description ? adfToText(fields.description).trim() : '';
const labels = (fields.labels ?? []).join(', ');
const comments = (fields.comment?.comments ?? [])
  .map((c) => adfToText(c.body).trim())
  .filter(Boolean)
  .join('\n---\n');

// ── 2. fetch subtasks ─────────────────────────────────────────────────────────

const subtasksRes = await fetch(`${jiraBaseUrl}/rest/api/3/search/jql`, {
  method: 'POST',
  headers: jiraHeaders(),
  body: JSON.stringify({
    jql: `parent=${ticketKey} ORDER BY created ASC`,
    fields: ['summary', 'description'],
    maxResults: 20,
  }),
});
if (!subtasksRes.ok) {
  console.error(`[ferry:dev] Jira subtask search failed: ${subtasksRes.status}`);
  process.exit(1);
}
const subtasksData = await subtasksRes.json();
const subtaskLines = (subtasksData.issues ?? []).map((st) => {
  const stDesc = st.fields.description ? adfToText(st.fields.description).trim() : '';
  return `- [${st.key}] ${st.fields.summary ?? ''}${stDesc ? `\n  ${stDesc.slice(0, 300)}` : ''}`;
});

// ── 3. detect test runner ─────────────────────────────────────────────────────

let testRunner = 'none';
try {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const testScript = pkg.scripts?.test ?? '';
  if (deps.vitest || testScript.includes('vitest')) testRunner = 'vitest';
  else if (deps.jest || testScript.includes('jest')) testRunner = 'jest';
  else if (deps.mocha || testScript.includes('mocha')) testRunner = 'mocha';
  else if (deps.ava || testScript.includes('ava')) testRunner = 'ava';
  else if (testScript.includes('node --test')) testRunner = 'node:test';
} catch {
  // no package.json — leave testRunner as 'none'
}

// ── 4. build repo tree ────────────────────────────────────────────────────────

let repoTree = '';
try {
  repoTree = run(
    `find . -maxdepth 2 -not -path './.git*' -not -path './.ferry*' -not -path './node_modules*' | sort`,
  );
} catch {
  repoTree = '(unavailable)';
}

// ── 5. build prompt ───────────────────────────────────────────────────────────

const systemPrompt = readFileSync(promptPath, 'utf-8');

const ticketBlock = [
  `TICKET ${ticketKey}`,
  `TITLE: ${title}`,
  `LABELS: ${labels || '(none)'}`,
  `DESCRIPTION:\n${description || '(empty)'}`,
  comments ? `COMMENTS:\n${comments}` : 'COMMENTS: (none)',
  subtaskLines.length ? `SUBTASKS:\n${subtaskLines.join('\n')}` : 'SUBTASKS: (none)',
].join('\n\n');

const userMessage = [
  `<<<UNTRUSTED>>>\n${ticketBlock}\n<<<END_UNTRUSTED>>>`,
  `TEST_RUNNER: ${testRunner}`,
  `REPO TREE (top 2 levels):\n${repoTree}`,
  'Implement the code as JSON.',
].join('\n\n');

// ── 6. call Claude ────────────────────────────────────────────────────────────

const anthropic = new Anthropic();
const completion = await anthropic.messages.create({
  model,
  max_tokens: 32768,
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
});

const rawText = completion.content.find((b) => b.type === 'text')?.text ?? '';

const ghOutput = process.env.GITHUB_OUTPUT;
if (ghOutput) {
  appendFileSync(ghOutput, `input_tokens=${completion.usage.input_tokens}\noutput_tokens=${completion.usage.output_tokens}\n`);
}

// ── 7. parse JSON from fenced block ──────────────────────────────────────────

const fences = [...rawText.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
const jsonStr = fences.length ? fences[fences.length - 1][1].trim() : rawText.trim();
let parsed;
try {
  parsed = JSON.parse(jsonStr);
} catch {
  console.error(`[ferry:dev] Could not parse Claude response as JSON:\n${rawText}`);
  process.exit(1);
}

// ── 8. handle non-actionable ──────────────────────────────────────────────────

if (!parsed.actionable) {
  const reason = parsed.reason_if_not_actionable ?? 'No reason provided.';
  const commentPrefix = `[ferry:dev:${eventId}]`;
  const commentText = `${commentPrefix} Cannot implement — ${reason}`;
  if (!await jiraCommentExists(ticketKey, commentPrefix)) {
    const commentRes = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${ticketKey}/comment`, {
      method: 'POST',
      headers: jiraHeaders(),
      body: JSON.stringify({ body: adfDoc(commentText) }),
    });
    if (!commentRes.ok) {
      console.error(`[ferry:dev] Failed to post non-actionable comment: ${commentRes.status}`);
      process.exit(1);
    }
  }
  console.log(`[ferry:dev] Ticket ${ticketKey} not actionable — comment posted.`);
  process.exit(0);
}

// ── 9. validate and sanitize parsed fields ────────────────────────────────────

const rawBranch = parsed.branch_name ?? `feat/${ticketKey}-dev`;
const branchName = rawBranch.replace(/[^a-zA-Z0-9/_.-]/g, '-').slice(0, 100);
const commitMessage = (parsed.commit_message ?? `feat: implement ${ticketKey}`)
  .replace(/[\r\n]/g, ' ')
  .slice(0, 200);
const summary = parsed.summary ?? '';
const files = parsed.files ?? [];

if (!files.length) {
  console.error('[ferry:dev] Claude returned no files — aborting.');
  process.exit(1);
}

// ── 10. write files ───────────────────────────────────────────────────────────

const DENIED_PREFIXES = ['.github', '.ferry', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

for (const file of files) {
  const filePath = path.resolve(repoRoot, file.path);
  if (!filePath.startsWith(repoRoot + path.sep)) {
    console.error(`[ferry:dev] Skipping path outside repo root: ${file.path}`);
    continue;
  }
  const rel = path.relative(repoRoot, filePath);
  const topSegment = rel.split(path.sep)[0];
  if (DENIED_PREFIXES.some((d) => topSegment === d)) {
    console.error(`[ferry:dev] Skipping denied path: ${file.path}`);
    continue;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, file.content ?? '', 'utf-8');
  console.log(`[ferry:dev] ${file.action ?? 'write'}: ${file.path}`);
}

// ── 11. git: configure, branch, commit, push ─────────────────────────────────

run('git config user.name "ferry-bot"');
run('git config user.email "ferry-bot@users.noreply.github.com"');
run(`git checkout -B ${branchName}`);
run('git add -A');
spawn('git', ['commit', '-m', commitMessage]);
run(`git push origin ${branchName} --force-with-lease`);

// ── 12. open pull request ─────────────────────────────────────────────────────

const jiraLink = `${jiraBaseUrl}/browse/${ticketKey}`;
const subtaskListMd = subtaskLines.length
  ? subtaskLines.map((l) => `- ${l.replace(/^- /, '')}`).join('\n')
  : '(no subtasks)';
const prBody = [
  `## Summary`,
  summary,
  ``,
  `**Jira:** [${ticketKey}](${jiraLink})`,
  ``,
  `## Subtasks addressed`,
  subtaskListMd,
  testRunner === 'none' ? `\n> No test runner detected — tests skipped.` : '',
].join('\n');

const prTitle = `[${ticketKey}] ${title}`.slice(0, 120);
const bodyFile = path.join(tmpdir(), `ferry-pr-body-${eventId}.md`);
writeFileSync(bodyFile, prBody, 'utf-8');

let prUrl;
try {
  prUrl = spawn('gh', [
    'pr', 'create',
    '--title', prTitle,
    '--body-file', bodyFile,
    '--base', 'main',
    '--head', branchName,
  ]);
} catch {
  // PR may already exist on this branch — retrieve existing URL
  try {
    prUrl = spawn('gh', ['pr', 'view', branchName, '--json', 'url', '-q', '.url']);
  } catch (e) {
    console.error(`[ferry:dev] Failed to create or find PR: ${e.message}`);
    process.exit(1);
  }
}

console.log(`[ferry:dev] PR: ${prUrl}`);

// ── 13. Jira transition to Review ─────────────────────────────────────────────

const transitionRes = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${ticketKey}/transitions`, {
  method: 'POST',
  headers: jiraHeaders(),
  body: JSON.stringify({ transition: { id: reviewTransitionId } }),
});
if (!transitionRes.ok) {
  const errText = await transitionRes.text();
  console.error(`[ferry:dev] Jira transition failed: ${transitionRes.status} — ${errText}`);
  process.exit(1);
}

// ── 14. post summary comment (idempotent) ─────────────────────────────────────

const summaryPrefix = `[ferry:dev:${eventId}]`;
if (!await jiraCommentExists(ticketKey, summaryPrefix)) {
  const summaryText = `${summaryPrefix} Implementation complete — PR: ${prUrl}. Moved to Review.`;
  const commentRes = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${ticketKey}/comment`, {
    method: 'POST',
    headers: jiraHeaders(),
    body: JSON.stringify({ body: adfDoc(summaryText) }),
  });
  if (!commentRes.ok) {
    console.error(`[ferry:dev] Failed to post summary comment: ${commentRes.status}`);
    process.exit(1);
  }
}

console.log(`[ferry:dev] ${ticketKey} — ${files.length} file(s) written, PR opened, moved to Review.`);
process.exit(0);
