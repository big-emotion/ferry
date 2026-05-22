import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult } from '../types.js';
import { CC_AGENTS } from '../../../lib/prompts/cc-prompt.js';

/**
 * Reports consumer claude-code prompt overrides (`prompts/<agent>.claude-code.md`).
 *
 * Unlike a script-path `<agent>.md` full override — which `checkPromptOverrides`
 * warns about — this is the *intended* customisation mechanism for the
 * claude-code path: `ferry-cc-prompt` resolves it at runtime. A detected
 * override is therefore healthy, not a warning.
 */
export function checkClaudeCodePromptOverrides(opts: { repoRoot: string }): CheckResult {
  const promptsDir = join(opts.repoRoot, 'prompts');
  const overrides = CC_AGENTS.filter((agent) =>
    existsSync(join(promptsDir, `${agent}.claude-code.md`)),
  );

  if (overrides.length === 0) {
    return {
      label: 'CC path: prompt overrides',
      status: 'green',
      detail: 'No claude-code prompt overrides — agents use Ferry bundled defaults',
    };
  }

  return {
    label: 'CC path: prompt overrides',
    status: 'green',
    detail: `${overrides.length} claude-code prompt override(s) resolved by ferry-cc-prompt: ${overrides
      .map((agent) => `prompts/${agent}.claude-code.md`)
      .join(', ')}`,
  };
}
