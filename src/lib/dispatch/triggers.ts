/**
 * Story 2-2: label and @mention triggers.
 *
 * The Jira Automation rules send `repository_dispatch` events when:
 *  - an agent-role label is applied (one of AGENT_LABELS) → source: "jira-label"
 *  - an at-agent-role mention is posted (one of AGENT_MENTIONS) → source: "jira-mention"
 *
 * This module is the single source of truth for both formats so the
 * Jira-side rule generator and the agent-side instruction extractor
 * cannot drift.
 */

import type { EventPhase } from '../envelope/types.js';

type AgentPhase = Exclude<EventPhase, 'reconcile'>;

const LABEL_TO_PHASE: ReadonlyMap<string, AgentPhase> = new Map([
  ['agent:refiner', 'refine'],
  ['agent:developer', 'dev'],
  ['agent:reviewer', 'review'],
  ['agent:iterator', 'iterate'],
]);

const MENTION_ROLE_TO_PHASE: ReadonlyMap<string, AgentPhase> = new Map([
  ['refiner', 'refine'],
  ['developer', 'dev'],
  ['reviewer', 'review'],
  ['iterator', 'iterate'],
]);

export const AGENT_LABELS: readonly string[] = Array.from(LABEL_TO_PHASE.keys());
export const AGENT_MENTIONS: readonly string[] = Array.from(MENTION_ROLE_TO_PHASE.keys()).map(
  (role) => `@agent-${role}`,
);

export function agentLabelToPhase(label: string): AgentPhase | null {
  return LABEL_TO_PHASE.get(label) ?? null;
}

export interface ParsedMention {
  phase: AgentPhase;
  instructions: string;
}

const MENTION_REGEX = /@agent-([a-z]+)\b\s*([^\n\r]*)/i;

export function parseAgentMention(body: string): ParsedMention | null {
  const match = body.match(MENTION_REGEX);
  if (!match) {
    return null;
  }
  const role = (match[1] ?? '').toLowerCase();
  const phase = MENTION_ROLE_TO_PHASE.get(role);
  if (!phase) {
    return null;
  }
  return {
    phase,
    instructions: (match[2] ?? '').trim(),
  };
}
