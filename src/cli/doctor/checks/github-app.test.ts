import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const mockHttpsGet = vi.hoisted(() => vi.fn());
const mockHttpsPost = vi.hoisted(() => vi.fn());

vi.mock('../../http.js', () => ({
  httpsGet: mockHttpsGet,
  httpsPost: mockHttpsPost,
}));

import { checkGitHubApp } from './github-app.js';

const ALL_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  issues: 'write',
  metadata: 'read',
};

let validPem: string;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  validPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
});

describe('checkGitHubApp', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns skip when appId is empty', async () => {
    const result = await checkGitHubApp({ appId: '', privateKey: 'key', repo: 'org/repo' });
    expect(result.status).toBe('skip');
  });

  it('returns skip when privateKey is empty', async () => {
    const result = await checkGitHubApp({ appId: '123', privateKey: '', repo: 'org/repo' });
    expect(result.status).toBe('skip');
  });

  it('returns red for invalid private key (JWT sign failure)', async () => {
    const result = await checkGitHubApp({
      appId: '123',
      privateKey: 'not-a-valid-pem',
      repo: 'org/repo',
    });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Could not sign JWT');
  });

  it('returns red when installations returns 401', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 401, body: '' });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('JWT rejected');
  });

  it('returns red when installations returns unexpected status', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 500, body: '' });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('500');
  });

  it('returns red when network error reaching installations', async () => {
    mockHttpsGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Network error');
  });

  it('returns red when app has no installations', async () => {
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: '[]' });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('no installations');
  });

  it('returns red when access token creation returns non-201', async () => {
    const installations = [{ id: 1, account: { login: 'org' } }];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(installations) });
    mockHttpsPost.mockResolvedValue({ statusCode: 403, body: '' });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('403');
  });

  it('returns red when access token creation throws network error', async () => {
    const installations = [{ id: 1, account: { login: 'org' } }];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(installations) });
    mockHttpsPost.mockRejectedValue(new Error('timeout'));
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Failed to mint');
  });

  it('returns red when required permissions are missing', async () => {
    const installations = [{ id: 1, account: { login: 'org' } }];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(installations) });
    const token = { token: 'ghs_xxx', permissions: { issues: 'write', metadata: 'read' } };
    mockHttpsPost.mockResolvedValue({ statusCode: 201, body: JSON.stringify(token) });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Permission issues');
  });

  it('returns red when permissions are insufficient (read instead of write)', async () => {
    const installations = [{ id: 1, account: { login: 'org' } }];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(installations) });
    const token = {
      token: 'ghs_xxx',
      permissions: {
        contents: 'read',
        pull_requests: 'read',
        issues: 'write',
        metadata: 'read',
      },
    };
    mockHttpsPost.mockResolvedValue({ statusCode: 201, body: JSON.stringify(token) });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('needs write');
  });

  it('returns green when all permissions are correct', async () => {
    const installations = [{ id: 42, account: { login: 'org' } }];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(installations) });
    const token = { token: 'ghs_xxx', permissions: ALL_PERMISSIONS };
    mockHttpsPost.mockResolvedValue({ statusCode: 201, body: JSON.stringify(token) });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('green');
    expect(result.detail).toContain('42');
  });

  it('selects installation matching the repo owner', async () => {
    const installations = [
      { id: 1, account: { login: 'other-org' } },
      { id: 2, account: { login: 'org' } },
    ];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(installations) });
    const token = { token: 'ghs_xxx', permissions: ALL_PERMISSIONS };
    mockHttpsPost.mockResolvedValue({ statusCode: 201, body: JSON.stringify(token) });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('green');
    // Installation #2 (matching 'org') should be used
    expect(result.detail).toContain('2');
  });

  it('falls back to first installation when no owner match', async () => {
    const installations = [
      { id: 99, account: { login: 'unrelated' } },
      { id: 100, account: { login: 'also-unrelated' } },
    ];
    mockHttpsGet.mockResolvedValue({ statusCode: 200, body: JSON.stringify(installations) });
    const token = { token: 'ghs_xxx', permissions: ALL_PERMISSIONS };
    mockHttpsPost.mockResolvedValue({ statusCode: 201, body: JSON.stringify(token) });
    const result = await checkGitHubApp({ appId: '123', privateKey: validPem, repo: 'org/repo' });
    expect(result.status).toBe('green');
    expect(result.detail).toContain('99');
  });
});
