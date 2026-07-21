import { execSync } from 'node:child_process';
import { printSuccess, printSkip, printError } from '../prompt.js';
import type { StepResult } from '../types.js';

export interface PrLabel {
  name: string;
  color: string;
  description: string;
}

/**
 * The PR labels Ferry's agents read and write. The Developer, Reviewer, and
 * Iterator all run regardless of CI status, so the pipeline's true state
 * travels on the PR as labels rather than as a gate — these must exist before
 * the first agent run or every `gh pr edit --add-label` fails.
 */
export const FERRY_PR_LABELS: readonly PrLabel[] = [
  { name: 'ready-for-review', color: '0e8a16', description: 'Ferry: developer opened this PR' },
  { name: 'needs-rereview', color: 'fbca04', description: 'Ferry: iterator pushed review fixes' },
  { name: 'approved', color: '0e8a16', description: 'Ferry: reviewer approved — merger may land' },
  {
    name: 'changes-requested',
    color: 'd93f0b',
    description: 'Ferry: reviewer requested changes',
  },
  { name: 'ci-green', color: '0e8a16', description: 'Ferry: required checks passed' },
  { name: 'ci-failing', color: 'd93f0b', description: 'Ferry: checks red, pending, or absent' },
];

export function listExistingLabels(repo: string): string[] {
  try {
    const output = execSync(`gh label list --repo ${repo} --limit 200 --json name`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (JSON.parse(output) as Array<{ name: string }>).map((l) => l.name);
  } catch {
    return [];
  }
}

export function createLabel(repo: string, name: string, color: string, description: string): void {
  execSync(
    `gh label create ${JSON.stringify(name)} --repo ${repo} --color ${color} --description ${JSON.stringify(description)}`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

export async function stepPrLabels(
  repo: string,
  _listExisting: (repo: string) => string[] = listExistingLabels,
  _create: (repo: string, name: string, color: string, description: string) => void = createLabel,
): Promise<StepResult> {
  // GitHub label names are case-insensitively unique — a repo with "Approved"
  // rejects a "approved" create, so compare folded.
  const existing = new Set(_listExisting(repo).map((n) => n.toLowerCase()));
  const failed: string[] = [];

  for (const label of FERRY_PR_LABELS) {
    if (existing.has(label.name.toLowerCase())) {
      printSkip(`Label ${label.name} already exists — skipping`);
      continue;
    }
    try {
      _create(repo, label.name, label.color, label.description);
      printSuccess(`Created label ${label.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(`Failed to create label ${label.name}: ${msg}`);
      failed.push(label.name);
    }
  }

  if (failed.length > 0) {
    return { ok: false, reason: `Failed to create labels: ${failed.join(', ')}` };
  }
  return { ok: true };
}
