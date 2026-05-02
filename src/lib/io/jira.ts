import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { checkIdempotencyMarker } from './idempotency.js';
import { retry } from './retry.js';
import { upsertJiraComment, type FerryRole } from './jira-upsert.js';
import { createJiraRestClientFromEnv } from './jira-rest.js';
import { textToAdf } from './jira-adf.js';
import { scanWithGitleaks } from '../safety/scan.js';
import { FerryError } from '../errors/index.js';

export interface JiraComment {
  id: number;
  body: string;
}

export interface PostCommentParams {
  ticketKey: string;
  body: string;
  idempotencyMarker: string;
  recentComments: JiraComment[];
}

export type PostCommentResult =
  | { skipped: true }
  | {
      skipped: false;
      body: string;
    };

async function scanStringPayload(text: string): Promise<void> {
  const tmpFile = join(tmpdir(), `ferry-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await writeFile(tmpFile, text, 'utf8');
    const result = await scanWithGitleaks({
      path: tmpFile,
      binaryPath: process.env.GITLEAKS_PATH ?? 'gitleaks',
    });
    if (result.leaksFound) {
      throw new FerryError('spend-cap', { reason: 'secret-scan-hit' });
    }
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

function parseMarker(marker: string): { role: FerryRole; runId: string } | null {
  const match = marker.match(/^\[ferry:(refiner|developer|reviewer|iterator):([^\]]+)\]$/);
  if (!match) return null;
  return { role: match[1] as FerryRole, runId: match[2] };
}

export async function postComment(params: PostCommentParams): Promise<PostCommentResult> {
  const items = params.recentComments.map((c) => c.body);
  const idempotency = checkIdempotencyMarker(params.idempotencyMarker, items);
  if (idempotency.skipped) return { skipped: true };

  const markerParsed = parseMarker(params.idempotencyMarker);
  const directive = markerParsed
    ? upsertJiraComment({
        existing_comments: params.recentComments,
        role: markerParsed.role,
        run_id: markerParsed.runId,
        body: params.body,
      })
    : { action: 'create' as const, body: params.body };

  await scanStringPayload(directive.body);

  const c = createJiraRestClientFromEnv();

  const jiraRetryBaseDelayMs =
    parseInt(process.env.FERRY_JIRA_RETRY_BASE_DELAY_MS ?? '', 10) || 2000;
  const jiraRetryMaxAttempts =
    parseInt(process.env.FERRY_JIRA_RETRY_MAX_ATTEMPTS ?? '', 10) || 3;
  const run = retry(
    async () => {
      if (directive.action === 'update') {
        await c.putComment(
          params.ticketKey,
          String(directive.target_id),
          textToAdf(directive.body),
        );
      } else {
        await c.postComment(params.ticketKey, textToAdf(directive.body));
      }
      return { skipped: false as const, body: params.body };
    },
    { baseDelayMs: jiraRetryBaseDelayMs, maxAttempts: jiraRetryMaxAttempts },
  );

  return run();
}
