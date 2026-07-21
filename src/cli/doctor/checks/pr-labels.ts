import { execSync } from 'node:child_process';
import type { CheckResult } from '../types.js';
import { FERRY_PR_LABELS } from '../../init/steps/pr-labels.js';

const LABEL = 'PR labels';

/** Returns null when the label list is unreadable (no `gh`, no auth, no repo). */
function readLabels(repo: string): string[] | null {
  try {
    const output = execSync(`gh label list --repo ${repo} --limit 200 --json name`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (JSON.parse(output) as Array<{ name: string }>).map((l) => l.name);
  } catch {
    return null;
  }
}

/**
 * Ferry's agents surface PR state through labels rather than through a CI gate,
 * so a repo missing them loses that signal — every `gh pr edit --add-label`
 * fails silently (labelling is best-effort by design). Never red: a missing
 * label degrades visibility, it does not stop the pipeline.
 */
export function checkPrLabels(
  opts: { repo: string },
  _readLabels: (repo: string) => string[] | null = readLabels,
): CheckResult {
  const existing = _readLabels(opts.repo);
  if (existing === null) {
    return {
      label: LABEL,
      status: 'yellow',
      detail: `Could not read labels for ${opts.repo} — is gh authenticated?`,
      remedy: 'Run: gh auth login',
    };
  }

  const present = new Set(existing.map((n) => n.toLowerCase()));
  const missing = FERRY_PR_LABELS.filter((l) => !present.has(l.name.toLowerCase()));

  if (missing.length === 0) {
    return {
      label: LABEL,
      status: 'green',
      detail: `All ${FERRY_PR_LABELS.length} Ferry PR labels present`,
    };
  }

  return {
    label: LABEL,
    status: 'yellow',
    detail: `Missing: ${missing.map((l) => l.name).join(', ')}. Agents label PRs best-effort, so these calls will fail and PR state will be invisible.`,
    remedy: missing
      .map(
        (l) =>
          `gh label create ${l.name} --repo ${opts.repo} --color ${l.color} --description ${JSON.stringify(l.description)}`,
      )
      .join('\n'),
  };
}
