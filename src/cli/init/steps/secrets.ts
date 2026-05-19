import { execSync } from 'node:child_process';
import { printSuccess, printSkip, printError } from '../prompt.js';
import type { ExecutionPath } from '../../../lib/config.js';
import type { SecretEntry, StepResult } from '../types.js';

export function buildSecrets(config: {
  appId: string;
  privateKey: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  executionPath?: ExecutionPath;
  claudeCodeOauthToken?: string;
}): SecretEntry[] {
  const secrets: SecretEntry[] = [
    { name: 'FERRY_APP_ID', value: config.appId, description: 'GitHub App numeric ID' },
    {
      name: 'FERRY_PRIVATE_KEY',
      value: config.privateKey,
      description: 'GitHub App RSA private key (PEM)',
    },
    { name: 'FERRY_JIRA_BASE_URL', value: config.jiraBaseUrl, description: 'Jira instance URL' },
    { name: 'FERRY_JIRA_EMAIL', value: config.jiraEmail, description: 'Jira account email' },
    {
      name: 'FERRY_JIRA_API_TOKEN',
      value: config.jiraApiToken,
      description: 'Atlassian API token',
    },
  ];

  if (config.executionPath === 'claude-code') {
    // ADR-0006 §6 / decisions-0002 §A: the claude-code path authenticates
    // EXCLUSIVELY with CLAUDE_CODE_OAUTH_TOKEN — ANTHROPIC_API_KEY is forbidden.
    secrets.push({
      name: 'CLAUDE_CODE_OAUTH_TOKEN',
      value: config.claudeCodeOauthToken ?? '',
      description: 'Claude Code OAuth token (claude setup-token; Claude Pro/Max subscription)',
    });
  } else {
    secrets.push({
      name: 'ANTHROPIC_API_KEY',
      value: config.anthropicApiKey ?? '',
      description: 'Anthropic API key',
    });
  }

  if (config.openaiApiKey) {
    secrets.push({
      name: 'OPENAI_API_KEY',
      value: config.openaiApiKey,
      description: 'OpenAI API key',
    });
  }
  if (config.googleApiKey) {
    secrets.push({
      name: 'GOOGLE_API_KEY',
      value: config.googleApiKey,
      description: 'Google AI API key',
    });
  }

  return secrets;
}

export function listExistingSecrets(repo: string): string[] {
  try {
    const output = execSync(`gh secret list --repo ${repo} --json name`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output) as Array<{ name: string }>;
    return parsed.map((s) => s.name);
  } catch {
    return [];
  }
}

export function setSecret(repo: string, name: string, value: string): void {
  execSync(`gh secret set ${name} --repo ${repo}`, {
    input: value,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function stepSecrets(
  repo: string,
  secrets: SecretEntry[],
  overwrite: boolean,
): Promise<StepResult> {
  const existing = listExistingSecrets(repo);
  const errors: string[] = [];

  for (const secret of secrets) {
    if (existing.includes(secret.name) && !overwrite) {
      printSkip(`${secret.name} already set — skipping`);
      continue;
    }
    try {
      setSecret(repo, secret.name, secret.value);
      printSuccess(`Set ${secret.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(`Failed to set ${secret.name}: ${msg}`);
      errors.push(secret.name);
    }
  }

  if (errors.length > 0) {
    return { ok: false, reason: `Failed to set secrets: ${errors.join(', ')}` };
  }
  return { ok: true };
}
