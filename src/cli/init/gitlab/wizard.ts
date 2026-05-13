/**
 * `ferry-init --forge gitlab` wizard.
 *
 * Mirrors the GitHub wizard's responsibilities but adapted to the GitLab
 * adapter's contract:
 *   1. Detect / accept the GitLab project (host + namespaced path).
 *   2. Scaffold the six GitLab CI templates under `ci/ferry/` (see
 *      `examples/consumer-setup-gitlab/README.md` for the authoritative list).
 *   3. Print the required project-access-token scopes and CI/CD variables —
 *      consumers set these by hand (Settings → CI/CD → Variables) because
 *      there is no `gh`-style CLI we can shell out to safely.
 *   4. Idempotent: re-running on an initialised repo skips unchanged files
 *      and reports drifted ones as "would overwrite"; `--force` overwrites.
 *
 * Tokens are never accepted on the command line or stored on disk — they live
 * exclusively in GitLab CI/CD variables. The wizard's job is to tell the
 * operator which ones to set, not to set them.
 */
import { execSync } from 'node:child_process';
import {
  ask,
  confirm,
  closePrompt,
  print,
  printStep,
  printSuccess,
  printError,
  printWarn,
} from '../prompt.js';
import { detectGitLabProject, type GitLabProject } from './detect.js';
import { gitlabTemplates } from './templates.js';
import { installGitLabTemplates, GITLAB_CI_TARGET_DIR } from './scaffold.js';

export const GITLAB_TOKEN_SCOPES = ['api'] as const;

export const GITLAB_CI_VARIABLES = [
  'FERRY_VERSION',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
  'FERRY_GITLAB_TOKEN',
  'FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN',
  'FERRY_REVIEW_TRANSITION_ID',
  'FERRY_ITER_TRANSITION_ID',
  'FERRY_APPROVE_TRANSITION_ID',
  'FERRY_AUDIT_ISSUE',
  'ANTHROPIC_API_KEY',
] as const;

export interface RunGitLabInitOptions {
  argv: readonly string[];
  cwd?: string;
  remoteOverride?: string;
  /**
   * When true, skip all interactive prompts (still honours --force). The CLI
   * sets this when stdin is not a TTY; tests set it to drive the wizard
   * end-to-end without spying on readline.
   */
  nonInteractive?: boolean;
}

const TOTAL_STEPS = 3;

interface ParsedArgs {
  force: boolean;
  dryRun: boolean;
  projectOverride: string | undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const force = argv.includes('--force') || argv.includes('--overwrite');
  const dryRun = argv.includes('--dry-run');
  let projectOverride: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project' && argv[i + 1]) {
      projectOverride = argv[i + 1];
      break;
    }
    if (argv[i].startsWith('--project=')) {
      projectOverride = argv[i].slice('--project='.length);
      break;
    }
  }
  return { force, dryRun, projectOverride };
}

function readOriginRemote(cwd: string | undefined): string | undefined {
  try {
    return execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    }).trim();
  } catch {
    return undefined;
  }
}

function resolveProject(
  args: ParsedArgs,
  remoteOverride: string | undefined,
  cwd: string | undefined,
): GitLabProject | undefined {
  if (args.projectOverride) {
    // Operator-supplied path: assume gitlab.com unless the override embeds a host.
    const path = args.projectOverride.replace(/^\/+|\/+$/g, '');
    if (!path.includes('/')) return undefined;
    return { host: 'gitlab.com', path };
  }
  const remote = remoteOverride ?? readOriginRemote(cwd);
  return remote ? detectGitLabProject(remote) : undefined;
}

