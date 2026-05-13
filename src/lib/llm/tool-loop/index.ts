import Anthropic from '@anthropic-ai/sdk';
import { FerryError } from '../../errors/index.js';
import { resolveAnthropicAuth } from '../anthropic-auth.js';
import { createAnthropicToolCallLoop } from './anthropic.js';
import { createOpenAIToolCallLoop } from './openai.js';
import { createGoogleToolCallLoop } from './google.js';
import { resolveThinkingForProvider } from '../thinking.js';
import type { ToolCallLoop } from './types.js';
import type { TicketOverrides } from '../../labels/capabilities.js';
import type { Logger } from '../../logger/index.js';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new FerryError('state-invariant', { reason: 'missing-env', key });
  }
  return val;
}

export function createToolCallLoop(opts: {
  provider: string;
  model: string;
  /** Extended-thinking override from the ferry:thinking/{on,off,extended} label — Anthropic-only, ignored elsewhere. */
  thinking?: TicketOverrides['thinking'];
  /** Logger used to emit the "ignored — non-Anthropic provider" warning. */
  logger?: Logger;
}): ToolCallLoop {
  if (opts.provider === 'anthropic') {
    const auth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
    const client = new Anthropic(auth);
    const thinking = resolveThinkingForProvider(opts.thinking, opts.provider, opts.logger);
    return createAnthropicToolCallLoop({ client, model: opts.model, thinking });
  }

  // Non-Anthropic providers: still call the resolver so the stderr warning is emitted
  // when a thinking override is set, then fall through without passing the param.
  resolveThinkingForProvider(opts.thinking, opts.provider, opts.logger);

  if (opts.provider === 'openai') {
    const apiKey = requireEnv('FERRY_OPENAI_KEY');
    return createOpenAIToolCallLoop({ apiKey, model: opts.model });
  }

  if (opts.provider === 'google') {
    const apiKey = requireEnv('FERRY_GOOGLE_AI_KEY');
    return createGoogleToolCallLoop({ apiKey, model: opts.model });
  }

  throw new FerryError('state-invariant', { reason: 'unknown-provider', provider: opts.provider });
}

export type {
  ToolCallLoop,
  ToolDef,
  ToolHandler,
  ToolLoopResult,
  ToolLoopRunOpts,
} from './types.js';
