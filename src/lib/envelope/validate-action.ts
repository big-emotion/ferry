import { appendFileSync } from 'fs';
import { validateEnvelope } from './validate.js';

const raw = process.env.FERRY_ENVELOPE_PAYLOAD;
if (!raw) {
  console.error('[ferry:envelope] FERRY_ENVELOPE_PAYLOAD is not set');
  process.exit(1);
}

let parsed: unknown;
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
  // Log only the sanitized error message — no payload values (NFR-S1)
  console.error('[ferry:envelope] Envelope validation failed:', (e as Error).message);
  process.exit(1);
}
