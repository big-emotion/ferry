import type { CheckResult } from '../types.js';

interface EnvVarRule {
  key: string;
  label: string;
  validate: (val: number) => string | null;
}

const ENV_VAR_RULES: EnvVarRule[] = [
  {
    key: 'FERRY_HTTP_TIMEOUT_MS',
    label: 'FERRY_HTTP_TIMEOUT_MS',
    validate: (v) => (v < 1000 ? 'timeout below 1000 ms is dangerously low' : null),
  },
  {
    key: 'FERRY_DISPATCH_POLL_INTERVAL_MS',
    label: 'FERRY_DISPATCH_POLL_INTERVAL_MS',
    validate: (v) => (v < 1000 ? 'poll interval below 1000 ms will hammer the API' : null),
  },
  {
    key: 'FERRY_DISPATCH_PROBE_TIMEOUT_MS',
    label: 'FERRY_DISPATCH_PROBE_TIMEOUT_MS',
    validate: (v) => (v < 1000 ? 'timeout below 1000 ms is too short to observe a workflow start' : null),
  },
  {
    key: 'FERRY_LLM_RETRY_MAX_ATTEMPTS',
    label: 'FERRY_LLM_RETRY_MAX_ATTEMPTS',
    validate: (v) => (v === 0 ? 'retry count of 0 disables all LLM retries' : null),
  },
  {
    key: 'FERRY_LLM_RETRY_BASE_DELAY_MS',
    label: 'FERRY_LLM_RETRY_BASE_DELAY_MS',
    validate: (v) => (v < 100 ? 'retry base delay below 100 ms risks rate-limit cascades' : null),
  },
  {
    key: 'FERRY_LLM_UTILITY_MAX_TOKENS',
    label: 'FERRY_LLM_UTILITY_MAX_TOKENS',
    validate: (v) => (v < 64 ? 'max_tokens below 64 will truncate almost all LLM responses' : null),
  },
  {
    key: 'FERRY_BUDGET_ALERT_RATIO',
    label: 'FERRY_BUDGET_ALERT_RATIO',
    validate: (v) =>
      v <= 0 || v > 1 ? 'alert ratio must be between 0 (exclusive) and 1 (inclusive)' : null,
  },
  {
    key: 'FERRY_AUDIT_ROTATION_THRESHOLD',
    label: 'FERRY_AUDIT_ROTATION_THRESHOLD',
    validate: (v) =>
      v < 10 ? 'rotation threshold below 10 will rotate audit issues too aggressively' : null,
  },
  {
    key: 'FERRY_BASH_TIMEOUT_MS',
    label: 'FERRY_BASH_TIMEOUT_MS',
    validate: (v) => (v < 1000 ? 'bash timeout below 1000 ms will kill most commands immediately' : null),
  },
  {
    key: 'FERRY_BASH_TIMEOUT_MAX_MS',
    label: 'FERRY_BASH_TIMEOUT_MAX_MS',
    validate: (v) => (v < 1000 ? 'max bash timeout below 1000 ms is too restrictive' : null),
  },
  {
    key: 'FERRY_JIRA_RETRY_MAX_ATTEMPTS',
    label: 'FERRY_JIRA_RETRY_MAX_ATTEMPTS',
    validate: (v) => (v === 0 ? 'Jira retry count of 0 disables all retries' : null),
  },
];

export function checkEnvVarSanity(): CheckResult {
  const warnings: string[] = [];

  for (const rule of ENV_VAR_RULES) {
    const raw = process.env[rule.key];
    if (raw === undefined || raw === '') continue;

    const parsed = rule.key === 'FERRY_BUDGET_ALERT_RATIO' ? parseFloat(raw) : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      warnings.push(`${rule.label}="${raw}" is not a valid number`);
      continue;
    }
    const msg = rule.validate(parsed);
    if (msg) {
      warnings.push(`${rule.label}=${parsed}: ${msg}`);
    }
  }

  if (warnings.length === 0) {
    return {
      label: 'Env var sanity',
      status: 'green',
      detail: 'All Ferry env var overrides are within safe ranges',
    };
  }

  return {
    label: 'Env var sanity',
    status: 'yellow',
    detail: warnings.join('; '),
    remedy: 'Review the flagged env vars and correct the values',
  };
}
