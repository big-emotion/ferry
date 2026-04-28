import { describe, it, expect } from 'vitest';
import { phaseToWorkflow, phaseToDispatchType } from './routing.js';
import { validateEnvelope } from '../envelope/validate.js';

/**
 * Story 2-1 AC5: dry-run E2E fixture for all four phase-to-workflow mappings.
 * Each fixture is a fully-valid envelope that would, in production, dispatch to the named workflow.
 */
const FIXTURES = [
  {
    phase: 'refine' as const,
    expectedWorkflow: 'refine.yml',
    expectedType: 'ferry-refine',
    envelope: {
      version: 'v1',
      event_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      ticket_key: 'CHAN-100',
      phase: 'refine',
      source: 'jira-column',
      ts: '2026-04-28T13:50:00.000Z',
    },
  },
  {
    phase: 'dev' as const,
    expectedWorkflow: 'dev.yml',
    expectedType: 'ferry-dev',
    envelope: {
      version: 'v1',
      event_id: '01HZZZZZZZZZZZZZZZZZZZZZA1',
      ticket_key: 'CHAN-101',
      phase: 'dev',
      source: 'jira-column',
      ts: '2026-04-28T13:50:00.000Z',
    },
  },
  {
    phase: 'review' as const,
    expectedWorkflow: 'review.yml',
    expectedType: 'ferry-review',
    envelope: {
      version: 'v1',
      event_id: '01HZZZZZZZZZZZZZZZZZZZZZA2',
      ticket_key: 'CHAN-102',
      phase: 'review',
      source: 'jira-column',
      ts: '2026-04-28T13:50:00.000Z',
    },
  },
  {
    phase: 'iterate' as const,
    expectedWorkflow: 'iterate.yml',
    expectedType: 'ferry-iterate',
    envelope: {
      version: 'v1',
      event_id: '01HZZZZZZZZZZZZZZZZZZZZZA3',
      ticket_key: 'CHAN-103',
      phase: 'iterate',
      source: 'jira-column',
      ts: '2026-04-28T13:50:00.000Z',
    },
  },
];

describe('dry-run E2E: phase → workflow dispatch (Story 2-1)', () => {
  it.each(FIXTURES)(
    '$phase phase routes to $expectedWorkflow / $expectedType',
    ({ phase, expectedWorkflow, expectedType, envelope }) => {
      const validated = validateEnvelope(envelope);
      expect(validated.phase).toBe(phase);
      expect(phaseToWorkflow(phase)).toBe(expectedWorkflow);
      expect(phaseToDispatchType(phase)).toBe(expectedType);
    },
  );

  it('rejects unknown phase values before any side-effect (Story 1-3 regression)', () => {
    expect(() =>
      validateEnvelope({
        version: 'v1',
        event_id: '01HZZZZZZZZZZZZZZZZZZZZZA4',
        ticket_key: 'CHAN-999',
        phase: 'deploy', // not in enum
        source: 'jira-column',
        ts: '2026-04-28T13:50:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts envelopes carrying ticket_type (Story 2-1 AC4 schema extension)', () => {
    const validated = validateEnvelope({
      version: 'v1',
      event_id: '01HZZZZZZZZZZZZZZZZZZZZZA5',
      ticket_key: 'CHAN-200',
      phase: 'refine',
      source: 'jira-column',
      ts: '2026-04-28T13:50:00.000Z',
      ticket_type: 'Task',
    });
    expect(validated.ticket_type).toBe('Task');
  });
});
