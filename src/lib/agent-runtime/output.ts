import { appendFileSync } from 'node:fs';
import { computeCostEur } from '../llm/pricing.js';
import type { LlmProvider } from '../llm/config.js';

export function appendOutput(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  model?: string;
  provider?: string;
}): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;

    let costEur = 0;
    if (usage.provider && usage.model && usage.model !== 'placeholder') {
      costEur = computeCostEur(
        usage.provider as LlmProvider,
        usage.model,
        usage.input_tokens,
        usage.output_tokens,
      );
    }

    let out = `input_tokens=${usage.input_tokens}\noutput_tokens=${usage.output_tokens}\n`;
    out += `cache_read_tokens=${cacheRead}\ncache_write_tokens=${cacheWrite}\n`;
    out += `cost_eur=${costEur}\n`;
    if (usage.model) out += `model=${usage.model}\n`;
    if (usage.provider) out += `provider=${usage.provider}\n`;
    appendFileSync(githubOutput, out);
  }
}
