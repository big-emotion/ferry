import { Octokit } from '@octokit/rest';

export interface FreshnessOpts {
  octokit: Octokit;
  owner: string;
  repo: string;
  processedEventsIssue: number;
}

export type FreshnessResult = { superseded: false } | { superseded: true; newerEventId: string };

const DEDUPE_PREFIX = '[ferry:dedupe] ';

export async function assertFreshOrSupersede(
  envelope: { ticket_key: string; event_id: string },
  opts: FreshnessOpts,
): Promise<FreshnessResult> {
  let page = 1;

  while (true) {
    const { data: comments } = await opts.octokit.rest.issues.listComments({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.processedEventsIssue,
      per_page: 100,
      page,
    });

    for (const comment of comments) {
      if (!comment.body?.startsWith(DEDUPE_PREFIX)) continue;
      const parts = comment.body.slice(DEDUPE_PREFIX.length).split(' ');
      const commentEventId = parts[0];
      const commentTicketKey = parts[1];
      if (!commentEventId || !commentTicketKey) continue;
      if (commentTicketKey === envelope.ticket_key && commentEventId > envelope.event_id) {
        return { superseded: true, newerEventId: commentEventId };
      }
    }

    if (comments.length < 100) break;
    page++;
  }

  return { superseded: false };
}
