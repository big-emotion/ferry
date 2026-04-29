import { appendFileSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
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

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

interface ReviewIssue {
  file: string;
  issue: string;
  suggestion: string;
}

interface ReviewOutput {
  approved: boolean;
  issues: ReviewIssue[];
}

function parseReviewOutput(content: string): ReviewOutput {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new FerryError('state-invariant', { reason: 'review-parse-failed' });
  let parsed: ReviewOutput;
  try {
    parsed = JSON.parse(jsonMatch[0]) as ReviewOutput;
  } catch (e) {
    throw new FerryError('state-invariant', { reason: 'review-json-invalid', cause: String(e) });
  }
  if (typeof parsed.approved !== 'boolean' || !Array.isArray(parsed.issues)) {
    throw new FerryError('state-invariant', { reason: 'review-schema-invalid' });
  }
  return parsed;
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

  // Idempotency: check if this run already completed
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

  const pr = pulls[0];
  const prNumber = pr.number;
  const headSha = pr.head.sha;

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

    // CI red — post PR comment + transition to iterate
    const ciMessage =
      ciOutcome.findings[0]?.message ?? 'CI checks failed. See the Actions run for details.';
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

  // Fetch PR diff
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const diffText = files
    .map((f) => `### ${f.filename} (+${f.additions} -${f.deletions})\n${f.patch ?? '(binary or empty)'}`)
    .join('\n\n');

  // Build ticket context
  const description = adfToText(issue.fields.description);
  const ticketBlock = [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.fields.summary}`,
    `DESCRIPTION:\n${description}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Single LLM call
  const system = readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const userMessage = [
    delimitUntrusted(ticketBlock),
    '',
    '## PR Diff',
    delimitUntrusted(diffText),
  ].join('\n');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 16384,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  const rawContent =
    response.content.find((b) => b.type === 'text')?.text ?? '';
  const review = parseReviewOutput(rawContent);

  console.error(
    `[ferry:review-action] reviewed ${ticketKey} PR#${prNumber} — approved=${review.approved} issues=${review.issues.length} in=${inputTokens} out=${outputTokens}`,
  );

  if (review.approved) {
    await jira.postComment(
      ticketKey,
      textToAdf(`${idempotencyMarker} Approved. PR#${prNumber} is ready to merge.`),
    );
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: ['ferry:approved'],
    });
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: prNumber,
      name: 'ferry:reviewing',
    }).catch(() => {});
  } else {
    // Post PR comment with numbered issues
    const issueLines = review.issues
      .map(
        (iss, i) =>
          `${i + 1}. **\`${iss.file}\`** — ${iss.issue}\n   _Fix:_ ${iss.suggestion}`,
      )
      .join('\n');
    const prComment = `${idempotencyMarker}\n\n**Changes requested for ${ticketKey}:**\n\n${issueLines || '_(no specific issues listed)_'}`;

    // Detect if a prior iterator has run (re-review scenario)
    const hasIteratorMarker = existingComments.some((c) => c.includes('[ferry:iterator:'));

    if (!hasIteratorMarker) {
      // First review — Jira marker first, then GH writes
      await jira.postComment(
        ticketKey,
        textToAdf(
          `${idempotencyMarker} Changes requested. Moved to Dev Iteration. See PR#${prNumber} for details.`,
        ),
      );
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: prComment,
      });
      await jira.postTransition(ticketKey, iterTransitionId);
    } else {
      // Re-review after iterate — Jira marker first, then GH writes
      await jira.postComment(
        ticketKey,
        textToAdf(
          `${idempotencyMarker} Changes requested (re-review). See PR#${prNumber} comments and move ticket manually.`,
        ),
      );
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: prComment,
      });
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
