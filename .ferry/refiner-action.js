import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ── env ──────────────────────────────────────────────────────────────────────

const required = [
  'FERRY_ENVELOPE_PAYLOAD',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
  'ANTHROPIC_API_KEY',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[ferry:refiner] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const envelope = JSON.parse(process.env.FERRY_ENVELOPE_PAYLOAD);
const ticketKey = envelope.ticket_key;
const eventId = envelope.event_id;

const jiraBaseUrl = process.env.FERRY_JIRA_BASE_URL.replace(/\/$/, '');
const jiraEmail = process.env.FERRY_JIRA_EMAIL;
const jiraToken = process.env.FERRY_JIRA_API_TOKEN;
const model = process.env.FERRY_MODEL ?? 'claude-sonnet-4-6';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const promptPath =
  process.env.FERRY_PROMPT_PATH ?? path.join(repoRoot, 'prompts', 'refiner.md');

// ── helpers ───────────────────────────────────────────────────────────────────

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

function adfDocMultiline(lines) {
  return {
    version: 1,
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    })),
  };
}

// ── 1. fetch Jira ticket ──────────────────────────────────────────────────────

const issueUrl = `${jiraBaseUrl}/rest/api/3/issue/${ticketKey}?fields=summary,description,comment,labels,issuetype`;
const issueRes = await fetch(issueUrl, { method: 'GET', headers: jiraHeaders() });
if (!issueRes.ok) {
  console.error(`[ferry:refiner] Jira GET ${ticketKey} failed: ${issueRes.status}`);
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

// ── 2. build prompt ───────────────────────────────────────────────────────────

const systemPrompt = readFileSync(promptPath, 'utf-8');

const ticketBlock = [
  `TICKET ${ticketKey}`,
  `TITLE: ${title}`,
  `LABELS: ${labels || '(none)'}`,
  `DESCRIPTION:\n${description || '(empty)'}`,
  comments ? `COMMENTS:\n${comments}` : 'COMMENTS: (none)',
].join('\n\n');

const userMessage = `<<<UNTRUSTED>>>\n${ticketBlock}\n<<<END_UNTRUSTED>>>\n\nPlan the work as JSON.`;

// ── 3. call Claude ────────────────────────────────────────────────────────────

const anthropic = new Anthropic();
const completion = await anthropic.messages.create({
  model,
  max_tokens: 4096,
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
});

const rawText = completion.content.find((b) => b.type === 'text')?.text ?? '';

// ── 4. parse JSON from fenced block ──────────────────────────────────────────

const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
const jsonStr = fenceMatch ? fenceMatch[1].trim() : rawText.trim();
let parsed;
try {
  parsed = JSON.parse(jsonStr);
} catch {
  console.error(`[ferry:refiner] Could not parse Claude response as JSON:\n${rawText}`);
  process.exit(1);
}

// ── 5. handle non-actionable ──────────────────────────────────────────────────

if (!parsed.actionable) {
  const reason = parsed.reason_if_not_actionable ?? 'No reason provided.';
  const commentText = `[ferry:refiner:${eventId}] Cannot plan — ${reason}`;
  const commentRes = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${ticketKey}/comment`, {
    method: 'POST',
    headers: jiraHeaders(),
    body: JSON.stringify({ body: adfDoc(commentText) }),
  });
  if (!commentRes.ok) {
    console.error(`[ferry:refiner] Failed to post non-actionable comment: ${commentRes.status}`);
    process.exit(1);
  }
  console.log(`[ferry:refiner] Ticket ${ticketKey} not actionable — comment posted.`);
  process.exit(0);
}

// ── 6. create sub-tasks ───────────────────────────────────────────────────────

const subtasks = (parsed.subtasks ?? []).slice(0, 12);
let created = 0;

for (let i = 0; i < subtasks.length; i++) {
  const st = subtasks[i];
  const marker = `[ferry:refiner-subtask:${eventId}:${i}]`;
  const descriptionLines = [marker, st.description ?? ''];
  const adfDescription = adfDocMultiline(descriptionLines);

  const body = {
    fields: {
      project: { key: ticketKey.split('-')[0] },
      parent: { key: ticketKey },
      summary: (st.title ?? '').slice(0, 120),
      issuetype: { name: 'Subtask' },
      description: adfDescription,
    },
  };

  let stRes = await fetch(`${jiraBaseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: jiraHeaders(),
    body: JSON.stringify(body),
  });

  // Retry with alternate issuetype name — some Jira tenants use "Sub-task".
  if (stRes.status === 400) {
    body.fields.issuetype = { name: 'Sub-task' };
    stRes = await fetch(`${jiraBaseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: jiraHeaders(),
      body: JSON.stringify(body),
    });
  }

  if (!stRes.ok) {
    const errText = await stRes.text();
    console.error(`[ferry:refiner] Failed to create sub-task ${i}: ${stRes.status} — ${errText}`);
    process.exit(1);
  }

  const stData = await stRes.json();
  console.log(`[ferry:refiner] Created sub-task ${stData.key}: ${st.title}`);
  created++;
}

// ── 7. post summary comment ───────────────────────────────────────────────────

const summaryText = `[ferry:refiner:${eventId}] Refinement complete — ${created} sub-tasks created. Move the ticket to Ready for Dev when reviewed.`;
const summaryRes = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${ticketKey}/comment`, {
  method: 'POST',
  headers: jiraHeaders(),
  body: JSON.stringify({ body: adfDoc(summaryText) }),
});
if (!summaryRes.ok) {
  console.error(`[ferry:refiner] Failed to post summary comment: ${summaryRes.status}`);
  process.exit(1);
}

console.log(`[ferry:refiner] ${ticketKey} — ${created} sub-tasks created, summary comment posted.`);
process.exit(0);
