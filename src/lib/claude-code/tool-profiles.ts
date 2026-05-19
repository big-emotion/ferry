/**
 * Per-agent tool profiles for the claude-code-action execution path.
 *
 * This encodes the parity table from issue #302 / ADR-0006 §2:
 *   - Refiner / Reviewer are READ-ONLY — they read (Jira/GitHub via MCP, files
 *     via native read tools) and emit a structured verdict; they perform NO
 *     LLM-driven writes. All side effects are deterministic wrapper steps.
 *   - Developer / Iterator are READ-WRITE — they use the native Claude Code
 *     tools `Bash/Read/Write/Edit/Glob/Grep` plus consumer MCP servers.
 *
 * These are the *native* Claude Code core tool names (as accepted by
 * `claude_args --allowedTools`). MCP tool allowlisting is handled separately
 * in `mcp-config.ts`.
 */

export type FerryRole = 'refiner' | 'developer' | 'reviewer' | 'iterator';

export type ToolAccess = 'read-only' | 'read-write';

/**
 * The exact prompt name each role passes to `buildSystem()` today. Used so the
 * claude-code path resolves the *same* bundled prompt (`prompts/<name>.md` +
 * `prompts/<name>.extra.md`) verbatim — no rewrite.
 */
export const ROLE_PROMPT_NAME: Record<FerryRole, string> = {
  refiner: 'refiner',
  developer: 'dev',
  reviewer: 'review',
  iterator: 'iterate',
};

export const ROLE_ACCESS: Record<FerryRole, ToolAccess> = {
  refiner: 'read-only',
  reviewer: 'read-only',
  developer: 'read-write',
  iterator: 'read-write',
};

/** Native tools a read-only agent may use: file inspection only. */
export const READ_ONLY_NATIVE_TOOLS = ['Read', 'Glob', 'Grep'] as const;

/** Native tools a read-write agent may use: the full Ferry code-tool surface. */
export const READ_WRITE_NATIVE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'] as const;

function isFerryRole(role: string): role is FerryRole {
  return Object.prototype.hasOwnProperty.call(ROLE_ACCESS, role);
}

/**
 * Returns the native Claude Code tool allowlist for a role. Fail-closed:
 * an unrecognised role throws rather than defaulting to broad access.
 */
export function nativeToolsForRole(role: FerryRole): string[] {
  if (!isFerryRole(role)) {
    throw new Error(`unknown ferry role: ${String(role)}`);
  }
  return ROLE_ACCESS[role] === 'read-only'
    ? [...READ_ONLY_NATIVE_TOOLS]
    : [...READ_WRITE_NATIVE_TOOLS];
}
