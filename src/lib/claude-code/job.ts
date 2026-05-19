/**
 * Top-level assembler for the `claude-code-action` execution path (issue #302).
 *
 * Given a role plus the **already-resolved, verbatim** Ferry prompts
 * (`buildSystem(<role>)` and the existing `initialPrompt` builder output) and
 * the **already capability-filtered** MCP pool, produces the deterministic
 * inputs the wrapping workflow steps (#301) feed into `claude-code-action`:
 *
 *   - `prompt`            → action `prompt:` input (initial prompt + transport suffix)
 *   - `claudeArgs`        → `claude_args:` token list (system via --append-system-prompt)
 *   - `authInput`         → the ONLY allowed auth input name (OAuth token; never API key)
 *   - `outputArtifactPath`→ where the LLM writes its final structured result
 *   - `parseOutput`       → role-bound, fail-closed parser → identical script outcomes
 *
 * This module does NOT resolve prompts, filter MCP by capability, run the
 * action, validate the envelope, emit audit comments, or perform transitions —
 * those are the deterministic wrapper steps (#301) and routing (#300). Nothing
 * here is wired into a workflow; the path stays inert until those land.
 */

import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { FerryRole, ToolAccess } from './tool-profiles.js';
import { ROLE_ACCESS, nativeToolsForRole } from './tool-profiles.js';
import { buildClaudeArgs } from './claude-args.js';
import {
  CC_OUTPUT_ARTIFACT_PATH,
  outcomePromptSuffix,
  parseClaudeCodeArtifact,
  type ClaudeCodeArtifact,
} from './output-artifact.js';

/**
 * The claude-code path authenticates EXCLUSIVELY with this action input
 * (ADR-0006 §6 / decisions/0002 hard constraint). `anthropic_api_key` is
 * forbidden on this path — exported so wrapper/init code and tests can assert
 * the invariant rather than re-encode the string.
 */
export const CLAUDE_CODE_AUTH_INPUT = 'claude_code_oauth_token' as const;
export const FORBIDDEN_AUTH_INPUT = 'anthropic_api_key' as const;

export interface BuildClaudeCodeJobInput {
  role: FerryRole;
  /** Resolved `buildSystem(<role>)` output — forwarded unchanged. */
  system: string;
  /** Resolved existing `initialPrompt` — forwarded unchanged (verbatim). */
  initialPrompt: string;
  /** Already capability-filtered MCP pool (caller runs `filterMcpServers`). */
  mcpServers?: McpServerConfig[];
  maxTurns?: number;
  model?: string;
}

export interface ClaudeCodeJob {
  role: FerryRole;
  access: ToolAccess;
  /** action `prompt:` — the verbatim initial prompt + the terminal-output suffix. */
  prompt: string;
  /** action `claude_args:` token list. */
  claudeArgs: string[];
  /** The only permitted auth input name (OAuth token). */
  authInput: typeof CLAUDE_CODE_AUTH_INPUT;
  /** Native tools granted to this role (parity-table observable). */
  allowedNativeTools: string[];
  outputArtifactPath: string;
  /** Role-bound, fail-closed parser of the LLM's final artifact. */
  parseOutput: (raw: unknown) => ClaudeCodeArtifact;
}

export function buildClaudeCodeJob(input: BuildClaudeCodeJobInput): ClaudeCodeJob {
  // nativeToolsForRole is fail-closed on an unknown role — call it first so an
  // invalid role throws before we build anything partial.
  const allowedNativeTools = nativeToolsForRole(input.role);

  return {
    role: input.role,
    access: ROLE_ACCESS[input.role],
    prompt: input.initialPrompt + outcomePromptSuffix(input.role),
    claudeArgs: buildClaudeArgs({
      role: input.role,
      system: input.system,
      mcpServers: input.mcpServers,
      maxTurns: input.maxTurns,
      model: input.model,
    }),
    authInput: CLAUDE_CODE_AUTH_INPUT,
    allowedNativeTools,
    outputArtifactPath: CC_OUTPUT_ARTIFACT_PATH,
    parseOutput: (raw: unknown) => parseClaudeCodeArtifact(input.role, raw),
  };
}
