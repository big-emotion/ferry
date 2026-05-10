import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckResult } from '../types.js';

const LABEL = 'Audit log file';
const REMEDY =
  'Ferry writes ferry-audit.jsonl when the audit issue comment export is synced locally. Run the cost report after at least one agent has completed a run.';

export function checkAuditLog(repoRoot: string): CheckResult {
  const filePath = resolve(repoRoot, 'ferry-audit.jsonl');

  if (!existsSync(filePath)) {
    return {
      label: LABEL,
      status: 'red',
      detail: 'ferry-audit.jsonl not found in repo root',
      remedy: REMEDY,
    };
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      label: LABEL,
      status: 'red',
      detail: 'ferry-audit.jsonl is empty',
      remedy: REMEDY,
    };
  }

  if (lines.length < 5) {
    return {
      label: LABEL,
      status: 'yellow',
      detail: `ferry-audit.jsonl has only ${lines.length} line(s) — cost reports may be sparse`,
      remedy: 'Wait for more agent runs to complete before running ferry-cost-report.',
    };
  }

  return {
    label: LABEL,
    status: 'green',
    detail: `ferry-audit.jsonl has ${lines.length} entries`,
  };
}
