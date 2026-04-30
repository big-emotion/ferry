import { describe, it, expect } from 'vitest';
import { validateEnvelope } from './validate.js';
import { FerryError } from '../errors/index.js';

const VALID_ENVELOPE = {
  version: 'v1',
  event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
  ticket_key: 'PROJ-1',
  phase: 'refine',
  source: 'jira-column',
  ts: '2026-04-27T00:00:00.000Z',
};

describe('validateEnvelope', () => {
  it('returns a typed envelope for a valid payload', () => {
    const result = validateEnvelope(VALID_ENVELOPE);
    expect(result).toMatchObject(VALID_ENVELOPE);
  });

  it('passes through an optional instructions field', () => {
    const result = validateEnvelope({ ...VALID_ENVELOPE, instructions: 'focus on auth' });
    expect(result.instructions).toBe('focus on auth');
  });

  it('trims instructions to 2000 chars when oversized', () => {
    const long = 'x'.repeat(2500);
    const result = validateEnvelope({ ...VALID_ENVELOPE, instructions: long });
    expect(result.instructions).toHaveLength(2000);
  });

  it('throws FerryError state-invariant for missing required field', () => {
    const missing = { ...VALID_ENVELOPE, source: undefined };
    expect(() => validateEnvelope(missing)).toThrow(FerryError);
    try {
      validateEnvelope(missing);
    } catch (e) {
      expect((e as FerryError).code).toBe('state-invariant');
    }
  });

  it('throws FerryError state-invariant for invalid phase value', () => {
    expect(() => validateEnvelope({ ...VALID_ENVELOPE, phase: 'unknown-phase' })).toThrow(
      FerryError,
    );
  });

  it('accepts Jira-style event_id (issue.key-issue.id)', () => {
    expect(() => validateEnvelope({ ...VALID_ENVELOPE, event_id: 'CHAN-117-10042' })).not.toThrow();
  });

  it('throws FerryError state-invariant for invalid ticket_key pattern', () => {
    expect(() => validateEnvelope({ ...VALID_ENVELOPE, ticket_key: 'proj-1' })).toThrow(FerryError);
  });

  it('throws FerryError state-invariant for extra unknown field', () => {
    expect(() => validateEnvelope({ ...VALID_ENVELOPE, unexpected: 'value' })).toThrow(FerryError);
  });

  it('does NOT include raw field values in the error (NFR-S1)', () => {
    expect.assertions(1);
    const sensitivePayload = { ...VALID_ENVELOPE, phase: 'secret-data-should-not-appear' };
    try {
      validateEnvelope(sensitivePayload);
    } catch (e) {
      const errorString = JSON.stringify(e);
      expect(errorString).not.toContain('secret-data-should-not-appear');
    }
  });

  it('throws FerryError for non-object input', () => {
    expect(() => validateEnvelope('not-an-object')).toThrow(FerryError);
    expect(() => validateEnvelope(null)).toThrow(FerryError);
  });
});
