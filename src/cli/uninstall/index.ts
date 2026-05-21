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
  detectCompositeActions,
  detectCodeownersBlock,
  detectSecrets,
  detectOAuthSecret,
  detectVariables,
  detectAuditIssueNumber,
  detectAuditIssue,
  ANTHROPIC_SECRET,
  CLAUDE_CODE_OAUTH_SECRET,
  FERRY_VARIABLE,
  AUDIT_LABEL,
} from './detect.js';
import {
  removeWorkflows,
  removeCompositeActions,
  removeCodeownersBlock,
  removeSecrets,
  removeVariable,
  handleAuditIssue,
  type ExecOptions,
} from './execute.js';
import { resolveForgeFromArgv } from '../lib/forge.js';
import { runGitlabUninstall } from './gitlab/run.js';
import { shouldRemoveOAuth } from './oauth-gate.js';
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

function detectGitlabProjectUrl(): string | undefined {
  try {
    const remote = execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // SSH form: git@gitlab.com:group/repo.git  →  https://gitlab.com/group/repo
    const ssh = remote.match(/^(?:ssh:\/\/)?git@([^:]+):(.+?)(?:\.git)?$/);
    if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
    // HTTPS form: https://gitlab.example.com/group/repo(.git)?
    const https = remote.match(/^https?:\/\/[^/]+\/.+$/);
    if (https) return remote.replace(/\.git$/, '');
    return undefined;
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

  const forge = resolveForgeFromArgv(argv);
  if (forge === 'gitlab') {
    const repoRoot = getArg(argv, '--repo-root') ?? process.cwd();
    const apply = hasFlag(argv, '--apply');
    const yes = hasFlag(argv, '--yes');
    const projectUrl = getArg(argv, '--project-url') ?? detectGitlabProjectUrl();
    const code = await runGitlabUninstall({ repoRoot, apply, yes, projectUrl });
    process.exit(code);
  }

  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    process.stdout.write(`ferry-uninstall — cleanly remove Ferry from a consumer repo

Usage:
  npx -p @big-emotion/ferry ferry-uninstall [options]

Options:
  --forge <github|gitlab>  Target forge. Defaults to auto-detect from origin remote.
  --repo <owner/repo>      GitHub repository (default: auto-detect from git remote)
  --repo-root <path>       Path to the repo root (default: cwd)
  --dry-run                Print the plan and change nothing  [github]
  --apply                  Perform deletion  [gitlab — default is dry-run]
  --project-url <url>      GitLab project URL (default: auto-detect from origin remote)
  --yes                    Skip confirmation prompt (for CI / scripts)
  --keep-secrets           Leave all secrets and variables in place
  --keep-workflows         Leave workflow files and CODEOWNERS entries
  --include-anthropic      Also remove ${ANTHROPIC_SECRET}
  --close-audit-issue      Close the audit-log issue (default: only unlabel)
  -h, --help               Show this help

What is removed by default:
  • .github/workflows/ferry-*.yml (6 workflow files)
  • .github/actions/ferry-route/, ferry-ci-gate/ (composite actions)
  • Ferry entries in .github/CODEOWNERS (file kept; only Ferry lines removed)
  • Repo secrets: FERRY_APP_ID, FERRY_PRIVATE_KEY, FERRY_JIRA_BASE_URL,
                  FERRY_JIRA_EMAIL, FERRY_JIRA_API_TOKEN,
                  FERRY_REVIEW_TRANSITION_ID, FERRY_ITER_TRANSITION_ID
  • Repo variable: ${FERRY_VARIABLE}
  • Label '${AUDIT_LABEL}' removed from audit-log issue (issue NOT closed)

What requires interactive confirmation (never removed in --yes mode):
  • CLAUDE_CODE_OAUTH_TOKEN — OAuth subscription token; prompted individually

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
  const compositeActions = detectCompositeActions(opts.repoRoot);
  const codeownersHasFerry = detectCodeownersBlock(opts.repoRoot);
  const secrets = opts.keepSecrets ? [] : detectSecrets(opts.repo, opts.includeAnthropic);
  const oauthSecretPresent = opts.keepSecrets ? false : detectOAuthSecret(opts.repo);
  const variables = opts.keepSecrets ? [] : detectVariables(opts.repo);
  const auditIssueNumber = detectAuditIssueNumber(opts.repo);
  const auditIssue =
    auditIssueNumber !== null ? detectAuditIssue(opts.repo, auditIssueNumber) : null;

  const presentWorkflows = workflows.filter((w) => w.present);
  const presentComposites = compositeActions.filter((a) => a.present);
  const hasWorkflowChanges =
    !opts.keepWorkflows &&
    (presentWorkflows.length > 0 || presentComposites.length > 0 || codeownersHasFerry);
  const hasAnything =
    hasWorkflowChanges ||
    secrets.length > 0 ||
    oauthSecretPresent ||
    variables.length > 0 ||
    auditIssue !== null;

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
    for (const ca of presentComposites) {
      print(`  ✓ .github/actions/${ca.dirname}/`);
    }
    if (codeownersHasFerry) {
      print('  ✓ Ferry block in .github/CODEOWNERS  (file kept; only Ferry lines removed)');
    }
  }

  if (secrets.length > 0) {
    const formatted = secrets.join(', ');
    print(`  ✓ Repo secrets: ${formatted}`);
  }

  if (oauthSecretPresent) {
    if (opts.yes) {
      print(
        `  • ${CLAUDE_CODE_OAUTH_SECRET} — skipped in --yes mode (requires interactive consent)`,
      );
    } else {
      print(`  ✓ ${CLAUDE_CODE_OAUTH_SECRET} (will confirm interactively)`);
    }
  }

  if (variables.length > 0) {
    print(`  ✓ Repo variable: ${variables.join(', ')}`);
  }

  if (auditIssue !== null) {
    if (opts.closeAuditIssue) {
      print(`  ✓ Audit-log issue (#${auditIssue.number}): remove '${AUDIT_LABEL}' label and CLOSE`);
    } else {
      print(
        `  ✓ Audit-log issue (#${auditIssue.number}): remove '${AUDIT_LABEL}' label, do NOT close`,
      );
    }
  }

  print('');
  print('Will NOT touch (manual cleanup required):');
  if (!opts.includeAnthropic) {
    print(`  • ${ANTHROPIC_SECRET} secret (use --include-anthropic to also remove)`);
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

  let confirmed = false;
  if (!opts.yes && oauthSecretPresent) {
    print('');
    confirmed = await confirm(
      `Also remove ${CLAUDE_CODE_OAUTH_SECRET}? (Deletes the GitHub repo secret only — does not revoke the underlying Anthropic OAuth token. To fully revoke, follow up at https://console.anthropic.com.)`,
      false,
    );
  }
  const removeOAuthSecretFlag = shouldRemoveOAuth({
    yes: opts.yes,
    oauthSecretPresent,
    confirmed,
  });

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

  // ── Step 1: Workflows & composite actions ────────────────────────────────
  printStep(1, TOTAL_STEPS, 'Removing workflow files and composite actions');
  if (opts.keepWorkflows) {
    printSkip(
      '--keep-workflows: leaving workflow files, composite actions, and CODEOWNERS in place',
    );
  } else {
    removeWorkflows(opts.repoRoot, workflows, execOpts);
    removeCompositeActions(opts.repoRoot, compositeActions, execOpts);
    removeCodeownersBlock(opts.repoRoot, execOpts);
  }

  // ── Step 2: Secrets ───────────────────────────────────────────────────────
  printStep(2, TOTAL_STEPS, 'Removing secrets');
  if (opts.keepSecrets) {
    printSkip('--keep-secrets: leaving all secrets in place');
  } else {
    removeSecrets(opts.repo, secrets, execOpts);
    if (removeOAuthSecretFlag) {
      removeSecrets(opts.repo, [CLAUDE_CODE_OAUTH_SECRET], execOpts);
    } else if (oauthSecretPresent) {
      printSkip(`${CLAUDE_CODE_OAUTH_SECRET}: not removed (requires explicit interactive consent)`);
    }
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
  print('What was removed:');
  if (!opts.keepWorkflows) {
    const removedWf = presentWorkflows.length;
    const removedCa = presentComposites.length;
    if (removedWf > 0) print(`  ✓ ${removedWf} workflow file(s) from .github/workflows/`);
    if (removedCa > 0) print(`  ✓ ${removedCa} composite action(s) from .github/actions/`);
    if (codeownersHasFerry) print('  ✓ Ferry entries from .github/CODEOWNERS');
  }
  if (secrets.length > 0) print(`  ✓ Secrets: ${secrets.join(', ')}`);
  if (removeOAuthSecretFlag) print(`  ✓ Secret: ${CLAUDE_CODE_OAUTH_SECRET}`);
  if (variables.length > 0) print(`  ✓ Variable: ${variables.join(', ')}`);
  print('');
  print('Remaining manual steps:');
  let step = 1;
  if (oauthSecretPresent && !removeOAuthSecretFlag) {
    print(`  ${step++}. Remove ${CLAUDE_CODE_OAUTH_SECRET} if desired:`);
    print(`     gh secret delete ${CLAUDE_CODE_OAUTH_SECRET} --repo ${opts.repo}`);
  }
  if (!opts.includeAnthropic) {
    print(`  ${step++}. Decide whether to delete the ${ANTHROPIC_SECRET} secret`);
    print(`     (gh secret delete ${ANTHROPIC_SECRET} --repo ${opts.repo})`);
  }
  print(`  ${step++}. Disable or delete the 4 Jira Automation rules in the Jira UI`);
  print('     (Project settings → Automation)');
  print(`  ${step++}. Uninstall the GitHub App at https://github.com/settings/installations`);
  print(`  ${step}. Review repo-level workflow permissions if desired`);
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
