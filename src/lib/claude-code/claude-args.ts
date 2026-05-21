/**
 * Assembles the `claude_args` token list for the `claude-code-action` step and
 * serializes it into the string that action's `claude_args:` input expects.
 *
 * `buildClaudeArgs` returns an ordered `string[]` of `[flag, value, …]` pairs —
 * a pure token list, trivially unit-testable and quoting-agnostic.
 * `serializeClaudeArgs` renders that list into the single-line, shell-quoted
 * string `cc-prepare` writes to `$GITHUB_OUTPUT`.
 *
 * The system prompt is NOT carried here. `claude-code-action` runs
 * `stripShellComments` over `claude_args` before parsing it with `shell-quote`,
 * dropping every physical line whose first non-whitespace character is `#` —
 * which would silently delete the Markdown headings of `buildSystem(<role>)`.
 * The system prompt is delivered through the action's verbatim `prompt:` input
 * instead (ADR-0006 §2); `claude_args` therefore carries only single-line,
 * `#`-free flag values.
 *
 * No-auto-merge tool hardening (`--disallowedTools`, protected-ref scoping) is
 * wired here via `assertToolPolicyEnforcesNoAutoMerge` + `NO_AUTO_MERGE_DENY`
 * (#303, ADR-0002 §accepted-divergences point 3).
 */

import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { FerryRole } from './tool-profiles.js';
import { nativeToolsForRole } from './tool-profiles.js';
import { toClaudeCodeMcpConfig, mcpToolAllowlist } from './mcp-config.js';
import { assertToolPolicyEnforcesNoAutoMerge, NO_AUTO_MERGE_DENY } from './tool-policy.js';
import { CC_OUTPUT_ARTIFACT_PATH } from './output-artifact.js';

export interface BuildClaudeArgsInput {
  role: FerryRole;
  /** Already capability-filtered MCP pool (caller runs `filterMcpServers`). */
  mcpServers?: McpServerConfig[];
  /** Coarse loop bound (ADR-0006 §4) — there is no per-run EUR cap on this path. */
  maxTurns?: number;
  model?: string;
}

export function buildClaudeArgs(input: BuildClaudeArgsInput): string[] {
  const servers = input.mcpServers ?? [];
  // All roles need a narrow Write grant for the output artifact (.ferry/cc-output.json).
  // Read-only roles (refiner/reviewer) have no broad Write in their native tool set,
  // so without this grant the agent cannot write its result and cc-apply fails with ENOENT.
  const allowedTools = [
    ...nativeToolsForRole(input.role),
    `Write(${CC_OUTPUT_ARTIFACT_PATH})`,
    ...mcpToolAllowlist(servers),
  ];

  // Fail-closed: assert the no-auto-merge invariant before emitting args.
  // Throws if the allow set re-grants a denied rule (ADR-0002 §D, #303).
  const disallowedTools = [...NO_AUTO_MERGE_DENY];
  assertToolPolicyEnforcesNoAutoMerge({ allowedTools, disallowedTools });

  const args: string[] = [
    '--allowedTools',
    allowedTools.join(','),
    '--disallowedTools',
    disallowedTools.join(','),
  ];

  if (servers.length > 0) {
    args.push('--mcp-config', JSON.stringify(toClaudeCodeMcpConfig(servers)));
  }

  if (input.maxTurns !== undefined) {
    if (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0) {
      throw new Error(`max-turns must be a positive integer, got ${input.maxTurns}`);
    }
    args.push('--max-turns', String(input.maxTurns));
  }

  if (input.model !== undefined && input.model.trim().length > 0) {
    args.push('--model', input.model);
  }

  return args;
}

/** A token safe to emit bare: no shell metacharacter, quote, or whitespace. */
const SHELL_SAFE_TOKEN = /^[A-Za-z0-9_,.:=/@+-]+$/;

/**
 * Render a `buildClaudeArgs` token list as the single-line, shell-quoted string
 * `anthropics/claude-code-action@v1` expects for its `claude_args:` input.
 *
 * The action word-splits that input with `shell-quote`; a JSON array (or any
 * unquoted value containing spaces or parens) is mis-tokenized and the affected
 * flags are silently dropped — which is exactly how a correct `--allowedTools`
 * grant can fail to take effect.
 *
 * Each token is single-quoted — with the embedded-quote `'\''` idiom — unless
 * it is already a bare shell-safe word, so the parenthesised tool rules and the
 * JSON `--mcp-config` payload survive verbatim. A token containing a newline is
 * rejected: it would span multiple physical lines and hit the action's
 * `#`-leading-line stripping (see the module header).
 */
export function serializeClaudeArgs(tokens: string[]): string {
  return tokens
    .map((token) => {
      if (token.includes('\n')) {
        throw new Error(`claude_args token must not contain a newline: ${JSON.stringify(token)}`);
      }
      return token.length > 0 && SHELL_SAFE_TOKEN.test(token)
        ? token
        : `'${token.replace(/'/g, "'\\''")}'`;
    })
    .join(' ');
}
