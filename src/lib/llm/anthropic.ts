import Anthropic from '@anthropic-ai/sdk';
import { FerryError } from '../errors/index.js';
import { computeCostEur } from './pricing.js';
import type { LlmResult } from './call.js';

export async function invokeAnthropic(opts: {
  client: Anthropic;
  model: string;
  prompt: string;
  maxTokens: number;
}): Promise<LlmResult> {
  try {
    const msg = await opts.client.messages.create({
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
