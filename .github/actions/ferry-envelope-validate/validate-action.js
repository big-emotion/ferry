// Self-contained envelope validation bundle for ferry-envelope-validate composite action.
// AJV is loaded via createRequire so it resolves from this action's own node_modules.
import { createRequire } from 'module';
import { appendFileSync } from 'fs';

const _require = createRequire(import.meta.url);

const eventSchema = _require('./schemas/event.v1.schema.json');
const { Ajv2020 } = _require('ajv/dist/2020');
const addFormats = _require('ajv-formats');

const ajv = new Ajv2020({ strict: true });
addFormats.default(ajv);
const validateFn = ajv.compile(eventSchema);

function validateEnvelope(raw) {
  if (!validateFn(raw)) {
    const safePaths = (validateFn.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    const err = new Error(`[ferry:state-invariant] ${JSON.stringify({ paths: safePaths })}`);
    err.name = 'FerryError';
    throw err;
  }
  if (raw.instructions !== undefined) {
    raw.instructions = raw.instructions.slice(0, 2000);
  }
  return raw;
}

const raw = process.env.FERRY_ENVELOPE_PAYLOAD;
if (!raw) {
  console.error('[ferry:envelope] FERRY_ENVELOPE_PAYLOAD is not set');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error('[ferry:envelope] FERRY_ENVELOPE_PAYLOAD is not valid JSON');
  process.exit(1);
}

try {
  const envelope = validateEnvelope(parsed);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(
      output,
      `ticket_key=${envelope.ticket_key}\nphase=${envelope.phase}\nevent_id=${envelope.event_id}\n`,
    );
  }
  process.exit(0);
} catch (e) {
  console.error('[ferry:envelope] Envelope validation failed:', e.message);
  process.exit(1);
}
