import { describe, it, expect, vi, beforeEach } from 'vitest';

const probeProjectAccess = vi.hoisted(() => vi.fn());
const probeTokenScopes = vi.hoisted(() => vi.fn());
const probePipelineTrigger = vi.hoisted(() => vi.fn());
const probeProjectVariables = vi.hoisted(() => vi.fn());
const probeJiraWebhookManual = vi.hoisted(() => vi.fn());

vi.mock('./probes.js', () => ({
  probeProjectAccess,
  probeTokenScopes,
  probePipelineTrigger,
  probeProjectVariables,
  probeJiraWebhookManual,
}));

import { runGitLabDoctor, parseGitLabConfig } from './index.js';

describe('parseGitLabConfig', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.FERRY_GITLAB_TOKEN;
    delete process.env.FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN;
    delete process.env.FERRY_GITLAB_PROJECT_PATH;
    delete process.env.FERRY_GITLAB_API_BASE;
  });

  it('falls back to env vars when flags are absent', () => {
    process.env.FERRY_GITLAB_TOKEN = 'env-token';
    process.env.FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN = 'env-trigger';
    process.env.FERRY_GITLAB_PROJECT_PATH = 'env/path';
    process.env.FERRY_GITLAB_API_BASE = 'https://gitlab.example/api/v4';
    const cfg = parseGitLabConfig([]);
    expect(cfg.token).toBe('env-token');
    expect(cfg.triggerToken).toBe('env-trigger');
    expect(cfg.projectPath).toBe('env/path');
    expect(cfg.apiBase).toBe('https://gitlab.example/api/v4');
  });

  it('flags override env vars', () => {
    process.env.FERRY_GITLAB_TOKEN = 'env';
    const cfg = parseGitLabConfig(['--token', 'flag-token']);
    expect(cfg.token).toBe('flag-token');
  });

  it('defaults apiBase to https://gitlab.com/api/v4', () => {
    const cfg = parseGitLabConfig([]);
    expect(cfg.apiBase).toBe('https://gitlab.com/api/v4');
  });
});

describe('runGitLabDoctor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    probeProjectAccess.mockResolvedValue({
      label: 'GitLab project access',
      status: 'green',
      detail: 'ok',
    });
    probeTokenScopes.mockResolvedValue({
      label: 'GitLab token scopes',
      status: 'green',
      detail: 'ok',
    });
    probePipelineTrigger.mockResolvedValue({
      label: 'GitLab pipeline trigger',
      status: 'green',
      detail: 'ok',
    });
    probeProjectVariables.mockResolvedValue({
      label: 'GitLab CI/CD variables',
      status: 'green',
      detail: 'ok',
    });
    probeJiraWebhookManual.mockResolvedValue({
      label: 'Jira → GitLab webhook',
      status: 'skip',
      detail: '[MANUAL] confirm manually',
    });
  });

  it('returns exit code 0 when no probe is red', async () => {
    const code = await runGitLabDoctor({
      apiBase: 'https://gitlab.com/api/v4',
      token: 't',
      projectPath: 'org/repo',
      triggerToken: 'tt',
      write: () => undefined,
    });
    expect(code).toBe(0);
  });

  it('returns exit code 1 when any probe is red', async () => {
    probeTokenScopes.mockResolvedValue({
      label: 'GitLab token scopes',
      status: 'red',
      detail: 'missing api scope',
    });
    const code = await runGitLabDoctor({
      apiBase: 'https://gitlab.com/api/v4',
      token: 't',
      projectPath: 'org/repo',
      triggerToken: 'tt',
      write: () => undefined,
    });
    expect(code).toBe(1);
  });

  it('invokes all 5 probes', async () => {
    await runGitLabDoctor({
      apiBase: 'https://gitlab.com/api/v4',
      token: 't',
      projectPath: 'org/repo',
      triggerToken: 'tt',
      write: () => undefined,
    });
    expect(probeProjectAccess).toHaveBeenCalledTimes(1);
    expect(probeTokenScopes).toHaveBeenCalledTimes(1);
    expect(probePipelineTrigger).toHaveBeenCalledTimes(1);
    expect(probeProjectVariables).toHaveBeenCalledTimes(1);
    expect(probeJiraWebhookManual).toHaveBeenCalledTimes(1);
  });

  it('renders results to the supplied write function', async () => {
    let captured = '';
    const code = await runGitLabDoctor({
      apiBase: 'https://gitlab.com/api/v4',
      token: 't',
      projectPath: 'org/repo',
      triggerToken: 'tt',
      write: (s: string) => {
        captured += s;
      },
    });
    expect(code).toBe(0);
    expect(captured).toContain('GitLab project access');
    expect(captured).toContain('Jira');
    expect(captured).toContain('[MANUAL]');
  });
});
