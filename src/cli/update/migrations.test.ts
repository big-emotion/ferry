import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getRelevantMigrations,
  parseMigrationsContent,
  filterMigrationsByForge,
} from './migrations.js';
import type { ForgeKind } from '../lib/forge.js';

function writeFixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ferry-migrations-'));
  const file = join(dir, 'MIGRATIONS.md');
  writeFileSync(file, content, 'utf8');
  return file;
}

function cleanup(file: string): void {
  rmSync(file, { recursive: true, force: true, retryDelay: 50 });
}

// ── parseMigrationsContent — forge field detection ───────────────────────────

describe('parseMigrationsContent — forge field', () => {
  it('defaults forge to "both" when no annotation is present', () => {
    const md = `## v0.1.0 → v0.2.0\n- **(action)** rename ANTHROPIC_API_KEY secret\n`;
    const parsed = parseMigrationsContent(md);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.forge).toBe('both');
    expect(parsed[0]!.notes).toHaveLength(1);
  });

  it('parses `forge: github` from a line below the heading', () => {
    const md = `## v0.1.0 → v0.2.0
forge: github

- **(action)** GitHub-only action note
`;
    const parsed = parseMigrationsContent(md);
    expect(parsed[0]!.forge).toBe('github');
    expect(parsed[0]!.notes[0]!.message).toContain('GitHub-only');
  });

  it('parses `forge: gitlab`', () => {
    const md = `## v0.1.0 → v0.2.0
forge: gitlab

- **(action)** GitLab-only action note
`;
    const parsed = parseMigrationsContent(md);
    expect(parsed[0]!.forge).toBe('gitlab');
  });

  it('parses `forge: both` explicitly', () => {
    const md = `## v0.1.0 → v0.2.0
forge: both

- **(info)** applies to both
`;
    const parsed = parseMigrationsContent(md);
    expect(parsed[0]!.forge).toBe('both');
  });

  it('treats unknown forge values as "both" (backwards-compatible)', () => {
    const md = `## v0.1.0 → v0.2.0
forge: martian

- **(info)** note
`;
    const parsed = parseMigrationsContent(md);
    expect(parsed[0]!.forge).toBe('both');
  });

  it('parses `forge:` in different cases / whitespace', () => {
    const md = `## v0.1.0 → v0.2.0
  Forge:  GitLab

- **(info)** mixed case
`;
    const parsed = parseMigrationsContent(md);
    expect(parsed[0]!.forge).toBe('gitlab');
  });

  it('handles multiple sections with different forge values', () => {
    const md = `## v0.1.0 → v0.2.0
forge: github

- **(action)** github-only

## v0.2.0 → v0.3.0
forge: gitlab

- **(action)** gitlab-only

## v0.3.0 → v0.4.0

- **(info)** both (default)
`;
    const parsed = parseMigrationsContent(md);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]!.forge).toBe('github');
    expect(parsed[1]!.forge).toBe('gitlab');
    expect(parsed[2]!.forge).toBe('both');
  });
});

// ── filterMigrationsByForge ──────────────────────────────────────────────────

describe('filterMigrationsByForge', () => {
  const fixture = `## v0.1.0 → v0.2.0
forge: github

- **(action)** github only

## v0.2.0 → v0.3.0
forge: gitlab

- **(action)** gitlab only

## v0.3.0 → v0.4.0

- **(info)** applies to both
`;

  it('returns github + both entries when forge is github', () => {
    const parsed = parseMigrationsContent(fixture);
    const filtered = filterMigrationsByForge(parsed, 'github');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.keyTo)).toEqual(['v0.2.0', 'v0.4.0']);
  });

  it('returns gitlab + both entries when forge is gitlab', () => {
    const parsed = parseMigrationsContent(fixture);
    const filtered = filterMigrationsByForge(parsed, 'gitlab');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.keyTo)).toEqual(['v0.3.0', 'v0.4.0']);
  });

  it('returns all entries when forge is unspecified (undefined)', () => {
    const parsed = parseMigrationsContent(fixture);
    const filtered = filterMigrationsByForge(parsed, undefined);
    expect(filtered).toHaveLength(3);
  });
});

// ── getRelevantMigrations — forge filter integration ─────────────────────────

describe('getRelevantMigrations — forge filtering', () => {
  it('filters out gitlab-only notes when forge=github', () => {
    const file = writeFixture(`## v0.1.0 → v0.2.0
forge: github

- **(action)** github action

## v0.1.0 → v0.2.0
forge: gitlab

- **(action)** gitlab action
`);
    const notes = getRelevantMigrations('v0.1.0', 'v0.2.0', {
      migrationsPath: file,
      forge: 'github' as ForgeKind,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message).toContain('github action');
    cleanup(file);
  });

  it('filters out github-only notes when forge=gitlab', () => {
    const file = writeFixture(`## v0.1.0 → v0.2.0
forge: github

- **(action)** github action

## v0.1.0 → v0.2.0
forge: gitlab

- **(action)** gitlab action
`);
    const notes = getRelevantMigrations('v0.1.0', 'v0.2.0', {
      migrationsPath: file,
      forge: 'gitlab' as ForgeKind,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message).toContain('gitlab action');
    cleanup(file);
  });

  it('preserves backwards compatibility: undefined forge returns everything', () => {
    const file = writeFixture(`## v0.1.0 → v0.2.0
forge: github

- **(action)** github action

## v0.1.0 → v0.2.0
forge: gitlab

- **(action)** gitlab action

## v0.1.0 → v0.2.0

- **(info)** both
`);
    const notes = getRelevantMigrations('v0.1.0', 'v0.2.0', { migrationsPath: file });
    expect(notes).toHaveLength(3);
    cleanup(file);
  });

  it('positional API (no options) still works (back-compat)', () => {
    const file = writeFixture(`## v0.1.0 → v0.2.0

- **(action)** legacy entry
`);
    // The legacy 2-arg call shape must still resolve via the package's
    // own MIGRATIONS.md — we just verify the call typechecks and returns an
    // array (the package MIGRATIONS.md has no v0.1.0 → v0.2.0 entry so the
    // result will be empty, but that's still backwards-compatible).
    cleanup(file);
    const notes = getRelevantMigrations('v9.0.0', 'v9.0.1');
    expect(Array.isArray(notes)).toBe(true);
  });
});
