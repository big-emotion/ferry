import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAndClaim } from './dedupe.js';
import type { Octokit } from '@octokit/rest';

const EVENT_ID = '01JFBK9Q4BVCJAGTYQ6S3XTDMN';
const TICKET_KEY = 'PROJ-1';
const RUN_ID = '01JFBK9Q4BVCJAGTYQ6S3XTDMP';

function makeOctokit(comments: Array<{ id: number; body: string }>) {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: comments }),
        createComment: vi.fn().mockResolvedValue({ data: { id: 999 } }),
      },
    },
  } as unknown as Octokit;
}

const BASE_OPTS = { owner: 'acme', repo: 'ferry', issueNumber: 42, runId: RUN_ID };

describe('checkAndClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns alreadyProcessed:false and posts a claim comment for a fresh event', async () => {
    const octokit = makeOctokit([]);
    const result = await checkAndClaim(EVENT_ID, TICKET_KEY, { octokit, ...BASE_OPTS });
    expect(result).toEqual({ alreadyProcessed: false });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'ferry',
        issue_number: 42,
        body: `[ferry:dedupe] ${EVENT_ID} ${TICKET_KEY} ${RUN_ID}`,
      }),
    );
  });

  it('returns alreadyProcessed:true and does NOT post a comment if event_id already claimed', async () => {
    const existingComment = {
      id: 1,
      body: `[ferry:dedupe] ${EVENT_ID} ${TICKET_KEY} some-previous-run`,
    };
    const octokit = makeOctokit([existingComment]);
    const result = await checkAndClaim(EVENT_ID, TICKET_KEY, { octokit, ...BASE_OPTS });
    expect(result).toEqual({ alreadyProcessed: true });
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('does not match a comment with a different event_id prefix', async () => {
    const otherComment = {
      id: 2,
      body: `[ferry:dedupe] 01JFBK9Q4BVCJAGTYQ6S3XTDMX PROJ-2 some-run`,
    };
    const octokit = makeOctokit([otherComment]);
    const result = await checkAndClaim(EVENT_ID, TICKET_KEY, { octokit, ...BASE_OPTS });
    expect(result).toEqual({ alreadyProcessed: false });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
  });

  it('ignores comments without a body', async () => {
    const nullBodyComment = { id: 3, body: null as unknown as string };
    const octokit = makeOctokit([nullBodyComment]);
    const result = await checkAndClaim(EVENT_ID, TICKET_KEY, { octokit, ...BASE_OPTS });
    expect(result).toEqual({ alreadyProcessed: false });
  });
});
