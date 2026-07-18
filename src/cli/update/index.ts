#!/usr/bin/env node
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  confirm,
  closePrompt,
  print,
  printStep,
  printSuccess,
  printError,
  printWarn,
  printSkip,
} from '../init/prompt.js';
import { buildManualSetupDoc, buildRouterManualSetupDoc } from '../init/steps/jira-bundle.js';
import {
  detectInstalledVersion,
  detectWorkflowModel,
  templatesForModel,
  computeWorkflowChanges,
} from './detect.js';
import { getRelevantMigrations } from './migrations.js';
import { runCredentialGate } from './credential-gate-run.js';
import { extractJiraConfigFromSetupFile } from './extract-jira-config.js';
import { resolveForgeFromArgv, type ForgeKind } from '../lib/forge.js';
import { loadLocalOverrides, applyLocalOverrides, type LocalOverrides } from './local-overrides.js';
import { rewriteGitLabVersion } from './gitlab/rewriter.js';
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

async function runGitLabUpdate(argv: string[]): Promise<void> {
  const config = parseArgs(argv);
  const repoRoot = config.repoRoot;
  const target = config.toVersion; // already v-prefixed via packageVersion() default

  print('');
  print('╔════════════════════════════════════════╗');
  print('║         ferry-update (gitlab)          ║');
  print('║  Rewrite pinned Ferry version in       ║');
  print('║  .gitlab-ci.yml + per-role includes    ║');
  print('╚════════════════════════════════════════╝');
  print('');
  print(`  Target version: ${target}`);
  print(`  Repo root:      ${repoRoot}`);
  print('');

  let result;
  try {
    result = rewriteGitLabVersion({
      repoRoot,
      toVersion: target,
      dryRun: true, // first pass: dry-run to print the diff
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`Rewriter failed: ${msg}`);
    closePrompt();
    process.exit(1);
  }

  if (result.errors.length > 0) {
    for (const e of result.errors) printError(`${e.relPath}: ${e.message}`);
    closePrompt();
    process.exit(1);
  }

  const changed = result.files.filter((f) => f.changed);

  if (result.files.length === 0) {
    printSkip(
      'No .gitlab-ci.yml files found under the repo root. ' +
        'Copy the templates from examples/consumer-setup-gitlab/ first.',
    );
    closePrompt();
    process.exit(0);
  }

  if (changed.length === 0) {
    printSkip(`All GitLab CI files already pin ${target} — nothing to do.`);
    // Still surface migration notes (idempotent informational pass).
    printGitLabMigrations('v0.0.0', target);
    closePrompt();
    process.exit(0);
  }

  print(`  Files to rewrite (${changed.length}):`);
  for (const f of changed) {
    print(`    • ${f.relPath} — ${f.replacements} replacement(s)`);
  }
  print('');
  print('─── Unified diff ───────────────────────────────────────────────────');
  for (const f of changed) {
    if (f.diff) print(f.diff);
  }
  print('────────────────────────────────────────────────────────────────────');

  if (config.dryRun) {
    print('');
    print('Dry-run mode — no changes written.');
    printGitLabMigrations('v0.0.0', target);
    closePrompt();
    process.exit(0);
  }

  if (!config.yes) {
    print('');
    const ok = await confirm(`Apply version rewrite to ${changed.length} file(s)?`, true);
    if (!ok) {
      print('Aborted.');
      closePrompt();
      process.exit(0);
    }
  }

  closePrompt();

  // Second pass: actually write files.
  const apply = rewriteGitLabVersion({ repoRoot, toVersion: target, dryRun: false });
  let errors = 0;
  for (const e of apply.errors) {
    printError(`${e.relPath}: ${e.message}`);
    errors += 1;
  }
  for (const f of apply.files) {
    if (f.changed) printSuccess(`Rewrote ${f.relPath} (${f.replacements} pin(s))`);
  }

  printGitLabMigrations('v0.0.0', target);

  if (errors > 0) {
    printWarn(`${errors} error(s) — review output above.`);
    process.exit(1);
  }

  print('');
  print(`Pinned Ferry version → ${target}.`);
  print('');
  print('Next steps:');
  print('  1. Review git diff in your .gitlab-ci.yml file(s).');
  print('  2. Commit and push — the new pinned version takes effect on the next pipeline run.');
  print(
    '  3. If consumers rely on the FERRY_VERSION CI/CD UI variable, update it in Settings → CI/CD → Variables.',
  );
  print('');
}

/**
 * Print the combined "Manual follow-ups required" block (MIGRATIONS.md notes
 * for the crossed GitHub range + any credential-gate follow-ups). Returns
 * true when anything was printed.
 */
function printGitHubFollowUps(fromVersion: string, toVersion: string, extra: string[]): boolean {
  const migrations = getRelevantMigrations(fromVersion, toVersion, {
    forge: 'github' as ForgeKind,
  });
  if (migrations.length === 0 && extra.length === 0) return false;
  print('');
  print('════════════════════════════════════════');
  print('  Manual follow-ups required');
  print('════════════════════════════════════════');
  for (const note of migrations) {
    const prefix = note.kind === 'action' ? '  [action] ' : '  [info]   ';
    print(`${prefix}${note.message}`);
  }
  for (const msg of extra) {
    print(`  [action] ${msg}`);
  }
  print('');
  return true;
}

function printGitLabMigrations(fromVersion: string, toVersion: string): void {
  const migrations = getRelevantMigrations(fromVersion, toVersion, {
    forge: 'gitlab' as ForgeKind,
  });
  if (migrations.length === 0) return;
  print('');
  print('════════════════════════════════════════');
  print('  Manual follow-ups required (gitlab)');
  print('════════════════════════════════════════');
  for (const note of migrations) {
    const prefix = note.kind === 'action' ? '  [action] ' : '  [info]   ';
    print(`${prefix}${note.message}`);
  }
  print('');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const forge = resolveForgeFromArgv(argv);
  if (forge === 'gitlab') {
    if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
      process.stdout
        .write(`ferry-update --forge gitlab — rewrite pinned Ferry version in GitLab CI files

Usage:
  npx -p @big-emotion/ferry@<new-version> ferry-update --forge gitlab [options]

Options:
  --to <version>       Target version (default: running package version)
  --dry-run            Print diff, write nothing
  --yes                Skip confirmation prompt
  --repo-root <path>   Path to the consumer repo root (default: cwd)
  -h, --help           Show this help

What is updated:
  • .gitlab-ci.yml at the repo root
  • Per-role *.gitlab-ci.yml files (refine, dev, review, iterate,
    reconcile, cost-daily) and any included files in subdirectories.

Rewrite rules:
  • A YAML 'FERRY_VERSION: <ver>' assignment under 'variables:' is rewritten
    to the target version.
  • A literal '@big-emotion/ferry@<ver>' pin in a 'script:' line is rewritten.
  • The '\${FERRY_VERSION}' interpolation form is left untouched — that value
    lives in CI/CD UI variables, not in YAML.

The rewriter is idempotent. Rerunning after convergence produces no diff.

Exit code: 0 on success, 1 on parse or write failure.
`);
      process.exit(0);
    }
    await runGitLabUpdate(argv);
    return;
  }

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
    (the single ferry-router.yml on router installs; the per-agent stubs on
    legacy installs)
  • Missing workflow files are added
  • ferry-jira-automation-setup.md — regenerated if it exists (format fixes, etc.)

What is NOT touched:
  • GitHub repo secrets (already set; ferry-update never re-prompts for creds)
  • FERRY_AUDIT_ISSUE repo variable
  • Jira Automation rules themselves (consumer-side, manual)
  • GitHub App installation

Important:
  • Direct edits inside the Ferry workflow files (ferry-router.yml or the per-agent
    ferry-*.yml stubs) are not a durable customisation surface.
    Ferry warns on unmanaged drift before overwrite; move supported workflow changes into ferry.local.yml.

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
  const interactive = !!process.stdin.isTTY && !config.yes;
  print(`  From: ${fromVersion}  →  To: ${toVersion}`);

  // Router vs legacy decides which template set the upgrade renders. A mixed
  // repo (router + stale stubs) is managed as a router install — the leftover
  // stubs are never regenerated; ferry-update never deletes them itself, so
  // finishing the migration is surfaced as a follow-up on every exit path.
  const workflowModel = detectWorkflowModel(config.repoRoot);
  const modelFollowUps =
    workflowModel === 'mixed'
      ? [
          'Legacy per-agent stubs still present alongside ferry-router.yml — remove them after migrating the Jira rule, or both will fire on legacy events.',
        ]
      : [];

  if (fromVersion === toVersion) {
    printSkip(`Already at ${toVersion} — nothing to do.`);
    if (modelFollowUps.length > 0) {
      printGitHubFollowUps(fromVersion, toVersion, modelFollowUps);
    }
    closePrompt();
    process.exit(0);
  }

  // ── Load consumer-side overlay (ferry.local.yml) ──────────────────────────
  let localOverrides: LocalOverrides | null = null;
  try {
    localOverrides = loadLocalOverrides(config.repoRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    closePrompt();
    process.exit(1);
  }
  if (localOverrides) {
    const keys: string[] = [];
    if (localOverrides.review?.ciGate) keys.push(`review.ciGate=${localOverrides.review.ciGate}`);
    if (localOverrides.global?.runner !== undefined) {
      const r = localOverrides.global.runner;
      keys.push(`global.runner=${Array.isArray(r) ? JSON.stringify(r) : r}`);
    }
    if (keys.length > 0) {
      print(`  Local overrides (ferry.local.yml): ${keys.join(', ')}`);
    }
  }

  // ── Compute changes ───────────────────────────────────────────────────────
  printStep(2, 3, 'Computing changes');
  const changes = computeWorkflowChanges(config.repoRoot, toVersion, {
    fromVersion,
    overrides: localOverrides ?? undefined,
  });
  const toUpdate = changes.filter((c) => c.status === 'updated');
  const toAdd = changes.filter((c) => c.status === 'added');
  const drifted = changes.filter((c) => c.status === 'drifted');
  const unchanged = changes.filter((c) => c.status === 'unchanged');

  if (toUpdate.length === 0 && toAdd.length === 0 && drifted.length === 0) {
    printSkip('All workflow files already match the target version — nothing to do.');
    // A code-only range stays silent; a range that declares a newly-required
    // secret is still gated even when no workflow file changed (e.g. re-run).
    const gate = await runCredentialGate({
      repoRoot: config.repoRoot,
      fromVersion,
      toVersion,
      interactive,
      dryRun: config.dryRun,
    });
    closePrompt();
    if (gate.ran || modelFollowUps.length > 0) {
      printGitHubFollowUps(fromVersion, toVersion, [...gate.followUps, ...modelFollowUps]);
    }
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
  if (drifted.length > 0) {
    print(`  Files with unmanaged local drift (${drifted.length}):`);
    for (const c of drifted) {
      print(`    • ${c.filename}`);
    }
  }
  if (unchanged.length > 0) {
    print(`  Unchanged (${unchanged.length}): ${unchanged.map((c) => c.filename).join(', ')}`);
  }

  // Print diffs
  const changed = [...toUpdate, ...toAdd, ...drifted];
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
    if (drifted.length > 0) {
      printWarn(
        'Dry-run detected unmanaged local workflow edits. Ferry would not overwrite these files without explicit confirmation.',
      );
    }
    print('Dry-run mode — no changes written.');
    const gate = await runCredentialGate({
      repoRoot: config.repoRoot,
      fromVersion,
      toVersion,
      interactive,
      dryRun: true,
    });
    closePrompt();
    if (gate.ran || modelFollowUps.length > 0) {
      printGitHubFollowUps(fromVersion, toVersion, [...gate.followUps, ...modelFollowUps]);
    }
    process.exit(0);
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  if (!config.yes) {
    print('');
    if (drifted.length > 0) {
      printWarn('Unmanaged local workflow edits detected. Ferry will not overwrite them silently.');
      for (const c of drifted) {
        printWarn(
          `${c.filename}: move durable changes into ferry.local.yml or confirm the overwrite intentionally`,
        );
      }
      print('');
    }
    const ok = await confirm(
      `Apply ${toUpdate.length + toAdd.length + drifted.length} file change(s) to .github/workflows/?`,
      true,
    );
    if (!ok) {
      print('Aborted.');
      closePrompt();
      process.exit(0);
    }
  }

  // ── Credential gate (must run while the prompt is still open) ──────────────
  const gate = await runCredentialGate({
    repoRoot: config.repoRoot,
    fromVersion,
    toVersion,
    interactive,
    dryRun: false,
  });

  closePrompt();

  // ── Apply ─────────────────────────────────────────────────────────────────
  printStep(3, 3, 'Applying changes');
  const workflowDir = join(config.repoRoot, '.github', 'workflows');
  const baseTemplates = templatesForModel(workflowModel, toVersion);
  const templates = localOverrides
    ? applyLocalOverrides(baseTemplates, localOverrides)
    : baseTemplates;

  let errors = 0;
  for (const tmpl of templates) {
    const c = changes.find((x) => x.filename === tmpl.filename);
    if (!c || c.status === 'unchanged') continue;
    try {
      const dest = join(workflowDir, tmpl.filename);
      writeFileSync(dest, tmpl.content, 'utf8');
      printSuccess(c.status === 'added' ? `Added ${tmpl.filename}` : `Updated ${tmpl.filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(`Failed to write ${tmpl.filename}: ${msg}`);
      errors++;
    }
  }

  // ── Regenerate Jira setup file if it exists ────────────────────────────────
  const jiraConfig = extractJiraConfigFromSetupFile(config.repoRoot);
  if (jiraConfig) {
    try {
      const setupPath = join(config.repoRoot, 'ferry-jira-automation-setup.md');
      // Router installs get the single any-column rule walkthrough; legacy and
      // mixed repos keep the per-column doc until the Jira rule is migrated.
      const setupContent =
        workflowModel === 'router'
          ? buildRouterManualSetupDoc(jiraConfig.owner, jiraConfig.repo)
          : buildManualSetupDoc(jiraConfig.owner, jiraConfig.repo);
      writeFileSync(setupPath, setupContent, 'utf8');
      printSuccess('Regenerated ferry-jira-automation-setup.md');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(`Failed to regenerate ferry-jira-automation-setup.md: ${msg}`);
      errors++;
    }
  }

  // ── Migration notes + credential-gate follow-ups ──────────────────────────
  const hadFollowUps = printGitHubFollowUps(fromVersion, toVersion, [
    ...gate.followUps,
    ...modelFollowUps,
  ]);

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
  if (!hadFollowUps) {
    print('  3. No manual follow-ups required for this upgrade');
  }
  print('');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  printError(`Unexpected error: ${msg}`);
  process.exit(1);
});
