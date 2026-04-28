/**
 * Policy: Ferry never merges PRs (FR39). Provides a static-analysis scan that
 * walks `src/` and reports any `octokit.pulls.merge` (or equivalent) call.
 *
 * Used both by the unit test and by the eslint companion check. We rely on a
 * regex match because the symbol must literally appear; we are not parsing
 * arbitrary expressions.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const MERGE_CALL_RE = /\b(?:octokit|gh|github|api)\.(?:rest\.)?pulls\.merge\s*\(/;

export interface MergeOffender {
  file: string;
  line: number;
  preview: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
      yield p;
    }
  }
}

function detectInString(s: string): MergeOffender[] {
  const out: MergeOffender[] = [];
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (MERGE_CALL_RE.test(lines[i])) {
      out.push({ file: '<inline>', line: i + 1, preview: lines[i].trim() });
    }
  }
  return out;
}

interface ScanForMergeCalls {
  (rootDir: string): Promise<MergeOffender[]>;
  detectInString: (s: string) => MergeOffender[];
}

const impl = async (rootDir: string): Promise<MergeOffender[]> => {
  const offenders: MergeOffender[] = [];
  for await (const file of walk(rootDir)) {
    // Skip this module and its test; the test file contains a literal snippet
    // (`octokit.pulls.merge({ pull_number: 1 });`) that would self-match. The
    // policy module itself only contains the escaped regex `\.merge`, which does
    // not match the detector's own pattern, but is skipped for symmetry.
    if (file.endsWith('no-auto-merge.ts') || file.endsWith('no-auto-merge.test.ts')) {
      continue;
    }
    const text = await fs.readFile(file, 'utf8');
    for (const o of detectInString(text)) {
      offenders.push({ ...o, file });
    }
  }
  return offenders;
};

export const scanForMergeCalls: ScanForMergeCalls = Object.assign(impl, {
  detectInString,
});
