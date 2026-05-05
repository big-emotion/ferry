#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ask,
  askSecret,
  confirm,
  closePrompt,
  print,
  printStep,
  printSuccess,
  printError,
  printSkip,
} from './prompt.js';
import { workflowTemplates } from './templates.js';
import { stepGitHubApp } from './steps/github-app.js';
import { buildSecrets, stepSecrets } from './steps/secrets.js';
import { installWorkflows, scaffoldCodeowners } from './steps/workflows.js';
import { stepJiraBundle, DEFAULT_STATUS_NAMES } from './steps/jira-bundle.js';
import { resolveJiraWorkspaceId, resolveJiraProjectId } from './steps/jira-resolve.js';
import { stepVerify } from './steps/verify.js';
import type { FerryConfig, LlmProvider } from './types.js';

const FERRY_VERSION_DEFAULT = 'v1';

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
  print('  3. Install 4 Ferry workflow stubs into .github/workflows/');
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
  const jiraApiToken = await askSecret(
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
  print('Auto-transitions (column to move to after each step, leave blank to disable):');
  const devAutoTransition = await ask('Developer → after implementation (moves to)', 'In Review');
  const reviewerChangesAutoTransition = await ask(
    'Reviewer → after requesting changes (moves to)',
    'Changes Requested',
  );
  const reviewerApproveAutoTransition = await ask(
    'Reviewer → after approving (moves to, blank = no transition)',
    '',
  );
  const iteratorAutoTransition = await ask('Iterator → after iteration (moves to)', 'In Review');

  print('');
  print('LLM provider per phase (anthropic / openai / google, default: anthropic):');
  print('  Note: MCP server support (labels, context7, etc.) requires Anthropic.');

  function validateProvider(input: string): LlmProvider {
    const lower = input.toLowerCase().trim();
    if (lower === 'openai' || lower === 'google' || lower === 'anthropic') return lower;
    return 'anthropic';
  }

  const refinerProviderRaw = await ask('Refiner provider', 'anthropic');
  const devProviderRaw = await ask('Developer provider', 'anthropic');
  const reviewProviderRaw = await ask('Reviewer provider', 'anthropic');
  const iterateProviderRaw = await ask('Iterator provider', 'anthropic');

  const refinerProvider = validateProvider(refinerProviderRaw);
  const devProvider = validateProvider(devProviderRaw);
  const reviewProvider = validateProvider(reviewProviderRaw);
  const iterateProvider = validateProvider(iterateProviderRaw);

  const needsOpenAI = [refinerProvider, devProvider, reviewProvider, iterateProvider].includes(
    'openai',
  );
  const needsGoogle = [refinerProvider, devProvider, reviewProvider, iterateProvider].includes(
    'google',
  );

  print('');
  print('API keys:');
  const anthropicApiKey = await askSecret('Anthropic API key (sk-ant-...)');

  let openaiApiKey = '';
  if (needsOpenAI) {
    openaiApiKey = await askSecret('OpenAI API key (sk-...)');
  }

  let googleApiKey = '';
  if (needsGoogle) {
    googleApiKey = await askSecret('Google AI API key');
  }

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
    openaiApiKey: openaiApiKey || undefined,
    googleApiKey: googleApiKey || undefined,
    refinerProvider,
    devProvider,
    reviewProvider,
    iterateProvider,
  };

  // ── Step 2: Secrets ───────────────────────────────────────────────────────
  printStep(2, TOTAL_STEPS, `Setting secrets on ${fullRepo}`);
  const secrets = buildSecrets(config);
  const secretsResult = await stepSecrets(fullRepo, secrets, overwrite);
  if (!secretsResult.ok) {
    printError(secretsResult.reason);
    print('You can re-run ferry-init to retry.');
  }

  // ── Step 3: Workflows + ferry.config.yaml ────────────────────────────────
  printStep(3, TOTAL_STEPS, 'Installing workflow files');
  const templates = workflowTemplates(config.ferryVersion);
  const workflowDir = join(repoRoot, '.github', 'workflows');
  installWorkflows(workflowDir, templates, overwrite);
  scaffoldCodeowners(repoRoot, owner);

  const configPath = join(repoRoot, 'ferry.config.yaml');
  if (!existsSync(configPath) || overwrite) {
    const nullable = (val: string): string => (val.trim() ? `"${val.trim()}"` : 'null');

    const DEFAULT_MODELS: Record<string, string> = {
      anthropic: 'claude-sonnet-4-6',
      openai: 'gpt-4o',
      google: 'gemini-2.5-pro',
    };

    const phaseProviders: Array<[string, string]> = [
      ['refiner', refinerProvider],
      ['dev', devProvider],
      ['review', reviewProvider],
      ['iterate', iterateProvider],
    ];
    const nonDefaultPhases = phaseProviders.filter(([, p]) => p !== 'anthropic');

    const modelsBlock =
      nonDefaultPhases.length > 0
        ? [
            'models:',
            ...nonDefaultPhases.flatMap(([phase, provider]) => [
              `  ${phase}:`,
              `    provider: ${provider}`,
              `    model: ${DEFAULT_MODELS[provider] ?? 'gpt-4o'}`,
            ]),
            '',
          ]
        : [];

    const workflowYaml = [
      ...modelsBlock,
      'workflow:',
      '  agents:',
      '    refiner:',
      `      trigger_column: "${refineStatus || DEFAULT_STATUS_NAMES.refine}"`,
      '      auto_transition: null',
      '    developer:',
      `      trigger_column: "${devStatus || DEFAULT_STATUS_NAMES.dev}"`,
      `      auto_transition: ${nullable(devAutoTransition)}`,
      '    reviewer:',
      `      trigger_column: "${reviewStatus || DEFAULT_STATUS_NAMES.review}"`,
      `      auto_transition_approve: ${nullable(reviewerApproveAutoTransition)}`,
      `      auto_transition_changes: ${nullable(reviewerChangesAutoTransition)}`,
      '    iterator:',
      `      trigger_column: "${iterateStatus || DEFAULT_STATUS_NAMES.iterate}"`,
      `      auto_transition: ${nullable(iteratorAutoTransition)}`,
      '',
    ].join('\n');
    writeFileSync(configPath, workflowYaml, 'utf8');
    printSuccess('Generated ferry.config.yaml with workflow.agents settings');
    if (nonDefaultPhases.length > 0) {
      printSuccess(
        `Added models block for non-default providers: ${nonDefaultPhases.map(([p]) => p).join(', ')}`,
      );
    }
  } else {
    printSkip('ferry.config.yaml already exists — skipping (use --overwrite to replace)');
  }

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
  print('  1. Commit .github/workflows/ferry-*.yml, ferry.config.yaml, and .github/CODEOWNERS');
  print('  2. Set up Jira Automation rules (choose one):');
  print('     a) Manual (recommended): follow ferry-jira-automation-setup.md');
  print('     b) Import (beta): Jira → Project settings → Automation → Import rules');
  print('        Upload ferry-jira-automation-rules.beta.json');
  print('  3. Set spend caps on provider billing pages (see links above)');
  print('  4. Set FERRY_AUDIT_ISSUE repository variable to a GitHub Issue number');
  print('     for the audit log (create a blank issue and use its number)');
  let nextStep = 5;
  if (needsOpenAI) {
    print(`  ${nextStep++}. OpenAI key was set as OPENAI_API_KEY secret.`);
    print(
      '     Set spend limits: https://platform.openai.com/settings/organization/billing/limits',
    );
  }
  if (needsGoogle) {
    print(`  ${nextStep++}. Google AI key was set as GOOGLE_API_KEY secret.`);
    print('     Enable budget alerts: https://console.cloud.google.com/billing');
  }
  print(`  ${nextStep}. Move a Jira ticket to "Refinement" — watch the Actions tab!`);
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
