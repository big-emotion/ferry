import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockAsk = vi.hoisted(() => vi.fn<() => Promise<string>>());
const mockPrintWarn = vi.hoisted(() => vi.fn());

vi.mock('../prompt.js', () => ({
  ask: mockAsk,
  print: vi.fn(),
  printSuccess: vi.fn(),
  printWarn: mockPrintWarn,
  printError: vi.fn(),
  printSkip: vi.fn(),
}));

import { stepGitHubApp } from './github-app.js';

describe('stepGitHubApp', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns error when appId is empty', async () => {
    mockAsk.mockResolvedValue('');
    const result = await stepGitHubApp('my-org');
    expect(result.result.ok).toBe(false);
    if (!result.result.ok) expect(result.result.reason).toContain('App ID is required');
  });

  it('returns error when appId is not numeric', async () => {
    mockAsk.mockResolvedValue('not-a-number');
    const result = await stepGitHubApp('my-org');
    expect(result.result.ok).toBe(false);
    if (!result.result.ok) expect(result.result.reason).toContain('must be numeric');
  });

  it('returns error when pem path is empty', async () => {
    mockAsk
      .mockResolvedValueOnce('12345') // appId
      .mockResolvedValueOnce(''); // pem path
    const result = await stepGitHubApp('my-org');
    expect(result.result.ok).toBe(false);
    if (!result.result.ok) expect(result.result.reason).toContain('Private key path is required');
  });

  it('returns error when pem file does not exist', async () => {
    mockAsk
      .mockResolvedValueOnce('12345')
      .mockResolvedValueOnce('/nonexistent/path/does-not-exist.pem');
    const result = await stepGitHubApp('my-org');
    expect(result.result.ok).toBe(false);
    if (!result.result.ok) expect(result.result.reason).toContain('File not found');
  });

  it('returns error when file is not a PEM', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ferry-ga-test-'));
    const pemPath = join(tmpDir, 'not-a-pem.txt');
    writeFileSync(pemPath, 'this is not a pem file\n', 'utf8');

    mockAsk.mockResolvedValueOnce('12345').mockResolvedValueOnce(pemPath);

    const result = await stepGitHubApp('my-org');
    rmSync(tmpDir, { recursive: true });

    expect(result.result.ok).toBe(false);
    if (!result.result.ok) expect(result.result.reason).toContain('does not look like a PEM');
  });

  it('returns success with a valid PEM file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ferry-ga-pem-'));
    const pemPath = join(tmpDir, 'key.pem');
    writeFileSync(
      pemPath,
      '-----BEGIN CERTIFICATE-----\nfakekey\n-----END CERTIFICATE-----\n',
      'utf8',
    );

    mockAsk.mockResolvedValueOnce('12345').mockResolvedValueOnce(pemPath);

    const result = await stepGitHubApp('my-org');
    rmSync(tmpDir, { recursive: true });

    expect(result.result.ok).toBe(true);
    expect(result.appId).toBe('12345');
    expect(result.privateKey).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('shows warning when existingAppId is provided', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ferry-ga-warn-'));
    const pemPath = join(tmpDir, 'key.pem');
    writeFileSync(
      pemPath,
      '-----BEGIN CERTIFICATE-----\nfakekey\n-----END CERTIFICATE-----\n',
      'utf8',
    );

    mockAsk.mockResolvedValueOnce('99999').mockResolvedValueOnce(pemPath);

    await stepGitHubApp('my-org', '99999');
    rmSync(tmpDir, { recursive: true });

    expect(mockPrintWarn).toHaveBeenCalledWith(expect.stringContaining('99999'));
  });

  it('returns appId and empty privateKey fields on failure', async () => {
    mockAsk.mockResolvedValue('');
    const result = await stepGitHubApp('my-org');
    expect(result.appId).toBe('');
    expect(result.privateKey).toBe('');
  });
});
