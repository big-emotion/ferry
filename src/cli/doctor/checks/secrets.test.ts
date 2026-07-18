import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
      { name: 'ANTHROPIC_API_KEY' },
    ];
    mockExecSync.mockReturnValue(JSON.stringify(allSecrets));
    const result = checkSecrets('org/repo');
    expect(result.status).toBe('green');
    expect(result.detail).toContain('All 6 required secrets found');
  });

  it('does not require the transition-id override secrets (auto-resolved from status names)', () => {
    const withoutTransitionIds = [
      { name: 'FERRY_APP_ID' },
      { name: 'FERRY_PRIVATE_KEY' },
      { name: 'FERRY_JIRA_BASE_URL' },
      { name: 'FERRY_JIRA_EMAIL' },
      { name: 'FERRY_JIRA_API_TOKEN' },
      { name: 'ANTHROPIC_API_KEY' },
    ];
    mockExecSync.mockReturnValue(JSON.stringify(withoutTransitionIds));
    const result = checkSecrets('org/repo');
    expect(result.status).toBe('green');
    expect(result.detail).toContain('auto-resolve');
    expect(result.detail).toContain('ferry.config');
  });

  it('omits the auto-resolve note when a transition-id override secret is set', () => {
    const withOverride = [
      { name: 'FERRY_APP_ID' },
      { name: 'FERRY_PRIVATE_KEY' },
      { name: 'FERRY_JIRA_BASE_URL' },
      { name: 'FERRY_JIRA_EMAIL' },
      { name: 'FERRY_JIRA_API_TOKEN' },
      { name: 'ANTHROPIC_API_KEY' },
      { name: 'FERRY_REVIEW_TRANSITION_ID' },
    ];
    mockExecSync.mockReturnValue(JSON.stringify(withOverride));
    const result = checkSecrets('org/repo');
    expect(result.status).toBe('green');
    expect(result.detail).toBe('All 6 required secrets found');
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
      { name: 'ANTHROPIC_API_KEY' },
    ];
    mockExecSync.mockReturnValue(JSON.stringify(allSecrets));
    const result = checkSecrets('org/repo');
    expect(result.detail).toContain('required secrets');
  });

  it('returns red when a transition-id override is set but a required secret is missing', () => {
    // Optional overrides must never mask a genuinely missing required secret.
    const missingJiraToken = [
      { name: 'FERRY_APP_ID' },
      { name: 'FERRY_PRIVATE_KEY' },
      { name: 'FERRY_JIRA_BASE_URL' },
      { name: 'FERRY_JIRA_EMAIL' },
      { name: 'ANTHROPIC_API_KEY' },
      { name: 'FERRY_REVIEW_TRANSITION_ID' },
      { name: 'FERRY_ITER_TRANSITION_ID' },
    ];
    mockExecSync.mockReturnValue(JSON.stringify(missingJiraToken));
    const result = checkSecrets('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('FERRY_JIRA_API_TOKEN');
  });
});

describe('checkSecrets — execution-path-aware provider secret', () => {
  let tmpRoot: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tmpRoot = mkdtempSync(join(tmpdir(), 'ferry-doctor-secrets-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const baseSecrets = [
    { name: 'FERRY_APP_ID' },
    { name: 'FERRY_PRIVATE_KEY' },
    { name: 'FERRY_JIRA_BASE_URL' },
    { name: 'FERRY_JIRA_EMAIL' },
    { name: 'FERRY_JIRA_API_TOKEN' },
  ];

  it('claude-code path requires CLAUDE_CODE_OAUTH_TOKEN, never ANTHROPIC_API_KEY', () => {
    writeFileSync(
      join(tmpRoot, 'ferry.config.json'),
      JSON.stringify({ execution_path: 'claude-code' }),
    );
    // Canonical router install: OAuth token present, NO API key (ADR-0006 §6).
    mockExecSync.mockReturnValue(
      JSON.stringify([...baseSecrets, { name: 'CLAUDE_CODE_OAUTH_TOKEN' }]),
    );
    const result = checkSecrets('org/repo', tmpRoot);
    expect(result.status).toBe('green');
    expect(result.detail).toContain('All 6 required secrets found');
  });

  it('claude-code path is red when CLAUDE_CODE_OAUTH_TOKEN is missing', () => {
    writeFileSync(
      join(tmpRoot, 'ferry.config.json'),
      JSON.stringify({ execution_path: 'claude-code' }),
    );
    mockExecSync.mockReturnValue(JSON.stringify([...baseSecrets, { name: 'ANTHROPIC_API_KEY' }]));
    const result = checkSecrets('org/repo', tmpRoot);
    expect(result.status).toBe('red');
    expect(result.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(result.detail).not.toContain('ANTHROPIC_API_KEY');
  });

  it('script path (no config) still requires ANTHROPIC_API_KEY', () => {
    mockExecSync.mockReturnValue(
      JSON.stringify([...baseSecrets, { name: 'CLAUDE_CODE_OAUTH_TOKEN' }]),
    );
    const result = checkSecrets('org/repo', tmpRoot);
    expect(result.status).toBe('red');
    expect(result.detail).toContain('ANTHROPIC_API_KEY');
  });
});
