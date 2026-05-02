import { appendFileSync } from 'node:fs';

export function appendOutput(usage: {
  input_tokens: number;
  output_tokens: number;
  model?: string;
  provider?: string;
}): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    let out = `input_tokens=${usage.input_tokens}\noutput_tokens=${usage.output_tokens}\n`;
    if (usage.model) out += `model=${usage.model}\n`;
    if (usage.provider) out += `provider=${usage.provider}\n`;
    appendFileSync(githubOutput, out);
  }
}
