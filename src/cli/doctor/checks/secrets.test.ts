import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

import { listRepoSecrets, checkSecrets } from './secrets.js';

describe('listRepoSecrets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns secret names from gh output', () => {
    const secrets = [{ name: 'FERRY_APP_ID' }, { name: 'FERRY_PRIVATE_KEY' }];
    mockExecSync.mockReturnValue(JSON.stringify(secrets));
    const result = listRepoSecrets('org/repo');
    expect(result).toEqual(['FERRY_APP_ID', 'FERRY_PRIVATE_KEY']);
  });

  it('returns empty array when execSync throws', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command failed: gh');
    });
    const result = listRepoSecrets('org/repo');
    expect(result).toEqual([]);
  });

  it('returns empty array when JSON is malformed', () => {
    mockExecSync.mockReturnValue('not-valid-json');
    const result = listRepoSecrets('org/repo');
    expect(result).toEqual([]);
  });

  it('returns empty array when gh returns empty list', () => {
    mockExecSync.mockReturnValue('[]');
    const result = listRepoSecrets('org/repo');
    expect(result).toEqual([]);
  });
});

describe('checkSecrets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns green when all required secrets are present', () => {
    const allSecrets = [
      { name: 'FERRY_APP_ID' },
      { name: 'FERRY_PRIVATE_KEY' },
      { name: 'FERRY_JIRA_BASE_URL' },
      { name: 'FERRY_JIRA_EMAIL' },
      { name: 'FERRY_JIRA_API_TOKEN' },
      { name: 'FERRY_ANTHROPIC_API_KEY' },
    ];
    mockExecSync.mockReturnValue(JSON.stringify(allSecrets));
    const result = checkSecrets('org/repo');
    expect(result.status).toBe('green');
    expect(result.detail).toContain('All 6');
  });

  it('returns red when some secrets are missing', () => {
    const partial = [{ name: 'FERRY_APP_ID' }, { name: 'FERRY_PRIVATE_KEY' }];
    mockExecSync.mockReturnValue(JSON.stringify(partial));
    const result = checkSecrets('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Missing');
    expect(result.detail).toContain('FERRY_JIRA_BASE_URL');
  });

  it('returns red listing all missing secrets', () => {
    mockExecSync.mockReturnValue('[]');
    const result = checkSecrets('org/repo');
    expect(result.status).toBe('red');
    expect(result.remedy).toContain('ferry-init');
  });

  it('includes remedy with gh secret set instructions', () => {
    mockExecSync.mockReturnValue('[]');
    const result = checkSecrets('org/repo');
    expect(result.remedy).toContain('gh secret set');
  });

  it('returns green with detail mentioning the count', () => {
    const allSecrets = [
      { name: 'FERRY_APP_ID' },
      { name: 'FERRY_PRIVATE_KEY' },
      { name: 'FERRY_JIRA_BASE_URL' },
      { name: 'FERRY_JIRA_EMAIL' },
      { name: 'FERRY_JIRA_API_TOKEN' },
      { name: 'FERRY_ANTHROPIC_API_KEY' },
    ];
    mockExecSync.mockReturnValue(JSON.stringify(allSecrets));
    const result = checkSecrets('org/repo');
    expect(result.detail).toContain('FERRY_*');
  });
});
