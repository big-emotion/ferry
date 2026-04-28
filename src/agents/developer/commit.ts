/**
 * Story 4-2: commit message + branch name formatters (FR15).
 */

const ALLOWED_TYPES = new Set(['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf']);

export interface CommitInput {
  ticketKey: string;
  runId: string;
  summary: string;
  type?: string;
}

export function formatDeveloperCommit(input: CommitInput): string {
  const type = input.type && ALLOWED_TYPES.has(input.type) ? input.type : 'feat';
  const summary =
    input.summary.length > 0
      ? input.summary[0].toLowerCase() + input.summary.slice(1)
      : input.summary;
  return `[${input.ticketKey}] ${type}: ${summary}\n\n[ferry:developer:${input.runId}]`;
}

export function formatBranchName(ticketKey: string): string {
  return `ferry/${ticketKey}`;
}
