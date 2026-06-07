import { postComment } from '../io/jira.js';
import { validateEnvelope } from '../envelope/validate.js';
import { buildTaskSkipComment, shouldSkipForTaskType } from './routing.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('', 'ferry:dispatch');

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

const envelope = validateEnvelope(parsed);
const issueType = envelope.issue_type;
if (!issueType) process.exit(0);

const skip = shouldSkipForTaskType(issueType);
if (!skip.skip) process.exit(0);

const VALID_ROLES = ['refiner', 'developer', 'reviewer', 'iterator', 'merger'] as const;
type AgentRole = (typeof VALID_ROLES)[number];

const rawRole = process.env.FERRY_AGENT_ROLE;
if (!rawRole || !(VALID_ROLES as readonly string[]).includes(rawRole)) {
  logger.error('FERRY_AGENT_ROLE is invalid', {
    valid: VALID_ROLES.join(', '),
    got: rawRole ?? '(unset)',
  });
  process.exit(1);
}
const role = rawRole as AgentRole;
const body = buildTaskSkipComment(role, envelope.event_id);

await postComment({
  ticketKey: envelope.ticket_key,
  body,
  idempotencyMarker: `[ferry:${role}:${envelope.event_id}]`,
  recentComments: [],
});

process.exit(0);
