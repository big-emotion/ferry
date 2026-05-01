import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../prompt.js', () => ({
  printSuccess: vi.fn(),
  printSkip: vi.fn(),
  printError: vi.fn(),
  printWarn: vi.fn(),
  print: vi.fn(),
}));

import { listExistingSecrets, setSecret, stepSecrets } from './secrets.js';
import type { SecretEntry } from '../types.js';

const SECRET_ENTRIES: SecretEntry[] = [
  { name: 'FERRY_APP_ID', value: '12345', description: 'App ID' },
  { name: 'FERRY_PRIVATE_KEY', value: 'pem-data', description: 'Private key' },
];

describe('listExistingSecrets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns secret names from gh CLI output', () => {
    const secrets = [{ name: 'FERRY_APP_ID' }, { name: 'FERRY_PRIVATE_KEY' }];
    mockExecSync.mockReturnValue(JSON.stringify(secrets));
    const result = listExistingSecrets('org/repo');
    expect(result).toEqual(['FERRY_APP_ID', 'FERRY_PRIVATE_KEY']);
  });

  it('returns empty array when execSync throws', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command not found: gh');
    });
    const result = listExistingSecrets('org/repo');
    expect(result).toEqual([]);
  });

  it('returns empty array when JSON is malformed', () => {
    mockExecSync.mockReturnValue('not-valid-json');
    const result = listExistingSecrets('org/repo');
    expect(result).toEqual([]);
  });

  it('returns empty array when gh returns empty list', () => {
    mockExecSync.mockReturnValue('[]');
    const result = listExistingSecrets('org/repo');
    expect(result).toEqual([]);
  });
});

describe('setSecret', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls gh secret set with correct arguments', () => {
    mockExecSync.mockReturnValue('');
    setSecret('org/repo', 'FERRY_APP_ID', 'secret-value');
    expect(mockExecSync).toHaveBeenCalledWith(
      'gh secret set FERRY_APP_ID --repo org/repo',
      expect.objectContaining({ input: 'secret-value' }),
    );
  });
});

describe('stepSecrets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('sets all secrets when none exist', async () => {
    mockExecSync
      .mockReturnValueOnce('[]') // listExistingSecrets
      .mockReturnValue(''); // setSecret calls

    const result = await stepSecrets('org/repo', SECRET_ENTRIES, false);
    expect(result.ok).toBe(true);
  });

  it('skips secrets that already exist when overwrite is false', async () => {
    const existing = SECRET_ENTRIES.map((s) => ({ name: s.name }));
    mockExecSync.mockReturnValue(JSON.stringify(existing)); // both exist

    const result = await stepSecrets('org/repo', SECRET_ENTRIES, false);
    expect(result.ok).toBe(true);
    // setSecret should not have been called after listExistingSecrets
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('overwrites existing secrets when overwrite is true', async () => {
    const existing = [{ name: 'FERRY_APP_ID' }];
    mockExecSync
      .mockReturnValueOnce(JSON.stringify(existing)) // listExistingSecrets
      .mockReturnValue(''); // setSecret calls

    const result = await stepSecrets('org/repo', SECRET_ENTRIES, true);
    expect(result.ok).toBe(true);
    // Both secrets should be set even though one already existed
    expect(mockExecSync).toHaveBeenCalledTimes(3); // list + 2 sets
  });

  it('returns ok:false when setSecret throws for any secret', async () => {
    mockExecSync
      .mockReturnValueOnce('[]') // listExistingSecrets returns empty
      .mockImplementationOnce(() => {
        throw new Error('gh: not authenticated');
      }); // first setSecret fails

    const result = await stepSecrets('org/repo', SECRET_ENTRIES, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('FERRY_APP_ID');
  });

  it('returns ok:false listing all failed secrets', async () => {
    mockExecSync
      .mockReturnValueOnce('[]')
      .mockImplementation(() => {
        throw new Error('auth error');
      });

    const result = await stepSecrets('org/repo', SECRET_ENTRIES, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('FERRY_APP_ID');
      expect(result.reason).toContain('FERRY_PRIVATE_KEY');
    }
  });
});
