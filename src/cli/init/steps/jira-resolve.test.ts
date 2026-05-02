import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpsGet = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsGet: mockHttpsGet,
  httpsPost: vi.fn(),
}));

import { resolveJiraWorkspaceId, resolveJiraProjectId } from './jira-resolve.js';

const BASE_URL = 'https://acme.atlassian.net';
const EMAIL = 'bot@acme.com';
const TOKEN = 'api-token-abc';

describe('resolveJiraWorkspaceId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns cloudId on a 200 response', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ cloudId: '75eb33f5-5dd0-4328-b0e6-8bb3f4e0af91' }),
    });
    const result = await resolveJiraWorkspaceId(BASE_URL, EMAIL, TOKEN);
    expect(result).toBe('75eb33f5-5dd0-4328-b0e6-8bb3f4e0af91');
  });

  it('calls /_edge/tenant_info on the correct hostname', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ cloudId: 'abc' }) });
    await resolveJiraWorkspaceId(BASE_URL, EMAIL, TOKEN);
    const call = mockHttpsGet.mock.calls[0]?.[0] as { hostname: string; path: string };
    expect(call.hostname).toBe('acme.atlassian.net');
    expect(call.path).toContain('/_edge/tenant_info');
  });

  it('returns null when status is not 200', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 401, body: 'Unauthorized' });
    const result = await resolveJiraWorkspaceId(BASE_URL, EMAIL, TOKEN);
    expect(result).toBeNull();
  });

  it('returns null when cloudId is absent from response', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify({}) });
    const result = await resolveJiraWorkspaceId(BASE_URL, EMAIL, TOKEN);
    expect(result).toBeNull();
  });

  it('returns null when httpsGet throws a network error', async () => {
    mockHttpsGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await resolveJiraWorkspaceId(BASE_URL, EMAIL, TOKEN);
    expect(result).toBeNull();
  });

  it('returns null when baseUrl is invalid', async () => {
    const result = await resolveJiraWorkspaceId('not-a-url', EMAIL, TOKEN);
    expect(result).toBeNull();
  });

  it('sends Basic auth header', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ cloudId: 'x' }) });
    await resolveJiraWorkspaceId(BASE_URL, EMAIL, TOKEN);
    const call = mockHttpsGet.mock.calls[0]?.[0] as { headers: Record<string, string> };
    expect(call.headers['Authorization']).toMatch(/^Basic /);
  });
});

describe('resolveJiraProjectId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns numeric project id on a 200 response', async () => {
    mockHttpsGet.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ id: '10033', key: 'CHAN', name: 'Channel' }),
    });
    const result = await resolveJiraProjectId(BASE_URL, EMAIL, TOKEN, 'CHAN');
    expect(result).toBe('10033');
  });

  it('calls /rest/api/3/project/<key> on the correct hostname', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ id: '10033' }) });
    await resolveJiraProjectId(BASE_URL, EMAIL, TOKEN, 'CHAN');
    const call = mockHttpsGet.mock.calls[0]?.[0] as { hostname: string; path: string };
    expect(call.hostname).toBe('acme.atlassian.net');
    expect(call.path).toContain('/rest/api/3/project/CHAN');
  });

  it('URL-encodes the project key', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ id: '10034' }) });
    await resolveJiraProjectId(BASE_URL, EMAIL, TOKEN, 'MY PROJECT');
    const call = mockHttpsGet.mock.calls[0]?.[0] as { path: string };
    expect(call.path).toContain('MY%20PROJECT');
  });

  it('returns null when status is 404', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 404, body: 'Not Found' });
    const result = await resolveJiraProjectId(BASE_URL, EMAIL, TOKEN, 'MISSING');
    expect(result).toBeNull();
  });

  it('returns null when id field is absent', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ key: 'CHAN' }) });
    const result = await resolveJiraProjectId(BASE_URL, EMAIL, TOKEN, 'CHAN');
    expect(result).toBeNull();
  });

  it('returns null when httpsGet throws a network error', async () => {
    mockHttpsGet.mockRejectedValue(new Error('timeout'));
    const result = await resolveJiraProjectId(BASE_URL, EMAIL, TOKEN, 'CHAN');
    expect(result).toBeNull();
  });

  it('sends Basic auth header', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ id: '10033' }) });
    await resolveJiraProjectId(BASE_URL, EMAIL, TOKEN, 'CHAN');
    const call = mockHttpsGet.mock.calls[0]?.[0] as { headers: Record<string, string> };
    expect(call.headers['Authorization']).toMatch(/^Basic /);
  });
});
