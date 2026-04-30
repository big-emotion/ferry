import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

function makeAjv() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const ajvModule = _require('ajv/dist/2020') as {
    Ajv2020: new (opts?: any) => { compile: (s: any) => (d: unknown) => boolean };
  };
  const instance = new ajvModule.Ajv2020({ strict: true });
  (_require('ajv-formats') as any).default(instance);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return instance;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: Record<string, any>;
let validate: (data: unknown) => boolean;

beforeAll(() => {
  schema = JSON.parse(readFileSync(join(__dirname, 'state.v1.schema.json'), 'utf-8'));
  validate = makeAjv().compile(schema);
});

describe('state.v1.schema.json', () => {
  it('parses as valid JSON', () => {
    expect(() =>
      JSON.parse(readFileSync(join(__dirname, 'state.v1.schema.json'), 'utf-8')),
    ).not.toThrow();
  });

  it('compiles as a valid JSON Schema (draft 2020-12)', () => {
    expect(validate).toBeDefined();
  });

  it('phase enum contains all 8 required values', () => {
    const phaseEnum = schema.properties.phase.enum as string[];
    const required = [
      'refining',
      'developing',
      'reviewing',
      'iterating',
      'ready',
      'paused',
      'cancelled',
      'needs-human',
    ];
    for (const v of required) {
      expect(phaseEnum, `phase enum must contain "${v}"`).toContain(v);
    }
  });

  it('run_id pattern matches ULID pattern', () => {
    expect(schema.properties.run_id.pattern).toBe('^[0-9A-HJKMNP-TV-Z]{26}$');
  });

  it('a minimal valid state object passes validation', () => {
    const valid = {
      version: 'v1',
      ticket_key: 'PROJ-1',
      phase: 'refining',
      run_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
      prompt_version: '0.0.1',
      iteration: 0,
      iteration_history: [],
      updated_at: '2026-04-27T00:00:00.000Z',
    };
    expect(validate(valid)).toBe(true);
  });

  it('rejects a state object with an unknown top-level field (additionalProperties: false)', () => {
    const withExtra = {
      version: 'v1',
      ticket_key: 'PROJ-1',
      phase: 'refining',
      run_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
      prompt_version: '0.0.1',
      iteration: 0,
      iteration_history: [],
      updated_at: '2026-04-27T00:00:00.000Z',
      unknown_field: 'should-fail',
    };
    expect(validate(withExtra)).toBe(false);
  });
});

describe('event.v1.schema.json', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let eventSchema: Record<string, any>;
  let validateEvent: (data: unknown) => boolean;

  beforeAll(() => {
    eventSchema = JSON.parse(readFileSync(join(__dirname, 'event.v1.schema.json'), 'utf-8'));
    validateEvent = makeAjv().compile(eventSchema);
  });

  it('parses as valid JSON', () => {
    expect(() =>
      JSON.parse(readFileSync(join(__dirname, 'event.v1.schema.json'), 'utf-8')),
    ).not.toThrow();
  });

  it('compiles as a valid JSON Schema (draft 2020-12)', () => {
    expect(validateEvent).toBeDefined();
  });

  it('phase enum contains all 5 values', () => {
    const phases = eventSchema.properties.phase.enum as string[];
    for (const v of ['refine', 'dev', 'review', 'iterate', 'reconcile']) {
      expect(phases, `phase enum must contain "${v}"`).toContain(v);
    }
  });

  it('event_id pattern accepts ULID, Jira millis-key format, and issue-key-id format', () => {
    const pattern = new RegExp(eventSchema.properties.event_id.pattern as string);
    expect(pattern.test('01JFBK9Q4BVCJAGTYQ6S3XTDMN')).toBe(true); // ULID
    expect(pattern.test('CHAN-117-10042')).toBe(true); // Jira issue.key-issue.id
    expect(pattern.test('1746047810000-CHAN-27-1')).toBe(true); // legacy millis format
    expect(pattern.test('')).toBe(false); // empty rejected
    expect(pattern.test('-bad')).toBe(false); // leading hyphen rejected
  });

  it('a minimal valid event envelope passes validation', () => {
    const valid = {
      version: 'v1',
      event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
      ticket_key: 'PROJ-1',
      phase: 'refine',
      source: 'jira-column',
      ts: '2026-04-27T00:00:00.000Z',
    };
    expect(validateEvent(valid)).toBe(true);
  });

  it('accepts Jira millis-key event_id format', () => {
    const valid = {
      version: 'v1',
      event_id: '1745876263000-CHAN-42',
      ticket_key: 'CHAN-42',
      phase: 'refine',
      source: 'jira-column',
      ts: '2026-04-28T00:00:00.000Z',
    };
    expect(validateEvent(valid)).toBe(true);
  });

  it('rejects envelope missing required field', () => {
    const missing = {
      version: 'v1',
      event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
      ticket_key: 'PROJ-1',
      phase: 'refine',
      // source missing
      ts: '2026-04-27T00:00:00.000Z',
    };
    expect(validateEvent(missing)).toBe(false);
  });

  it('rejects envelope with unknown field (additionalProperties: false)', () => {
    const extra = {
      version: 'v1',
      event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
      ticket_key: 'PROJ-1',
      phase: 'refine',
      source: 'jira-column',
      ts: '2026-04-27T00:00:00.000Z',
      surprise: 'bad',
    };
    expect(validateEvent(extra)).toBe(false);
  });

  it('instructions field is optional and respected when present', () => {
    const withInstructions = {
      version: 'v1',
      event_id: '01JFBK9Q4BVCJAGTYQ6S3XTDMN',
      ticket_key: 'PROJ-1',
      phase: 'dev',
      source: 'jira-mention',
      ts: '2026-04-27T00:00:00.000Z',
      instructions: 'focus on auth module only',
    };
    expect(validateEvent(withInstructions)).toBe(true);
  });
});
