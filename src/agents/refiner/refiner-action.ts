import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { createTrackerFromEnv } from '../../lib/io/tracker/factory.js';
import { isDryRun } from '../../lib/dry-run.js';
import { FerryError } from '../../lib/errors/index.js';
import { loadFerryConfig } from '../../lib/config.js';
import { resolveAnthropicAuth } from '../../lib/llm/anthropic-auth.js';
import { runRefiner } from './refine.js';
import { prepareBatch, applyBatch } from './batch.js';
import { filterExistingSubtasks } from './idempotency.js';
import type { IssueTracker } from '../../lib/io/tracker/types.js';
import type { LlmCall } from './refine.js';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new FerryError('state-invariant', { reason: 'missing-env', key });
  return val;
}

export interface RefinerActionDeps {
  tracker: IssueTracker;
  callLlm: LlmCall;
}

export async function run(envelope: EventEnvelopeV1, deps: RefinerActionDeps): Promise<void> {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;
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
    console.log(
      `[ferry:refiner-action] DRY_RUN — ${ticketKey} plan (${auditSummary.subtaskCount} subtasks, no Jira writes):`,
    );
    console.log(JSON.stringify(plan, null, 2));
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

  console.error(
    `[ferry:refiner-action] created ${applied.createdCount} sub-task(s) for ${ticketKey}`,
  );

  await deps.tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Refined. Created ${applied.createdCount} sub-task(s). See run: ${runLink}`,
  );
}

async function main(): Promise<void> {
  const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
  const envelope = validateEnvelope(JSON.parse(rawPayload));

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
  await run(envelope, { tracker, callLlm });
}

// Only invoke main() when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[ferry:refiner-action] fatal:', (err as Error).message);
    process.exit(1);
  });
}
