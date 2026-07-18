import { execSync } from 'node:child_process';
import { resolveExecutionPath } from './claude-code-path.js';
import type { CheckResult } from '../types.js';

const BASE_REQUIRED_SECRETS = [
  'FERRY_APP_ID',
  'FERRY_PRIVATE_KEY',
  'FERRY_JIRA_BASE_URL',
  'FERRY_JIRA_EMAIL',
  'FERRY_JIRA_API_TOKEN',
];

// The provider secret depends on the execution path: the claude-code path
// authenticates with CLAUDE_CODE_OAUTH_TOKEN and FORBIDS ANTHROPIC_API_KEY
// (ADR-0006 §6) — requiring the API key there would make a healthy install
// permanently red while the token-exclusivity check asks to delete it.
function requiredSecretsFor(repoRoot: string | undefined): string[] {
  const path = repoRoot ? resolveExecutionPath(repoRoot) : 'script';
  const providerSecret = path === 'claude-code' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY';
  return [...BASE_REQUIRED_SECRETS, providerSecret];
}

// Optional overrides: when absent, agents auto-resolve transition ids from the
// status names in ferry.config (workflow.agents.*) — see resolveConfiguredTransitionId.
const OPTIONAL_TRANSITION_SECRETS = [
  'FERRY_REVIEW_TRANSITION_ID',
  'FERRY_ITER_TRANSITION_ID',
  'FERRY_APPROVE_TRANSITION_ID',
  'FERRY_MERGE_DONE_TRANSITION_ID',
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

export function checkSecrets(repo: string, repoRoot?: string): CheckResult {
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

  const required = requiredSecretsFor(repoRoot);
  const missing = required.filter((s) => !existing.includes(s));

  if (missing.length === 0) {
    const anyTransitionOverride = OPTIONAL_TRANSITION_SECRETS.some((s) => existing.includes(s));
    const autoResolveNote = anyTransitionOverride
      ? ''
      : ' (no transition-id override secrets set — ids auto-resolve from ferry.config status names)';
    return {
      label: 'Secrets present',
      status: 'green',
      detail: `All ${required.length} required secrets found${autoResolveNote}`,
    };
  }

  return {
    label: 'Secrets present',
    status: 'red',
    detail: `Missing: ${missing.join(', ')}`,
    remedy: `Run \`npx -p @big-emotion/ferry ferry-init\` to set the missing secrets, or set them manually via \`gh secret set <NAME> --repo ${repo}\``,
  };
}
