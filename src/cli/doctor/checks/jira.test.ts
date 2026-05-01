import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpsGet = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsGet: mockHttpsGet,
  httpsPost: vi.fn(),
}));

import { checkJira } from './jira.js';

const VALID_OPTS = {
  jiraBaseUrl: 'https://acme.atlassian.net',
  jiraEmail: 'bot@acme.com',
  jiraApiToken: 'token-xyz',
  jiraProjectKey: 'ACME',
};

describe('checkJira', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns skip when jiraBaseUrl is missing', async () => {
    const result = await checkJira({ ...VALID_OPTS, jiraBaseUrl: '' });
    expect(result.status).toBe('skip');
  });

  it('returns skip when jiraEmail is missing', async () => {
    const result = await checkJira({ ...VALID_OPTS, jiraEmail: '' });
    expect(result.status).toBe('skip');
  });

  it('returns skip when jiraApiToken is missing', async () => {
    const result = await checkJira({ ...VALID_OPTS, jiraApiToken: '' });
    expect(result.status).toBe('skip');
  });

  it('returns red for invalid jiraBaseUrl', async () => {
    const result = await checkJira({ ...VALID_OPTS, jiraBaseUrl: 'not-a-url' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Invalid Jira URL');
  });

  it('returns red for 401 from /myself', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 401, body: '' });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Authentication failed');
  });

  it('returns red for 403 from /myself', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 403, body: '' });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Authentication failed');
  });

  it('returns red for unexpected status from /myself', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 500, body: '' });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Unexpected status 500');
  });

  it('returns red for network error reaching /myself', async () => {
    mockHttpsGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Network error');
  });

  it('returns green when authenticated but no project key provided', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ displayName: 'Ferry Bot', emailAddress: 'bot@acme.com' }),
    });
    const result = await checkJira({ ...VALID_OPTS, jiraProjectKey: '' });
    expect(result.status).toBe('green');
    expect(result.detail).toContain('Ferry Bot');
  });

  it('returns red when project key returns 404', async () => {
    mockHttpsGet
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ displayName: 'Ferry Bot' }),
      })
      .mockResolvedValueOnce({ statusCode: 404, body: '' });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not found');
  });

  it('returns yellow when project check returns unexpected status', async () => {
    mockHttpsGet
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ displayName: 'Ferry Bot' }),
      })
      .mockResolvedValueOnce({ statusCode: 403, body: '' });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('403');
  });

  it('returns green when project resolves successfully', async () => {
    mockHttpsGet
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ displayName: 'Ferry Bot' }),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ key: 'ACME', name: 'Acme Project' }),
      });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('green');
    expect(result.detail).toContain('Acme Project');
    expect(result.detail).toContain('ACME');
  });

  it('returns yellow when project check throws a network error', async () => {
    mockHttpsGet
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ displayName: 'Ferry Bot' }),
      })
      .mockRejectedValueOnce(new Error('timeout'));
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('project check failed');
  });

  it('uses jiraEmail as displayName when displayName is absent', async () => {
    mockHttpsGet
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ emailAddress: 'bot@acme.com' }),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ key: 'ACME', name: 'Acme' }),
      });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('green');
  });

  it('uses project key as name when name is absent in project response', async () => {
    mockHttpsGet
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ displayName: 'Ferry Bot' }),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ key: 'ACME' }),
      });
    const result = await checkJira(VALID_OPTS);
    expect(result.status).toBe('green');
    expect(result.detail).toContain('ACME');
  });
});
