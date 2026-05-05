import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Keys GitHub Actions supports on composite-action steps.
// Workflow/job-level keys such as `timeout-minutes` are NOT in this list —
// they are silently rejected at job setup time and have caused broken releases.
// https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-composite-actions
const ALLOWED_STEP_KEYS = new Set([
  'id',
  'if',
  'name',
  'uses',
  'run',
  'shell',
  'with',
  'env',
  'working-directory',
  'continue-on-error',
]);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ACTIONS_DIR = join(REPO_ROOT, '.github', 'actions');

interface StepRecord {
  label: string;
  keys: string[];
}

/**
 * Targeted structural parser for composite action YAML manifests.
 *
 * Extracts the top-level key names from each step in `runs.steps`.
 * Not a general-purpose YAML parser — assumes the indentation convention
 * used by ferry action manifests (4-space step list items, 6-space step keys,
 * 8+ space nested content such as `with:` and `env:` sub-keys).
 */
function extractCompositeStepKeys(yaml: string): StepRecord[] {
  const steps: StepRecord[] = [];
  let inSteps = false;
  let current: StepRecord | null = null;

  for (const line of yaml.split('\n')) {
    if (line === '  steps:') {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;

    // A non-blank line at ≤2-space root indent means we have left runs.steps
    if (/^  \S/.test(line)) break;

    // Start of a new step: "    - key: ..."
    const newStepMatch = line.match(/^    - ([a-zA-Z][\w-]*)\s*:/);
    if (newStepMatch) {
      if (current) steps.push(current);
      const firstKey = newStepMatch[1];
      const label =
        firstKey === 'name'
          ? (line.match(/^    - name:\s*(.+)/)?.[1]?.trim() ?? `<step ${steps.length + 1}>`)
          : `<step ${steps.length + 1}>`;
      current = { label, keys: [firstKey] };
      continue;
    }

    // Continuation key at step level (exactly 6-space indent): "      key: ..."
    const stepKeyMatch = line.match(/^      ([a-zA-Z][\w-]*)\s*:/);
    if (stepKeyMatch && current) {
      current.keys.push(stepKeyMatch[1]);
    }
  }

  if (current) steps.push(current);
  return steps;
}

describe('composite action step-key allowlist', () => {
  const actionDirs = readdirSync(ACTIONS_DIR)
    .filter((entry) => {
      try {
        return statSync(join(ACTIONS_DIR, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  it('finds all six expected action directories under .github/actions/', () => {
    const required = [
      'ferry-emit-audit',
      'ferry-envelope-validate',
      'ferry-run-developer',
      'ferry-run-iterator',
      'ferry-run-refiner',
      'ferry-run-reviewer',
    ];
    for (const name of required) {
      expect(actionDirs, `missing action directory: ${name}`).toContain(name);
    }
  });

  for (const actionName of actionDirs) {
    it(`${actionName}/action.yml — only uses allowlisted step keys`, () => {
      const content = readFileSync(join(ACTIONS_DIR, actionName, 'action.yml'), 'utf-8');

      expect(
        content,
        `${actionName}/action.yml must declare a composite action`,
      ).toContain('using: composite');

      const steps = extractCompositeStepKeys(content);
      expect(
        steps.length,
        `${actionName}/action.yml must contain at least one composite step`,
      ).toBeGreaterThan(0);

      for (const step of steps) {
        const disallowed = step.keys.filter((k) => !ALLOWED_STEP_KEYS.has(k));
        expect(
          disallowed,
          `Step "${step.label}" in ${actionName}/action.yml has disallowed key(s): ` +
            `${disallowed.join(', ')}. ` +
            `Allowed keys on composite steps: ${[...ALLOWED_STEP_KEYS].join(', ')}`,
        ).toEqual([]);
      }
    });
  }
});
