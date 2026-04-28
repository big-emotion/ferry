import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { checkIdempotencyMarker } from './idempotency.js';
import { retry } from './retry.js';
import { upsertJiraComment, type FerryRole } from './jira-upsert.js';
import { createJiraRestClientFromEnv } from './jira-rest.js';
import { textToAdf, adfToText } from './jira-adf.js';
import { scanWithGitleaks } from '../secret-scan/scan.js';
import { FerryError } from '../error.js';

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

export interface JiraTicket {
  key: string;
  title: string;
  description: string;
  comments: Array<{ id: number; body: string }>;
  labels: string[];
  issueType: string;
}

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
    { baseDelayMs: 2000, maxAttempts: 3 },
  );

  return run();
}

export async function getTicket(ticketKey: string): Promise<JiraTicket> {
  const c = createJiraRestClientFromEnv();
  const issue = await c.getIssue(ticketKey);

  return {
    key: issue.key,
    title: issue.fields.summary,
    description: adfToText(issue.fields.description),
    comments: issue.fields.comment.comments.map((comment) => ({
      id: parseInt(comment.id, 10),
      body: adfToText(comment.body),
    })),
    labels: issue.fields.labels,
    issueType: issue.fields.issuetype.name,
  };
}

export async function createSubtask(
  ticketKey: string,
  summary: string,
  description: string,
): Promise<{ key: string }> {
  await scanStringPayload(`${summary}\n${description}`);

  const c = createJiraRestClientFromEnv();
  const run = retry(() => c.createSubtask(ticketKey, summary, textToAdf(description)), {
    baseDelayMs: 2000,
    maxAttempts: 3,
  });
  return run();
}

export async function addLabel(ticketKey: string, label: string): Promise<void> {
  await scanStringPayload(label);

  const c = createJiraRestClientFromEnv();
  const run = retry(() => c.addLabel(ticketKey, label), {
    baseDelayMs: 2000,
    maxAttempts: 3,
  });
  return run();
}

export async function transitionTicket(ticketKey: string, targetName: string): Promise<void> {
  const c = createJiraRestClientFromEnv();
  const { transitions } = await c.getTransitions(ticketKey);

  const target = transitions.find((t) => t.name.toLowerCase() === targetName.toLowerCase());
  if (!target) {
    throw new FerryError('state-invariant', {
      reason: 'transition-not-found',
      target: targetName,
    });
  }

  const run = retry(() => c.postTransition(ticketKey, target.id), {
    baseDelayMs: 2000,
    maxAttempts: 3,
  });
  return run();
}
