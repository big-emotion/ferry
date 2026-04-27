import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { assertFreshOrSupersede } from './freshness.js';

const ENVELOPE = { ticket_key: 'CHAN-27', event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN' };
// Newer: lexicographically greater (later timestamp)
const NEWER_ID = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
// Older: lexicographically smaller
const OLDER_ID = '01JAAAAAAAAAAAAAAAAAAAAAAA';

const OPTS = { owner: 'org', repo: 'target', processedEventsIssue: 42 };

function makeMockOctokit(commentBodies: string[]): Octokit {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({
          data: commentBodies.map((body, i) => ({ id: i + 1, body })),
        }),
      },
    },
  } as unknown as Octokit;
}

describe('assertFreshOrSupersede', () => {
  it('returns { superseded: false } when no comments exist', async () => {
    const octokit = makeMockOctokit([]);
    const result = await assertFreshOrSupersede(ENVELOPE, { ...OPTS, octokit });
    expect(result).toEqual({ superseded: false });
  });

  it('returns { superseded: false } when only older event_ids exist for same ticket_key', async () => {
    const octokit = makeMockOctokit([
      `[ferry:dedupe] ${OLDER_ID} CHAN-27 01JFBK9Q4BVCJAGTYQ6S3XTDMP`,
    ]);
    const result = await assertFreshOrSupersede(ENVELOPE, { ...OPTS, octokit });
    expect(result).toEqual({ superseded: false });
  });

  it('returns { superseded: true, newerEventId } when a newer event_id exists for same ticket_key', async () => {
    const octokit = makeMockOctokit([
      `[ferry:dedupe] ${NEWER_ID} CHAN-27 01JFBK9Q4BVCJAGTYQ6S3XTDMP`,
    ]);
    const result = await assertFreshOrSupersede(ENVELOPE, { ...OPTS, octokit });
    expect(result).toEqual({ superseded: true, newerEventId: NEWER_ID });
  });

  it('returns { superseded: false } when newer event_id exists for a DIFFERENT ticket_key', async () => {
    const octokit = makeMockOctokit([
      `[ferry:dedupe] ${NEWER_ID} CHAN-99 01JFBK9Q4BVCJAGTYQ6S3XTDMP`,
    ]);
    const result = await assertFreshOrSupersede(ENVELOPE, { ...OPTS, octokit });
    expect(result).toEqual({ superseded: false });
  });

  it('ignores non-dedupe comments', async () => {
    const octokit = makeMockOctokit([
      `[ferry:audit:${NEWER_ID}] {"ticket":"CHAN-27","outcome":"success"}`,
      `some unrelated comment body`,
    ]);
    const result = await assertFreshOrSupersede(ENVELOPE, { ...OPTS, octokit });
    expect(result).toEqual({ superseded: false });
  });

  it('paginates when ferry-processed-events has more than 100 comments', async () => {
    const page1Bodies = Array.from(
      { length: 100 },
      (_, i) => `[ferry:dedupe] ${OLDER_ID} CHAN-27 run-${i}`,
    );
    const page2Bodies = [`[ferry:dedupe] ${NEWER_ID} CHAN-27 run-latest`];

    const listComments = vi
      .fn()
      .mockResolvedValueOnce({ data: page1Bodies.map((body, i) => ({ id: i + 1, body })) })
      .mockResolvedValueOnce({ data: page2Bodies.map((body, i) => ({ id: 200 + i, body })) });

    const octokit = { rest: { issues: { listComments } } } as unknown as Octokit;
    const result = await assertFreshOrSupersede(ENVELOPE, { ...OPTS, octokit });
    expect(result).toEqual({ superseded: true, newerEventId: NEWER_ID });
    expect(listComments).toHaveBeenCalledTimes(2);
  });
});
