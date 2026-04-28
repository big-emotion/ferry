import { GoogleGenAI } from '@google/genai';
import { FerryError } from '../error.js';
import { computeCostEur } from './pricing.js';
import type { LlmResult } from './call.js';

export async function invokeGoogle(opts: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<LlmResult> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  try {
    const response = await ai.models.generateContent({
      model: opts.model,
      contents: opts.prompt,
    });

    const text = response.text ?? '';
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costEur: computeCostEur('google', opts.model, inputTokens, outputTokens),
      },
    };
  } catch (e) {
    // Google GenAI SDK v1 has no named rate-limit error class; treat all errors as transient
    if (e instanceof Error) {
      throw new FerryError('transient', { reason: 'network-error', message: e.message });
    }
    throw e;
  }
}
