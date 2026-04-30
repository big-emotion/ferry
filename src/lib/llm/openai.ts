import OpenAI from 'openai';
import { FerryError } from '../errors/index.js';
import { computeCostEur } from './pricing.js';
import type { LlmResult } from './call.js';

export async function invokeOpenAI(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
}): Promise<LlmResult> {
  const client = new OpenAI({ apiKey: opts.apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: opts.model,
      messages: [{ role: 'user', content: opts.prompt }],
      max_tokens: opts.maxTokens,
    });

    const text = completion.choices[0]?.message.content ?? '';
    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;

    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costEur: computeCostEur('openai', opts.model, inputTokens, outputTokens),
      },
    };
  } catch (e) {
    if (e instanceof OpenAI.RateLimitError) {
      throw new FerryError('spend-cap', { reason: 'rate-limit' });
    }
    if (e instanceof OpenAI.APIConnectionError) {
      throw new FerryError('transient', { reason: 'network-error' });
    }
    if (e instanceof OpenAI.APIError && e.status >= 500) {
      throw new FerryError('transient', { reason: 'server-error', status: e.status });
    }
    throw e;
  }
}
