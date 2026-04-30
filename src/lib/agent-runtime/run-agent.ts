import { validateEnvelope } from '../envelope/validate.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';
import { requireEnv } from './env.js';

export type AgentRole = 'refiner' | 'developer' | 'reviewer' | 'iterator';

const LOG_PREFIX: Record<AgentRole, string> = {
  refiner: '[ferry:refiner-action]',
  developer: '[ferry:dev-action]',
  reviewer: '[ferry:review-action]',
  iterator: '[ferry:iterate-action]',
};

/**
 * Shared shell for agent entrypoints. Reads `FERRY_ENVELOPE_PAYLOAD`,
 * validates it, hands the envelope to the role-specific handler, and
 * normalizes fatal errors with a `[ferry:<role>-action]` prefix and exit 1.
 *
 * The handler controls its own success exit code (it may call `process.exit(0)`
 * or simply return). Throwing from the handler is treated as fatal.
 */
export async function runAgent(
  role: AgentRole,
  handler: (envelope: EventEnvelopeV1) => Promise<void>,
): Promise<void> {
  const prefix = LOG_PREFIX[role];
  try {
    const rawPayload = requireEnv('FERRY_ENVELOPE_PAYLOAD');
    const envelope = validateEnvelope(JSON.parse(rawPayload));
    await handler(envelope);
  } catch (err) {
    console.error(`${prefix} fatal:`, (err as Error).message);
    process.exit(1);
  }
}
