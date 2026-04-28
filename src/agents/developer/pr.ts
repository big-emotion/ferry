/**
 * Story 4-4: PR title + body formatters and state transition (FR16 / FR18).
 */

export const DRAFT_PR_OPTS = { draft: true } as const;

export interface PrTitleInput {
  ticketKey: string;
  summary: string;
}

export function formatPullRequestTitle(input: PrTitleInput): string {
  return `[${input.ticketKey}] ${input.summary}`;
}

export interface PrBodyInput {
  ticketKey: string;
  jiraBaseUrl: string;
  runId: string;
  tldr: string;
}

export function formatPullRequestBody(input: PrBodyInput): string {
  const ticketUrl = `${input.jiraBaseUrl.replace(/\/+$/, '')}/browse/${input.ticketKey}`;
  return [
    `## TL;DR`,
    input.tldr,
    ``,
    `## Ticket`,
    `[${input.ticketKey}](${ticketUrl})`,
    ``,
    `## Run`,
    `Ferry run id: ${input.runId}`,
    ``,
  ].join('\n');
}

export interface TransitionInput<S extends Record<string, unknown>> {
  state: S;
  prNumber: number;
}

export function transitionToReview<S extends Record<string, unknown>>(
  input: TransitionInput<S>,
): S & { phase: 'reviewing'; pr_number: number } {
  return { ...input.state, phase: 'reviewing', pr_number: input.prNumber };
}
