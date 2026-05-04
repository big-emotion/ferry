import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
  execSync: vi.fn(),
}));

import { detectInstalledVersion, computeWorkflowChanges } from './detect.js';
import { getRelevantMigrations } from './migrations.js';
import { workflowTemplates } from '../init/templates.js';

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ferry-update-test-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function spawnOk(stdout = ''): ReturnType<typeof mockSpawnSync> {
  return { stdout, stderr: '', status: 0, error: null };
}

// ── detectInstalledVersion ────────────────────────────────────────────────────

describe('detectInstalledVersion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns undefined when no workflow files exist', () => {
    const dir = makeTempRepo();
    expect(detectInstalledVersion(dir)).toBeUndefined();
    cleanup(dir);
  });

  it('detects version from ferry-refine.yml', () => {
    const dir = makeTempRepo();
    const content = `jobs:
  refine:
    uses: big-emotion/ferry/.github/workflows/refine.yml@v0.3.0
    secrets: inherit
`;
    writeFileSync(join(dir, '.github', 'workflows', 'ferry-refine.yml'), content, 'utf8');
    expect(detectInstalledVersion(dir)).toBe('v0.3.0');
    cleanup(dir);
  });

  it('falls back to ferry-dev.yml when refine is missing', () => {
    const dir = makeTempRepo();
    const content = `jobs:
  dev:
    uses: big-emotion/ferry/.github/workflows/dev.yml@v0.2.5
    secrets: inherit
`;
    writeFileSync(join(dir, '.github', 'workflows', 'ferry-dev.yml'), content, 'utf8');
    expect(detectInstalledVersion(dir)).toBe('v0.2.5');
    cleanup(dir);
  });

  it('returns undefined when workflow file has no uses line', () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.github', 'workflows', 'ferry-refine.yml'),
      'name: Ferry — Refine\non:\n  workflow_dispatch: {}\n',
      'utf8',
    );
    expect(detectInstalledVersion(dir)).toBeUndefined();
    cleanup(dir);
  });
});

// ── computeWorkflowChanges ────────────────────────────────────────────────────

describe('computeWorkflowChanges', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSpawnSync.mockReturnValue(spawnOk('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new\n'));
  });

  it('marks all files as added when none exist', () => {
    const dir = makeTempRepo();
    const changes = computeWorkflowChanges(dir, 'v0.3.1');
    expect(changes.every((c) => c.status === 'added')).toBe(true);
    cleanup(dir);
  });

  it('marks file as unchanged when content matches', () => {
    const dir = makeTempRepo();
    const templates = workflowTemplates('v0.3.1');
    const tmpl = templates[0]!;
    writeFileSync(join(dir, '.github', 'workflows', tmpl.filename), tmpl.content, 'utf8');

    const changes = computeWorkflowChanges(dir, 'v0.3.1');
    const change = changes.find((c) => c.filename === tmpl.filename);
    expect(change?.status).toBe('unchanged');
    expect(change?.diff).toBe('');
    cleanup(dir);
  });

  it('marks file as updated when content differs', () => {
    const dir = makeTempRepo();
    const templates = workflowTemplates('v0.3.1');
    const tmpl = templates[0]!;
    writeFileSync(
      join(dir, '.github', 'workflows', tmpl.filename),
      'old content that differs\n',
      'utf8',
    );

    const changes = computeWorkflowChanges(dir, 'v0.3.1');
    const change = changes.find((c) => c.filename === tmpl.filename);
    expect(change?.status).toBe('updated');
    cleanup(dir);
  });

  it('handles partial install — some files present, some missing', () => {
    const dir = makeTempRepo();
    const templates = workflowTemplates('v0.3.1');
    // Install only the first template with matching content (unchanged)
    const first = templates[0]!;
    writeFileSync(join(dir, '.github', 'workflows', first.filename), first.content, 'utf8');

    const changes = computeWorkflowChanges(dir, 'v0.3.1');
    const unchanged = changes.filter((c) => c.status === 'unchanged');
    const added = changes.filter((c) => c.status === 'added');

    expect(unchanged).toHaveLength(1);
    expect(added).toHaveLength(templates.length - 1);
    cleanup(dir);
  });

  it('no-op update returns all unchanged when all files match', () => {
    const dir = makeTempRepo();
    const templates = workflowTemplates('v0.3.1');
    for (const tmpl of templates) {
      writeFileSync(join(dir, '.github', 'workflows', tmpl.filename), tmpl.content, 'utf8');
    }

    const changes = computeWorkflowChanges(dir, 'v0.3.1');
    expect(changes.every((c) => c.status === 'unchanged')).toBe(true);
    cleanup(dir);
  });
});

// ── getRelevantMigrations ─────────────────────────────────────────────────────

describe('getRelevantMigrations', () => {
  it('returns empty array when the target version is below all migration targets', () => {
    // v0.3.1 is below every keyTo in MIGRATIONS.md, so nothing applies.
    expect(getRelevantMigrations('v0.3.0', 'v0.3.1')).toEqual([]);
  });

  it('handles v prefix stripping', () => {
    expect(getRelevantMigrations('0.3.0', '0.3.1')).toEqual([]);
  });

  it('returns no notes when already at the target version (same from/to)', () => {
    expect(getRelevantMigrations('v0.5.3', 'v0.5.3')).toEqual([]);
  });

  // Regression: v0.3.0 → v0.5.4 must surface the FERRY_ANTHROPIC_API_KEY rename action.
  it('includes the ANTHROPIC_API_KEY rename action for v0.3.0 → v0.5.4', () => {
    const notes = getRelevantMigrations('v0.3.0', 'v0.5.4');
    const actions = notes.filter((n) => n.kind === 'action');
    expect(actions.some((n) => n.message.includes('ANTHROPIC_API_KEY'))).toBe(true);
  });

  // Regression: v0.5.2 → v0.5.3 is a patch; no consumer actions required.
  it('returns no action notes for the v0.5.2 → v0.5.3 patch upgrade', () => {
    const notes = getRelevantMigrations('v0.5.2', 'v0.5.3');
    expect(notes.filter((n) => n.kind === 'action')).toHaveLength(0);
  });

  it('includes info notes for v0.5.2 → v0.5.3', () => {
    const notes = getRelevantMigrations('v0.5.2', 'v0.5.3');
    expect(notes.filter((n) => n.kind === 'info').length).toBeGreaterThan(0);
  });
});
