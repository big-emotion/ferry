import { validateEnvelope } from '../envelope/validate.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';
import { requireEnv } from './env.js';
import { createLogger } from '../logger/index.js';
import type { Logger } from '../logger/index.js';

export type AgentRole = 'refiner' | 'developer' | 'reviewer' | 'iterator' | 'merger';

const COMPONENT: Record<AgentRole, string> = {
  refiner: 'ferry:refiner-action',
  developer: 'ferry:dev-action',
  reviewer: 'ferry:review-action',
  iterator: 'ferry:iterate-action',
  merger: 'ferry:merge-action',
};

export async function runAgent(
  role: AgentRole,
  handler: (envelope: EventEnvelopeV1, logger: Logger) => Promise<void>,
): Promise<void> {
  const component = COMPONENT[role];
  const bootstrapLogger = createLogger('', component);
  try {
    const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
    const envelope = validateEnvelope(JSON.parse(rawPayload));
    const logger = createLogger(envelope.event_id, component);
    await handler(envelope, logger);
  } catch (err) {
    bootstrapLogger.error('fatal', { error: (err as Error).message });
    process.exit(1);
  }
}
