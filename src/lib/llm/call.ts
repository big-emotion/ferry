import { FerryError } from '../errors/index.js';
import { retry } from '../io/retry.js';
import type { LlmRoute } from './config.js';
import { invokeAnthropic } from './anthropic.js';
import { invokeOpenAI } from './openai.js';
import { invokeGoogle } from './google.js';
import { resolveAnthropicAuth } from './anthropic-auth.js';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

export interface LlmResult {
  text: string;
  promptIncluded?: string;
  usage: LlmUsage | null;
}

export type LlmCall = (prompt: string) => Promise<LlmResult>;

const MAX_TOKENS = 4096;

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new FerryError('state-invariant', { reason: 'missing-env', key });
  }
  return val;
}

export function createLlmCall(route: LlmRoute): LlmCall {
  if (route.provider === 'anthropic') {
    const auth = resolveAnthropicAuth({ apiKeyEnv: 'FERRY_ANTHROPIC_KEY' });
    return retry(
      (prompt: string) =>
        invokeAnthropic({ auth, model: route.model, prompt, maxTokens: MAX_TOKENS }),
      { baseDelayMs: 2000, maxAttempts: 3 },
    );
  }

  if (route.provider === 'openai') {
    const apiKey = requireEnv('FERRY_OPENAI_KEY');
    return retry(
      (prompt: string) =>
        invokeOpenAI({ apiKey, model: route.model, prompt, maxTokens: MAX_TOKENS }),
      { baseDelayMs: 2000, maxAttempts: 3 },
    );
  }

  if (route.provider === 'google') {
    const apiKey = requireEnv('FERRY_GOOGLE_AI_KEY');
    return retry((prompt: string) => invokeGoogle({ apiKey, model: route.model, prompt }), {
      baseDelayMs: 2000,
      maxAttempts: 3,
    });
  }

  throw new FerryError('state-invariant', { reason: 'unknown-provider', provider: route.provider });
}
