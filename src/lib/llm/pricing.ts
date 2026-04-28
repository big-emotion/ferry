import type { LlmProvider } from './config.js';

interface TokenRates {
  inputPer1M: number;
  outputPer1M: number;
}

// EUR/USD ≈ 0.93; rates pinned 2025-Q2
const RATES: Record<string, TokenRates> = {
  'anthropic/claude-sonnet-4-6': { inputPer1M: 2.79, outputPer1M: 13.95 },
  'anthropic/claude-opus': { inputPer1M: 13.95, outputPer1M: 69.75 },
  'anthropic/claude-haiku': { inputPer1M: 0.23, outputPer1M: 1.16 },
  'openai/gpt-4.1-mini': { inputPer1M: 0.14, outputPer1M: 0.56 },
  'openai/gpt-4.': { inputPer1M: 2.79, outputPer1M: 8.37 },
  'openai/gpt-5.': { inputPer1M: 2.79, outputPer1M: 8.37 },
  'google/gemini-2.5-flash': { inputPer1M: 0.07, outputPer1M: 0.28 },
  'google/gemini-2.5-pro': { inputPer1M: 1.05, outputPer1M: 4.2 },
};

const PROVIDER_FALLBACK: Record<LlmProvider, TokenRates> = {
  anthropic: RATES['anthropic/claude-opus']!,
  openai: RATES['openai/gpt-4.']!,
  google: RATES['google/gemini-2.5-pro']!,
};

function lookupRates(provider: LlmProvider, model: string): TokenRates {
  const exactKey = `${provider}/${model}`;
  if (RATES[exactKey]) return RATES[exactKey]!;

  for (const key of Object.keys(RATES)) {
    if (
      key !== exactKey &&
      key.startsWith(`${provider}/`) &&
      model.startsWith(key.slice(provider.length + 1))
    ) {
      return RATES[key]!;
    }
  }

  return PROVIDER_FALLBACK[provider];
}

export function computeCostEur(
  provider: LlmProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = lookupRates(provider, model);
  const cost =
    (inputTokens / 1_000_000) * rates.inputPer1M + (outputTokens / 1_000_000) * rates.outputPer1M;
  return Math.round(cost * 10_000) / 10_000;
}
