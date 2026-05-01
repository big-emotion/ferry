#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkSecrets } from './checks/secrets.js';
import { checkGitHubApp } from './checks/github-app.js';
import { checkJira } from './checks/jira.js';
import { checkLlmKeys } from './checks/llm.js';
import { checkSyntheticDispatch } from './checks/dispatch.js';
import { checkWorkflowDrift } from './checks/workflows.js';
import { checkPromptOverrides } from './checks/prompts.js';
import { renderTable } from './table.js';
import type { DoctorConfig } from './types.js';

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

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function readPrivateKey(path: string): string {
  const resolved = resolve(path.replace(/^~/, process.env['HOME'] ?? '~'));
  if (!existsSync(resolved)) {
    throw new Error(`Private key file not found: ${resolved}`);
  }
  return readFileSync(resolved, 'utf8').trim();
}

function parseConfig(argv: string[]): DoctorConfig {
  const repo = getArg(argv, '--repo') ?? process.env['FERRY_DOCTOR_REPO'] ?? detectRepo() ?? '';

  const appId = getArg(argv, '--app-id') ?? process.env['FERRY_APP_ID'] ?? '';

  let privateKey = getArg(argv, '--private-key') ?? process.env['FERRY_PRIVATE_KEY'] ?? '';
  const pkPath = getArg(argv, '--private-key-path');
  if (pkPath && !privateKey) {
    try {
      privateKey = readPrivateKey(pkPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Warning: ${msg}\n`);
    }
  }

  return {
    repo,
    appId,
    privateKey,
    jiraBaseUrl: getArg(argv, '--jira-url') ?? process.env['FERRY_JIRA_BASE_URL'] ?? '',
    jiraEmail: getArg(argv, '--jira-email') ?? process.env['FERRY_JIRA_EMAIL'] ?? '',
    jiraApiToken: getArg(argv, '--jira-token') ?? process.env['FERRY_JIRA_API_TOKEN'] ?? '',
    jiraProjectKey: getArg(argv, '--jira-project') ?? process.env['FERRY_JIRA_PROJECT_KEY'] ?? '',
    anthropicApiKey:
      getArg(argv, '--anthropic-key') ?? process.env['FERRY_ANTHROPIC_API_KEY'] ?? '',
    ferryVersion: getArg(argv, '--version') ?? 'v1',
    repoRoot: getArg(argv, '--repo-root') ?? process.cwd(),
    noDispatch: hasFlag(argv, '--no-dispatch'),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    process.stdout.write(`
ferry doctor — end-to-end health check for a Ferry installation

Usage:
  npx -p @big-emotion/ferry ferry-doctor [options]

Options:
  --repo <owner/repo>          GitHub repository (default: auto-detect from git remote)
  --app-id <id>                GitHub App ID (default: FERRY_APP_ID env var)
  --private-key <pem>          GitHub App private key PEM string (default: FERRY_PRIVATE_KEY)
  --private-key-path <path>    Path to the .pem file (alternative to --private-key)
  --jira-url <url>             Jira base URL (default: FERRY_JIRA_BASE_URL)
  --jira-email <email>         Jira account email (default: FERRY_JIRA_EMAIL)
  --jira-token <token>         Jira API token (default: FERRY_JIRA_API_TOKEN)
  --jira-project <key>         Jira project key to verify (default: FERRY_JIRA_PROJECT_KEY)
  --anthropic-key <key>        Anthropic API key (default: FERRY_ANTHROPIC_API_KEY)
  --version <tag>              Ferry version tag for workflow drift check (default: v1)
  --repo-root <path>           Path to the repo root (default: cwd)
  --no-dispatch                Skip the synthetic dispatch probe
  -h, --help                   Show this help

Checks run in order:
  1. Secrets present        — all 6 FERRY_* repo secrets exist
  2. GitHub App             — mint installation token, verify permissions
  3. Jira reachable         — /myself + project key resolution
  4. LLM keys valid         — 1-token Anthropic sanity call
  5. Synthetic dispatch     — trigger ferry-refine + poll for run start
  6. Workflow files         — compare .github/workflows/ferry-*.yml vs current release
  7. Prompt overrides       — warn on full prompts/<agent>.md overrides; suggest .extra.md

Exit code: 0 if all checks green/yellow, 1 if any check red.
`);
    process.exit(0);
  }

  const config = parseConfig(argv);

  if (!config.repo) {
    process.stderr.write(
      'Error: could not detect GitHub repo. Pass --repo owner/repo or run inside a git checkout.\n',
    );
    process.exit(1);
  }

  process.stdout.write(`\n  ferry doctor — checking ${config.repo}\n`);

  const results = await Promise.all([
    checkSecrets(config.repo),
    checkGitHubApp({
      appId: config.appId,
      privateKey: config.privateKey,
      repo: config.repo,
    }),
    checkJira({
      jiraBaseUrl: config.jiraBaseUrl,
      jiraEmail: config.jiraEmail,
      jiraApiToken: config.jiraApiToken,
      jiraProjectKey: config.jiraProjectKey,
    }),
    checkLlmKeys({ anthropicApiKey: config.anthropicApiKey }),
    checkSyntheticDispatch({ repo: config.repo, noDispatch: config.noDispatch }),
    checkWorkflowDrift({ repoRoot: config.repoRoot, ferryVersion: config.ferryVersion }),
    checkPromptOverrides({ repoRoot: config.repoRoot }),
  ]);

  process.stdout.write(renderTable(results));

  const anyRed = results.some((r) => r.status === 'red');
  process.exit(anyRed ? 1 : 0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Unexpected error: ${msg}\n`);
  process.exit(1);
});
