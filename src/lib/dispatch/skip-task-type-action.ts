import { postComment } from '../io/jira.js';
import { validateEnvelope } from '../envelope/validate.js';
import { buildTaskSkipComment, shouldSkipForTaskType } from './routing.js';

const raw = process.env.FERRY_ENVELOPE_PAYLOAD;
if (!raw) {
  console.error('[ferry:dispatch] FERRY_ENVELOPE_PAYLOAD is not set');
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error('[ferry:dispatch] FERRY_ENVELOPE_PAYLOAD is not valid JSON');
  process.exit(1);
}

const envelope = validateEnvelope(parsed);
const issueType = envelope.issue_type;
if (!issueType) process.exit(0);

const skip = shouldSkipForTaskType(issueType);
if (!skip.skip) process.exit(0);

const role = 'refiner';
const body = buildTaskSkipComment(role, envelope.event_id);

await postComment({
  ticketKey: envelope.ticket_key,
  body,
  idempotencyMarker: `[ferry:${role}:${envelope.event_id}]`,
  recentComments: [],
});

process.exit(0);
