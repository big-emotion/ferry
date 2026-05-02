import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult } from '../types.js';

const AGENT_NAMES = ['refiner', 'dev', 'review', 'iterate'] as const;

export function checkPromptOverrides(opts: { repoRoot: string }): CheckResult {
  const { repoRoot } = opts;
  const promptsDir = join(repoRoot, 'prompts');

  if (!existsSync(promptsDir)) {
    return {
      label: 'Prompt overrides',
      status: 'green',
      detail: 'No prompts/ directory — using bundled prompts',
    };
  }

  const overrides: string[] = [];
  for (const name of AGENT_NAMES) {
    const overridePath = join(promptsDir, `${name}.md`);
    if (existsSync(overridePath)) {
      overrides.push(`${name}.md`);
    }
  }

  if (overrides.length === 0) {
    return {
      label: 'Prompt overrides',
      status: 'green',
      detail: 'No full prompt overrides detected',
    };
  }

  const warnings = overrides
    .map(
      (file) =>
        `Full prompt override \`prompts/${file}\` detected. This replaces Ferry's bundled prompt entirely and may break the agent contract (tools, output format, transitions). Consider using \`prompts/${file.replace(/\.md$/, '.extra.md')}\` instead — it appends your customisations without replacing the contract. See docs/CONFIGURATION.md.`,
    )
    .join('\n');

  return {
    label: 'Prompt overrides',
    status: 'yellow',
    detail: warnings,
    remedy: `Rename ${overrides.join(', ')} to use the .extra.md suffix to keep Ferry's contract intact`,
  };
}
