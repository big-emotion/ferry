import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { workflowTemplates } from '../init/templates.js';
import { applyLocalOverrides, type LocalOverrides } from './local-overrides.js';
import type { WorkflowChange } from './types.js';

const FERRY_WORKFLOW_PATTERN = /uses:\s+big-emotion\/ferry\/.+@(v[\w.-]+)/;

/**
 * Detect the currently pinned Ferry version from workflow files.
 * Returns undefined if no workflow file exists or the pattern is not found.
 */
export function detectInstalledVersion(repoRoot: string): string | undefined {
  const workflowDir = join(repoRoot, '.github', 'workflows');

  for (const candidate of [
    'ferry-refine.yml',
    'ferry-dev.yml',
    'ferry-review.yml',
    'ferry-iterate.yml',
  ]) {
    const filePath = join(workflowDir, candidate);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(FERRY_WORKFLOW_PATTERN);
    if (match?.[1]) return match[1];
  }

  return undefined;
}

/**
 * Compute what changes applying `toVersion` templates would make.
 * Returns one entry per workflow template file.
 *
 * When `overrides` is provided the templates are post-processed with
 * `applyLocalOverrides` before comparison, so the diff reflects only
 * upstream changes (not the overlay itself).
 */
export function computeWorkflowChanges(
  repoRoot: string,
  toVersion: string,
  overrides?: LocalOverrides,
): WorkflowChange[] {
  const workflowDir = join(repoRoot, '.github', 'workflows');
  const base = workflowTemplates(toVersion);
  const templates = overrides ? applyLocalOverrides(base, overrides) : base;
  const changes: WorkflowChange[] = [];

  for (const tmpl of templates) {
    const filePath = join(workflowDir, tmpl.filename);

    if (!existsSync(filePath)) {
      changes.push({ filename: tmpl.filename, status: 'added', diff: tmpl.content });
      continue;
    }

    const existing = readFileSync(filePath, 'utf8');
    if (existing === tmpl.content) {
      changes.push({ filename: tmpl.filename, status: 'unchanged', diff: '' });
      continue;
    }

    const diff = computeUnifiedDiff(tmpl.filename, existing, tmpl.content);
    changes.push({ filename: tmpl.filename, status: 'updated', diff });
  }

  return changes;
}

function computeUnifiedDiff(filename: string, oldContent: string, newContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ferry-diff-'));
  const oldFile = join(dir, `old-${filename}`);
  const newFile = join(dir, `new-${filename}`);

  try {
    writeFileSync(oldFile, oldContent, 'utf8');
    writeFileSync(newFile, newContent, 'utf8');

    const result = spawnSync(
      'diff',
      ['-u', `--label=a/${filename}`, `--label=b/${filename}`, oldFile, newFile],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // diff exits 1 when files differ (normal), 2 on error
    if (result.status === 2 || result.error) {
      return `--- a/${filename}\n+++ b/${filename}\n(diff unavailable)\n`;
    }

    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
