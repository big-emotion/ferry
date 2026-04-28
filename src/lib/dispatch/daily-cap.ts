/**
 * Story 2-3: per-ticket daily trigger cap (FR7).
 *
 * The cap is checked AFTER envelope validation and dedupe but BEFORE any LLM call
 * or external write. The caller injects `listClaimsToday` (typically wraps
 * `src/lib/io/github.ts`'s issue-comment listing) so this module stays a pure-logic
 * unit that's trivial to test.
 */

export const DEFAULT_DAILY_CAP = 10;

import type { EventPhase } from '../envelope/types.js';

type AgentPhase = Exclude<EventPhase, 'reconcile'>;

export interface CapCheckInput {
  ticketKey: string;
  cap: number;
  now: Date;
  /** Returns the timestamps of all dispatch claims observed for this ticket today. */
  listClaimsToday: () => Promise<Date[]>;
}

export interface CapCheckResult {
  allowed: boolean;
  count: number;
  cap: number;
  ticketKey: string;
}

function todayMidnightUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

export async function checkDailyTicketCap(input: CapCheckInput): Promise<CapCheckResult> {
  const start = todayMidnightUtc(input.now);
  const claims = await input.listClaimsToday();
  const todays = claims.filter((d) => d.getTime() >= start.getTime());
  const count = todays.length;
  return {
    allowed: count < input.cap,
    count,
    cap: input.cap,
    ticketKey: input.ticketKey,
  };
}

export interface CapCommentInput {
  phase: AgentPhase;
  runId: string;
  ticketKey: string;
  cap: number;
}

export function formatCapPauseComment(input: CapCommentInput): string {
  const agent = input.phase === 'refine' ? 'refiner' : input.phase;
  return `[ferry:${agent}:${input.runId}] Paused — daily trigger cap (${input.cap}) reached for ${input.ticketKey}. Resets at midnight UTC.`;
}

export function getConfiguredCap(): number {
  const raw = process.env.FERRY_DAILY_TICKET_CAP;
  if (!raw) {
    return DEFAULT_DAILY_CAP;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DAILY_CAP;
  }
  return parsed;
}
