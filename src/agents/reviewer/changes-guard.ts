/**
 * Counts prior completed iterator cycles by scanning Jira issue comments.
 * Mirrors the filter used in iterate-action.ts so both agents agree on the count.
 */
export function countPriorIterations(existingComments: string[]): number {
  return existingComments.filter(
    (c) => c.includes('[ferry:iterator:') && c.includes('complete. Pushed fixes to PR#'),
  ).length;
}
