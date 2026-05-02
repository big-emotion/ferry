#!/usr/bin/env node
import { execSync } from 'node:child_process';
import {
  ask,
  confirm,
  closePrompt,
  print,
  printStep,
  printSuccess,
  printSkip,
  printWarn,
  printError,
} from '../init/prompt.js';
import {
  detectWorkflows,
  detectCodeownersBlock,
  detectSecrets,
  detectVariables,
  detectAuditIssueNumber,
  detectAuditIssue,
  ANTHROPIC_SECRET,
  FERRY_VARIABLE,
  AUDIT_LABEL,
} from './detect.js';
import {
  removeWorkflows,
  removeCodeownersBlock,
  removeSecrets,
  removeVariable,
  handleAuditIssue,
  type ExecOptions,
} from './execute.js';
import type { UninstallOptions } from './types.js';

const TOTAL_STEPS = 4;

function detectRepo(): string | undefined {
  try {
    const remote = execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function parseArgs(argv: string[]): UninstallOptions {
  return {
    dryRun: hasFlag(argv, '--dry-run'),
    yes: hasFlag(argv, '--yes'),
    keepSecrets: hasFlag(argv, '--keep-secrets'),
    keepWorkflows: hasFlag(argv, '--keep-workflows'),
    includeAnthropic: hasFlag(argv, '--include-anthropic'),
    closeAuditIssue: hasFlag(argv, '--close-audit-issue'),
    repo: getArg(argv, '--repo') ?? '',
    repoRoot: getArg(argv, '--repo-root') ?? process.cwd(),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    process.stdout.write(`ferry-uninstall — cleanly remove Ferry from a consumer repo

Usage:
  npx -p @big-emotion/ferry ferry-uninstall [options]

Options:
  --repo <owner/repo>      GitHub repository (default: auto-detect from git remote)
  --repo-root <path>       Path to the repo root (default: cwd)
  --dry-run                Print the plan and change nothing
  --yes                    Skip confirmation prompt (for CI / scripts)
  --keep-secrets           Leave all secrets and variables in place
  --keep-workflows         Leave workflow files and CODEOWNERS entries
  --include-anthropic      Also remove ${ANTHROPIC_SECRET}
  --close-audit-issue      Close the audit-log issue (default: only unlabel)
  -h, --help               Show this help

What is removed by default:
  • .github/workflows/ferry-*.yml (6 workflow files)
  • Ferry entries in .github/CODEOWNERS (file kept; only Ferry lines removed)
  • Repo secrets: FERRY_APP_ID, FERRY_PRIVATE_KEY, FERRY_JIRA_BASE_URL,
                  FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
                  FERRY_REVIEW_TRANSITION_ID, FERRY_ITER_TRANSITION_ID
  • Repo variable: ${FERRY_VARIABLE}
  • Label '${AUDIT_LABEL}' removed from audit-log issue (issue NOT closed)

What is NOT touched:
  • ${ANTHROPIC_SECRET} (use --include-anthropic to also remove)
  • Jira Automation rules — disable/delete in Jira UI
  • GitHub App installation — uninstall at https://github.com/settings/installations
  • Repo-level workflow permissions

Exit code: 0 on success, 1 on any error.
`);
    process.exit(0);
  }

  const opts = parseArgs(argv);

  if (!opts.repo) {
    opts.repo = detectRepo() ?? '';
  }

  print('');
  print('╔════════════════════════════════════════╗');
  print('║        ferry-uninstall  v0.1           ║');
  print('║  Remove Ferry from your GitHub repo    ║');
  print('╚════════════════════════════════════════╝');
  print('');

  if (!opts.repo) {
    if (opts.yes) {
      printError('Could not detect GitHub repo. Pass --repo owner/repo.');
      process.exit(1);
    }
    const repoInput = await ask('GitHub repo (owner/repo)');
    if (!repoInput?.includes('/')) {
      printError('Repo must be in the form owner/repo');
      closePrompt();
      process.exit(1);
    }
    opts.repo = repoInput.trim();
  }

  print(`Scanning ${opts.repo} for Ferry components...`);
  print('');

  const workflows = detectWorkflows(opts.repoRoot);
  const codeownersHasFerry = detectCodeownersBlock(opts.repoRoot);
  const secrets = opts.keepSecrets ? [] : detectSecrets(opts.repo, opts.includeAnthropic);
  const variables = opts.keepSecrets ? [] : detectVariables(opts.repo);
  const auditIssueNumber = detectAuditIssueNumber(opts.repo);
  const auditIssue =
    auditIssueNumber !== null ? detectAuditIssue(opts.repo, auditIssueNumber) : null;

  const presentWorkflows = workflows.filter((w) => w.present);
  const hasWorkflowChanges =
    !opts.keepWorkflows && (presentWorkflows.length > 0 || codeownersHasFerry);
  const hasAnything =
    hasWorkflowChanges || secrets.length > 0 || variables.length > 0 || auditIssue !== null;

  if (!hasAnything) {
    print('Nothing to remove — Ferry does not appear to be installed.');
    closePrompt();
    process.exit(0);
  }

  print('Will remove:');

  if (!opts.keepWorkflows) {
    for (const wf of presentWorkflows) {
      print(`  ✓ .github/workflows/${wf.filename}`);
    }
    if (codeownersHasFerry) {
      print(
        '  ✓ Ferry block in .github/CODEOWNERS  (file kept; only Ferry lines removed)',
      );
    }
  }

  if (secrets.length > 0) {
    const formatted = secrets.join(', ');
    print(`  ✓ Repo secrets: ${formatted}`);
  }

  if (variables.length > 0) {
    print(`  ✓ Repo variable: ${variables.join(', ')}`);
  }

  if (auditIssue !== null) {
    if (opts.closeAuditIssue) {
      print(
        `  ✓ Audit-log issue (#${auditIssue.number}): remove '${AUDIT_LABEL}' label and CLOSE`,
      );
    } else {
      print(
        `  ✓ Audit-log issue (#${auditIssue.number}): remove '${AUDIT_LABEL}' label, do NOT close`,
      );
    }
  }

  print('');
  print('Will NOT touch (manual cleanup required):');
  if (!opts.includeAnthropic) {
    print(
      `  • ${ANTHROPIC_SECRET} secret (use --include-anthropic to also remove)`,
    );
  }
  print('  • Jira Automation rules — disable/delete in Jira UI');
  print('  • GitHub App installation — uninstall at https://github.com/settings/installations');
  print('  • Workflow read/write permissions — repo-wide; left as-is');
  print('');

  if (opts.dryRun) {
    print('Dry-run mode — no changes made.');
    closePrompt();
    process.exit(0);
  }

  if (!opts.yes) {
    const confirmed = await confirm(`Proceed with removal from ${opts.repo}?`, false);
    if (!confirmed) {
      print('Aborted.');
      closePrompt();
      process.exit(0);
    }
  }

  closePrompt();

  const errors: string[] = [];
  const execOpts: ExecOptions = {
    dryRun: false,
    onAction: (msg) => printSuccess(msg),
    onSkip: (msg) => printSkip(msg),
    onError: (msg) => {
      printError(msg);
      errors.push(msg);
    },
  };

  // ── Step 1: Workflows ─────────────────────────────────────────────────────
  printStep(1, TOTAL_STEPS, 'Removing workflow files');
  if (opts.keepWorkflows) {
    printSkip('--keep-workflows: leaving workflow files and CODEOWNERS in place');
  } else {
    removeWorkflows(opts.repoRoot, workflows, execOpts);
    removeCodeownersBlock(opts.repoRoot, execOpts);
  }

  // ── Step 2: Secrets ───────────────────────────────────────────────────────
  printStep(2, TOTAL_STEPS, 'Removing secrets');
  if (opts.keepSecrets) {
    printSkip('--keep-secrets: leaving all secrets in place');
  } else {
    removeSecrets(opts.repo, secrets, execOpts);
  }

  // ── Step 3: Variables ─────────────────────────────────────────────────────
  printStep(3, TOTAL_STEPS, 'Removing repo variables');
  if (opts.keepSecrets) {
    printSkip('--keep-secrets: leaving repo variables in place');
  } else if (variables.length === 0) {
    printSkip(`${FERRY_VARIABLE} not found — skipping`);
  } else {
    for (const v of variables) {
      removeVariable(opts.repo, v, execOpts);
    }
  }

  // ── Step 4: Audit issue ───────────────────────────────────────────────────
  printStep(4, TOTAL_STEPS, 'Updating audit-log issue');
  if (auditIssue !== null) {
    handleAuditIssue(opts.repo, auditIssue, opts.closeAuditIssue, execOpts);
  } else {
    printSkip('No audit-log issue found — skipping');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  print('');
  print('════════════════════════════════════════');
  print('  Uninstall complete!');
  print('════════════════════════════════════════');
  print('');
  print('Remaining manual steps:');
  if (!opts.includeAnthropic) {
    print(`  1. Decide whether to delete the ${ANTHROPIC_SECRET} secret`);
    print(`     (gh secret delete ${ANTHROPIC_SECRET} --repo ${opts.repo})`);
  }
  print('  2. Disable or delete the 4 Jira Automation rules in the Jira UI');
  print('     (Project settings → Automation)');
  print('  3. Uninstall the GitHub App at https://github.com/settings/installations');
  print('  4. Review repo-level workflow permissions if desired');
  print('');

  if (errors.length > 0) {
    printWarn(`${errors.length} error(s) occurred — review the output above.`);
    process.exit(1);
  }

  printSuccess('Ferry has been removed.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  printError(`Unexpected error: ${msg}`);
  process.exit(1);
});