export async function runGitLabInit(options: RunGitLabInitOptions): Promise<number> {
  const args = parseArgs(options.argv);
  const cwd = options.cwd ?? process.cwd();
  const interactive = !options.nonInteractive;

  print('');
  print('╔════════════════════════════════════════╗');
  print('║  ferry-init --forge gitlab (beta)      ║');
  print('║  Scaffold Ferry into a GitLab project  ║');
  print('╚════════════════════════════════════════╝');
  print('');
  print('This wizard will:');
  print('  1. Confirm the GitLab project from `git remote get-url origin`.');
  print(`  2. Write six GitLab CI templates under ${GITLAB_CI_TARGET_DIR}/.`);
  print('  3. Print the project-access-token scopes and CI/CD variables to set.');
  print('');
  print('GitLab support is experimental — see #210 for the promotion checklist.');
  print('');

  if (interactive) {
    const ready = await confirm('Ready to start?', true);
    if (!ready) {
      print('Aborted.');
      closePrompt();
      return 0;
    }
  }

  // ── Step 1: Project detection ────────────────────────────────────────────
  printStep(1, TOTAL_STEPS, 'Detecting GitLab project');
  let project = resolveProject(args, options.remoteOverride, cwd);

  if (!project) {
    if (interactive) {
      print('  Could not auto-detect a GitLab remote on `origin`.');
      print('  Enter the project path as `namespace/project` (subgroups allowed):');
      const entered = await ask('GitLab project path');
      if (entered && entered.includes('/')) {
        project = { host: 'gitlab.com', path: entered.replace(/^\/+|\/+$/g, '') };
      }
    }
    if (!project) {
      printError(
        'No GitLab project resolved. Pass --project namespace/project or run from a clone whose `origin` points at GitLab.',
      );
      closePrompt();
      return 1;
    }
  }
  printSuccess(`Project: ${project.host}/${project.path}`);

  // ── Step 2: Scaffold templates ──────────────────────────────────────────
  printStep(2, TOTAL_STEPS, `Writing GitLab CI templates to ${GITLAB_CI_TARGET_DIR}/`);
  const templates = gitlabTemplates();
  const result = installGitLabTemplates(cwd, templates, {
    overwrite: args.force,
    dryRun: args.dryRun,
  });

  if (!args.force && result.wouldOverwrite.length > 0) {
    printWarn(
      `${result.wouldOverwrite.length} file(s) would be overwritten — re-run with --force to apply.`,
    );
  }

  // ── Step 3: Print required CI variables + token scopes ─────────────────
  printStep(3, TOTAL_STEPS, 'Required GitLab project setup');
  print('');
  print('  Project access token (Settings → Access tokens):');
  print(`    Scopes: ${GITLAB_TOKEN_SCOPES.join(', ')} (single "api" scope = full read/write)`);
  print('    Save the value as the CI/CD variable FERRY_GITLAB_TOKEN (masked + protected).');
  print('');
  print('  Pipeline trigger token (Settings → CI/CD → Pipeline triggers):');
  print('    Save the value as FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN (masked + protected).');
  print('');
  print('  CI/CD variables (Settings → CI/CD → Variables; mark every token-bearing one');
  print('  as masked + protected):');
  for (const v of GITLAB_CI_VARIABLES) {
    print(`    - ${v}`);
  }
  print('');
  print('  Wire each Jira column transition to a webhook of the form:');
  print(
    `    POST https://${project.host}/api/v4/projects/${encodeURIComponent(project.path)}/trigger/pipeline`,
  );
  print('    token=<FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN>');
  print('    ref=main');
  print('    variables[FERRY_DISPATCH_TYPE]=ferry-{refine|dev|review|iterate}');
  print('    variables[FERRY_ENVELOPE_PAYLOAD]=<JSON envelope>');
  print('');
  print(
    '  See examples/consumer-setup-gitlab/README.md and docs/CONFIGURATION.md → GitLab section for the full setup.',
  );
  print('');

  closePrompt();

  print('════════════════════════════════════════');
  print('  GitLab scaffolding complete.');
  print('════════════════════════════════════════');
  if (result.installed.length > 0) {
    print(`  Files written: ${result.installed.join(', ')}`);
  }
  if (result.skipped.length > 0) {
    print(`  Files unchanged: ${result.skipped.join(', ')}`);
  }
  if (result.wouldInstall.length > 0) {
    print(`  Files that would be created on a real run: ${result.wouldInstall.join(', ')}`);
  }
  if (result.wouldOverwrite.length > 0) {
    print(`  Files that would be overwritten on --force: ${result.wouldOverwrite.join(', ')}`);
  }
  print('');
  return 0;
}
