import { appendFileSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolResultBlockParam, ContentBlock } from '@anthropic-ai/sdk/resources/messages.js';
import { Octokit } from '@octokit/rest';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { delimitUntrusted } from '../../lib/sanitization/delimit-untrusted.js';
import { createJiraRestClientFromEnv } from '../../lib/io/jira-rest.js';
import { adfToText, textToAdf } from '../../lib/io/jira-adf.js';
import { checkIdempotencyMarker } from '../../lib/io/idempotency.js';
import { gateCi } from './ci-gate.js';
import type { CiStatus } from './ci-gate.js';
import { FerryError } from '../../lib/error.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();
const SYSTEM_PROMPT_PATH =
  process.env.FERRY_PROMPT_PATH ?? path.join(REPO_ROOT, 'prompts', 'review.md');
const COMMENT_TEMPLATE_PATH =
  process.env.FERRY_REVIEW_TEMPLATE_PATH ?? path.join(REPO_ROOT, 'prompts', 'review-comment.md');

const MAX_ITERATIONS = 40;
const MAX_PATCH_CHARS = 20_000;
const MAX_CONTENT_CHARS = 40_000;

const REVIEW_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_file_patch',
    description:
      'Get the unified diff patch for a specific file in this PR. ' +
      'Use this to inspect what changed in a file before making a finding.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Exact file path as listed in the PR file list.' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'get_file_content',
    description:
      'Get the full content of a file from the PR head branch. ' +
      'Use when the patch is truncated or you need context outside the changed lines.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Exact file path.' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'finish_review',
    description: 'Post the review verdict and end the review loop. Call once you have inspected all relevant files.',
    input_schema: {
      type: 'object',
      properties: {
        approved: {
          type: 'boolean',
          description: 'true = ready to merge, false = changes required.',
        },
        comment: {
          type: 'string',
          description: 'Full review comment in Markdown. Follow the required format from the system prompt.',
        },
      },
      required: ['approved', 'comment'],
    },
  },
];

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

async function resolveCiStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
): Promise<CiStatus> {
  const { data } = await octokit.checks.listForRef({ owner, repo, ref: sha, per_page: 100 });
  const runs = data.check_runs;
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  if (runs.some((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out')) return 'red';
  return 'green';
}

type PrFile = { filename: string; status: string; additions: number; deletions: number; patch?: string };

async function fetchAllPrFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrFile[]> {
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));
}

function detectMergeConflicts(files: PrFile[]): string[] {
  const conflicted: string[] = [];
  for (const f of files) {
    if (f.patch && /^[+].*<{7}|^[+].*={7}|^[+].*>{7}/m.test(f.patch)) {
      conflicted.push(f.filename);
    }
  }
  return conflicted;
}

function buildFileList(files: PrFile[]): string {
  return files
    .map((f) => `${f.status.padEnd(8)} +${f.additions} -${f.deletions}  ${f.filename}`)
    .join('\n');
}

async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  filename: string,
  ref: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filename, ref });
    if ('content' in data && typeof data.content === 'string') {
      const decoded = Buffer.from(data.content, 'base64').toString('utf8');
      return decoded.length > MAX_CONTENT_CHARS
        ? decoded.slice(0, MAX_CONTENT_CHARS) + '\n... (truncated)'
        : decoded;
    }
    return '(binary file or directory — cannot display)';
  } catch (e) {
    return `(error fetching content: ${(e as Error).message})`;
  }
}

interface ReviewResult {
  approved: boolean;
  comment: string;
}

