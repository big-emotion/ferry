import { appendFileSync } from 'fs';
import { validateEnvelope } from './validate.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('', 'ferry:envelope');

const raw = process.env.FERRY_ENVELOPE_PAYLOAD;
if (!raw) {
  logger.error('FERRY_ENVELOPE_PAYLOAD is not set');
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch {
  logger.error('FERRY_ENVELOPE_PAYLOAD is not valid JSON');
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
  logger.error('Envelope validation failed', { error: (e as Error).message });
  process.exit(1);
}
