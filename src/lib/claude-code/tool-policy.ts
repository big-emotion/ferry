/**
 * No-auto-merge tool policy for the `claude-code-action` execution path.
 *
 * The bundled-script sandbox deny-list (`src/agents/developer/sandbox.ts`) runs
 * *inside* the bundled agent loop and therefore does NOT wrap
 * `claude-code-action`'s separate, opaque loop. ADR-0006 §5 requires the
 * no-auto-merge invariant (ADR-0005) to be re-established for that path through
 * a restricted `--allowedTools` / `--disallowedTools` policy.
 *
 * Claude Code resolves a tool call against deny rules first: a `disallowedTools`
 * rule takes precedence over any `allowedTools` rule. That is what makes a broad
 * `Bash(git:*)` grant for the code agents safe — the explicit deny rules below
 * still block push / merge regardless of how broad the allow set is.
 *
 * The only sanctioned push on this path is the deterministic, post-action
 * secret-scan gate (see `secret-scan-gate.ts`). The LLM is never allowed to
 * push or merge directly — `git push` is denied wholesale (a superset of
 * "no push to protected refs").
 */

export type AgentRole = 'refiner' | 'developer' | 'reviewer' | 'iterator';

export interface ToolPolicy {
  /** Tools the action loop may use (Claude Code permission rule syntax). */
  allowedTools: string[];
  /** Tools the action loop may never use; takes precedence over allow. */
  disallowedTools: string[];
}

/**
 * The deny rules that re-establish ADR-0005 on the claude-code path.
 *
 * Both the bare form (`Bash(git push)`) and the prefix form
 * (`Bash(git push:*)`) are listed: Claude Code's prefix matcher keys off the
 * command prefix, and an exact-match rule does not imply the prefixed variant.
 * Listing both closes the "no-args invocation slips through" gap.
 */
export const NO_AUTO_MERGE_DENY: readonly string[] = [
  'Bash(gh pr merge)',
  'Bash(gh pr merge:*)',
  'Bash(gh merge:*)',
  'Bash(gh pr close)',
  'Bash(gh pr close:*)',
  'Bash(git push)',
  'Bash(git push:*)',
];

/** Read + reasoning tools shared by every role. */
const COMMON_READ_TOOLS: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
];

/** Code-mutation tools granted only to the developer / iterator agents. */
const CODE_TOOLS: readonly string[] = [
  'Write',
  'Edit',
  'Bash(git:*)',
  'Bash(npm:*)',
  'Bash(npx:*)',
];

function allowedToolsFor(role: AgentRole): string[] {
  const isCodeRole = role === 'developer' || role === 'iterator';
  return isCodeRole ? [...COMMON_READ_TOOLS, ...CODE_TOOLS] : [...COMMON_READ_TOOLS];
}

/**
 * Build the deterministic tool policy for an agent role. The no-auto-merge deny
 * set is unconditional — it is attached to every role regardless of how broad
 * that role's allow set is.
 */
export function buildToolPolicy(role: AgentRole): ToolPolicy {
  return {
    allowedTools: allowedToolsFor(role),
    disallowedTools: [...NO_AUTO_MERGE_DENY],
  };
}

/**
 * Fail-closed invariant check: a policy is only valid if it carries the entire
 * no-auto-merge deny set and no allow rule re-grants a denied rule verbatim.
 *
 * This is the deterministic guarantee #302 must assert before invoking the
 * action — a misconfigured allowlist re-opens the auto-merge risk (ADR-0006
 * "Negative" consequence), so the check is explicit and tested.
 */
export function assertToolPolicyEnforcesNoAutoMerge(policy: ToolPolicy): void {
  const denySet = new Set(policy.disallowedTools);
  const missing = NO_AUTO_MERGE_DENY.filter((rule) => !denySet.has(rule));
  if (missing.length > 0) {
    throw new Error(`no-auto-merge invariant violated: deny set is missing ${missing.join(', ')}`);
  }
  const regranted = policy.allowedTools.filter((rule) => denySet.has(rule));
  if (regranted.length > 0) {
    throw new Error(
      `no-auto-merge invariant violated: allowed tools re-grant denied rule(s) ${regranted.join(
        ', ',
      )}`,
    );
  }
}

/**
 * Render the policy as a `claude_args` fragment for `claude-code-action`.
 * Output is deterministic for a given role (insertion order is stable).
 */
export function renderClaudeArgs(policy: ToolPolicy): string {
  return [
    `--allowedTools "${policy.allowedTools.join(',')}"`,
    `--disallowedTools "${policy.disallowedTools.join(',')}"`,
  ].join(' ');
}
