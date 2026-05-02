import { createRequire } from 'module';
import type { ValidateFunction } from 'ajv';
import { FerryError } from '../errors/index.js';
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

export function validateEnvelope(raw: unknown): EventEnvelopeV1 {
  if (!validateFn(raw)) {
    const safePaths = (validateFn.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError('state-invariant', { paths: safePaths });
  }
  const envelope = raw as EventEnvelopeV1;
  if (envelope.instructions !== undefined) {
    const cap = parseInt(process.env.FERRY_ENVELOPE_INSTRUCTIONS_CHARS ?? '', 10) || 2000;
    envelope.instructions = envelope.instructions.slice(0, cap);
  }
  return envelope;
}
