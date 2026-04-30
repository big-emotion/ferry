export function byEventId(role: string, eventId: string): string {
  return `[ferry:${role}:${eventId}]`;
}

export function byPrHeadSha(role: string, headSha: string): string {
  return `[ferry:${role}:${headSha.slice(0, 7)}]`;
}

export function byReviewCommentId(role: string, commentId: number): string {
  return `[ferry:${role}:${commentId}]`;
}
