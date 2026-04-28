/**
 * In-place Jira comment upsert (FR60, NFR-UX4).
 *
 * Pure decision helper that, given the existing comment list and the role +
 * run_id, returns either an `update` directive (with the target comment id
 * and the new body carrying a refreshed marker) or a `create` directive when
 * no marker for that role exists. Used to keep the per-ticket Ferry comment
 * count ≤ 8 across a full lifecycle.
 */

export type FerryRole = 'refiner' | 'developer' | 'reviewer' | 'iterator';

export interface CommentLike {
  id: number;
  body: string;
}

export interface UpsertInput {
  existing_comments: CommentLike[];
  role: FerryRole;
  run_id: string;
  body: string;
}

export type UpsertDirective =
  | { action: 'update'; target_id: number; body: string }
  | { action: 'create'; target_id?: undefined; body: string };

export function upsertJiraComment(input: UpsertInput): UpsertDirective {
  const prefix = `[ferry:${input.role}:`;
  const match = input.existing_comments.find((c) => c.body.includes(prefix));
  const marker = `[ferry:${input.role}:${input.run_id}]`;
  const body = `${marker} ${input.body}`;
  if (match) return { action: 'update', target_id: match.id, body };
  return { action: 'create', body };
}
