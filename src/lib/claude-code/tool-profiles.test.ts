import { describe, it, expect } from 'vitest';
import {
  ROLE_PROMPT_NAME,
  ROLE_ACCESS,
  READ_ONLY_NATIVE_TOOLS,
  READ_WRITE_NATIVE_TOOLS,
  nativeToolsForRole,
  type FerryRole,
} from './tool-profiles.js';

const ALL_ROLES: FerryRole[] = ['refiner', 'developer', 'reviewer', 'iterator'];

describe('ROLE_PROMPT_NAME', () => {
  it('maps each role to the prompt name buildSystem() uses today', () => {
    // Verbatim reuse: these are the exact names the agent code passes to buildSystem().
    expect(ROLE_PROMPT_NAME).toEqual({
      refiner: 'refiner',
      developer: 'dev',
      reviewer: 'review',
      iterator: 'iterate',
    });
  });
});

describe('ROLE_ACCESS (parity table)', () => {
  it('marks refiner and reviewer read-only (no LLM writes)', () => {
    expect(ROLE_ACCESS.refiner).toBe('read-only');
    expect(ROLE_ACCESS.reviewer).toBe('read-only');
  });

  it('marks developer and iterator read-write', () => {
    expect(ROLE_ACCESS.developer).toBe('read-write');
    expect(ROLE_ACCESS.iterator).toBe('read-write');
  });
});

describe('nativeToolsForRole', () => {
  it('gives refiner/reviewer the read-only native tool set (no Bash/Write/Edit)', () => {
    for (const role of ['refiner', 'reviewer'] as const) {
      const tools = nativeToolsForRole(role);
      expect(tools).toEqual([...READ_ONLY_NATIVE_TOOLS]);
      expect(tools).not.toContain('Bash');
      expect(tools).not.toContain('Write');
      expect(tools).not.toContain('Edit');
    }
  });

  it('gives developer/iterator the native Bash/Read/Write/Edit/Glob/Grep set', () => {
    for (const role of ['developer', 'iterator'] as const) {
      expect(nativeToolsForRole(role)).toEqual(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
    }
  });

  it('read-only set is a strict subset of the read-write set', () => {
    for (const t of READ_ONLY_NATIVE_TOOLS) {
      expect(READ_WRITE_NATIVE_TOOLS).toContain(t);
    }
    expect(READ_WRITE_NATIVE_TOOLS.length).toBeGreaterThan(READ_ONLY_NATIVE_TOOLS.length);
  });

  it('returns a fresh array (mutating the result never leaks into the constants)', () => {
    const a = nativeToolsForRole('developer');
    a.push('Mutated');
    expect(nativeToolsForRole('developer')).not.toContain('Mutated');
  });

  it('covers every role', () => {
    for (const role of ALL_ROLES) {
      expect(nativeToolsForRole(role).length).toBeGreaterThan(0);
    }
  });

  it('throws on an unknown role (fail-closed)', () => {
    expect(() => nativeToolsForRole('hacker' as FerryRole)).toThrow(/unknown ferry role/i);
  });
});
