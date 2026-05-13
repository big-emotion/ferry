import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpsGet = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsGet: mockHttpsGet,
  httpsPost: vi.fn(),
}));

import {
  probeProjectAccess,
  probeTokenScopes,
  probePipelineTrigger,
  probeProjectVariables,
  probeJiraWebhookManual,
  REQUIRED_PROJECT_VARIABLES,
} from './probes.js';

const BASE_OPTS = {
  apiBase: 'https://gitlab.com/api/v4',
  token: 'glpat-xxxxxxxxxxxxxxxxxxxx',
  projectPath: 'org/repo',
  triggerToken: 'tkn-yyyyyyyyyyyyyyyyyyyy',
};

describe('probeProjectAccess', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns skip when token is empty', async () => {
    const r = await probeProjectAccess({ ...BASE_OPTS, token: '' });
    expect(r.status).toBe('skip');
    expect(r.detail).toContain('No GitLab token');
  });

  it('returns skip when projectPath is empty', async () => {
    const r = await probeProjectAccess({ ...BASE_OPTS, projectPath: '' });
    expect(r.status).toBe('skip');
    expect(r.detail).toContain('project path');
  });

  it('returns red on 401 (token invalid)', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 401, body: '{"message":"401 Unauthorized"}' });
    const r = await probeProjectAccess(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('401');
    expect(r.remedy).toMatch(/api.*read_repository/);
  });

  it('returns red on 404 (project not found / no access)', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 404, body: '{"message":"404 Not Found"}' });
    const r = await probeProjectAccess(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('404');
    expect(r.remedy).toContain('org/repo');
  });

  it('returns red on network failure', async () => {
    mockHttpsGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await probeProjectAccess(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('Network error');
  });

  it('returns red on unexpected non-200 status', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 500, body: '' });
    const r = await probeProjectAccess(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('500');
  });

  it('returns green when project is fetched (200)', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ id: 42, path_with_namespace: 'org/repo' }),
    });
    const r = await probeProjectAccess(BASE_OPTS);
    expect(r.status).toBe('green');
    expect(r.detail).toContain('42');
    expect(r.detail).toContain('org/repo');
  });

  it('URL-encodes the project path before GET /projects/:id', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ id: 1, path_with_namespace: 'group/sub/repo' }),
    });
    await probeProjectAccess({ ...BASE_OPTS, projectPath: 'group/sub/repo' });
    expect(mockHttpsGet).toHaveBeenCalledTimes(1);
    const opts = mockHttpsGet.mock.calls[0]![0] as { path: string };
    expect(opts.path).toBe('/api/v4/projects/group%2Fsub%2Frepo');
  });
});

describe('probeTokenScopes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns skip when token is empty', async () => {
    const r = await probeTokenScopes({ ...BASE_OPTS, token: '' });
    expect(r.status).toBe('skip');
  });

  it('returns red on 401', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 401, body: '' });
    const r = await probeTokenScopes(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('401');
  });

  it('returns red when api scope is missing', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ scopes: ['read_user'], active: true, revoked: false }),
    });
    const r = await probeTokenScopes(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('api');
    expect(r.remedy).toMatch(/api/);
  });

  it('returns red when token is revoked', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ scopes: ['api'], active: false, revoked: true }),
    });
    const r = await probeTokenScopes(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toMatch(/revoked|inactive/i);
  });

  it('returns yellow when /personal_access_tokens/self returns 404 (project access token)', async () => {
    // GitLab project access tokens may not expose /personal_access_tokens/self.
    mockHttpsGet.mockResolvedValue({ statusCode: 404, body: '' });
    const r = await probeTokenScopes(BASE_OPTS);
    expect(r.status).toBe('yellow');
    expect(r.detail).toMatch(/cannot introspect|project access token/i);
  });

  it('returns green when scopes include api', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ scopes: ['api', 'read_repository'], active: true, revoked: false }),
    });
    const r = await probeTokenScopes(BASE_OPTS);
    expect(r.status).toBe('green');
    expect(r.detail).toContain('api');
  });

  it('returns red on network error', async () => {
    mockHttpsGet.mockRejectedValue(new Error('ETIMEDOUT'));
    const r = await probeTokenScopes(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('Network error');
  });
});

