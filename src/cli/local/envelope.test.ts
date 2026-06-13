import { describe, expect, it } from 'vitest';
import { validateEnvelope } from '../../lib/envelope/validate.js';
import { DEFAULT_FERRY_CONFIG } from '../../lib/config.js';
import { buildLocalEnvelope, mapStatusToPhase } from './envelope.js';

describe('mapStatusToPhase', () => {
  it('maps configured workflow trigger columns to phases', () => {
    expect(mapStatusToPhase('Refinement', DEFAULT_FERRY_CONFIG.workflow)).toBe('refine');
    expect(mapStatusToPhase('In Development', DEFAULT_FERRY_CONFIG.workflow)).toBe('dev');
    expect(mapStatusToPhase('In Review', DEFAULT_FERRY_CONFIG.workflow)).toBe('review');
    expect(mapStatusToPhase('Changes Requested', DEFAULT_FERRY_CONFIG.workflow)).toBe('iterate');
  });

  it('returns merge for the explicit ready-to-merge status', () => {
    expect(mapStatusToPhase('Ready to Merge', DEFAULT_FERRY_CONFIG.workflow)).toBe('merge');
  });

  it('returns null for unmapped statuses', () => {
    expect(mapStatusToPhase('Done', DEFAULT_FERRY_CONFIG.workflow)).toBeNull();
  });
});

describe('buildLocalEnvelope', () => {
  it('builds an envelope that passes the shared validator', () => {
    const envelope = buildLocalEnvelope({
      ticketKey: 'CHAN-1',
      status: 'In Development',
      ts: '2026-06-13T09:10:11.000Z',
      workflow: DEFAULT_FERRY_CONFIG.workflow,
    });

    expect(validateEnvelope(envelope)).toMatchObject({
      ticket_key: 'CHAN-1',
      phase: 'dev',
      source: 'jira-column',
    });
    expect(envelope.event_id).toBe(`${Date.parse('2026-06-13T09:10:11.000Z')}-CHAN-1`);
  });

  it('supports custom workflow columns', () => {
    const envelope = buildLocalEnvelope({
      ticketKey: 'CHAN-2',
      status: 'Code Review',
      ts: '2026-06-13T09:10:11.000Z',
      workflow: {
        agents: {
          ...DEFAULT_FERRY_CONFIG.workflow.agents,
          reviewer: {
            ...DEFAULT_FERRY_CONFIG.workflow.agents.reviewer,
            trigger_column: 'Code Review',
          },
        },
      },
    });

    expect(envelope.phase).toBe('review');
  });

  it('throws for unknown statuses', () => {
    expect(() =>
      buildLocalEnvelope({
        ticketKey: 'CHAN-3',
        status: 'Done',
        ts: '2026-06-13T09:10:11.000Z',
        workflow: DEFAULT_FERRY_CONFIG.workflow,
      }),
    ).toThrow(/No local-runner phase mapping/);
  });
});
