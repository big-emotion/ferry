/**
 * Shared "prepared context" base type for the four agent roles
 * (refiner / developer / reviewer / iterator).
 *
 * Each role's `*-prepare.ts` module builds the `RolePreparedContextBase`
 * fields PLUS any role-specific extras, returning a typed extension of this
 * interface. The agent action then invokes its loop with the returned context.
 *
 * The single source of `system` / `initialPrompt` / `mcpServers` is the goal
 * of this refactor (issue #330) — it structurally enforces the ADR-0006 §2
 * "prompts reused verbatim" promise, so the future cc-prepare composite
 * (sister issue #331) consumes the same prepare function and feeds
 * `buildClaudeCodeJob` with identical inputs.
 *
 * Note: the refiner does not currently use `createAgentLoop`/`runReviewLoop`
 * on the script path — its `system` and `initialPrompt` are constructed
 * inside `runRefiner`. The refiner's prepared context therefore omits those
 * three loop-only fields; this stays compatible with the cc-prepare path,
 * which will call `buildSystem('refiner')` itself.
 */

import type { McpServerConfig } from '../llm/agent-loop/types.js';
import type { ResolvedCapabilities } from '../labels/capabilities.js';

export interface RolePreparedContextBase {
  /** Resolved `buildSystem(<role>)` output — forwarded verbatim to the loop. */
  system: string;
  /** Final initial prompt for the loop (delimited ticket block, etc.). */
  initialPrompt: string;
  /** Capability-filtered MCP pool. Never carries unfiltered defaults. */
  mcpServers: McpServerConfig[];
  /** `[ferry:<role>:<key>]` marker used by audit comments. */
  idempotencyMarker: string;
  /** The delimited ticket block — exposed so the cc-prepare composite can re-use it. */
  ticketBlock: string;
  /** Resolved capabilities (mcp server names, triggered labels, etc.). */
  capabilities: ResolvedCapabilities;
}
