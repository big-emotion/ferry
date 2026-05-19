import { describe, it, expect } from 'vitest';
import {
  NO_AUTO_MERGE_DENY,
  buildToolPolicy,
  renderClaudeArgs,
  assertToolPolicyEnforcesNoAutoMerge,
  type AgentRole,
} from './tool-policy.js';

const ROLES: AgentRole[] = ['refiner', 'developer', 'reviewer', 'iterator'];

describe('NO_AUTO_MERGE_DENY', () => {
  it('denies gh pr merge (bare and prefixed)', () => {
    expect(NO_AUTO_MERGE_DENY).toContain('Bash(gh pr merge)');
    expect(NO_AUTO_MERGE_DENY).toContain('Bash(gh pr merge:*)');
  });

  it('denies all git push (bare and prefixed) so no protected-ref push is possible', () => {
    expect(NO_AUTO_MERGE_DENY).toContain('Bash(git push)');
    expect(NO_AUTO_MERGE_DENY).toContain('Bash(git push:*)');
  });

  it('denies gh pr close (destructive PR op adjacent to merge)', () => {
    expect(NO_AUTO_MERGE_DENY).toContain('Bash(gh pr close:*)');
  });

  it('never grants a wildcard that could re-open merge/push', () => {
    expect(NO_AUTO_MERGE_DENY).not.toContain('Bash');
    expect(NO_AUTO_MERGE_DENY).not.toContain('Bash(*)');
  });
});

describe('buildToolPolicy', () => {
  it.each(ROLES)('every role carries the no-auto-merge deny set: %s', (role) => {
    const policy = buildToolPolicy(role);
    for (const rule of NO_AUTO_MERGE_DENY) {
      expect(policy.disallowedTools).toContain(rule);
    }
  });

  it('read-only roles (refiner, reviewer) never grant Write/Edit', () => {
    for (const role of ['refiner', 'reviewer'] as AgentRole[]) {
      const policy = buildToolPolicy(role);
      expect(policy.allowedTools).not.toContain('Write');
      expect(policy.allowedTools).not.toContain('Edit');
    }
  });

  it('code roles (developer, iterator) grant Write/Edit but still deny push/merge', () => {
    for (const role of ['developer', 'iterator'] as AgentRole[]) {
      const policy = buildToolPolicy(role);
      expect(policy.allowedTools).toContain('Write');
      expect(policy.allowedTools).toContain('Edit');
      // Broad git allow is fine ONLY because deny takes precedence.
      expect(policy.disallowedTools).toContain('Bash(git push:*)');
      expect(policy.disallowedTools).toContain('Bash(gh pr merge:*)');
    }
  });

  it('no allowed rule re-grants a denied rule verbatim', () => {
    for (const role of ROLES) {
      const policy = buildToolPolicy(role);
      for (const denied of policy.disallowedTools) {
        expect(policy.allowedTools).not.toContain(denied);
      }
    }
  });
});

describe('assertToolPolicyEnforcesNoAutoMerge', () => {
  it('passes for every built policy', () => {
    for (const role of ROLES) {
      expect(() => assertToolPolicyEnforcesNoAutoMerge(buildToolPolicy(role))).not.toThrow();
    }
  });

  it('throws when the deny set is missing gh pr merge', () => {
    expect(() =>
      assertToolPolicyEnforcesNoAutoMerge({
        allowedTools: ['Read'],
        disallowedTools: ['Bash(git push:*)', 'Bash(git push)'],
      }),
    ).toThrow(/no-auto-merge/i);
  });

  it('throws when the deny set is missing git push', () => {
    expect(() =>
      assertToolPolicyEnforcesNoAutoMerge({
        allowedTools: ['Read'],
        disallowedTools: ['Bash(gh pr merge)', 'Bash(gh pr merge:*)'],
      }),
    ).toThrow(/no-auto-merge/i);
  });

  it('throws when an allowed rule re-grants a denied rule', () => {
    expect(() =>
      assertToolPolicyEnforcesNoAutoMerge({
        allowedTools: [...NO_AUTO_MERGE_DENY],
        disallowedTools: [...NO_AUTO_MERGE_DENY],
      }),
    ).toThrow(/no-auto-merge/i);
  });
});

describe('renderClaudeArgs', () => {
  it('emits both --allowedTools and --disallowedTools quoted comma-joined', () => {
    const args = renderClaudeArgs(buildToolPolicy('developer'));
    expect(args).toMatch(/--allowedTools "[^"]+"/);
    expect(args).toMatch(/--disallowedTools "[^"]+"/);
    expect(args).toContain('Bash(git push:*)');
    expect(args).toContain('Bash(gh pr merge:*)');
  });

  it('the rendered string is deterministic for a given role', () => {
    expect(renderClaudeArgs(buildToolPolicy('iterator'))).toBe(
      renderClaudeArgs(buildToolPolicy('iterator')),
    );
  });
});
