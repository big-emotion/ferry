/**
 * Least-privilege `GITHUB_TOKEN` profile for the `claude-code-action` job.
 *
 * ADR-0006 §5 requires a least-privilege token alongside the tool allowlist:
 * the action's loop is opaque, so the workflow-level `permissions:` block is the
 * second half of the no-auto-merge defense (the first is `tool-policy.ts`).
 *
 * GitHub Actions cannot express "write contents but not merge PRs" — `gh pr
 * merge` and a feature-branch push both ride on `contents: write`. The deny is
 * therefore enforced by the tool policy; this module's job is narrower but
 * still load-bearing: guarantee the action token is scoped to *exactly* the
 * permissions the agents need and nothing that would broaden blast radius
 * (no `actions`/`workflows`/`packages` write, no `write-all`).
 *
 * Note: `id-token: write` is required because `anthropics/claude-code-action@v1`
 * unconditionally calls `core.getIDToken()` during `setupGitHubToken`; omitting
 * it causes every dispatch to fail at OIDC fetch (issue #353).
 *
 * `#302` generates the claude-code workflow; it consumes `renderPermissionsYaml`
 * and must `assertLeastPrivilege` before emitting the job.
 */

export type PermissionScope = 'read' | 'write' | 'none';

export type JobPermissions = Record<string, PermissionScope>;

/** The only scopes the four agents need on the claude-code path. */
const REQUIRED_WRITE_SCOPES = ['contents', 'pull-requests', 'issues', 'id-token'] as const;

/** Canonical least-privilege descriptor for the claude-code-action job. */
export const CLAUDE_CODE_JOB_PERMISSIONS: JobPermissions = {
  contents: 'write',
  'pull-requests': 'write',
  issues: 'write',
  'id-token': 'write',
};

/**
 * Fail-closed check that a permissions map is least-privilege for this path:
 *
 * - the four required scopes are present and set to `write`;
 * - no other scope is granted `read` or `write` (only an explicit `none` is
 *   tolerated — it is equivalent to omission and keeps generated workflows
 *   self-documenting);
 * - the `write-all` blanket grant is rejected outright.
 */
export function assertLeastPrivilege(permissions: JobPermissions): void {
  const fail = (reason: string): never => {
    throw new Error(`least-privilege violation: ${reason}`);
  };

  if ('write-all' in permissions || 'read-all' in permissions) {
    fail('blanket grant (write-all / read-all) is forbidden for the claude-code job');
  }

  for (const scope of REQUIRED_WRITE_SCOPES) {
    if (permissions[scope] !== 'write') {
      fail(`required scope "${scope}" must be "write" (got "${permissions[scope] ?? 'missing'}")`);
    }
  }

  for (const [scope, level] of Object.entries(permissions)) {
    if ((REQUIRED_WRITE_SCOPES as readonly string[]).includes(scope)) continue;
    if (level !== 'none') {
      fail(
        `scope "${scope}: ${level}" exceeds least privilege (only contents / pull-requests / issues may be granted)`,
      );
    }
  }
}

/**
 * Render a GitHub Actions `permissions:` block. Scopes set to `none` are
 * omitted (equivalent to not granting them). Output is deterministic — keys
 * follow `REQUIRED_WRITE_SCOPES` order, then any remaining granted scopes
 * sorted, so generated workflows diff cleanly.
 */
export function renderPermissionsYaml(permissions: JobPermissions): string {
  const granted = Object.entries(permissions).filter(([, level]) => level !== 'none');
  const ordered = [
    ...REQUIRED_WRITE_SCOPES.filter((s) => granted.some(([k]) => k === s)).map(
      (s) => [s, permissions[s]] as const,
    ),
    ...granted
      .filter(([k]) => !(REQUIRED_WRITE_SCOPES as readonly string[]).includes(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  ];
  return ['permissions:', ...ordered.map(([scope, level]) => `  ${scope}: ${level}`)].join('\n');
}
