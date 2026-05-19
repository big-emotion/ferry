import type { ExecutionPath } from '../../../lib/config.js';

/**
 * Wizard question for the install-time execution-path choice (ADR-0006 §6).
 * Default is the bundled script — the safe, multi-provider, per-run-EUR-capped
 * path. The claude-code-action path is Anthropic-subscription only and adds the
 * required `CLAUDE_CODE_OAUTH_TOKEN` secret.
 */
export const EXECUTION_PATH_QUESTION =
  'Execution path: (a) bundled script [multi-provider, per-run EUR cap — default] ' +
  'or (b) claude-code-action [Anthropic subscription, free agent loop, requires CLAUDE_CODE_OAUTH_TOKEN]';

/**
 * Parse the wizard answer into an {@link ExecutionPath}. Anything that is not an
 * explicit claude-code choice resolves to the safe `script` path.
 */
export function parseExecutionPathChoice(answer: string): ExecutionPath {
  const v = answer.trim().toLowerCase();
  if (v === 'b' || v === 'claude-code' || v === 'claude-code-action') {
    return 'claude-code';
  }
  return 'script';
}
