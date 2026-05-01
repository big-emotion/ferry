import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createTrackerFromEnv } from '../../lib/io/tracker/factory.js';
import { isDryRun } from '../../lib/dry-run.js';
import { loadFerryConfig } from '../../lib/config.js';
import { resolveAnthropicAuth } from '../../lib/llm/anthropic-auth.js';
import { runAgent, createLogger } from '../../lib/agent-runtime/index.js';
import type { Logger } from '../../lib/agent-runtime/index.js';
import { runRefiner } from './refine.js';
import { prepareBatch, applyBatch } from './batch.js';
import { filterExistingSubtasks } from './idempotency.js';
import type { IssueTracker } from '../../lib/io/tracker/types.js';
import type { LlmCall } from './refine.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

export interface RefinerActionDeps {
  tracker: IssueTracker;
  callLlm: LlmCall;
  logger?: Logger;
}

export async function run(envelope: EventEnvelopeV1, deps: RefinerActionDeps): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;
  const logger = deps.logger ?? createLogger(eventId, 'ferry:refiner-action');
  const dryRun = isDryRun();

  const issue = await deps.tracker.getIssue(ticketKey);
  const runLink = `https://github.com/${process.env.GITHUB_REPO ?? 'unknown'}/actions/runs/${process.env.GITHUB_RUN_ID ?? '0'}`;

  const { plan, auditSummary } = await runRefiner({
    ticket: {
      key: issue.key,
      title: issue.summary,
      description: issue.description,
      comments: issue.comments,
      labels: issue.labels,
    },
    callLlm: deps.callLlm,
    runLink,
  });

  if (dryRun) {
    logger.info('DRY_RUN — plan (no Jira writes)', {
      ticket: ticketKey,
      subtasks: auditSummary.subtaskCount,
      plan,
    });
    return;
  }

  const idempotencyMarker = `[ferry:refiner:${eventId}]`;
  const existingSubtasks = await deps.tracker.getSubtasks(ticketKey);
  const batch = filterExistingSubtasks(prepareBatch(plan, eventId), existingSubtasks);
  const applied = await applyBatch(batch, (items) =>
    Promise.all(
      items.map((item) => deps.tracker.createSubtask(ticketKey, item.title, item.description)),
    ),
  );

  logger.info('subtasks created', { ticket: ticketKey, count: applied.createdCount });

  await deps.tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Refined. Created ${applied.createdCount} sub-task(s). See run: ${runLink}`,
  );
}

async function main(envelope: EventEnvelopeV1, logger: Logger): Promise<void> {
  const anthropicAuth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
  const anthropic = new Anthropic(anthropicAuth);
  const ferryCfg = loadFerryConfig(REPO_ROOT);
  const model = ferryCfg.models.refiner.model;

  const callLlm: LlmCall = async (prompt) => {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: ferryCfg.limits.max_tokens_per_message,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('');
    return {
      text,
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        costEur: 0,
      },
    };
  };

  const tracker = createTrackerFromEnv();
  await run(envelope, { tracker, callLlm, logger });
}

// Only invoke main() when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runAgent('refiner', main);
}
