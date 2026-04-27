import type { Octokit } from '@octokit/rest';

export interface DedupeOpts {
  octokit: Octokit;
  owner: string;
  repo: string;
  issueNumber: number;
  runId: string;
}

export async function checkAndClaim(
  eventId: string,
  ticketKey: string,
  opts: DedupeOpts,
): Promise<{ alreadyProcessed: boolean }> {
  const { octokit, owner, repo, issueNumber, runId } = opts;
  const prefix = `[ferry:dedupe] ${eventId}`;

  const MAX_PAGES = 10;
  let page = 1;
  while (page <= MAX_PAGES) {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
      page,
    });

    for (const comment of comments) {
      if (comment.body?.startsWith(prefix)) {
        return { alreadyProcessed: true };
      }
    }

    if (comments.length < 100) {
      break;
    }
    page++;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `${prefix} ${ticketKey} ${runId}`,
  });

  return { alreadyProcessed: false };
}
