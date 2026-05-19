import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCredentialGate } from './credential-gate-run.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ferry-cgr-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, retryDelay: 50 });
});

function writeMigrations(content: string): string {
  const f = join(dir, 'MIGRATIONS.md');
  writeFileSync(f, content, 'utf8');
  return f;
}
function writeConfig(content: string): void {
  writeFileSync(join(dir, 'ferry.config.json'), content, 'utf8');
}
function writeSetupFile(): void {
  writeFileSync(
    join(dir, 'ferry-jira-automation-setup.md'),
    'POST `https://api.github.com/repos/acme/widgets/dispatches`\n',
    'utf8',
  );
}

const SILENT_DEPS = {
  listSecrets: () => [],
  promptSecret: async () => '',
  setRepoSecret: () => undefined,
};

describe('runCredentialGate', () => {
  it('code-only range → silent: ran=false, no prompts, no follow-ups', async () => {
    const mig = writeMigrations(`## v0.1.0 → v0.2.0\n- **(info)** internal only\n`);
    writeSetupFile();
    const promptSecret = vi.fn(async () => 'x');
    const setRepoSecret = vi.fn();
    const r = await runCredentialGate({
      repoRoot: dir,
      fromVersion: 'v0.1.0',
      toVersion: 'v0.2.0',
      interactive: true,
      dryRun: false,
      migrationsPath: mig,
      listSecrets: () => ['UNRELATED'],
      promptSecret,
      setRepoSecret,
    });
    expect(r.ran).toBe(false);
    expect(r.followUps).toEqual([]);
    expect(promptSecret).not.toHaveBeenCalled();
    expect(setRepoSecret).not.toHaveBeenCalled();
  });

  it('declared + already set → adopts: writes execution_path, no prompt', async () => {
    const mig = writeMigrations(
      `## v0.1.0 → v0.2.0\nrequires-secrets: CLAUDE_CODE_OAUTH_TOKEN\n\n- **(action)** a\n`,
    );
    writeSetupFile();
    writeConfig('{\n  "audit_issue": 9\n}\n');
    const promptSecret = vi.fn(async () => 'x');
    const r = await runCredentialGate({
      repoRoot: dir,
      fromVersion: 'v0.1.0',
      toVersion: 'v0.2.0',
      interactive: false,
      dryRun: false,
      migrationsPath: mig,
      listSecrets: () => ['CLAUDE_CODE_OAUTH_TOKEN'],
      promptSecret,
      setRepoSecret: () => undefined,
    });
    expect(r.ran).toBe(true);
    expect(promptSecret).not.toHaveBeenCalled();
    const cfg = JSON.parse(readFileSync(join(dir, 'ferry.config.json'), 'utf8'));
    expect(cfg.execution_path).toBe('claude-code');
  });

  it('declared + missing + interactive → prompts ONLY the missing, then adopts', async () => {
    const mig = writeMigrations(
      `## v0.1.0 → v0.2.0\nrequires-secrets: CLAUDE_CODE_OAUTH_TOKEN, OTHER\n\n- **(action)** a\n`,
    );
    writeSetupFile();
    writeConfig('{\n  "audit_issue": 9\n}\n');
    const promptSecret = vi.fn(async () => 'tok-value');
    const setRepoSecret = vi.fn();
    const r = await runCredentialGate({
      repoRoot: dir,
      fromVersion: 'v0.1.0',
      toVersion: 'v0.2.0',
      interactive: true,
      dryRun: false,
      migrationsPath: mig,
      listSecrets: () => ['OTHER'],
      promptSecret,
      setRepoSecret,
    });
    expect(r.ran).toBe(true);
    expect(promptSecret).toHaveBeenCalledTimes(1);
    expect(promptSecret).toHaveBeenCalledWith('CLAUDE_CODE_OAUTH_TOKEN');
    expect(setRepoSecret).toHaveBeenCalledWith(
      'acme/widgets',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'tok-value',
    );
    const cfg = JSON.parse(readFileSync(join(dir, 'ferry.config.json'), 'utf8'));
    expect(cfg.execution_path).toBe('claude-code');
  });

  it('declared + missing + non-interactive → stay on script + mandatory follow-up, no write', async () => {
    const mig = writeMigrations(
      `## v0.1.0 → v0.2.0\nrequires-secrets: CLAUDE_CODE_OAUTH_TOKEN\n\n- **(action)** a\n`,
    );
    writeSetupFile();
    writeConfig('{\n  "audit_issue": 9\n}\n');
    const r = await runCredentialGate({
      repoRoot: dir,
      fromVersion: 'v0.1.0',
      toVersion: 'v0.2.0',
      interactive: false,
      dryRun: false,
      migrationsPath: mig,
      ...SILENT_DEPS,
    });
    expect(r.ran).toBe(true);
    expect(r.followUps.join('\n')).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    const cfg = JSON.parse(readFileSync(join(dir, 'ferry.config.json'), 'utf8'));
    expect(cfg.execution_path).toBeUndefined();
  });

  it('explicit execution_path: script → respected, never overridden', async () => {
    const mig = writeMigrations(
      `## v0.1.0 → v0.2.0\nrequires-secrets: CLAUDE_CODE_OAUTH_TOKEN\n\n- **(action)** a\n`,
    );
    writeSetupFile();
    writeConfig('{\n  "execution_path": "script"\n}\n');
    const r = await runCredentialGate({
      repoRoot: dir,
      fromVersion: 'v0.1.0',
      toVersion: 'v0.2.0',
      interactive: true,
      dryRun: false,
      migrationsPath: mig,
      listSecrets: () => ['CLAUDE_CODE_OAUTH_TOKEN'],
      promptSecret: async () => 'x',
      setRepoSecret: () => undefined,
    });
    expect(r.ran).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, 'ferry.config.json'), 'utf8'));
    expect(cfg.execution_path).toBe('script');
  });

  it('dry-run never prompts or writes even when satisfied', async () => {
    const mig = writeMigrations(
      `## v0.1.0 → v0.2.0\nrequires-secrets: CLAUDE_CODE_OAUTH_TOKEN\n\n- **(action)** a\n`,
    );
    writeSetupFile();
    writeConfig('{\n  "audit_issue": 9\n}\n');
    const promptSecret = vi.fn(async () => 'x');
    const setRepoSecret = vi.fn();
    const r = await runCredentialGate({
      repoRoot: dir,
      fromVersion: 'v0.1.0',
      toVersion: 'v0.2.0',
      interactive: false,
      dryRun: true,
      migrationsPath: mig,
      listSecrets: () => ['CLAUDE_CODE_OAUTH_TOKEN'],
      promptSecret,
      setRepoSecret,
    });
    expect(r.ran).toBe(true);
    expect(promptSecret).not.toHaveBeenCalled();
    expect(setRepoSecret).not.toHaveBeenCalled();
    const cfg = JSON.parse(readFileSync(join(dir, 'ferry.config.json'), 'utf8'));
    expect(cfg.execution_path).toBeUndefined();
  });

  it('repo cannot be resolved → defers with an actionable follow-up, no write', async () => {
    const mig = writeMigrations(
      `## v0.1.0 → v0.2.0\nrequires-secrets: CLAUDE_CODE_OAUTH_TOKEN\n\n- **(action)** a\n`,
    );
    // No ferry-jira-automation-setup.md → owner/repo unknown.
    writeConfig('{\n  "audit_issue": 9\n}\n');
    const r = await runCredentialGate({
      repoRoot: dir,
      fromVersion: 'v0.1.0',
      toVersion: 'v0.2.0',
      interactive: true,
      dryRun: false,
      migrationsPath: mig,
      ...SILENT_DEPS,
    });
    expect(r.ran).toBe(true);
    expect(r.followUps.join('\n')).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    const cfg = JSON.parse(readFileSync(join(dir, 'ferry.config.json'), 'utf8'));
    expect(cfg.execution_path).toBeUndefined();
  });
});
