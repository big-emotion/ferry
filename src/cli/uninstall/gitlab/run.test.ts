import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runGitlabUninstall, type GitlabUninstallOptions } from './run.js';

interface CapturedIO {
  out: string[];
  warns: string[];
  errors: string[];
}

function makeIO(): {
  io: NonNullable<GitlabUninstallOptions['io']>;
  captured: CapturedIO;
} {
  const captured: CapturedIO = { out: [], warns: [], errors: [] };
  return {
    captured,
    io: {
      print: (msg) => captured.out.push(msg),
      warn: (msg) => captured.warns.push(msg),
      error: (msg) => captured.errors.push(msg),
    },
  };
}

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'ferry-uninstall-gitlab-run-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('runGitlabUninstall — empty repo (idempotency)', () => {
  it('reports nothing to remove and returns exit code 0 when no Ferry artefacts exist', async () => {
    const dir = makeTempRepo();
    const { io, captured } = makeIO();
    const code = await runGitlabUninstall({ repoRoot: dir, apply: false, yes: true, io });
    expect(code).toBe(0);
    expect(captured.out.some((l) => l.toLowerCase().includes('nothing to remove'))).toBe(true);
    cleanup(dir);
  });
});

describe('runGitlabUninstall — dry-run by default', () => {
  it('plans changes but does not touch the filesystem unless apply=true', async () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      ['include:', "  - local: 'refine.gitlab-ci.yml'", ''].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');

    const { io, captured } = makeIO();
    const code = await runGitlabUninstall({ repoRoot: dir, apply: false, yes: true, io });

    expect(code).toBe(0);
    // File untouched on dry-run:
    expect(existsSync(join(dir, 'refine.gitlab-ci.yml'))).toBe(true);
    expect(readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8')).toContain('refine.gitlab-ci.yml');
    // Output is informative:
    expect(captured.out.some((l) => l.includes('[dry-run]'))).toBe(true);
    expect(captured.out.some((l) => l.toLowerCase().includes('dry-run'))).toBe(true);
    cleanup(dir);
  });
});

describe('runGitlabUninstall — apply removes Ferry artefacts', () => {
  it('removes Ferry includes and stub files when apply=true', async () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      [
        'stages:',
        '  - build',
        'include:',
        "  - local: 'refine.gitlab-ci.yml'",
        "  - local: 'dev.gitlab-ci.yml'",
        "  - local: 'ci/test.yml'",
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    writeFileSync(join(dir, 'dev.gitlab-ci.yml'), '# ferry', 'utf8');

    const { io } = makeIO();
    const code = await runGitlabUninstall({ repoRoot: dir, apply: true, yes: true, io });
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'refine.gitlab-ci.yml'))).toBe(false);
    expect(existsSync(join(dir, 'dev.gitlab-ci.yml'))).toBe(false);
    const after = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    expect(after).not.toContain('refine.gitlab-ci.yml');
    expect(after).not.toContain('dev.gitlab-ci.yml');
    expect(after).toContain("- local: 'ci/test.yml'");
    cleanup(dir);
  });

  it('is idempotent — a second run after apply finds nothing to remove and exits 0', async () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      ['include:', "  - local: 'refine.gitlab-ci.yml'", "  - local: 'other.yml'", ''].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');

    const first = makeIO();
    expect(await runGitlabUninstall({ repoRoot: dir, apply: true, yes: true, io: first.io })).toBe(
      0,
    );
    const second = makeIO();
    expect(await runGitlabUninstall({ repoRoot: dir, apply: true, yes: true, io: second.io })).toBe(
      0,
    );
    expect(second.captured.out.some((l) => l.toLowerCase().includes('nothing to remove'))).toBe(
      true,
    );
    cleanup(dir);
  });
});

describe('runGitlabUninstall — token revocation guidance', () => {
  it('prints the GitLab Settings URLs for revoking the access token and trigger token', async () => {
    const dir = makeTempRepo();
    // Even on a clean repo, the manual revocation guidance must be printed so
    // the user knows what to do after deleting the local CI artefacts.
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    const { io, captured } = makeIO();
    await runGitlabUninstall({ repoRoot: dir, apply: false, yes: true, io });
    const text = captured.out.join('\n');
    expect(text).toMatch(/Settings.*Access [Tt]okens/);
    expect(text).toMatch(/Settings.*CI\/CD.*Triggers/);
    expect(text).toMatch(/Settings.*CI\/CD.*Variables/);
    cleanup(dir);
  });

  it('lists each Ferry CI/CD variable to remove', async () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    const { io, captured } = makeIO();
    await runGitlabUninstall({ repoRoot: dir, apply: false, yes: true, io });
    const text = captured.out.join('\n');
    expect(text).toContain('FERRY_VERSION');
    expect(text).toContain('FERRY_GITLAB_TOKEN');
    expect(text).toContain('FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN');
    expect(text).toContain('FERRY_JIRA_API_TOKEN');
    expect(text).toContain('FERRY_AUDIT_ISSUE');
    cleanup(dir);
  });
});

describe('runGitlabUninstall — stub file kept when it leaves .gitlab-ci.yml empty', () => {
  it('keeps the orphaned .gitlab-ci.yml on disk and notifies the user', async () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.gitlab-ci.yml'),
      ['include:', "  - local: 'refine.gitlab-ci.yml'", ''].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    const { io, captured } = makeIO();
    await runGitlabUninstall({ repoRoot: dir, apply: true, yes: true, io });
    expect(existsSync(join(dir, '.gitlab-ci.yml'))).toBe(true);
    expect(captured.warns.some((w) => w.toLowerCase().includes('empty'))).toBe(true);
    cleanup(dir);
  });
});

describe('runGitlabUninstall — projectPath override (for token URL printing)', () => {
  it('uses the supplied projectPath in the revocation URLs', async () => {
    const dir = makeTempRepo();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'refine.gitlab-ci.yml'), '# ferry', 'utf8');
    const { io, captured } = makeIO();
    await runGitlabUninstall({
      repoRoot: dir,
      apply: false,
      yes: true,
      projectUrl: 'https://gitlab.example.com/acme/my-app',
      io,
    });
    const text = captured.out.join('\n');
    expect(text).toContain('https://gitlab.example.com/acme/my-app/-/settings/');
    cleanup(dir);
  });
});
