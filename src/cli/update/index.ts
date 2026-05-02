#!/usr/bin/env node
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { confirm, closePrompt, print, printStep, printSuccess, printError, printWarn, printSkip } from '../init/prompt.js';
import { workflowTemplates } from '../init/templates.js';
import { detectInstalledVersion, computeWorkflowChanges } from './detect.js';
import { getRelevantMigrations } from './migrations.js';
import type { UpdateConfig } from './types.js';

const _require = createRequire(import.meta.url);

function packageVersion(): string {
  try {
    const pkg = _require('../../../package.json') as { version: string };
    return `v${pkg.version}`;
  } catch {
    return 'v0.0.0';
  }
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function parseArgs(argv: string[]): UpdateConfig {
  return {
    repoRoot: getArg(argv, '--repo-root') ?? process.cwd(),
    fromVersion: getArg(argv, '--from') ?? '',
    toVersion: getArg(argv, '--to') ?? packageVersion(),
    dryRun: hasFlag(argv, '--dry-run'),
    yes: hasFlag(argv, '--yes'),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    process.stdout.write(`ferry-update — bump Ferry workflow files to a newer version

Usage:
  npx -p @big-emotion/ferry@<new-version> ferry-update [options]

Options:
  --to <version>       Target version (default: running package version)
  --from <version>     Override autodetected current version
  --dry-run            Print diff, write nothing
  --yes                Skip confirmation prompt
  --repo-root <path>   Path to the consumer repo root (default: cwd)
  -h, --help           Show this help

What is updated:
  • .github/workflows/ferry-*.yml — re-rendered from templates at the new version
  • Missing workflow files are added

What is NOT touched:
  • GitHub repo secrets (already set; ferry-update never re-prompts for creds)
  • FERRY_AUDIT_ISSUE repo variable
  • Jira Automation rules (consumer-side, manual)
  • GitHub App installation

Exit code: 0 on success, 1 on error.
`);
    process.exit(0);
  }

  const config = parseArgs(argv);

  print('');
  print('╔════════════════════════════════════════╗');
  print('║         ferry-update                   ║');
  print('║  Upgrade Ferry workflow files          ║');
  print('╚════════════════════════════════════════╝');
  print('');

  // ── Detect current version ────────────────────────────────────────────────
  printStep(1, 3, 'Detecting installed version');
  const detected = config.fromVersion || detectInstalledVersion(config.repoRoot);
  if (!detected) {
    printError(
      'Could not detect installed Ferry version. ' +
        'No ferry-*.yml workflow files found in .github/workflows/. ' +
        'Run ferry-init first, or pass --from <version> to override.',
    );
    closePrompt();
    process.exit(1);
  }
  const fromVersion = config.fromVersion || detected;
  const toVersion = config.toVersion;
  print(`  From: ${fromVersion}  →  To: ${toVersion}`);

  if (fromVersion === toVersion) {
    printSkip(`Already at ${toVersion} — nothing to do.`);
    closePrompt();
    process.exit(0);
  }

  // ── Compute changes ───────────────────────────────────────────────────────
  printStep(2, 3, 'Computing changes');
  const changes = computeWorkflowChanges(config.repoRoot, toVersion);
  const toUpdate = changes.filter((c) => c.status === 'updated');
  const toAdd = changes.filter((c) => c.status === 'added');
  const unchanged = changes.filter((c) => c.status === 'unchanged');

  if (toUpdate.length === 0 && toAdd.length === 0) {
    printSkip('All workflow files already match the target version — nothing to do.');
    closePrompt();
    process.exit(0);
  }

  print('');
  if (toUpdate.length > 0) {
    print(`  Files to update (${toUpdate.length}):`);
    for (const c of toUpdate) {
      print(`    • ${c.filename}`);
    }
  }
  if (toAdd.length > 0) {
    print(`  Files to add (${toAdd.length}):`);
    for (const c of toAdd) {
      print(`    • ${c.filename}`);
    }
  }
  if (unchanged.length > 0) {
    print(`  Unchanged (${unchanged.length}): ${unchanged.map((c) => c.filename).join(', ')}`);
  }

  // Print diffs
  const changed = [...toUpdate, ...toAdd];
  if (changed.length > 0) {
    print('');
    print('─── Unified diff ───────────────────────────────────────────────────');
    for (const c of changed) {
      if (c.diff) {
        print(c.diff);
      }
    }
    print('────────────────────────────────────────────────────────────────────');
  }

  if (config.dryRun) {
    print('');
    print('Dry-run mode — no changes written.');
    closePrompt();
    process.exit(0);
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  if (!config.yes) {
    print('');
    const ok = await confirm(
      `Apply ${toUpdate.length + toAdd.length} file change(s) to .github/workflows/?`,
      true,
    );
    if (!ok) {
      print('Aborted.');
      closePrompt();
      process.exit(0);
    }
  }

  closePrompt();

  // ── Apply ─────────────────────────────────────────────────────────────────
  printStep(3, 3, 'Applying changes');
  const workflowDir = join(config.repoRoot, '.github', 'workflows');
  const templates = workflowTemplates(toVersion);

  let errors = 0;
  for (const tmpl of templates) {
    const c = changes.find((x) => x.filename === tmpl.filename);
    if (!c || c.status === 'unchanged') continue;
    try {
      const dest = join(workflowDir, tmpl.filename);
      writeFileSync(dest, tmpl.content, 'utf8');
      printSuccess(
        c.status === 'added' ? `Added ${tmpl.filename}` : `Updated ${tmpl.filename}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(`Failed to write ${tmpl.filename}: ${msg}`);
      errors++;
    }
  }

  // ── Migration notes ───────────────────────────────────────────────────────
  const migrations = getRelevantMigrations(fromVersion, toVersion);
  if (migrations.length > 0) {
    print('');
    print('════════════════════════════════════════');
    print('  Manual follow-ups required');
    print('════════════════════════════════════════');
    for (const note of migrations) {
      const prefix = note.kind === 'action' ? '  [action] ' : '  [info]   ';
      print(`${prefix}${note.message}`);
    }
    print('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  print('');
  if (errors > 0) {
    printWarn(`${errors} error(s) — review output above.`);
    process.exit(1);
  }

  printSuccess(`Upgraded ${fromVersion} → ${toVersion}.`);
  print('');
  print('Next steps:');
  print('  1. Review git diff in .github/workflows/');
  print('  2. Commit and push — the new pinned version takes effect on the next workflow run');
  if (migrations.length === 0) {
    print('  3. No manual follow-ups required for this upgrade');
  }
  print('');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  printError(`Unexpected error: ${msg}`);
  process.exit(1);
});
