#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { ask, confirm, closePrompt, print, printStep, printSuccess, printError } from './prompt.js';
import { workflowTemplates } from './templates.js';
import { stepGitHubApp } from './steps/github-app.js';
import { buildSecrets, stepSecrets } from './steps/secrets.js';
import { installWorkflows, scaffoldCodeowners } from './steps/workflows.js';
import { stepJiraBundle, DEFAULT_STATUS_NAMES } from './steps/jira-bundle.js';
import { resolveJiraWorkspaceId, resolveJiraProjectId } from './steps/jira-resolve.js';
import { stepVerify } from './steps/verify.js';
import type { FerryConfig } from './types.js';

const _require = createRequire(import.meta.url);
const { version: pkgVersion } = _require('../../../package.json') as { version: string };
const FERRY_VERSION_DEFAULT = `v${pkgVersion}`;

const TOTAL_STEPS = 5;

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

function parseArgs(argv: string[]): { overwrite: boolean; version: string } {
  const overwrite = argv.includes('--overwrite');
  const versionIdx = argv.findIndex((a) => a === '--version');
  const version =
    versionIdx >= 0 ? (argv[versionIdx + 1] ?? FERRY_VERSION_DEFAULT) : FERRY_VERSION_DEFAULT;
  return { overwrite, version };
}