describe('probePipelineTrigger', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns skip when triggerToken is empty', async () => {
    const r = await probePipelineTrigger({ ...BASE_OPTS, triggerToken: '' });
    expect(r.status).toBe('skip');
    expect(r.detail).toMatch(/no pipeline trigger token/i);
  });

  it('returns skip when projectPath is empty', async () => {
    const r = await probePipelineTrigger({ ...BASE_OPTS, projectPath: '' });
    expect(r.status).toBe('skip');
  });

  it('returns red on 401', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 401, body: '' });
    const r = await probePipelineTrigger(BASE_OPTS);
    expect(r.status).toBe('red');
  });

  it('returns red on 403 (token lacks api scope)', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 403, body: '' });
    const r = await probePipelineTrigger(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('403');
    expect(r.remedy).toMatch(/api/);
  });

  it('returns red when triggers list is empty', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: '[]' });
    const r = await probePipelineTrigger(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toMatch(/no pipeline triggers/i);
  });

  it('returns red when configured trigger token is not present in the list', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify([{ id: 1, token: 'different-token', description: 'other' }]),
    });
    const r = await probePipelineTrigger(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toMatch(/not (found|registered)/i);
  });

  it('returns green when the configured trigger token is present (full match)', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify([
        { id: 7, token: BASE_OPTS.triggerToken, description: 'ferry-dispatch' },
      ]),
    });
    const r = await probePipelineTrigger(BASE_OPTS);
    expect(r.status).toBe('green');
    expect(r.detail).toMatch(/trigger #?7|trigger.*7/);
  });

  it('returns green when the configured trigger token matches by short prefix (GitLab masks tokens)', async () => {
    const fullToken = 'glptt-1234567890abcdefghij';
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      // GitLab returns only the first 4 chars of the token in some responses.
      body: JSON.stringify([{ id: 9, token: 'glpt', description: 'ferry-dispatch' }]),
    });
    const r = await probePipelineTrigger({ ...BASE_OPTS, triggerToken: fullToken });
    expect(r.status).toBe('green');
  });

  it('returns red on network error', async () => {
    mockHttpsGet.mockRejectedValue(new Error('boom'));
    const r = await probePipelineTrigger(BASE_OPTS);
    expect(r.status).toBe('red');
  });
});

describe('probeProjectVariables', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exports the documented required-key list', () => {
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_VERSION');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_JIRA_BASE_URL');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_JIRA_EMAIL');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_JIRA_API_TOKEN');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_GITLAB_TOKEN');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_REVIEW_TRANSITION_ID');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_ITER_TRANSITION_ID');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_APPROVE_TRANSITION_ID');
    expect(REQUIRED_PROJECT_VARIABLES).toContain('FERRY_AUDIT_ISSUE');
  });

  it('returns skip when token is empty', async () => {
    const r = await probeProjectVariables({ ...BASE_OPTS, token: '' });
    expect(r.status).toBe('skip');
  });

  it('returns red on 401', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 401, body: '' });
    const r = await probeProjectVariables(BASE_OPTS);
    expect(r.status).toBe('red');
  });

  it('returns red on 403 (insufficient scope/role)', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 403, body: '' });
    const r = await probeProjectVariables(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain('403');
  });

  it('returns red and lists every missing required key when none are set', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: '[]' });
    const r = await probeProjectVariables(BASE_OPTS);
    expect(r.status).toBe('red');
    for (const key of REQUIRED_PROJECT_VARIABLES) {
      expect(r.detail).toContain(key);
    }
  });

  it('returns red and only lists missing keys', async () => {
    const present = REQUIRED_PROJECT_VARIABLES.slice(0, REQUIRED_PROJECT_VARIABLES.length - 1).map(
      (key) => ({ key, variable_type: 'env_var' }),
    );
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(present) });
    const missingKey = REQUIRED_PROJECT_VARIABLES[REQUIRED_PROJECT_VARIABLES.length - 1]!;
    const r = await probeProjectVariables(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toContain(missingKey);
    // The first key should not appear (it is set)
    const firstKey = REQUIRED_PROJECT_VARIABLES[0]!;
    expect(r.detail).not.toContain(firstKey);
  });

  it('returns yellow when at least one LLM key is set but token-bearing vars are unmasked', async () => {
    // All required keys present + LLM key, but the token-bearing ones aren't masked.
    const vars = [
      ...REQUIRED_PROJECT_VARIABLES.map((key) => ({
        key,
        variable_type: 'env_var',
        masked: false,
        protected: true,
      })),
      { key: 'ANTHROPIC_API_KEY', variable_type: 'env_var', masked: true, protected: true },
    ];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(vars) });
    const r = await probeProjectVariables(BASE_OPTS);
    expect(r.status).toBe('yellow');
    expect(r.detail).toMatch(/unmasked|not masked/i);
  });

  it('returns red when no LLM key is set even if all FERRY_* are present', async () => {
    const vars = REQUIRED_PROJECT_VARIABLES.map((key) => ({
      key,
      variable_type: 'env_var',
      masked: true,
      protected: true,
    }));
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(vars) });
    const r = await probeProjectVariables(BASE_OPTS);
    expect(r.status).toBe('red');
    expect(r.detail).toMatch(/llm key|ANTHROPIC_API_KEY/i);
  });

  it('returns green when all required keys and one LLM key are present and masked', async () => {
    const vars = [
      ...REQUIRED_PROJECT_VARIABLES.map((key) => ({
        key,
        variable_type: 'env_var',
        masked: true,
        protected: true,
      })),
      { key: 'OPENAI_API_KEY', variable_type: 'env_var', masked: true, protected: true },
    ];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(vars) });
    const r = await probeProjectVariables(BASE_OPTS);
    expect(r.status).toBe('green');
    expect(r.detail).toMatch(/all required/i);
  });
});

describe('probeJiraWebhookManual', () => {
  it('returns skip (manual) — never probes the network', async () => {
    const r = await probeJiraWebhookManual();
    expect(r.status).toBe('skip');
    expect(r.label.toLowerCase()).toContain('jira');
    expect(r.detail.toLowerCase()).toContain('manual');
    expect(r.remedy).toBeTruthy();
  });
});
