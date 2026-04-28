import { describe, expect, it } from 'vitest';
import { buildRetriggerEnvelope } from './retrigger.js';

describe('retrigger envelope builder', () => {
  it('builds an envelope from a label re-trigger with no instructions', () => {
    const env = buildRetriggerEnvelope({
      source: 'jira-label',
      ticket_key: 'CHAN-27',
      phase: 'dev',
      ticket_type: 'Story',
      event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
    });
    expect(env.source).toBe('jira-label');
    expect(env.phase).toBe('dev');
    expect(env.instructions).toBeUndefined();
  });

  it('appends @mention instructions wrapped in delimitUntrusted', () => {
    const env = buildRetriggerEnvelope({
      source: 'jira-mention',
      ticket_key: 'CHAN-27',
      phase: 'iterate',
      ticket_type: 'Story',
      event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMP',
      instructions: 'focus only on the CSRF finding',
    });
    expect(env.source).toBe('jira-mention');
    expect(env.instructions).toContain('focus only on the CSRF finding');
    expect(env.instructions).toMatch(/<<<UNTRUSTED>>>/);
    expect(env.instructions).toMatch(/<<<END UNTRUSTED>>>/);
  });

  it('label re-trigger preserves the event_id (caller is responsible for ULID freshness)', () => {
    const env = buildRetriggerEnvelope({
      source: 'jira-label',
      ticket_key: 'CHAN-27',
      phase: 'review',
      ticket_type: 'Story',
      event_id: '01J1',
    });
    expect(env.event_id).toBe('01J1');
  });
});
