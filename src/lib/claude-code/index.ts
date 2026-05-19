/**
 * Public surface of the claude-code-action execution path.
 *
 * Two complementary layers ship side-by-side and are both re-exported here:
 *
 * 1. **No-auto-merge hardening primitives** (#303, ADR-0006 §5, ADR-0005,
 *    decisions/0002 §C/§D) — `tool-policy.ts`, `job-permissions.ts`,
 *    `secret-scan-gate.ts`. Deterministic invariants that re-establish the
 *    ADR-0005 no-auto-merge constraint when an external reasoning core has
 *    write access; pure and side-effect free so they are unit-testable
 *    before the path is enabled.
 *
 * 2. **Job + prompt-reuse + tool/MCP mapping** (#302, ADR-0006 §2) —
 *    `tool-profiles.ts`, `mcp-config.ts`, `output-artifact.ts`,
 *    `claude-args.ts`, `job.ts`. Maps Ferry's existing role → prompt and
 *    role → tool model onto the inputs `claude-code-action` consumes,
 *    and parses the terminal artifact back into the script-path outcome
 *    objects.
 *
 * The whole module is inert: it is consumed by the contract wrapper steps
 * (#301) and routing (#300), but no workflow imports it yet.
 */

// --- #303: no-auto-merge hardening primitives ---

export {
  NO_AUTO_MERGE_DENY,
  buildToolPolicy,
  assertToolPolicyEnforcesNoAutoMerge,
  renderClaudeArgs,
} from './tool-policy.js';
export type { AgentRole, ToolPolicy } from './tool-policy.js';

export {
  CLAUDE_CODE_JOB_PERMISSIONS,
  assertLeastPrivilege,
  renderPermissionsYaml,
} from './job-permissions.js';
export type { JobPermissions, PermissionScope } from './job-permissions.js';

export { secretScanGate, gatedPush } from './secret-scan-gate.js';
export type { ScanFn, SecretScanGateOptions, GatedPushOptions } from './secret-scan-gate.js';

// --- #302: job + prompt-reuse + tool/MCP mapping ---

export {
  type FerryRole,
  type ToolAccess,
  ROLE_PROMPT_NAME,
  ROLE_ACCESS,
  READ_ONLY_NATIVE_TOOLS,
  READ_WRITE_NATIVE_TOOLS,
  nativeToolsForRole,
} from './tool-profiles.js';

export {
  type ClaudeCodeMcpServer,
  type ClaudeCodeMcpConfig,
  toClaudeCodeMcpConfig,
  mcpToolAllowlist,
} from './mcp-config.js';

export {
  type ReviewerVerdict,
  type RefinerArtifact,
  type ClaudeCodeArtifact,
  CC_OUTPUT_ARTIFACT_PATH,
  parseDevIterArtifact,
  parseReviewerArtifact,
  parseRefinerArtifact,
  parseClaudeCodeArtifact,
  outcomePromptSuffix,
} from './output-artifact.js';

export { type BuildClaudeArgsInput, buildClaudeArgs } from './claude-args.js';

export {
  type BuildClaudeCodeJobInput,
  type ClaudeCodeJob,
  CLAUDE_CODE_AUTH_INPUT,
  FORBIDDEN_AUTH_INPUT,
  buildClaudeCodeJob,
} from './job.js';
