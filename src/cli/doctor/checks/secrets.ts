import { execSync } from 'node:child_process';
import type { CheckResult } from '../types.js';

const REQUIRED_SECRETS = [
  'FERRY_APP_ID',
  'FERRY_PRIVATE_KEY',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
  'FERRY_ANTHROPIC_API_KEY',
];

export function listRepoSecrets(repo: string): string[] {
  try {
    const out = execSync(`gh secret list --repo ${repo} --json name`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(out) as Array<{ name: string }>;
    return parsed.map((s) => s.name);
  } catch {
    return [];
  }
}

export function checkSecrets(repo: string): CheckResult {
  let existing: string[];
  try {
    existing = listRepoSecrets(repo);
  } catch {
    return {
      label: 'Secrets present',
      status: 'red',
      detail: 'Could not query secrets — is gh CLI authenticated?',
      remedy: 'Run `gh auth status` and re-authenticate if needed',
    };
  }

  const missing = REQUIRED_SECRETS.filter((s) => !existing.includes(s));

  if (missing.length === 0) {
    return {
      label: 'Secrets present',
      status: 'green',
      detail: `All ${REQUIRED_SECRETS.length} FERRY_* secrets found`,
    };
  }

  return {
    label: 'Secrets present',
    status: 'red',
    detail: `Missing: ${missing.join(', ')}`,
    remedy: `Run \`npx -p @big-emotion/ferry ferry-init\` to set the missing secrets, or set them manually via \`gh secret set <NAME> --repo ${repo}\``,
  };
}
