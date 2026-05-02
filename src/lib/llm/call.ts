import Anthropic from '@anthropic-ai/sdk';
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

const MAX_TOKENS = parseInt(process.env.FERRY_LLM_UTILITY_MAX_TOKENS ?? '', 10) || 4096;
const LLM_RETRY_BASE_DELAY_MS = parseInt(process.env.FERRY_LLM_RETRY_BASE_DELAY_MS ?? '', 10) || 2000;
const LLM_RETRY_MAX_ATTEMPTS = parseInt(process.env.FERRY_LLM_RETRY_MAX_ATTEMPTS ?? '', 10) || 3;

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new FerryError('state-invariant', { reason: 'missing-env', key });
  }
  return val;
}

export function createLlmCall(route: LlmRoute): LlmCall {
  if (route.provider === 'anthropic') {
    const auth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
    const client = new Anthropic(auth);
    return retry(
      (prompt: string) =>
        invokeAnthropic({ client, model: route.model, prompt, maxTokens: MAX_TOKENS }),
      { baseDelayMs: LLM_RETRY_BASE_DELAY_MS, maxAttempts: LLM_RETRY_MAX_ATTEMPTS },
    );
  }

  if (route.provider === 'openai') {
    const apiKey = requireEnv('FERRY_OPENAI_KEY');
    return retry(
      (prompt: string) =>
        invokeOpenAI({ apiKey, model: route.model, prompt, maxTokens: MAX_TOKENS }),
      { baseDelayMs: LLM_RETRY_BASE_DELAY_MS, maxAttempts: LLM_RETRY_MAX_ATTEMPTS },
    );
  }

  if (route.provider === 'google') {
    const apiKey = requireEnv('FERRY_GOOGLE_AI_KEY');
    return retry((prompt: string) => invokeGoogle({ apiKey, model: route.model, prompt }), {
      baseDelayMs: LLM_RETRY_BASE_DELAY_MS,
      maxAttempts: LLM_RETRY_MAX_ATTEMPTS,
    });
  }

  throw new FerryError('state-invariant', { reason: 'unknown-provider', provider: route.provider });
}
