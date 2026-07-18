import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
  execSync: vi.fn(),
}));

import {
  detectInstalledVersion,
  detectWorkflowModel,
  templatesForModel,
  computeWorkflowChanges,
} from './detect.js';
import { applyLocalOverrides } from './local-overrides.js';
import { getRelevantMigrations } from './migrations.js';
import { workflowTemplates, routerWorkflowTemplate } from '../init/templates.js';

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

  it('detects version from a router-only repo', () => {
    const dir = makeTempRepo();
    const router = routerWorkflowTemplate('v0.6.0');
    writeFileSync(join(dir, '.github', 'workflows', router.filename), router.content, 'utf8');
    expect(detectInstalledVersion(dir)).toBe('v0.6.0');
    cleanup(dir);
  });

  it('prefers the router pin over stale legacy stubs on a mid-migration repo', () => {
    const dir = makeTempRepo();
    const router = routerWorkflowTemplate('v0.7.0');
    writeFileSync(join(dir, '.github', 'workflows', router.filename), router.content, 'utf8');
    writeFileSync(
      join(dir, '.github', 'workflows', 'ferry-refine.yml'),
      'jobs:\n  refine:\n    uses: big-emotion/ferry/.github/workflows/refine.yml@v0.6.0\n',
      'utf8',
    );
    expect(detectInstalledVersion(dir)).toBe('v0.7.0');
    cleanup(dir);
  });
});

// ── detectWorkflowModel / templatesForModel ───────────────────────────────────

describe('detectWorkflowModel', () => {
  it('returns router when only ferry-router.yml exists', () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, '.github', 'workflows', 'ferry-router.yml'), 'name: r\n', 'utf8');
    expect(detectWorkflowModel(dir)).toBe('router');
    cleanup(dir);
  });

  it('returns legacy when only per-agent stubs exist', () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, '.github', 'workflows', 'ferry-refine.yml'), 'name: r\n', 'utf8');
    expect(detectWorkflowModel(dir)).toBe('legacy');
    cleanup(dir);
  });

  it('returns legacy when no workflow files exist (fresh repo defaults to the full set)', () => {
    const dir = makeTempRepo();
    expect(detectWorkflowModel(dir)).toBe('legacy');
    cleanup(dir);
  });

  it('returns mixed when the router and any legacy stub coexist', () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, '.github', 'workflows', 'ferry-router.yml'), 'name: r\n', 'utf8');
    writeFileSync(join(dir, '.github', 'workflows', 'ferry-merge.yml'), 'name: m\n', 'utf8');
    expect(detectWorkflowModel(dir)).toBe('mixed');
    cleanup(dir);
  });
});

describe('templatesForModel', () => {
  it('returns only the router template for the router model', () => {
    const entries = templatesForModel('router', 'v0.6.0');
    expect(entries.map((e) => e.filename)).toEqual(['ferry-router.yml']);
    expect(entries[0]!.content).toBe(routerWorkflowTemplate('v0.6.0').content);
  });

  it('returns the legacy per-agent set only for the legacy model', () => {
    const legacyNames = workflowTemplates('v0.6.0').map((e) => e.filename);
    expect(templatesForModel('legacy', 'v0.6.0').map((e) => e.filename)).toEqual(legacyNames);
    expect(legacyNames).not.toContain('ferry-router.yml');
  });

  it('manages mixed repos as router installs — deleted legacy stubs are never regenerated', () => {
    // Recreating removed stubs would resurrect the per-agent model mid-migration.
    expect(templatesForModel('mixed', 'v0.6.0').map((e) => e.filename)).toEqual([
      'ferry-router.yml',
    ]);
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

  it('classifies unmanaged local workflow edits as drifted when fromVersion is provided', () => {
    const dir = makeTempRepo();
    const templates = workflowTemplates('v0.3.0');
    const tmpl = templates[0]!;
    writeFileSync(
      join(dir, '.github', 'workflows', tmpl.filename),
      `${tmpl.content}\n# local unmanaged edit\n`,
      'utf8',
    );

    const changes = computeWorkflowChanges(dir, 'v0.3.1', { fromVersion: 'v0.3.0' });
    const change = changes.find((c) => c.filename === tmpl.filename);
    expect(change?.status).toBe('drifted');
    cleanup(dir);
  });

  it('upgrades only ferry-router.yml on a router-model repo', () => {
    const dir = makeTempRepo();
    const router = routerWorkflowTemplate('v0.3.0');
    writeFileSync(join(dir, '.github', 'workflows', router.filename), router.content, 'utf8');

    const changes = computeWorkflowChanges(dir, 'v0.3.1');
    expect(changes.map((c) => c.filename)).toEqual(['ferry-router.yml']);
    expect(changes[0]!.status).toBe('updated');
    cleanup(dir);
  });

  it('reports ferry-router.yml unchanged when it already matches the target version', () => {
    const dir = makeTempRepo();
    const router = routerWorkflowTemplate('v0.3.1');
    writeFileSync(join(dir, '.github', 'workflows', router.filename), router.content, 'utf8');

    const changes = computeWorkflowChanges(dir, 'v0.3.1');
    expect(changes).toEqual([{ filename: 'ferry-router.yml', status: 'unchanged', diff: '' }]);
    cleanup(dir);
  });

  it('classifies router drift against the fromVersion baseline', () => {
    const dir = makeTempRepo();
    const router = routerWorkflowTemplate('v0.3.0');
    writeFileSync(
      join(dir, '.github', 'workflows', router.filename),
      `${router.content}\n# local unmanaged edit\n`,
      'utf8',
    );

    const changes = computeWorkflowChanges(dir, 'v0.3.1', { fromVersion: 'v0.3.0' });
    expect(changes.find((c) => c.filename === 'ferry-router.yml')?.status).toBe('drifted');
    cleanup(dir);
  });

  it('upgrades only the router on a mixed repo — leftover legacy stubs are untouched', () => {
    const dir = makeTempRepo();
    const router = routerWorkflowTemplate('v0.3.0');
    writeFileSync(join(dir, '.github', 'workflows', router.filename), router.content, 'utf8');
    const legacy = workflowTemplates('v0.3.0');
    writeFileSync(
      join(dir, '.github', 'workflows', legacy[0]!.filename),
      legacy[0]!.content,
      'utf8',
    );

    const changes = computeWorkflowChanges(dir, 'v0.3.1', { fromVersion: 'v0.3.0' });
    expect(changes.map((c) => c.filename)).toEqual(['ferry-router.yml']);
    expect(changes[0]!.status).toBe('updated');
    // The leftover stub is neither upgraded nor recreated — removing it is the
    // consumer's migration step, surfaced as a follow-up.
    cleanup(dir);
  });

  it('does not mark a supported ferry.local.yml overlay as drift', () => {
    const dir = makeTempRepo();
    const baseline = applyLocalOverrides(workflowTemplates('v0.3.0'), {
      global: { runner: 'self-hosted' },
    });
    const tmpl = baseline[0]!;
    writeFileSync(join(dir, '.github', 'workflows', tmpl.filename), tmpl.content, 'utf8');

    const changes = computeWorkflowChanges(dir, 'v0.3.1', {
      fromVersion: 'v0.3.0',
      overrides: { global: { runner: 'self-hosted' } },
    });
    const change = changes.find((c) => c.filename === tmpl.filename);
    expect(change?.status).toBe('updated');
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
