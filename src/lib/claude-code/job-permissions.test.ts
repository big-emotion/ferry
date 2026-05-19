import { describe, it, expect } from 'vitest';
import {
  CLAUDE_CODE_JOB_PERMISSIONS,
  assertLeastPrivilege,
  renderPermissionsYaml,
  type JobPermissions,
} from './job-permissions.js';

describe('CLAUDE_CODE_JOB_PERMISSIONS', () => {
  it('grants exactly the three scopes the agents need, all write', () => {
    expect(CLAUDE_CODE_JOB_PERMISSIONS).toEqual({
      contents: 'write',
      'pull-requests': 'write',
      issues: 'write',
    });
  });

  it('never grants id-token / actions / packages / workflows', () => {
    expect(CLAUDE_CODE_JOB_PERMISSIONS).not.toHaveProperty('id-token');
    expect(CLAUDE_CODE_JOB_PERMISSIONS).not.toHaveProperty('actions');
    expect(CLAUDE_CODE_JOB_PERMISSIONS).not.toHaveProperty('packages');
    expect(CLAUDE_CODE_JOB_PERMISSIONS).not.toHaveProperty('workflows');
  });
});

describe('assertLeastPrivilege', () => {
  it('passes for the canonical descriptor', () => {
    expect(() => assertLeastPrivilege(CLAUDE_CODE_JOB_PERMISSIONS)).not.toThrow();
  });

  it('throws when a required scope is missing', () => {
    expect(() =>
      assertLeastPrivilege({ 'pull-requests': 'write', issues: 'write' } as JobPermissions),
    ).toThrow(/least-privilege/i);
  });

  it('throws when a required scope is not write', () => {
    expect(() =>
      assertLeastPrivilege({
        contents: 'read',
        'pull-requests': 'write',
        issues: 'write',
      }),
    ).toThrow(/least-privilege/i);
  });

  it('throws on id-token: write (OIDC escalation)', () => {
    expect(() =>
      assertLeastPrivilege({
        ...CLAUDE_CODE_JOB_PERMISSIONS,
        'id-token': 'write',
      }),
    ).toThrow(/least-privilege/i);
  });

  it('throws on any extra write scope (actions:write)', () => {
    expect(() =>
      assertLeastPrivilege({ ...CLAUDE_CODE_JOB_PERMISSIONS, actions: 'write' }),
    ).toThrow(/least-privilege/i);
  });

  it('throws on the write-all blanket grant', () => {
    expect(() => assertLeastPrivilege({ 'write-all': 'write' } as JobPermissions)).toThrow(
      /least-privilege/i,
    );
  });

  it('tolerates an explicit none on an extra scope', () => {
    expect(() =>
      assertLeastPrivilege({ ...CLAUDE_CODE_JOB_PERMISSIONS, actions: 'none' }),
    ).not.toThrow();
  });
});

describe('renderPermissionsYaml', () => {
  it('renders a permissions: block with each scope indented', () => {
    const yaml = renderPermissionsYaml(CLAUDE_CODE_JOB_PERMISSIONS);
    expect(yaml).toContain('permissions:');
    expect(yaml).toContain('  contents: write');
    expect(yaml).toContain('  pull-requests: write');
    expect(yaml).toContain('  issues: write');
  });

  it('omits scopes explicitly set to none', () => {
    const yaml = renderPermissionsYaml({ ...CLAUDE_CODE_JOB_PERMISSIONS, actions: 'none' });
    expect(yaml).not.toContain('actions');
  });

  it('is deterministic', () => {
    expect(renderPermissionsYaml(CLAUDE_CODE_JOB_PERMISSIONS)).toBe(
      renderPermissionsYaml(CLAUDE_CODE_JOB_PERMISSIONS),
    );
  });
});
