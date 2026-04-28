import Anthropic from '@anthropic-ai/sdk';
import { FerryError } from '../error.js';
import { computeCostEur } from './pricing.js';
import type { LlmResult } from './call.js';

export async function invokeAnthropic(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
}): Promise<LlmResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });

  try {
    const msg = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: 'user', content: opts.prompt }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const inputTokens = msg.usage.input_tokens;
    const outputTokens = msg.usage.output_tokens;

    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costEur: computeCostEur('anthropic', opts.model, inputTokens, outputTokens),
      },
    };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      throw new FerryError('spend-cap', { reason: 'rate-limit' });
    }
    if (e instanceof Anthropic.APIError && e.status >= 500) {
      throw new FerryError('transient', { reason: 'server-error', status: e.status });
    }
    if (e instanceof Error && isNetworkError(e.message)) {
      throw new FerryError('transient', { reason: 'network-error' });
    }
    throw e;
  }
}

function isNetworkError(msg: string): boolean {
  return msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT');
}
