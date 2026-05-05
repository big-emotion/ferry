import Anthropic from '@anthropic-ai/sdk';
import { FerryError } from '../../errors/index.js';
import { resolveAnthropicAuth } from '../anthropic-auth.js';
import { createAnthropicToolCallLoop } from './anthropic.js';
import { createOpenAIToolCallLoop } from './openai.js';
import { createGoogleToolCallLoop } from './google.js';
import type { ToolCallLoop } from './types.js';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new FerryError('state-invariant', { reason: 'missing-env', key });
  }
  return val;
}

export function createToolCallLoop(opts: { provider: string; model: string }): ToolCallLoop {
  if (opts.provider === 'anthropic') {
    const auth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
    const client = new Anthropic(auth);
    return createAnthropicToolCallLoop({ client, model: opts.model });
  }

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
