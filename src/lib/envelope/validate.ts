import { createRequire } from 'module';
import type { ValidateFunction } from 'ajv';
import { FerryError } from '../error.js';
import type { EventEnvelopeV1 } from './types.js';

const _require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eventSchema: Record<string, any> = _require('../../schemas/event.v1.schema.json');

/* eslint-disable @typescript-eslint/no-explicit-any */
const ajvModule = _require('ajv/dist/2020') as {
  Ajv2020: new (opts?: any) => { compile: (s: any) => ValidateFunction };
};
const ajvInstance = new ajvModule.Ajv2020({ strict: true });
(_require('ajv-formats') as any).default(ajvInstance);
/* eslint-enable @typescript-eslint/no-explicit-any */

const validateFn: ValidateFunction = ajvInstance.compile(eventSchema);

/**
 * Validates an event envelope against the v1 JSON schema and enforces the
 * 2000-char instructions cap (Story 2-2 AC4).
 *
 * `warn` is injectable so tests can assert truncation diagnostics without
 * mutating the global console. Default routes to `console.warn` to keep prod
 * call-sites unchanged.
 */
export function validateEnvelope(
  raw: unknown,
  warn: (msg: string) => void = console.warn,
): EventEnvelopeV1 {
  if (!validateFn(raw)) {
    const safePaths = (validateFn.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError('state-invariant', { paths: safePaths });
  }
  const envelope = raw as EventEnvelopeV1;
  if (envelope.instructions !== undefined && envelope.instructions.length > 2000) {
    warn(
      `[ferry:envelope] instructions truncated from ${envelope.instructions.length} to 2000 chars`,
    );
    envelope.instructions = envelope.instructions.slice(0, 2000);
  }
  return envelope;
}
