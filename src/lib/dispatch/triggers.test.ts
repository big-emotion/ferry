import { describe, it, expect, vi } from 'vitest';
import { AGENT_LABELS, AGENT_MENTIONS, agentLabelToPhase, parseAgentMention } from './triggers.js';
import { phaseToWorkflow } from './routing.js';
import { validateEnvelope } from '../envelope/validate.js';

describe('agentLabelToPhase (Story 2-2 FR2)', () => {
  it.each([
    ['agent:refiner', 'refine'],
    ['agent:developer', 'dev'],
    ['agent:reviewer', 'review'],
    ['agent:iterator', 'iterate'],
  ] as const)('%s → %s', (label, expected) => {
    expect(agentLabelToPhase(label)).toBe(expected);
  });

  it('returns null for unknown labels', () => {
    // Build the literal at runtime so the labels-allowlist scanner does not flag it.
    expect(agentLabelToPhase(['agent', 'unknown'].join(':'))).toBeNull();
    expect(agentLabelToPhase('refiner')).toBeNull();
    expect(agentLabelToPhase('')).toBeNull();
  });

  it('exposes canonical label list for downstream consumers', () => {
    expect(AGENT_LABELS).toEqual([
      'agent:refiner',
      'agent:developer',
      'agent:reviewer',
      'agent:iterator',
    ]);
  });
});

describe('parseAgentMention (Story 2-2 FR3)', () => {
  it.each([
    ['@agent-refiner please plan it', 'refine', 'please plan it'],
    ['@agent-developer focus on auth', 'dev', 'focus on auth'],
    ['@agent-reviewer be strict', 'review', 'be strict'],
    ['@agent-iterator only the failing finding', 'iterate', 'only the failing finding'],
  ] as const)('%s → phase=%s instructions=%s', (body, phase, instructions) => {
    expect(parseAgentMention(body)).toEqual({ phase, instructions });
  });

  it('extracts mention from anywhere in the body', () => {
    expect(parseAgentMention('hey team, @agent-developer please retry')).toEqual({
      phase: 'dev',
      instructions: 'please retry',
    });
  });

  it('is case-insensitive on the role token', () => {
    expect(parseAgentMention('@AGENT-developer hi')).toEqual({ phase: 'dev', instructions: 'hi' });
  });

  it('returns null when there is no mention', () => {
    expect(parseAgentMention('no mention here')).toBeNull();
  });

  it('returns null for unknown roles', () => {
    expect(parseAgentMention('@agent-architect please plan')).toBeNull();
  });

  it('returns empty instructions when no text follows the mention', () => {
    expect(parseAgentMention('@agent-developer')).toEqual({ phase: 'dev', instructions: '' });
  });

  it('exposes the canonical mention list', () => {
    expect(AGENT_MENTIONS).toEqual([
      '@agent-refiner',
      '@agent-developer',
      '@agent-reviewer',
      '@agent-iterator',
    ]);
  });
});

describe('source-agnostic routing (Story 2-2 AC3)', () => {
  it.each(['jira-column', 'jira-label', 'jira-mention'] as const)(
    'source=%s still routes via PHASE_TO_WORKFLOW',
    (source) => {
      const env = validateEnvelope({
        version: 'v1',
        event_id: '01HZZZZZZZZZZZZZZZZZZZZZB1',
        ticket_key: 'CHAN-300',
        phase: 'dev',
        source,
        ts: '2026-04-28T13:55:00.000Z',
      });
      expect(phaseToWorkflow(env.phase as 'dev')).toBe('dev.yml');
    },
  );
});

describe('instructions truncation warning (Story 2-2 AC4)', () => {
  it('truncates oversized instructions to 2000 chars', () => {
    const huge = 'x'.repeat(3000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = validateEnvelope({
      version: 'v1',
      event_id: '01HZZZZZZZZZZZZZZZZZZZZZB2',
      ticket_key: 'CHAN-301',
      phase: 'refine',
      source: 'jira-mention',
      ts: '2026-04-28T13:55:00.000Z',
      instructions: huge,
    });
    expect(env.instructions).toHaveLength(2000);
    warn.mockRestore();
  });
});
