import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { printSuccess, printSkip, printWarn } from '../prompt.js';
import type { WorkflowEntry, StepResult } from '../types.js';

export function installWorkflows(
  workflowDir: string,
  templates: WorkflowEntry[],
  overwrite: boolean,
): StepResult {
  mkdirSync(workflowDir, { recursive: true });

  const skipped: string[] = [];
  const installed: string[] = [];

  for (const tmpl of templates) {
    const dest = join(workflowDir, tmpl.filename);

    if (existsSync(dest)) {
      const existing = readFileSync(dest, 'utf8');
      if (existing === tmpl.content) {
        printSkip(`${tmpl.filename} already up-to-date`);
        skipped.push(tmpl.filename);
        continue;
      }
      if (!overwrite) {
        printWarn(
          `${tmpl.filename} exists with different content — skipping (use --overwrite to replace)`,
        );
        skipped.push(tmpl.filename);
        continue;
      }
    }

    writeFileSync(dest, tmpl.content, 'utf8');
    printSuccess(`Wrote ${tmpl.filename}`);
    installed.push(tmpl.filename);
  }

  if (installed.length === 0 && skipped.length > 0) {
    return { ok: true };
  }
  return { ok: true };
}

export function scaffoldCodeowners(repoRoot: string, owner: string): StepResult {
  const codeownersPath = join(repoRoot, '.github', 'CODEOWNERS');

  if (existsSync(codeownersPath)) {
    const existing = readFileSync(codeownersPath, 'utf8');
    const ferryEntry = `.github/workflows/ferry-*.yml @${owner}`;
    if (existing.includes('ferry-')) {
      printSkip('CODEOWNERS already has ferry entries');
      return { ok: true };
    }
    writeFileSync(codeownersPath, existing.trimEnd() + '\n' + ferryEntry + '\n', 'utf8');
    printSuccess('Added ferry workflow entry to CODEOWNERS');
    return { ok: true };
  }

  const content = `# Ferry workflow files — only repo admins should modify these
.github/workflows/ferry-*.yml @${owner}
`;
  writeFileSync(codeownersPath, content, 'utf8');
  printSuccess('Created .github/CODEOWNERS');
  return { ok: true };
}
