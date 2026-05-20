/**
 * Assembles the `claude_args` token list for the `claude-code-action` step.
 *
 * Returned as an ordered `string[]` of `[flag, value, …]` pairs — NOT a
 * pre-quoted shell string. Shell-safe serialization into the action's
 * `claude_args:` input is the deterministic wrapper's job (#301); keeping this
 * a pure token list makes it trivially unit-testable and quoting-agnostic.
 *
 * The system prompt is forwarded **verbatim** via `--append-system-prompt`
 * (ADR-0006 §2): no rewrite of `buildSystem()` output. No-auto-merge tool
 * hardening (`--disallowedTools`, protected-ref scoping) is wired here via
 * `assertToolPolicyEnforcesNoAutoMerge` + `NO_AUTO_MERGE_DENY` (#303,
 * ADR-0002 §accepted-divergences point 3).
 */

import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { FerryRole } from './tool-profiles.js';
import { nativeToolsForRole } from './tool-profiles.js';
import { toClaudeCodeMcpConfig, mcpToolAllowlist } from './mcp-config.js';
import { assertToolPolicyEnforcesNoAutoMerge, NO_AUTO_MERGE_DENY } from './tool-policy.js';

export interface BuildClaudeArgsInput {
  role: FerryRole;
  /** Resolved `buildSystem(<role>)` output — passed through unchanged. */
  system: string;
  /** Already capability-filtered MCP pool (caller runs `filterMcpServers`). */
  mcpServers?: McpServerConfig[];
  /** Coarse loop bound (ADR-0006 §4) — there is no per-run EUR cap on this path. */
  maxTurns?: number;
  model?: string;
}

export function buildClaudeArgs(input: BuildClaudeArgsInput): string[] {
  const servers = input.mcpServers ?? [];
  const allowedTools = [...nativeToolsForRole(input.role), ...mcpToolAllowlist(servers)];

  // Fail-closed: assert the no-auto-merge invariant before emitting args.
  // Throws if the allow set re-grants a denied rule (ADR-0002 §D, #303).
  const disallowedTools = [...NO_AUTO_MERGE_DENY];
  assertToolPolicyEnforcesNoAutoMerge({ allowedTools, disallowedTools });

  const args: string[] = [
    '--append-system-prompt',
    input.system,
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
