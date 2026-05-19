// No-auto-merge hardening for the claude-code-action execution path (ADR-0006
// §5, ADR-0005, decisions/0002 §C/§D). These are the deterministic primitives
// #302 brackets the action with — they are intentionally pure and side-effect
// free so the no-auto-merge invariant is unit-testable before the path is
// enabled.

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
