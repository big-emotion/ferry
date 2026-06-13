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
  const overlays = CC_AGENTS.filter((agent) =>
    existsSync(join(promptsDir, `${agent}.claude-code.local.md`)),
  );

  if (overrides.length === 0 && overlays.length === 0) {
    return {
      label: 'CC path: prompt overrides',
      status: 'green',
      detail: 'No claude-code prompt overrides — agents use Ferry bundled defaults',
    };
  }

  if (overrides.length > 0) {
    return {
      label: 'CC path: prompt overrides',
      status: 'yellow',
      detail: `Legacy claude-code full override(s) detected: ${overrides
        .map((agent) => `prompts/${agent}.claude-code.md`)
        .join(
          ', ',
        )}. These replace Ferry's bundled direct-action prompt entirely and can freeze the prompt contract. Prefer additive local overlays such as ${overrides
        .map((agent) => `prompts/${agent}.claude-code.local.md`)
        .join(', ')}.`,
      remedy:
        'Move repo-specific direct-action guidance into prompts/<agent>.claude-code.local.md when possible',
    };
  }

  return {
    label: 'CC path: prompt overrides',
    status: 'green',
    detail: `${overlays.length} claude-code local overlay(s) resolved by ferry-cc-prompt: ${overlays
      .map((agent) => `prompts/${agent}.claude-code.local.md`)
      .join(', ')}`,
  };
}