async function main(): Promise<void> {
  const { overwrite, version } = parseArgs(process.argv.slice(2));

  print('');
  print('╔════════════════════════════════════════╗');
  print('║           ferry-init  v0.1             ║');
  print('║  Set up Ferry in your GitHub repo      ║');
  print('╚════════════════════════════════════════╝');
  print('');
  print('This wizard will:');
  print('  1. Guide you through creating a GitHub App');
  print('  2. Set 6 repository secrets via the gh CLI');
  print('  3. Install 6 Ferry workflow stubs into .github/workflows/');
  print('  4. Generate a Jira Automation import bundle');
  print('  5. Verify your Anthropic API key');
  print('');
  print('Prerequisites: gh CLI installed and authenticated (run `gh auth status`)');
  print('');

  const ready = await confirm('Ready to start?', true);
  if (!ready) {
    print('Aborted.');
    closePrompt();
    process.exit(0);
  }

  // Detect or prompt for owner/repo
  const detected = detectRepo();
  const repoInput = await ask('GitHub repo (owner/repo)', detected);
  if (!repoInput || !repoInput.includes('/')) {
    printError('Repo must be in the form owner/repo');
    closePrompt();
    process.exit(1);
  }
  const [owner, repo] = repoInput.split('/') as [string, string];
  const fullRepo = `${owner}/${repo}`;

  const repoRoot = process.cwd();

  // ── Step 1: GitHub App ────────────────────────────────────────────────────
  printStep(1, TOTAL_STEPS, 'GitHub App setup');
  const ghApp = await stepGitHubApp(owner);
  if (!ghApp.result.ok) {
    printError(ghApp.result.reason);
    closePrompt();
    process.exit(1);
  }

  // ── Collect remaining secrets ─────────────────────────────────────────────
  print('');
  print('Jira credentials:');
  const jiraBaseUrl = await ask('Jira base URL (e.g. https://acme.atlassian.net)');
  const jiraEmail = await ask('Jira account email');
  const jiraApiToken = await ask(
    'Jira API token (from https://id.atlassian.com/manage-profile/security/api-tokens)',
  );
  const jiraProjectKey = await ask('Jira project key (e.g. CHAN, PROJ)');

  print('  Resolving Jira workspace and project IDs from the API...');
  const [resolvedWorkspaceId, resolvedProjectId] = await Promise.all([
    resolveJiraWorkspaceId(jiraBaseUrl, jiraEmail, jiraApiToken),
    resolveJiraProjectId(jiraBaseUrl, jiraEmail, jiraApiToken, jiraProjectKey),
  ]);

  let workspaceId: string;
  if (resolvedWorkspaceId) {
    printSuccess(`Workspace ID resolved: ${resolvedWorkspaceId}`);
    workspaceId = resolvedWorkspaceId;
  } else {
    print('  Could not auto-detect workspace ID.');
    print('  Find it at: https://admin.atlassian.com → select your org → UUID in the URL');
    const entered = await ask('Jira workspace ID (cloudId UUID, leave blank for placeholder)');
    workspaceId = entered || 'YOUR_WORKSPACE_ID';
  }

  let projectId: string;
  if (resolvedProjectId) {
    printSuccess(`Project ID resolved: ${resolvedProjectId}`);
    projectId = resolvedProjectId;
  } else {
    print('  Could not auto-detect project ID.');
    print('  Find it at: Jira → Project settings → Details → numeric ID (not the key)');
    const entered = await ask('Jira project numeric ID (leave blank for placeholder)');
    projectId = entered || 'YOUR_PROJECT_ID';
  }

  print('');
  print('Jira column names (press Enter to accept defaults):');
  const refineStatus = await ask('Refiner trigger status', DEFAULT_STATUS_NAMES.refine);
  const devStatus = await ask('Developer trigger status', DEFAULT_STATUS_NAMES.dev);
  const reviewStatus = await ask('Reviewer trigger status', DEFAULT_STATUS_NAMES.review);
  const iterateStatus = await ask('Iterator trigger status', DEFAULT_STATUS_NAMES.iterate);

  print('');
  print('LLM provider:');
  const anthropicApiKey = await ask('Anthropic API key (sk-ant-...)');

  closePrompt();

  const config: FerryConfig = {
    owner,
    repo,
    ferryVersion: version,
    appId: ghApp.appId,
    privateKey: ghApp.privateKey,
    jiraBaseUrl,
    jiraEmail,
    jiraApiToken,
    jiraProjectKey,
    jiraWorkspaceId: workspaceId,
    jiraProjectId: projectId,
    anthropicApiKey,
  };

  // ── Step 2: Secrets ───────────────────────────────────────────────────────
  printStep(2, TOTAL_STEPS, `Setting secrets on ${fullRepo}`);
  const secrets = buildSecrets(config);
  const secretsResult = await stepSecrets(fullRepo, secrets, overwrite);
  if (!secretsResult.ok) {
    printError(secretsResult.reason);
    print('You can re-run ferry-init to retry.');
  }

  // ── Step 3: Workflows ─────────────────────────────────────────────────────
  printStep(3, TOTAL_STEPS, 'Installing workflow files');
  const templates = workflowTemplates(config.ferryVersion);
  const workflowDir = join(repoRoot, '.github', 'workflows');
  installWorkflows(workflowDir, templates, overwrite);
  scaffoldCodeowners(repoRoot, owner);

  // ── Step 4: Jira automation bundle ────────────────────────────────────────
  printStep(4, TOTAL_STEPS, 'Generating Jira Automation import bundle');
  stepJiraBundle(repoRoot, owner, repo, config.jiraWorkspaceId, config.jiraProjectId, {
    refine: refineStatus || DEFAULT_STATUS_NAMES.refine,
    dev: devStatus || DEFAULT_STATUS_NAMES.dev,
    review: reviewStatus || DEFAULT_STATUS_NAMES.review,
    iterate: iterateStatus || DEFAULT_STATUS_NAMES.iterate,
  });

  // ── Step 5: Verify ────────────────────────────────────────────────────────
  printStep(5, TOTAL_STEPS, 'Verifying provider API key');
  const verifyResult = await stepVerify(config.anthropicApiKey);

  // ── Summary ───────────────────────────────────────────────────────────────
  print('');
  print('════════════════════════════════════════');
  print('  Setup complete!');
  print('════════════════════════════════════════');
  print('');
  print('Next steps:');
  print('  1. Commit .github/workflows/ferry-*.yml and .github/CODEOWNERS');
  print('  2. Set up Jira Automation rules (choose one):');
  print('     a) Manual (recommended): follow ferry-jira-automation-setup.md');
  print('     b) Import (beta): Jira → Project settings → Automation → Import rules');
  print('        Upload ferry-jira-automation-rules.beta.json');
  print('  3. Set spend caps on provider billing pages (see links above)');
  print('  4. Set FERRY_AUDIT_ISSUE repository variable to a GitHub Issue number');
  print('     for the audit log (create a blank issue and use its number)');
  print('  5. Move a Jira ticket to "Refinement" — watch the Actions tab!');
  print('');

  if (!secretsResult.ok || !verifyResult.ok) {
    printError('Some steps had warnings — review the output above before proceeding.');
    process.exit(1);
  }

  printSuccess('All steps passed. Ferry is ready to run.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  printError(`Unexpected error: ${msg}`);
  process.exit(1);
});