async function runReviewLoop(opts: {
  anthropic: Anthropic;
  model: string;
  system: string;
  initialPrompt: string;
  fileMap: Map<string, string | undefined>;
  octokit: Octokit;
  owner: string;
  repo: string;
  headSha: string;
}): Promise<{ result: ReviewResult; inputTokens: number; outputTokens: number }> {
  const { anthropic, model, system, initialPrompt, fileMap, octokit, owner, repo, headSha } = opts;

  const tools = REVIEW_TOOLS.map((t, i) =>
    i === REVIEW_TOOLS.length - 1
      ? ({ ...t, cache_control: { type: 'ephemeral' as const } })
      : t,
  );

  const messages: MessageParam[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: initialPrompt, cache_control: { type: 'ephemeral' } }],
    },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let result: ReviewResult | null = null;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 16384,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    messages.push({ role: 'assistant', content: response.content as ContentBlock[] });

    console.error(
      `[ferry:review-loop] iter=${iter + 1} stop=${response.stop_reason} tools=${response.content.filter((b) => b.type === 'tool_use').length} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
    );

    if (response.stop_reason !== 'tool_use') {
      throw new FerryError('state-invariant', {
        reason: 'reviewer-stopped-without-finish',
        stop_reason: response.stop_reason,
      });
    }

    const toolResults: ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const input = block.input as Record<string, unknown>;

      if (block.name === 'finish_review') {
        result = {
          approved: input.approved as boolean,
          comment: input.comment as string,
        };
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ok' });
        continue;
      }

      if (block.name === 'get_file_patch') {
        const filename = input.filename as string;
        console.error(`[ferry:review-tool] iter=${iter + 1} get_file_patch ${filename}`);
        const patch = fileMap.get(filename);
        let content: string;
        if (patch === undefined) {
          content = `(file not found in PR: ${filename})`;
        } else if (!patch) {
          content = '(no patch — binary, empty, or content unchanged)';
        } else {
          content = patch.length > MAX_PATCH_CHARS ? patch.slice(0, MAX_PATCH_CHARS) + '\n... (truncated)' : patch;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
        continue;
      }

      if (block.name === 'get_file_content') {
        const filename = input.filename as string;
        console.error(`[ferry:review-tool] iter=${iter + 1} get_file_content ${filename}`);
        const content = await getFileContent(octokit, owner, repo, filename, headSha);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
        continue;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: `unknown tool: ${block.name}`,
        is_error: true,
      });
    }

    // Roll cache breakpoint forward to the latest tool results
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const content = msg.content as ToolResultBlockParam[];
        if (content.some((b) => b.type === 'tool_result')) {
          const last = content[content.length - 1];
          const { cache_control: _cc, ...rest } = last as ToolResultBlockParam & { cache_control?: unknown };
          content[content.length - 1] = rest as ToolResultBlockParam;
          break;
        }
      }
    }
    if (toolResults.length > 0) {
      const last = toolResults[toolResults.length - 1];
      toolResults[toolResults.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
    }

    messages.push({ role: 'user', content: toolResults });

    if (result) return { result, inputTokens, outputTokens };
  }

  throw new FerryError('state-invariant', { reason: 'review-iteration-cap-exceeded', cap: MAX_ITERATIONS });
}

async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const githubToken = requireEnv('GITHUB_TOKEN');
  const iterTransitionId = requireEnv('FERRY_ITER_TRANSITION_ID');
  const githubRepo = requireEnv('GITHUB_REPO');

  const model = process.env.FERRY_REVIEW_MODEL ?? 'claude-sonnet-4-6';

  const [owner, repo] = githubRepo.split('/');
  if (!owner || !repo) {
    throw new FerryError('state-invariant', { reason: 'invalid-github-repo', githubRepo });
  }
  const octokit = new Octokit({ auth: githubToken });
  const jira = createJiraRestClientFromEnv();

  const idempotencyMarker = `[ferry:reviewer:${eventId}]`;

  const issue = await jira.getIssue(ticketKey);
  const existingComments = issue.fields.comment.comments.map((c) => adfToText(c.body));
  const { skipped } = checkIdempotencyMarker(idempotencyMarker, existingComments);
  if (skipped) {
    console.error(`[ferry:review-action] already processed ${eventId}, skipping`);
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  // Find PR for this ticket's branch
  const branchName = `ferry/${ticketKey}`;
  const { data: pulls } = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branchName}`,
    per_page: 1,
  });

  if (pulls.length === 0) {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} No open PR found for branch ${branchName}. Cannot review.`),
    );
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  const prNumber = pulls[0].number;
  // Fetch the full PR to get the `mergeable` field (not available in list response)
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const headSha = pr.head.sha;
  const mergeable = pr.mergeable;

  // CI gate
  const ciStatus = await resolveCiStatus(octokit, owner, repo, headSha);
  const ciOutcome = gateCi({ status: ciStatus });

  if (!ciOutcome.proceed) {
    if (ciOutcome.outcome === 'pending-ci') {
      await jira.postComment(
        ticketKey,
        textToAdf(
          `${idempotencyMarker} CI checks are still pending on ${headSha.slice(0, 7)}. Will retry when CI completes.`,
        ),
      );
      appendOutput({ input_tokens: 0, output_tokens: 0, model });
      return;
    }

    const ciMessage = ciOutcome.findings[0]?.message ?? 'CI checks failed. See the Actions run for details.';
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} CI checks failed. Moved to Dev Iteration.`),
    );
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `${idempotencyMarker}\n\n**CI failed:** ${ciMessage}`,
    });
    await jira.postTransition(ticketKey, iterTransitionId);
    appendOutput({ input_tokens: 0, output_tokens: 0, model });
    return;
  }

  // Fetch ALL PR files (paginated)
  const files = await fetchAllPrFiles(octokit, owner, repo, prNumber);
  const fileMap = new Map<string, string | undefined>(files.map((f) => [f.filename, f.patch]));

  // Detect merge conflicts in patches
  const conflictedFiles = detectMergeConflicts(files);
  const hasMergeConflicts = mergeable === false || conflictedFiles.length > 0;

  // Fetch commits for context
  const { data: commits } = await octokit.pulls.listCommits({
    owner, repo, pull_number: prNumber, per_page: 50,
  });
  const commitLog = commits
    .map((c) => `${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]}`)
    .join('\n');

  // Build ticket context
  const description = adfToText(issue.fields.description);
  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.fields.summary}`,
    `TYPE: ${issue.fields.issuetype.name}`,
    `DESCRIPTION:\n${description}`,
  ].filter(Boolean).join('\n');

  const mergeConflictWarning = hasMergeConflicts
    ? `\n⚠️  MERGE CONFLICTS DETECTED — mergeable=${String(mergeable)}${conflictedFiles.length > 0 ? `, conflicted files: ${conflictedFiles.join(', ')}` : ''}`
    : '';

  const initialPrompt = [
    '## Jira Ticket',
    delimitUntrusted(ticketBlock),
    '',
    '## PR Metadata',
    `PR #${prNumber}: ${pr.title}`,
    `Base: ${pr.base.ref} ← Head: ${branchName} (${headSha.slice(0, 7)})`,
    `Files changed: ${files.length}  Commits: ${commits.length}`,
    mergeConflictWarning,
    '',
    '## Commits',
    commitLog,
    '',
    '## Changed files (status  +additions  -deletions  path)',
    buildFileList(files),
    '',
    'Use get_file_patch to inspect individual file diffs, get_file_content for full file contents.',
    'When you have enough information, call finish_review.',
  ].filter((l) => l !== null).join('\n');

  const systemBase = readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  let commentTemplate = '';
  try { commentTemplate = readFileSync(COMMENT_TEMPLATE_PATH, 'utf8'); } catch { /* optional */ }
  const system = commentTemplate
    ? `${systemBase}\n\n---\n\n${commentTemplate}`
    : systemBase;
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const { result: review, inputTokens, outputTokens } = await runReviewLoop({
    anthropic,
    model,
    system,
    initialPrompt,
    fileMap,
    octokit,
    owner,
    repo,
    headSha,
  });

  console.error(
    `[ferry:review-action] reviewed ${ticketKey} PR#${prNumber} — approved=${review.approved} in=${inputTokens} out=${outputTokens}`,
  );

  if (review.approved) {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} Approved. PR#${prNumber} is ready to merge.`),
    );
    await octokit.issues.addLabels({
      owner, repo, issue_number: prNumber, labels: ['ferry:approved'],
    });
    await octokit.issues.removeLabel({
      owner, repo, issue_number: prNumber, name: 'ferry:reviewing',
    }).catch(() => {});
    await octokit.issues.createComment({
      owner, repo, issue_number: prNumber, body: review.comment,
    });
  } else {
    const hasIteratorMarker = existingComments.some((c) => c.includes('[ferry:iterator:'));

    await octokit.issues.createComment({
      owner, repo, issue_number: prNumber, body: review.comment,
    });

    if (!hasIteratorMarker) {
      await jira.postComment(
        ticketKey,
        textToAdf(
          `${idempotencyMarker} Changes requested. Moved to Dev Iteration. See PR#${prNumber} for details.`,
        ),
      );
      await jira.postTransition(ticketKey, iterTransitionId);
    } else {
      await jira.postComment(
        ticketKey,
        textToAdf(
          `${idempotencyMarker} Changes requested (re-review). See PR#${prNumber} comments and move ticket manually.`,
        ),
      );
    }
  }

  appendOutput({ input_tokens: inputTokens, output_tokens: outputTokens, model });
}

function appendOutput(usage: { input_tokens: number; output_tokens: number; model?: string }): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    let out = `input_tokens=${usage.input_tokens}\noutput_tokens=${usage.output_tokens}\n`;
    if (usage.model) out += `model=${usage.model}\n`;
    appendFileSync(githubOutput, out);
  }
}

main().catch((err) => {
  console.error('[ferry:review-action] fatal:', (err as Error).message);
  process.exit(1);
});
