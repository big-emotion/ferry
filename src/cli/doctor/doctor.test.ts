import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { renderTable } from './table.js';
import { checkWorkflowDrift } from './checks/workflows.js';
import { listRepoSecrets } from './checks/secrets.js';
import { makeAppJwt } from './checks/github-app.js';
import type { CheckResult } from './types.js';

// ── renderTable ───────────────────────────────────────────────────────────────

describe('renderTable', () => {
  it('renders green checks with ✓ icon', () => {
    const results: CheckResult[] = [
      { label: 'Secrets present', status: 'green', detail: 'All 6 secrets found' },
    ];
    const out = renderTable(results);
    expect(out).toContain('✓');
    expect(out).toContain('All 6 secrets found');
  });

  it('renders red checks with ✗ icon and remedy', () => {
    const results: CheckResult[] = [
      {
        label: 'GitHub App',
        status: 'red',
        detail: 'Token rejected',
        remedy: 'Re-download PEM',
      },
    ];
    const out = renderTable(results);
    expect(out).toContain('✗');
    expect(out).toContain('Token rejected');
    expect(out).toContain('Re-download PEM');
  });

  it('renders yellow checks with ⚠ icon and remedy', () => {
    const results: CheckResult[] = [
      { label: 'Workflow files', status: 'yellow', detail: '1 file drifted', remedy: 'rerun init' },
    ];
    const out = renderTable(results);
    expect(out).toContain('⚠');
    expect(out).toContain('rerun init');
  });

  it('renders skip checks with – icon and no remedy', () => {
    const results: CheckResult[] = [
      { label: 'Synthetic dispatch', status: 'skip', detail: 'Skipped' },
    ];
    const out = renderTable(results);
    expect(out).toContain('–');
    expect(out).not.toContain('→');
  });

  it('summary line says "All N checks passed" when all green', () => {
    const results: CheckResult[] = [
      { label: 'Check A', status: 'green', detail: 'ok' },
      { label: 'Check B', status: 'green', detail: 'ok' },
    ];
    expect(renderTable(results)).toContain('All 2 checks passed');
  });

  it('summary line mentions failures when any red', () => {
    const results: CheckResult[] = [
      { label: 'Check A', status: 'red', detail: 'fail' },
      { label: 'Check B', status: 'green', detail: 'ok' },
    ];
    expect(renderTable(results)).toContain('1 check(s) failed');
  });

  it('does not print remedy for green checks', () => {
    const results: CheckResult[] = [
      { label: 'Check A', status: 'green', detail: 'all good', remedy: 'should not appear' },
    ];
    expect(renderTable(results)).not.toContain('should not appear');
  });

  it('summary line mentions warnings when yellow but no red', () => {
    const results: CheckResult[] = [
      { label: 'Check A', status: 'yellow', detail: 'warn' },
      { label: 'Check B', status: 'green', detail: 'ok' },
    ];
    expect(renderTable(results)).toContain('warning(s)');
  });
});

// ── checkWorkflowDrift ────────────────────────────────────────────────────────

describe('checkWorkflowDrift', () => {
  it('returns red when workflow dir is missing', () => {
    const result = checkWorkflowDrift({ repoRoot: '/nonexistent/path-xyz', ferryVersion: 'v1' });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Missing');
    expect(result.remedy).toBeTruthy();
  });

  it('returns green when all files match templates', async () => {
    const { workflowTemplates } = await import('../init/templates.js');
    const repoRoot = mkdtempSync(join(tmpdir(), 'ferry-doctor-test-'));
    const workflowDir = join(repoRoot, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });

    for (const tmpl of workflowTemplates('v1')) {
      writeFileSync(join(workflowDir, tmpl.filename), tmpl.content, 'utf8');
    }

    const result = checkWorkflowDrift({ repoRoot, ferryVersion: 'v1' });
    expect(result.status).toBe('green');
    expect(result.detail).toContain('match');

    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns yellow when a file differs from the current template', async () => {
    const { workflowTemplates } = await import('../init/templates.js');
    const repoRoot = mkdtempSync(join(tmpdir(), 'ferry-doctor-drift-'));
    const workflowDir = join(repoRoot, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });

    const templates = workflowTemplates('v1');
    for (const tmpl of templates) {
      const content =
        tmpl.filename === 'ferry-refine.yml'
          ? tmpl.content + '\n# extra line — simulated drift\n'
          : tmpl.content;
      writeFileSync(join(workflowDir, tmpl.filename), content, 'utf8');
    }

    const result = checkWorkflowDrift({ repoRoot, ferryVersion: 'v1' });
    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('ferry-refine.yml');
    expect(result.remedy).toContain('--overwrite');

    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns red when some files are missing and others are present', async () => {
    const { workflowTemplates } = await import('../init/templates.js');
    const repoRoot = mkdtempSync(join(tmpdir(), 'ferry-doctor-partial-'));
    const workflowDir = join(repoRoot, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });

    const templates = workflowTemplates('v1');
    // Only install the first 3
    for (const tmpl of templates.slice(0, 3)) {
      writeFileSync(join(workflowDir, tmpl.filename), tmpl.content, 'utf8');
    }

    const result = checkWorkflowDrift({ repoRoot, ferryVersion: 'v1' });
    expect(result.status).toBe('red');

    rmSync(repoRoot, { recursive: true, force: true });
  });
});

// ── listRepoSecrets ───────────────────────────────────────────────────────────

describe('listRepoSecrets', () => {
  it('returns empty array when gh CLI is not available or repo not found', () => {
    const result = listRepoSecrets('nonexistent-org/nonexistent-repo-xyz-12345');
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── makeAppJwt ────────────────────────────────────────────────────────────────

describe('makeAppJwt', () => {
  it('throws when private key is not a valid PEM', () => {
    expect(() => makeAppJwt('12345', 'not-a-valid-pem-string')).toThrow();
  });

  it('returns a three-part JWT for a valid RSA key', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const jwt = makeAppJwt('99999', pem);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
  });

  it('JWT header decodes to RS256 algorithm', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const jwt = makeAppJwt('12345', pem);
    const [headerB64] = jwt.split('.');
    const header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString()) as {
      alg: string;
      typ: string;
    };
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
  });

  it('JWT payload contains iss matching the appId', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const jwt = makeAppJwt('42', pem);
    const parts = jwt.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(payload.iss).toBe('42');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});
